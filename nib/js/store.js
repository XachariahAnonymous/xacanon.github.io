/* =====================================================================
   NIBCOIN TCG — Storage / Backend Layer (unified)
   -------------------------------------------------------------------
   Two backends behind ONE API (so app.js / admin.js don't care which):
     • LOCAL   (NIB_CONFIG.enabled === false) — localStorage demo.
     • FIREBASE(NIB_CONFIG.enabled === true)  — Firestore + Cloud
       Functions. Pack RNG runs server-side (can't be cheated); wallet
       auth via signed-message custom tokens.
   Getters are synchronous (read an in-memory cache); mutations that hit
   the network are async. `NIB.store.ready` resolves when initial data
   has loaded — bootstrap the UI off that.
   Attaches to window.NIB.store
   ===================================================================== */
(function (NIB) {
  "use strict";
  const CFG = window.NIB_CONFIG || { enabled: false };
  const LIVE = !!CFG.enabled;
  const KEY = "nibcoin.v1";
  const DAILY_AMOUNT = 100, DAILY_COOLDOWN = 24 * 3600 * 1000, PACK_COIN_REWARD = 20;
  const SELL_PRICE = 0.1;  // NIB per duplicate card sold
  const round2 = (n) => Math.round(n * 100) / 100;

  // Extra copies beyond the first of each card, from a collection array.
  function duplicateCopies(collection) {
    const byCard = {};
    collection.forEach((n) => (byCard[n.cardId] = byCard[n.cardId] || []).push(n));
    const dupes = [];
    Object.values(byCard).forEach((copies) => {
      copies.sort((a, b) => (a.serial || 0) - (b.serial || 0)).slice(1).forEach((c) => dupes.push(c));
    });
    return dupes;   // the sellable extras (keeps one of each)
  }

  const DEFAULT_CONFIG = () => ({
    packsEnabled: true,
    packPriceTokens: 5,
    bonusRareEnabled: true,
    dropRateOverrides: null,
    welcomeBalance: 0,
    onchain: {
      network: "devnet", rpcUrl: "", mintAddress: "",
      treasuryWallet: "", paymentsEnabled: false, mintingEnabled: false, linked: false,
    },
  });

  // in-memory cache read by all getters (populated by either backend)
  const cache = {
    uid: null, email: null, displayName: null, walletAddress: null, verified: false,
    balance: 0, adminFlag: false,
    config: DEFAULT_CONFIG(),
    collection: [], openings: [],
    supply: {}, global: {}, minted: {}, admins: [],
    overrides: {},   // cardId -> edited fields (merged over the built-in catalog)
    battleTeam: null, // own battle team + ladder record
    coins: 0,        // battle-shop currency
    items: {},       // owned battle items { itemId: count }
    lastDaily: 0,    // last daily-bonus claim (ms)
  };

  const emit = () => window.dispatchEvent(new CustomEvent("nib:change"));
  const short = (s) => s && s.length > 12 ? s.slice(0, 4) + "…" + s.slice(-4) : s;
  const toMillis = (t) => !t ? 0 : (t.toMillis ? t.toMillis()
    : (t.seconds ? t.seconds * 1000 : (typeof t === "string" ? Date.parse(t) : +t)));

  // ---- shared getters ----------------------------------------------
  const G = {
    isLive: () => LIVE,
    isLoggedIn: () => !!cache.uid,
    uid: () => cache.uid,
    email: () => cache.email,
    displayName: () => cache.displayName,
    // human label for the identity pill (name > email > short wallet)
    wallet: () => cache.displayName || cache.email || (cache.walletAddress ? short(cache.walletAddress) : null),
    walletAddress: () => cache.walletAddress,
    isVerified: () => cache.verified,
    balance: () => cache.balance,
    config: () => cache.config,
    collection: () => cache.collection,
    openings: () => cache.openings,
    isAdmin: () => cache.adminFlag,
    admins: () => cache.admins.slice(),

    // Card metadata as the player sees it: built-in catalog + admin edits.
    card(id) {
      const base = NIB.catalog.byId(id);
      const ov = cache.overrides[id];
      if (!base && !ov) return null;
      const merged = Object.assign({}, base, ov);
      if (ov && ov.stats) merged.stats = Object.assign({}, base && base.stats, ov.stats);
      return merged;
    },
    cardBack: () => (cache.config.appearance && cache.config.appearance.cardBackUrl) || null,
    battleTeam: () => cache.battleTeam,
    coins: () => cache.coins || 0,
    items: () => cache.items || {},
    sellPrice: () => SELL_PRICE,
    duplicateCount: () => duplicateCopies(cache.collection).length,
    duplicateValue: () => round2(duplicateCopies(cache.collection).length * SELL_PRICE),
    dailyStatus() {
      const rem = DAILY_COOLDOWN - (Date.now() - (cache.lastDaily || 0));
      return { ready: rem <= 0, nextInMs: Math.max(0, rem), amount: DAILY_AMOUNT };
    },

    // A player's own pack history, reconstructed from owned copies
    // (grouped by openingId) — no extra reads/permissions needed.
    orders() {
      const map = {};
      cache.collection.forEach((n) => {
        const oid = n.openingId || ("legacy-" + toMillis(n.mintedAt));
        (map[oid] = map[oid] || { id: oid, at: toMillis(n.mintedAt), cards: [] }).cards.push(n);
      });
      return Object.values(map).sort((a, b) => b.at - a.at);
    },

    mintedCount: (cardId) => cache.minted[cardId] || 0,   // LOCAL only

    supplyByTier() {
      const tiers = {};
      NIB.catalog.all().forEach((c) => {
        const t = (tiers[c.rarity] = tiers[c.rarity] || { minted: 0, cap: 0, designs: 0 });
        t.cap += c.mintCap; t.designs += 1;
        if (!LIVE) t.minted += cache.minted[c.id] || 0;
      });
      if (LIVE) for (const r in tiers) tiers[r].minted = cache.supply[r] || 0;
      return tiers;
    },
    rarityDistribution() {
      const dist = {};
      cache.collection.forEach((n) => {
        const r = n.rarity || NIB.catalog.byId(n.cardId).rarity;
        dist[r] = (dist[r] || 0) + 1;
      });
      return dist;
    },
    globalStats: () => cache.global,
  };

  // ===================================================================
  //  LOCAL BACKEND
  // ===================================================================
  const Local = (() => {
    let state;
    function load() {
      try {
        const raw = localStorage.getItem(KEY);
        state = raw ? JSON.parse(raw) : null;
      } catch (e) { state = null; }
      const base = { loggedIn: false, uid: null, email: null, displayName: null, walletAddress: null,
        balance: 100, minted: {}, collection: [], openings: [], config: DEFAULT_CONFIG(), admins: [], overrides: {}, battleTeam: null,
        coins: 150, items: { potion: 1, bomb: 1 }, lastDaily: 0 };
      state = Object.assign(base, state || {});
      if (typeof state.balance !== "number" && typeof state.tokenBalance === "number") state.balance = state.tokenBalance;
      syncCache();
    }
    function syncCache() {
      cache.uid = state.loggedIn ? state.uid : null;
      cache.email = state.email; cache.displayName = state.displayName; cache.walletAddress = state.walletAddress;
      cache.verified = true;              // demo accounts are always "verified"
      cache.balance = state.balance;
      cache.minted = state.minted; cache.collection = state.collection;
      cache.openings = state.openings; cache.config = Object.assign(DEFAULT_CONFIG(), state.config);
      cache.overrides = state.overrides || {};
      cache.battleTeam = state.battleTeam;
      cache.coins = state.coins || 0; cache.items = state.items || {}; cache.lastDaily = state.lastDaily || 0;
      cache.adminFlag = state.loggedIn;   // demo: any logged-in user is an admin
      cache.supply = {};                  // computed in supplyByTier for LOCAL
    }
    const persist = () => { localStorage.setItem(KEY, JSON.stringify(state)); syncCache(); emit(); };

    // Demo auth: accepts anything, no real password check.
    async function signUp(email, _pass, name) { return signIn(email, _pass, name); }
    async function signIn(email, _pass, name) {
      state.loggedIn = true; state.uid = "local-" + (email || "player");
      state.email = email || "demo@nibcoin.local";
      state.displayName = name || (email ? email.split("@")[0] : "Player");
      persist(); return state.uid;
    }
    async function signInGoogle() { return signIn("demo@google.local", "", "Google Player"); }
    async function connectWallet() {
      const p = window.phantom?.solana || window.solana || window.solflare || window.backpack;
      let pk;
      try { if (p?.connect) { const r = await p.connect(); pk = (r?.publicKey || p.publicKey)?.toString(); } } catch (e) {}
      state.walletAddress = pk || "DEMO-" + Math.random().toString(36).slice(2, 8).toUpperCase();
      persist(); return state.walletAddress;
    }
    function disconnect() { state.loggedIn = false; state.uid = null; persist(); }
    async function sendVerification() { /* demo: already verified */ }
    async function reloadUser() { /* demo: no-op */ }
    async function setDisplayName(name) { state.displayName = name; persist(); }

    function reserve(cardId) {
      const card = NIB.catalog.byId(cardId);
      const used = state.minted[cardId] || 0;
      if (used >= card.mintCap) return false;
      state.minted[cardId] = used + 1; return true;
    }
    async function buyAndOpenPack() {
      const cfg = state.config;
      if (!state.loggedIn) return { ok: false, error: "Log in first." };
      if (!cfg.packsEnabled) return { ok: false, error: "Pack sales are paused." };
      if (state.balance < cfg.packPriceTokens) return { ok: false, error: "Insufficient NIB balance." };
      state.balance -= cfg.packPriceTokens;
      const ecfg = JSON.parse(JSON.stringify(NIB.engine.DEFAULT_CONFIG));
      ecfg.bonusRare.enabled = cfg.bonusRareEnabled;
      if (cfg.dropRateOverrides) ecfg.chaseTable = cfg.dropRateOverrides;
      const slots = NIB.engine.openPack(G.poolLocal(), reserve, ecfg);
      const serials = slots.map((s) => state.minted[s.cardId]);
      state.coins = (state.coins || 0) + PACK_COIN_REWARD;
      const opening = { id: "pk_" + Date.now().toString(36), wallet: state.walletAddress || state.email, cost: cfg.packPriceTokens, slots, serials, coinsEarned: PACK_COIN_REWARD, at: new Date().toISOString() };
      slots.forEach((s, i) => state.collection.push({ cardId: s.cardId, rarity: s.rarity, serial: serials[i], openingId: opening.id, mintedAt: opening.at }));
      state.openings.push(opening);
      persist();
      return { ok: true, opening };
    }
    // built-in catalog + admin overrides + custom (override-only) cards
    function mergedCatalog() {
      const base = NIB.catalog.all().map((c) => G.card(c.id));
      const extra = Object.keys(state.overrides)
        .filter((id) => !NIB.catalog.byId(id)).map((id) => G.card(id)).filter(Boolean);
      return base.concat(extra);
    }
    G.poolLocal = () => mergedCatalog()
      .filter((c) => c.isActive !== false)
      .map((c) => ({ ...c, mintedCount: state.minted[c.id] || 0 }));

    function setConfig(patch) { Object.assign(state.config, patch); persist(); }
    function grantTokens(n) { state.balance += n; persist(); }
    async function loadCardStats(rarity, element, limit = 400) {
      return mergedCatalog()
        .filter((c) => (!rarity || c.rarity === rarity) && (!element || c.element === element))
        .slice(0, limit).map((c) => ({ ...c, mintedCount: state.minted[c.id] || 0 }));
    }
    async function seedCatalog() { return { written: NIB.catalog.count(), note: "LOCAL mode: catalogue is in-memory." }; }
    async function adminGrantTokens(_w, amount) { state.balance += Number(amount); persist(); }
    function addAdmin(pk) { if (!state.admins.includes(pk)) { state.admins.push(pk); persist(); } }
    function removeAdmin(pk) { state.admins = state.admins.filter((a) => a !== pk); persist(); }
    function resetAll() { localStorage.removeItem(KEY); load(); emit(); }

    // ---- card editing (demo) ----
    async function updateCard(id, patch) {
      const cur = state.overrides[id] || {};
      state.overrides[id] = Object.assign({}, cur, patch);
      if (patch.stats) state.overrides[id].stats = Object.assign({}, cur.stats, patch.stats);
      persist();
    }
    async function bulkUpdateCards(filter, patch) {
      let n = 0;
      NIB.catalog.all().forEach((c) => {
        if ((!filter.rarity || c.rarity === filter.rarity) && (!filter.element || c.element === filter.element)) {
          const cur = state.overrides[c.id] || {};
          state.overrides[c.id] = Object.assign({}, cur, patch);
          if (patch.stats) state.overrides[c.id].stats = Object.assign({}, cur.stats, patch.stats);
          n++;
        }
      });
      persist(); return { updated: n };
    }
    async function setAppearance(patch) { state.config.appearance = Object.assign({}, state.config.appearance, patch); persist(); }
    async function uploadImage(file) {   // demo: inline as a data URI
      return await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    }
    async function createCard(card) {
      state.overrides[card.id] = Object.assign({ isActive: true }, card);
      persist(); return { id: card.id };
    }
    async function deleteCard(id) {
      if (NIB.catalog.byId(id)) state.overrides[id] = Object.assign({}, state.overrides[id], { isActive: false });
      else delete state.overrides[id];
      persist();
    }

    // ---- battle (demo) ----
    async function saveBattleTeam(cardIds) {
      const cur = state.battleTeam || { rating: 1000, wins: 0, losses: 0 };
      state.battleTeam = Object.assign(cur, { uid: state.uid, name: state.displayName, teamCardIds: cardIds });
      cache.battleTeam = state.battleTeam; persist();
    }
    async function recordBattleResult(win) {
      const t = state.battleTeam || (state.battleTeam = { rating: 1000, wins: 0, losses: 0, teamCardIds: [] });
      t.rating = Math.max(0, t.rating + (win ? 20 : -15)); t[win ? "wins" : "losses"]++;
      cache.battleTeam = t; persist();
    }
    // ---- coins & items (demo) ----
    async function earnCoins(n) { state.coins = (state.coins || 0) + Number(n); persist(); }
    async function buyCoins(nib) {
      if (state.balance < nib) throw new Error("Not enough NIB");
      state.balance -= Number(nib); state.coins = (state.coins || 0) + nib * NIB.battle.COIN_PER_NIB; persist();
    }
    async function buyItem(id, price) {
      if ((state.coins || 0) < price) throw new Error("Not enough coins");
      state.coins -= price; state.items[id] = (state.items[id] || 0) + 1; persist();
    }
    async function consumeItem(id) {
      if ((state.items[id] || 0) <= 0) return;
      state.items[id]--; persist();
    }
    async function claimDaily() {
      if (!G.dailyStatus().ready) throw new Error("Daily bonus not ready yet");
      state.coins = (state.coins || 0) + DAILY_AMOUNT; state.lastDaily = Date.now(); persist();
      return { amount: DAILY_AMOUNT };
    }
    // ---- sell duplicates for NIB (demo) ----
    function sellSet(dupes) {
      const ids = new Set(dupes);
      state.collection = state.collection.filter((n) => !ids.has(n));
      state.balance = round2(state.balance + dupes.length * SELL_PRICE);
      persist(); return { sold: dupes.length, nib: round2(dupes.length * SELL_PRICE) };
    }
    async function sellDuplicates(cardId) {
      const dupes = duplicateCopies(state.collection).filter((n) => n.cardId === cardId);
      return dupes.length ? sellSet(dupes) : { sold: 0, nib: 0 };
    }
    async function sellAllDuplicates() {
      const dupes = duplicateCopies(state.collection);
      return dupes.length ? sellSet(dupes) : { sold: 0, nib: 0 };
    }
    // Demo: synthesize a few bot opponents so PvP is playable offline.
    async function listOpponents() {
      const names = ["ShadowByte", "PixelKnight", "NovaQueen", "RiftRunner", "AshWarden"];
      const diffs = ["easy", "medium", "hard", "medium", "hard"];
      return names.map((name, i) => ({
        uid: "bot-" + i, name, rating: 900 + i * 90, wins: 5 + i * 3, losses: 2 + i,
        teamCardIds: NIB.battle.generateNpcTeam(diffs[i], 3).map((c) => c.id), bot: true,
      }));
    }

    return {
      init: async () => { load(); }, signUp, signIn, signInGoogle, connectWallet, disconnect,
      sendVerification, reloadUser, setDisplayName,
      buyAndOpenPack, setConfig, grantTokens, loadCardStats,
      seedCatalog, adminGrantTokens, addAdmin, removeAdmin, resetAll,
      updateCard, bulkUpdateCards, setAppearance, uploadImage, createCard, deleteCard,
      saveBattleTeam, recordBattleResult, listOpponents,
      earnCoins, buyCoins, buyItem, consumeItem, claimDaily,
      sellDuplicates, sellAllDuplicates,
    };
  })();

  // ===================================================================
  //  FIREBASE BACKEND
  // ===================================================================
  // -------------------------------------------------------------------
  //  FIREBASE (SPARK / client-only) — no Cloud Functions.
  //  Email/Password (+ optional Google) accounts via Firebase Auth.
  //  Admins are accounts that also have an admins/<uid> doc. Firestore
  //  Rules enforce integrity; the pack roll runs client-side (honest
  //  engine) and rules cap-guard every card write. See firestore.rules.
  // -------------------------------------------------------------------
  const Fire = (() => {
    let auth, dbf, FV;
    const WELCOME = 25;                 // must match welcome() in firestore.rules
    let unsub = [], userUnsub = [];

    async function init() {
      firebase.initializeApp(CFG.firebase);
      auth = firebase.auth();
      dbf = firebase.firestore();
      FV = firebase.firestore.FieldValue;
      auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
      subscribePublic();                // config + stats are public-read
      auth.onAuthStateChanged((u) => u ? onSignedIn(u) : onSignedOut());
    }

    function subscribePublic() {
      unsub.push(dbf.doc("config/game").onSnapshot((d) => {
        cache.config = Object.assign(DEFAULT_CONFIG(), d.exists ? d.data() : {}); emit();
      }));
      unsub.push(dbf.doc("stats/global").onSnapshot((d) => { cache.global = d.data() || {}; emit(); }));
      unsub.push(dbf.doc("stats/supply").onSnapshot((d) => { cache.supply = d.data() || {}; emit(); }));
      // admin card edits, merged over the built-in catalog for display
      unsub.push(dbf.doc("config/catalogOverrides").onSnapshot((d) => { cache.overrides = d.data() || {}; emit(); }));
    }

    async function onSignedIn(u) {
      cache.uid = u.uid; cache.email = u.email; cache.verified = !!u.emailVerified;
      cache.displayName = u.displayName || (u.email || "").split("@")[0];
      const ref = dbf.doc(`users/${u.uid}`);
      // The doc is created by signUp/signInGoogle; subscribe to it here.
      userUnsub.push(ref.onSnapshot((d) => {
        const p = d.data() || {};
        cache.balance = p.tokenBalance || 0;
        cache.walletAddress = p.wallet || null;
        cache.coins = p.coins || 0; cache.items = p.items || {}; cache.lastDaily = p.lastDailyCoins || 0;
        if (p.displayName) cache.displayName = p.displayName;
        emit();
      }));
      userUnsub.push(dbf.collection(`users/${u.uid}/collection`).onSnapshot((s) => {
        cache.collection = s.docs.map((x) => Object.assign({ _id: x.id }, x.data())); emit();
      }));
      userUnsub.push(dbf.doc(`admins/${u.uid}`).onSnapshot((d) => {
        const wasAdmin = cache.adminFlag; cache.adminFlag = d.exists;
        if (cache.adminFlag && !wasAdmin) subscribeAdmin();
        emit();
      }));
      userUnsub.push(dbf.doc(`battleTeams/${u.uid}`).onSnapshot((d) => { cache.battleTeam = d.exists ? d.data() : null; emit(); }));
      emit();
    }
    function subscribeAdmin() {
      userUnsub.push(dbf.collection("packOpenings").orderBy("at", "desc").limit(50)
        .onSnapshot((s) => { cache.openings = s.docs.map((x) => x.data()); emit(); }));
      userUnsub.push(dbf.collection("admins").onSnapshot((s) => { cache.admins = s.docs.map((x) => x.id); emit(); }));
    }
    function onSignedOut() {
      userUnsub.forEach((f) => f && f()); userUnsub = [];
      cache.uid = null; cache.email = null; cache.displayName = null; cache.walletAddress = null;
      cache.verified = false; cache.balance = 0; cache.adminFlag = false;
      cache.collection = []; cache.openings = []; emit();
    }

    // create the profile doc exactly once (transaction => a clean create)
    async function ensureProfile(user, name) {
      const ref = dbf.doc(`users/${user.uid}`);
      await dbf.runTransaction(async (tx) => {
        const d = await tx.get(ref);
        if (!d.exists) tx.set(ref, {
          email: user.email || null, displayName: name || user.displayName || (user.email || "").split("@")[0],
          wallet: null, tokenBalance: WELCOME, packsOpened: 0,
          coins: 150, items: { potion: 1, bomb: 1 }, createdAt: FV.serverTimestamp(),
        });
      });
    }

    // ---- account auth ----
    async function signUp(email, password, name) {
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      if (name) await cred.user.updateProfile({ displayName: name }).catch(() => {});
      await ensureProfile(cred.user, name);
      await cred.user.sendEmailVerification().catch(() => {});   // verification email
      cache.verified = !!cred.user.emailVerified; emit();
      return cred.user.uid;
    }
    async function signIn(email, password) {
      const cred = await auth.signInWithEmailAndPassword(email, password);
      return cred.user.uid;
    }
    async function signInGoogle() {
      const provider = new firebase.auth.GoogleAuthProvider();
      const cred = await auth.signInWithPopup(provider);
      await ensureProfile(cred.user);            // Google emails are pre-verified
      return cred.user.uid;
    }
    async function resetPassword(email) { await auth.sendPasswordResetEmail(email); }
    async function sendVerification() {
      if (auth.currentUser) await auth.currentUser.sendEmailVerification();
    }
    async function reloadUser() {
      if (!auth.currentUser) return false;
      await auth.currentUser.reload();
      // Force a fresh ID token so the email_verified claim reaches
      // Firestore Rules (reload() alone doesn't refresh the token).
      if (auth.currentUser.emailVerified) await auth.currentUser.getIdToken(true);
      cache.verified = !!auth.currentUser.emailVerified; emit();
      return cache.verified;
    }
    async function setDisplayName(name) {
      if (!auth.currentUser) throw new Error("Log in first.");
      await auth.currentUser.updateProfile({ displayName: name }).catch(() => {});
      await dbf.doc(`users/${auth.currentUser.uid}`).set({ displayName: name }, { merge: true });
    }

    // Optional: link a Solana wallet address to the logged-in account.
    async function connectWallet() {
      if (!auth.currentUser) throw new Error("Log in first.");
      const p = window.phantom?.solana || window.solana || window.solflare || window.backpack;
      if (!p?.connect) throw new Error("No Solana wallet extension found.");
      const r = await p.connect();
      const pubkey = (r?.publicKey || p.publicKey)?.toString();
      await dbf.doc(`users/${auth.currentUser.uid}`).set({ wallet: pubkey }, { merge: true });
      return pubkey;
    }
    async function disconnect() { await auth.signOut(); }

    // Query one in-stock card of a rarity (index: rarity+soldOut+rand).
    async function pickAvailable(rarity, r, dir) {
      const s = await dbf.collection("cards")
        .where("rarity", "==", rarity).where("soldOut", "==", false)
        .where("rand", dir === "asc" ? ">=" : "<", r)
        .orderBy("rand", dir).limit(1).get();
      if (s.empty) return null;
      const d = s.docs[0];
      return { id: d.id, ref: d.ref, mintedCount: d.data().mintedCount, mintCap: d.data().mintCap, rarity };
    }
    async function selectCard(desired) {
      const start = NIB.engine.RARITY_ORDER.indexOf(desired);
      for (let t = start; t >= 0; t--) {
        const rarity = NIB.engine.RARITY_ORDER[t];
        const r = Math.random();
        const card = (await pickAvailable(rarity, r, "asc")) || (await pickAvailable(rarity, r, "desc"));
        if (card && card.mintedCount < card.mintCap) return { ...card, downtiered: t !== start };
      }
      throw new Error("Card pool exhausted — has the catalogue been seeded?");
    }

    async function buyAndOpenPack() {
      const cfg = cache.config;
      if (!cache.uid) return { ok: false, error: "Log in first." };
      if (cfg.packsEnabled === false) return { ok: false, error: "Pack sales are paused." };
      const price = Number(cfg.packPriceTokens || 5);
      if (cache.balance < price) return { ok: false, error: "Insufficient NIB balance." };

      // Roll the 6 rarities (honest client engine), then pick concrete cards.
      const ecfg = JSON.parse(JSON.stringify(NIB.engine.DEFAULT_CONFIG));
      ecfg.bonusRare.enabled = cfg.bonusRareEnabled !== false;
      if (cfg.dropRateOverrides) ecfg.chaseTable = cfg.dropRateOverrides;
      // reuse the planner from the engine via a dummy pool of one-per-rarity
      const rarities = planRarities(ecfg);

      let chosen;
      try { chosen = []; for (const r of rarities) chosen.push(await selectCard(r)); }
      catch (e) { return { ok: false, error: e.message }; }

      // Build the atomic batch fresh each attempt (a WriteBatch can't be
      // reused after commit). Returns { openRef, slots, label }.
      const uid = cache.uid;
      const label = cache.walletAddress || cache.email || uid;
      const buildBatch = () => {
        const batch = dbf.batch();
        const openRef = dbf.collection("packOpenings").doc();
        const slots = [];
        chosen.forEach((c) => {
          const serial = c.mintedCount + 1;
          batch.update(c.ref, { mintedCount: FV.increment(1), soldOut: serial >= c.mintCap });
          const copyRef = dbf.collection(`users/${uid}/collection`).doc();
          batch.set(copyRef, { cardId: c.id, rarity: c.rarity, serial, mintAddress: null, openingId: openRef.id, mintedAt: FV.serverTimestamp() });
          slots.push({ cardId: c.id, rarity: c.rarity, serial });
        });
        batch.update(dbf.doc(`users/${uid}`), { tokenBalance: FV.increment(-price), packsOpened: FV.increment(1), coins: FV.increment(PACK_COIN_REWARD) });
        batch.set(openRef, { uid, wallet: label, cost: price, slots, at: FV.serverTimestamp() });
        batch.set(dbf.doc("stats/global"), { packsOpened: FV.increment(1), tokensCollected: FV.increment(price), cardsMinted: FV.increment(slots.length) }, { merge: true });
        const supply = {}; slots.forEach((s) => supply[s.rarity] = FV.increment(1));
        batch.set(dbf.doc("stats/supply"), supply, { merge: true });
        return { batch, openRef, slots };
      };

      let built = buildBatch();
      try {
        await built.batch.commit();
      } catch (e) {
        // Most common cause: a stale ID token (email just verified but the
        // cached token still says unverified). Force-refresh once and retry.
        if (isPermError(e) && auth.currentUser) {
          try {
            await auth.currentUser.getIdToken(true);
            cache.verified = !!auth.currentUser.emailVerified;
            built = buildBatch();
            await built.batch.commit();
          } catch (e2) {
            return { ok: false, error: verifyHint(e2) };
          }
        } else {
          return { ok: false, error: verifyHint(e) };
        }
      }

      const { openRef, slots } = built;
      const opening = { id: openRef.id, wallet: label, cost: price, slots, serials: slots.map((s) => s.serial), coinsEarned: PACK_COIN_REWARD, at: new Date().toISOString() };
      return { ok: true, opening };
    }
    const isPermError = (e) => e && (e.code === "permission-denied" || /permission/i.test(e.message || ""));
    const verifyHint = (e) => isPermError(e)
      ? (cache.verified ? "Pack open was blocked. Try logging out and back in." : "Verify your email before opening packs.")
      : "Pack open failed (try again). " + (e.message || "");

    // Same rarity planner the engine uses (fixed slots + bonus + chase).
    function planRarities(ecfg) {
      const plan = [];
      const rng = () => { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] / 2 ** 32; };
      for (const s of ecfg.fixedSlots) for (let i = 0; i < s.count; i++) plan.push(s.rarity);
      if (ecfg.bonusRare.enabled && rng() < ecfg.bonusRare.chance) {
        const idx = plan.indexOf(ecfg.bonusRare.from); if (idx !== -1) plan[idx] = ecfg.bonusRare.to;
      }
      // chase slot
      let cum = 0, roll = rng(), chase = ecfg.chaseFloor;
      Object.entries(ecfg.chaseTable).sort((a, b) => NIB.engine.RARITY_ORDER.indexOf(b[0]) - NIB.engine.RARITY_ORDER.indexOf(a[0]))
        .forEach(([r, p]) => { if (roll >= cum && roll < cum + p) chase = r; cum += p; });
      plan.push(chase);
      return plan;
    }

    async function setConfig(patch) { await dbf.doc("config/game").set(patch, { merge: true }); }
    function grantTokens() { /* no self-faucet in live mode */ }
    async function loadCardStats(rarity, element, limit = 400) {
      let q = dbf.collection("cards");
      if (rarity) q = q.where("rarity", "==", rarity);
      if (element) q = q.where("element", "==", element);
      const s = await q.limit(limit).get();
      return s.docs.map((d) => d.data());
    }
    // Client-side seed (admin-gated by rules). ~1,710 writes in batches.
    async function seedCatalog() {
      const cards = NIB.catalog.all();
      let written = 0;
      for (let i = 0; i < cards.length; i += 400) {
        const batch = dbf.batch();
        cards.slice(i, i + 400).forEach((c) => {
          batch.set(dbf.doc(`cards/${c.id}`), { ...c, mintedCount: 0, soldOut: false, rand: Math.random(), isActive: true }, { merge: true });
          written++;
        });
        await batch.commit();
      }
      return { written };
    }
    // Grant by target uid (admins can read the users list to find uids).
    async function adminGrantTokens(uid, amount) {
      await dbf.doc(`users/${uid}`).set({ tokenBalance: FV.increment(Number(amount)) }, { merge: true });
    }
    async function addAdmin(uid) { await dbf.doc(`admins/${uid}`).set({ role: "admin", at: FV.serverTimestamp() }); }
    async function removeAdmin(uid) { await dbf.doc(`admins/${uid}`).delete(); }
    function resetAll() { /* not available in live mode */ }

    // ---- card editing ----
    // Write to cards/{id} (source of truth for pack logic) AND mirror the
    // deltas into config/catalogOverrides (cheap client-side display).
    async function updateCard(id, patch) {
      await dbf.doc(`cards/${id}`).set(patch, { merge: true });
      await dbf.doc("config/catalogOverrides").set({ [id]: patch }, { merge: true });
    }
    async function bulkUpdateCards(filter, patch) {
      const targets = NIB.catalog.all().filter((c) =>
        (!filter.rarity || c.rarity === filter.rarity) && (!filter.element || c.element === filter.element));
      let updated = 0;
      for (let i = 0; i < targets.length; i += 300) {
        const batch = dbf.batch();
        const ovPatch = {};
        targets.slice(i, i + 300).forEach((c) => {
          batch.set(dbf.doc(`cards/${c.id}`), patch, { merge: true });
          ovPatch[c.id] = patch; updated++;
        });
        batch.set(dbf.doc("config/catalogOverrides"), ovPatch, { merge: true });
        await batch.commit();
      }
      return { updated };
    }
    async function setAppearance(patch) {
      await dbf.doc("config/game").set({ appearance: patch }, { merge: true });
    }
    // Upload to Firebase Storage and return the download URL. Requires
    // Storage enabled + the storage SDK + storage rules (see README).
    async function uploadImage(file, pathHint) {
      if (!firebase.storage) throw new Error("Firebase Storage not loaded. Paste an image URL instead, or enable Storage.");
      const path = `art/${pathHint || "img"}-${Date.now()}-${file.name}`.replace(/\s+/g, "_");
      const ref = firebase.storage().ref().child(path);
      await ref.put(file);
      return await ref.getDownloadURL();
    }
    // Create a brand-new card: full record (pack logic) + override (display).
    async function createCard(card) {
      const full = Object.assign({ mintedCount: 0, soldOut: false, rand: Math.random(), isActive: true }, card);
      await dbf.doc(`cards/${card.id}`).set(full);
      await dbf.doc("config/catalogOverrides").set({ [card.id]: card }, { merge: true });
      return { id: card.id };
    }
    // Delete: remove the card doc (drops it from pack pool). Built-in cards
    // are marked inactive in the overrides; custom cards are fully removed.
    async function deleteCard(id) {
      await dbf.doc(`cards/${id}`).delete().catch(() => {});
      if (NIB.catalog.byId(id)) await dbf.doc("config/catalogOverrides").set({ [id]: { isActive: false } }, { merge: true });
      else await dbf.doc("config/catalogOverrides").set({ [id]: FV.delete() }, { merge: true });
    }

    // ---- battle (public battleTeams collection = PvP snapshots + ladder) ----
    async function saveBattleTeam(cardIds) {
      const cur = cache.battleTeam || {};
      await dbf.doc(`battleTeams/${cache.uid}`).set({
        uid: cache.uid, name: cache.displayName || cache.email || "Player",
        teamCardIds: cardIds, rating: cur.rating || 1000,
        wins: cur.wins || 0, losses: cur.losses || 0, updatedAt: FV.serverTimestamp(),
      }, { merge: true });
    }
    async function recordBattleResult(win) {
      await dbf.doc(`battleTeams/${cache.uid}`).set({
        rating: FV.increment(win ? 20 : -15),
        wins: FV.increment(win ? 1 : 0), losses: FV.increment(win ? 0 : 1),
      }, { merge: true });
    }
    async function listOpponents(limit = 50) {
      const s = await dbf.collection("battleTeams").orderBy("rating", "desc").limit(limit).get();
      return s.docs.map((d) => d.data()).filter((t) => t.uid !== cache.uid && (t.teamCardIds || []).length);
    }

    // ---- coins & items ----
    async function earnCoins(n) { await dbf.doc(`users/${cache.uid}`).update({ coins: FV.increment(Number(n)) }); }
    async function buyCoins(nib) {
      if ((cache.balance || 0) < nib) throw new Error("Not enough NIB");
      await dbf.doc(`users/${cache.uid}`).update({ tokenBalance: FV.increment(-nib), coins: FV.increment(nib * NIB.battle.COIN_PER_NIB) });
    }
    async function buyItem(id, price) {
      if ((cache.coins || 0) < price) throw new Error("Not enough coins");
      await dbf.doc(`users/${cache.uid}`).update({ coins: FV.increment(-price), ["items." + id]: FV.increment(1) });
    }
    async function consumeItem(id) {
      if ((cache.items[id] || 0) <= 0) return;
      await dbf.doc(`users/${cache.uid}`).update({ ["items." + id]: FV.increment(-1) });
    }
    async function claimDaily() {
      if (!G.dailyStatus().ready) throw new Error("Daily bonus not ready yet");
      await dbf.doc(`users/${cache.uid}`).update({ coins: FV.increment(DAILY_AMOUNT), lastDailyCoins: Date.now() });
      return { amount: DAILY_AMOUNT };
    }
    // ---- sell duplicates for NIB ----
    async function sellCopies(dupes) {
      const uid = cache.uid;
      for (let i = 0; i < dupes.length; i += 400) {
        const batch = dbf.batch();
        dupes.slice(i, i + 400).forEach((n) => batch.delete(dbf.doc(`users/${uid}/collection/${n._id}`)));
        batch.update(dbf.doc(`users/${uid}`), { tokenBalance: FV.increment(round2(dupes.slice(i, i + 400).length * SELL_PRICE)) });
        await batch.commit();
      }
      return { sold: dupes.length, nib: round2(dupes.length * SELL_PRICE) };
    }
    async function sellDuplicates(cardId) {
      const dupes = duplicateCopies(cache.collection).filter((n) => n.cardId === cardId && n._id);
      return dupes.length ? sellCopies(dupes) : { sold: 0, nib: 0 };
    }
    async function sellAllDuplicates() {
      const dupes = duplicateCopies(cache.collection).filter((n) => n._id);
      return dupes.length ? sellCopies(dupes) : { sold: 0, nib: 0 };
    }

    return {
      init, signUp, signIn, signInGoogle, resetPassword, connectWallet, disconnect,
      sendVerification, reloadUser, setDisplayName,
      buyAndOpenPack, setConfig, grantTokens,
      loadCardStats, seedCatalog, adminGrantTokens, addAdmin, removeAdmin, resetAll,
      updateCard, bulkUpdateCards, setAppearance, uploadImage, createCard, deleteCard,
      saveBattleTeam, recordBattleResult, listOpponents,
      earnCoins, buyCoins, buyItem, consumeItem, claimDaily,
      sellDuplicates, sellAllDuplicates,
    };
  })();

  // ---- pick backend + expose unified API ---------------------------
  const Backend = LIVE ? Fire : Local;
  const ready = Backend.init();
  const noop = async () => {};

  NIB.store = Object.assign({}, G, {
    ready,
    signUp: (...a) => Backend.signUp(...a),
    signIn: (...a) => Backend.signIn(...a),
    signInGoogle: (...a) => Backend.signInGoogle(...a),
    resetPassword: (...a) => (Backend.resetPassword ? Backend.resetPassword(...a) : noop()),
    sendVerification: (...a) => Backend.sendVerification(...a),
    reloadUser: (...a) => Backend.reloadUser(...a),
    setDisplayName: (...a) => Backend.setDisplayName(...a),
    connectWallet: (...a) => Backend.connectWallet(...a),
    disconnect: (...a) => Backend.disconnect(...a),
    buyAndOpenPack: (...a) => Backend.buyAndOpenPack(...a),
    setConfig: (...a) => Backend.setConfig(...a),
    grantTokens: (...a) => Backend.grantTokens(...a),
    loadCardStats: (...a) => Backend.loadCardStats(...a),
    seedCatalog: (...a) => Backend.seedCatalog(...a),
    adminGrantTokens: (...a) => Backend.adminGrantTokens(...a),
    addAdmin: (...a) => Backend.addAdmin(...a),
    removeAdmin: (...a) => Backend.removeAdmin(...a),
    resetAll: (...a) => Backend.resetAll(...a),
    updateCard: (...a) => Backend.updateCard(...a),
    bulkUpdateCards: (...a) => Backend.bulkUpdateCards(...a),
    setAppearance: (...a) => Backend.setAppearance(...a),
    uploadImage: (...a) => Backend.uploadImage(...a),
    createCard: (...a) => Backend.createCard(...a),
    deleteCard: (...a) => Backend.deleteCard(...a),
    saveBattleTeam: (...a) => Backend.saveBattleTeam(...a),
    recordBattleResult: (...a) => Backend.recordBattleResult(...a),
    listOpponents: (...a) => Backend.listOpponents(...a),
    earnCoins: (...a) => Backend.earnCoins(...a),
    buyCoins: (...a) => Backend.buyCoins(...a),
    buyItem: (...a) => Backend.buyItem(...a),
    consumeItem: (...a) => Backend.consumeItem(...a),
    claimDaily: (...a) => Backend.claimDaily(...a),
    sellDuplicates: (...a) => Backend.sellDuplicates(...a),
    sellAllDuplicates: (...a) => Backend.sellAllDuplicates(...a),
  });
})(window.NIB = window.NIB || {});
