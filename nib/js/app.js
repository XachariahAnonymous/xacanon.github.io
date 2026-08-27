/* =====================================================================
   LOLCOIN TCG — Player App UI  (index.html)
   Attaches to window.NIB.app
   ===================================================================== */
(function (NIB) {
  "use strict";
  const { store, catalog, matrix } = NIB;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  let currentTab = "store";
  let ripping = false;        // true while a pack-rip animation is playing
  let lastOpening = null;     // most recent pull, for repainting on re-render
  let flippedSlots = new Set(); // which pull cards the player has flipped face-up

  function fmtDuration(ms) {
    const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
  const nibFmt = (v) => String(Math.round((+v || 0) * 100) / 100);
  function toast(msg, isErr) {
    const t = document.createElement("div");
    t.className = "toast" + (isErr ? " err" : "");
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  // ---- card rendering ----------------------------------------------
  function cardEl(card, opts = {}) {
    const el = document.createElement("div");
    const shiny = ["super_rare", "ultra_rare", "mega_rare", "hidden_rare"].includes(card.rarity);
    el.className = `tcard r-${card.rarity}` + (shiny ? " shiny" : "") + ((card.fullImage && card.imageUrl) ? " full" : "");
    el.style.setProperty("--ec", matrix.META[card.element].color);
    if (opts.count > 1) el.classList.add("stacked");
    el.innerHTML = `
      <div class="foil"></div>
      ${opts.count > 1 ? `<div class="count">×${opts.count}</div>` : (opts.serial ? `<div class="serial">#${opts.serial}</div>` : "")}
      <div class="art">${card.imageUrl
        ? `<img class="art-img" src="${card.imageUrl}" alt="" onerror="this.replaceWith(document.createTextNode('${matrix.META[card.element].glyph}'))">`
        : matrix.META[card.element].glyph}</div>
      <div class="info">
        <div class="nm">${card.name}</div>
        <div class="meta">
          <span class="lvl">Lv ${card.level}${card.upgradeTier ? ` <span style="color:var(--gold)">★${card.upgradeTier}</span>` : ""}</span>
          <span class="elem" title="${matrix.META[card.element].label}">${matrix.META[card.element].glyph}</span>
        </div>
        <div style="margin-top:6px"><span class="badge">${card.rarityLabel}</span></div>
      </div>`;
    if (!opts.noClick) el.onclick = () => openCardModal(card, opts.serial);
    return el;
  }

  // A pull card that starts face-down (NIB back) and flips to the front
  // on click. Flip state is tracked in `flippedSlots` so it survives the
  // store re-renders. Once revealed, clicking again opens the detail modal.
  function revealCardEl(card, serial, index) {
    const wrap = document.createElement("div");
    // start flipped (no transition) if this slot was already revealed
    wrap.className = "flip-card" + (flippedSlots.has(index) ? " flipped" : "");
    const inner = document.createElement("div");
    inner.className = "flip-inner";

    const back = document.createElement("div");
    back.className = "flip-face flip-back";
    const backUrl = store.cardBack && store.cardBack();
    back.innerHTML = backUrl
      ? `<div class="cardback" style="background:#0b0d1a"><img class="art-img" src="${backUrl}" alt=""><div class="cb-tap">tap to reveal</div></div>`
      : `<div class="cardback"><div class="cb-logo">🃏</div><div class="cb-t">LOL</div><div class="cb-tap">tap to reveal</div></div>`;

    const front = document.createElement("div");
    front.className = "flip-face flip-front";
    front.appendChild(cardEl(card, { serial, noClick: true }));

    inner.appendChild(back); inner.appendChild(front);
    wrap.appendChild(inner);

    wrap.addEventListener("click", () => {
      if (!wrap.classList.contains("flipped")) { wrap.classList.add("flipped"); flippedSlots.add(index); }
      else openCardModal(card, serial);
    });
    return wrap;
  }

  function openCardModal(card, serial, owned) {
    const p = matrix.profile(card.element);
    const chip = (e) => `<span class="pill"><span>${e.glyph}</span>${e.label}</span>`;
    const dupCount = owned && owned.count ? owned.count - 1 : 0;
    const ownedHtml = owned && owned.count
      ? `<div style="margin-top:14px"><div class="muted" style="font-size:12px;margin-bottom:6px">YOU OWN ${owned.count}</div>
           <div class="row">${owned.serials.slice().sort((a, b) => a - b).map((s) => `<span class="pill mono">#${s}</span>`).join("")}</div>
           ${dupCount > 0 ? `<button class="btn gold sm" id="sellCardDupes" style="margin-top:10px">Sell ${dupCount} duplicate${dupCount > 1 ? "s" : ""} → ${nibFmt(dupCount * store.sellPrice())} LOL</button>` : ""}</div>`
      : "";
    const ab = NIB.battle && NIB.battle.abilityFor(card);
    const abilityHtml = ab
      ? `<div style="margin-top:14px"><div class="muted" style="font-size:12px;margin-bottom:6px">ABILITY</div>
           <span class="pill">${ab.glyph} <b>${ab.name}</b></span> <span class="muted" style="font-size:12px">${ab.desc}</span></div>`
      : "";
    const owns = store.isLoggedIn() && store.collection().some((n) => n.cardId === card.id);
    const upTier = store.cardTier(card.id), upCost = store.upgradeCost(card.id);
    const upgradeHtml = owns
      ? `<div style="margin-top:14px"><div class="muted" style="font-size:12px;margin-bottom:6px">LEVEL UP ${upTier > 0 ? `· <span style="color:var(--gold)">★${upTier}</span> / ${store.upgradeMax}` : `· 0 / ${store.upgradeMax}`}</div>
           ${upCost != null
             ? `<button class="btn gold sm" id="upBtn">Level up → 🪙 ${upCost}</button> <span class="muted" style="font-size:12px">+8% stats, +1 level</span>`
             : `<span class="badge" style="background:var(--gold)">MAX LEVEL</span>`}</div>`
      : "";
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.innerHTML = `
      <div class="panel modal r-${card.rarity}" style="position:relative">
        <span class="close">&times;</span>
        <div class="row" style="gap:18px;align-items:flex-start">
          <div class="tcard r-${card.rarity} ${["super_rare","ultra_rare","mega_rare","hidden_rare"].includes(card.rarity)?"shiny":""} ${card.fullImage && card.imageUrl ? "full" : ""}"
               style="width:150px;flex:none;--ec:${matrix.META[card.element].color}">
            <div class="foil"></div>
            <div class="art">${card.imageUrl ? `<img class="art-img" src="${card.imageUrl}" alt="">` : matrix.META[card.element].glyph}</div>
            <div class="info"><div class="nm">${card.name}</div></div>
          </div>
          <div style="flex:1;min-width:200px">
            <h2 style="margin-bottom:4px">${card.name}</h2>
            <div class="row" style="gap:8px">
              <span class="badge">${card.rarityLabel}</span>
              <span class="pill">${p.glyph} ${p.label}</span>
              <span class="pill">Lv ${card.level}</span>
              ${serial ? `<span class="pill mono">#${serial}</span>` : ""}
            </div>
            <div class="grid cols-3" style="margin-top:14px">
              <div class="panel" style="padding:10px;text-align:center"><div class="muted" style="font-size:12px">ATK</div><div class="stat small">${card.stats.attack}</div></div>
              <div class="panel" style="padding:10px;text-align:center"><div class="muted" style="font-size:12px">DEF</div><div class="stat small">${card.stats.defense}</div></div>
              <div class="panel" style="padding:10px;text-align:center"><div class="muted" style="font-size:12px">HP</div><div class="stat small">${card.stats.hp}</div></div>
            </div>
          </div>
        </div>
        <div style="margin-top:18px">
          <div class="muted" style="font-size:12px;margin-bottom:6px">STRONG AGAINST (×${matrix.DAMAGE_MULTIPLIER})</div>
          <div class="row">${p.strongAgainst.map(chip).join("") || "<span class='muted'>—</span>"}</div>
          <div class="muted" style="font-size:12px;margin:14px 0 6px">WEAK AGAINST (×${matrix.RESIST_MULTIPLIER})</div>
          <div class="row">${p.weakAgainst.map(chip).join("") || "<span class='muted'>—</span>"}</div>
        </div>
        ${abilityHtml}
        ${upgradeHtml}
        ${ownedHtml}
      </div>`;
    ov.onclick = (e) => { if (e.target === ov || e.target.classList.contains("close")) ov.remove(); };
    document.body.appendChild(ov);
    $("#upBtn", ov)?.addEventListener("click", async () => {
      try { const r = await store.upgradeCard(card.id); toast(`Leveled up to ★${r.tier}!`); ov.remove(); openCardModal(store.card(card.id), serial, owned); }
      catch (e) { toast(e.message || "Upgrade failed", true); }
    });
    $("#sellCardDupes", ov)?.addEventListener("click", async () => {
      if (!window.confirm(`Sell ${dupCount} duplicate${dupCount > 1 ? "s" : ""} of ${card.name} for ${nibFmt(dupCount * store.sellPrice())} LOL?`)) return;
      try { const r = await store.sellDuplicates(card.id); toast(`Sold ${r.sold} → +${nibFmt(r.nib)} LOL`); ov.remove(); render(); }
      catch (e) { toast(e.message || "Sell failed", true); }
    });
  }

  // ---- STORE / PACK OPENING ----------------------------------------
  function renderStore() {
    const cfg = store.config();
    const bal = store.balance();
    const canBuy = store.isLoggedIn() && store.isVerified() && cfg.packsEnabled && bal >= cfg.packPriceTokens;
    return `
      ${verifyBanner()}
      <div class="grid cols-2" style="align-items:start">
        <div class="panel">
          <h2>Booster Pack</h2>
          <p class="muted">6 cards · 1 guaranteed Rare or higher.</p>
          <div class="stage">
            <div class="pack" id="pack">
              <div class="rays"></div>
              <div class="pack-glow"></div>
              <div class="pack-body">
                <div class="pack-shine"></div>
                ${(store.cardFront && store.cardFront())
                  ? `<img class="pk-art" src="${store.cardFront()}" alt="">`
                  : `<div class="pk-logo">🃏</div><div class="pk-t">LOL</div>`}
              </div>
              <div class="pack-top"><span class="pull-tab">PULL ▸</span></div>
            </div>
          </div>
          <div class="row" style="justify-content:space-between;margin-top:10px">
            <span class="pill">💰 Cost: <b>${cfg.packPriceTokens} LOL</b></span>
            <span class="pill">Balance: <b>${nibFmt(bal)} LOL</b></span>
          </div>
          <button class="btn gold" id="buyBtn" style="width:100%;margin-top:14px" ${canBuy ? "" : "disabled"}>
            ${!store.isLoggedIn() ? "Log in to buy"
              : !store.isVerified() ? "Verify your email to buy"
              : !cfg.packsEnabled ? "Sales paused"
              : bal < cfg.packPriceTokens ? "Insufficient LOL"
              : "Rip Pack — " + cfg.packPriceTokens + " LOL"}
          </button>
          ${!store.isLoggedIn() ? `<button class="btn" id="loginCta" style="width:100%;margin-top:8px">Log in / Sign up</button>` : ""}
          ${store.isLive() ? "" : `<button class="btn ghost sm" id="faucet" style="margin-top:8px">+ Get 50 demo LOL</button>`}
        </div>
        <div class="panel">
          <h3>Drop Rates</h3>
          <table>
            <tr><th>Tier</th><th>Per pack</th></tr>
            <tr><td><span class="badge r-common">Common</span></td><td>3 fixed</td></tr>
            <tr><td><span class="badge r-uncommon">Uncommon</span></td><td>2 fixed</td></tr>
            <tr><td><span class="badge r-rare">Rare</span></td><td>1 guaranteed +10% bonus</td></tr>
            <tr><td><span class="badge r-super_rare">Super Rare</span></td><td>5%</td></tr>
            <tr><td><span class="badge r-ultra_rare">Ultra Rare</span></td><td>2%</td></tr>
            <tr><td><span class="badge r-mega_rare">Mega Rare</span></td><td>1%</td></tr>
            <tr><td><span class="badge r-hidden_rare">Hidden Rare</span></td><td>0.01%</td></tr>
          </table>
          <p class="muted" style="font-size:12px;margin-top:12px">Odds enforced server-side in production. ${catalog.count()} unique designs in circulation.</p>
        </div>
      </div>
      <div id="revealArea" class="panel hidden" style="margin-top:16px">
        <div class="row" style="justify-content:space-between;align-items:center">
          <h3 style="margin:0">Your Pull <span class="muted" style="font-size:13px">— tap each card to flip</span></h3>
          <button class="btn ghost sm" id="flipAll">Flip all</button>
        </div>
        <div class="reveal" id="reveal" style="margin-top:12px"></div>
      </div>`;
  }

  function wireStore() {
    const buy = async () => {
      if (ripping) return;
      ripping = true;                         // guard change-handler during animation
      if ($("#buyBtn")) $("#buyBtn").disabled = true;
      const res = await store.buyAndOpenPack();
      if (!res.ok) { ripping = false; renderTopbar(); return toast(res.error, true); }
      playRip(res.opening);
    };
    $("#buyBtn")?.addEventListener("click", buy);
    $("#pack")?.addEventListener("click", () => { if (!$("#buyBtn").disabled) buy(); });
    $("#faucet")?.addEventListener("click", () => { store.grantTokens(50); toast("+50 LOL granted"); });
    $("#loginCta")?.addEventListener("click", () => openAuthModal());
    wireVerifyBanner();
    // repaint prior pull on re-render (flip state restored from flippedSlots)
    if (lastOpening) paintReveal(lastOpening, false);
  }

  // Verify-email notice shown until the account confirms its email.
  function verifyBanner() {
    if (!store.isLoggedIn() || store.isVerified()) return "";
    return `<div class="panel" id="verifyBanner" style="margin-bottom:16px;border-color:var(--gold);display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <span style="font-size:22px">✉️</span>
      <div style="flex:1;min-width:200px">
        <b>Verify your email to open packs.</b>
        <div class="muted" style="font-size:13px">We sent a link to <span class="mono">${store.email() || ""}</span>. Click it, then hit “I’ve verified”.</div>
      </div>
      <button class="btn sm" id="vbCheck">I’ve verified</button>
      <button class="btn ghost sm" id="vbResend">Resend</button>
    </div>`;
  }
  function wireVerifyBanner() {
    $("#vbResend")?.addEventListener("click", async () => {
      try { await store.sendVerification(); toast("Verification email sent"); }
      catch (e) { toast(e.message || "Could not send", true); }
    });
    $("#vbCheck")?.addEventListener("click", async () => {
      const ok = await store.reloadUser();
      if (ok) { toast("Email verified — you're good to go!"); render(); }
      else toast("Not verified yet — check your inbox", true);
    });
  }

  // ---- AUTH MODAL (login / signup) ---------------------------------
  function openAuthModal(mode) {
    mode = mode || "login";
    const ov = document.createElement("div");
    ov.className = "overlay";
    const render = (m) => `
      <div class="panel modal" style="max-width:400px;position:relative">
        <span class="close">&times;</span>
        <h2 style="margin-bottom:4px">${m === "signup" ? "Create account" : "Welcome back"}</h2>
        <p class="muted" style="font-size:13px">${m === "signup" ? "Sign up to start collecting." : "Log in to your LOLCOIN account."}</p>
        ${m === "signup" ? `<label class="field">Display name</label><input id="auName" placeholder="Collector name">` : ""}
        <label class="field">Email</label><input id="auEmail" type="email" placeholder="you@email.com" autocomplete="email">
        <label class="field">Password</label><input id="auPass" type="password" placeholder="••••••••" autocomplete="${m === "signup" ? "new-password" : "current-password"}">
        <div id="auErr" class="muted" style="color:var(--danger);font-size:13px;min-height:18px;margin-top:8px"></div>
        <button class="btn gold" id="auGo" style="width:100%;margin-top:6px">${m === "signup" ? "Sign up" : "Log in"}</button>
        ${store.isLive() ? `<button class="btn ghost" id="auGoogle" style="width:100%;margin-top:8px">Continue with Google</button>` : ""}
        <div class="row" style="justify-content:space-between;margin-top:12px;font-size:13px">
          <a href="#" id="auSwitch">${m === "signup" ? "Have an account? Log in" : "New here? Create account"}</a>
          ${m === "login" && store.isLive() ? `<a href="#" id="auForgot">Forgot?</a>` : ""}
        </div>
      </div>`;
    ov.innerHTML = render(mode);
    document.body.appendChild(ov);

    const wire = (m) => {
      const err = (msg) => { $("#auErr").textContent = msg; };
      const busy = (b) => { const g = $("#auGo"); if (g) { g.disabled = b; g.textContent = b ? "…" : (m === "signup" ? "Sign up" : "Log in"); } };
      $("#auGo").onclick = async () => {
        const email = $("#auEmail").value.trim(), pass = $("#auPass").value, name = $("#auName")?.value.trim();
        if (!email || !pass) return err("Email and password required.");
        busy(true);
        try {
          if (m === "signup") { await store.signUp(email, pass, name); ov.remove(); toast(store.isLive() ? "Account created — check your email to verify" : "Account created"); }
          else { await store.signIn(email, pass); ov.remove(); toast("Logged in"); }
        } catch (e) { busy(false); err(friendly(e)); }
      };
      $("#auGoogle") && ($("#auGoogle").onclick = async () => {
        try { await store.signInGoogle(); ov.remove(); toast("Logged in"); }
        catch (e) { err(friendly(e)); }
      });
      $("#auForgot") && ($("#auForgot").onclick = async (e) => {
        e.preventDefault(); const email = $("#auEmail").value.trim();
        if (!email) return err("Enter your email first.");
        try { await store.resetPassword(email); err(""); toast("Password reset email sent"); } catch (ex) { err(friendly(ex)); }
      });
      $("#auSwitch").onclick = (e) => { e.preventDefault(); const nm = m === "signup" ? "login" : "signup"; ov.innerHTML = render(nm); wire(nm); };
      $("#auPass").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#auGo").click(); });
    };
    wire(mode);
    ov.addEventListener("click", (e) => { if (e.target === ov || e.target.classList.contains("close")) ov.remove(); });
  }
  function friendly(e) {
    const m = (e && e.code) || (e && e.message) || "";
    if (m.includes("email-already-in-use")) return "That email is already registered — log in instead.";
    if (m.includes("invalid-email")) return "That doesn't look like a valid email.";
    if (m.includes("weak-password")) return "Password should be at least 6 characters.";
    if (m.includes("wrong-password") || m.includes("invalid-credential")) return "Wrong email or password.";
    if (m.includes("user-not-found")) return "No account with that email.";
    if (m.includes("too-many-requests")) return "Too many attempts — try again shortly.";
    if (m.includes("popup-closed")) return "Google sign-in was cancelled.";
    return (e && e.message) || "Something went wrong.";
  }

  // Draw the 6 pulled cards face-down (flip on click). Data-driven so
  // handlers survive re-renders.
  function paintReveal(opening, animate) {
    const area = $("#revealArea"), grid = $("#reveal");
    if (!area || !grid) return;
    area.classList.remove("hidden");
    grid.innerHTML = "";
    opening.slots.forEach((s, i) => {
      const card = store.card(s.cardId);
      const el = revealCardEl(card, opening.serials?.[i], i);
      if (animate) el.style.animationDelay = (i * 0.12) + "s";
      else el.style.animation = "none", el.style.opacity = "1";
      grid.appendChild(el);
    });
    const flipAll = $("#flipAll");
    if (flipAll) flipAll.onclick = () => $$("#reveal .flip-card").forEach((c, i) => {
      flippedSlots.add(i); setTimeout(() => c.classList.add("flipped"), i * 90);
    });
  }

  const RARITY_COLOR = {
    common: "#9aa3c0", uncommon: "#4fcf6b", rare: "#3aa0ff", super_rare: "#b06bff",
    ultra_rare: "#ff6bd6", mega_rare: "#ff9a3c", hidden_rare: "#ffd75a",
  };
  function spawnParticles(stage, best, count) {
    const color = RARITY_COLOR[best] || "#ffd75a";
    for (let i = 0; i < count; i++) {
      const s = document.createElement("div");
      s.className = "spark";
      const ang = Math.random() * Math.PI * 2;
      const dist = 70 + Math.random() * 150;
      s.style.setProperty("--tx", (Math.cos(ang) * dist).toFixed(0) + "px");
      s.style.setProperty("--ty", (Math.sin(ang) * dist - 40).toFixed(0) + "px"); // bias upward
      s.style.setProperty("--sc", color);
      s.style.setProperty("--sd", (0.7 + Math.random() * 0.5).toFixed(2) + "s");
      s.style.animationDelay = (Math.random() * 0.18).toFixed(2) + "s";
      stage.appendChild(s);
      setTimeout(() => s.remove(), 1300);
    }
  }

  // Staged opening: anticipation shake -> foil tears off + light burst
  // + sparks -> pack dissolves -> cards fly out.
  function playRip(opening) {
    const pack = $("#pack"), stage = pack.closest(".stage");
    const best = bestRarity(opening.slots);   // opening.serials already set by the backend
    const big = ["ultra_rare", "mega_rare", "hidden_rare"].includes(best);
    flippedSlots = new Set();                  // fresh pull starts all face-down

    pack.classList.remove("tearing");
    pack.classList.add("shake");

    setTimeout(() => {                       // 1) tear + burst
      pack.classList.remove("shake");
      pack.classList.add("tearing");
      spawnParticles(stage, best, big ? 30 : 16);
      if (big) { const f = $("#flash"); f.classList.add("go"); setTimeout(() => f.classList.remove("go"), 800); }
    }, 480);

    setTimeout(() => {                       // 2) reveal cards
      lastOpening = opening;
      pack.classList.remove("tearing");      // reset pack for the next rip
      paintReveal(opening, true);
      $("#revealArea").scrollIntoView({ behavior: "smooth", block: "nearest" });
      if (["mega_rare", "hidden_rare"].includes(best)) toast("🌟 " + catalog.RARITY_LABEL[best] + " pulled!");
      if (opening.coinsEarned) toast(`🪙 +${opening.coinsEarned} coins`);
      renderTopbar();
      // Keep `ripping` true during the flip so incidental snapshots don't
      // wipe it; once it finishes, re-render the store so the buy button
      // re-enables and the balance updates (the reveal is repainted intact).
      setTimeout(() => { ripping = false; if (currentTab === "store") render(); }, 700);
    }, 1320);
  }

  function bestRarity(slots) {
    const order = NIB.engine.RARITY_ORDER;
    return slots.reduce((b, s) => order.indexOf(s.rarity) > order.indexOf(b) ? s.rarity : b, "common");
  }

  // ---- COLLECTION ---------------------------------------------------
  const filters = { element: "", rarity: "", level: "" };
  let colSort = "rarity", colGroup = "rarity";

  // Group owned copies into stacks: one entry per unique card + count.
  function buildStacks() {
    const map = {};
    store.collection().forEach((n) => {
      const card = store.card(n.cardId);
      if (!card) return;                              // deleted custom card
      const st = map[n.cardId] || (map[n.cardId] = { card, count: 0, serials: [] });
      st.count++; st.serials.push(n.serial);
    });
    let stacks = Object.values(map).filter((s) =>
      (!filters.element || s.card.element === filters.element) &&
      (!filters.rarity || s.card.rarity === filters.rarity) &&
      (!filters.level || s.card.level === +filters.level));
    const order = NIB.engine.RARITY_ORDER;
    const cmp = {
      rarity: (a, b) => order.indexOf(b.card.rarity) - order.indexOf(a.card.rarity) || b.card.level - a.card.level,
      count:  (a, b) => b.count - a.count || order.indexOf(b.card.rarity) - order.indexOf(a.card.rarity),
      level:  (a, b) => b.card.level - a.card.level,
      name:   (a, b) => (a.card.name || "").localeCompare(b.card.name || ""),
      element:(a, b) => a.card.element.localeCompare(b.card.element) || order.indexOf(b.card.rarity) - order.indexOf(a.card.rarity),
    };
    stacks.sort(cmp[colSort] || cmp.rarity);
    return stacks;
  }

  function renderCollection() {
    const totalCards = store.collection().length;
    const stacks = buildStacks();
    const uniqueOwned = new Set(store.collection().map((n) => n.cardId)).size;
    const totalDesigns = catalog.count();
    const pct = (uniqueOwned / totalDesigns * 100).toFixed(1);
    const opt = (v, l, sel) => `<option value="${v}" ${sel === v ? "selected" : ""}>${l}</option>`;
    return `
      <div class="panel" style="margin-bottom:16px">
        <div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
          <div>
            <h2 style="margin:0">Collection</h2>
            <div class="muted" style="font-size:13px;margin-top:2px">${totalCards} cards · ${uniqueOwned}/${totalDesigns} unique (${pct}%)</div>
            ${store.duplicateCount() > 0 ? `<button class="btn gold sm" id="sellAllDupes" style="margin-top:8px">Sell ${store.duplicateCount()} duplicate${store.duplicateCount() > 1 ? "s" : ""} → ${nibFmt(store.duplicateValue())} LOL</button>` : ""}
          </div>
          <div class="row" style="flex-wrap:wrap">
            <select id="fElement"><option value="">All Elements</option>${matrix.ELEMENTS.map((e) => opt(e, matrix.META[e].glyph + " " + matrix.META[e].label, filters.element)).join("")}</select>
            <select id="fRarity"><option value="">All Rarities</option>${Object.keys(catalog.RARITY_LABEL).map((r) => opt(r, catalog.RARITY_LABEL[r], filters.rarity)).join("")}</select>
            <select id="fLevel"><option value="">All Levels</option>${[...Array(10)].map((_, i) => opt(String(i + 1), "Lv " + (i + 1), filters.level)).join("")}</select>
            <select id="cSort">${[["rarity", "Rarity"], ["count", "Most owned"], ["level", "Level"], ["name", "Name"], ["element", "Element"]].map(([v, l]) => opt(v, "Sort: " + l, colSort)).join("")}</select>
            <select id="cGroup">${[["none", "No grouping"], ["rarity", "By rarity"], ["element", "By element"]].map(([v, l]) => opt(v, "Group: " + l, colGroup)).join("")}</select>
          </div>
        </div>
      </div>
      ${totalCards === 0
        ? `<div class="gate"><div><h3>No cards yet</h3><p class="muted">Head to the Store and rip your first pack.</p></div></div>`
        : `<div id="colBody"></div>`}`;
  }

  function stackTile(s) {
    const el = cardEl(s.card, { count: s.count, serial: s.count === 1 ? s.serials[0] : undefined });
    el.onclick = () => openCardModal(s.card, s.count === 1 ? s.serials[0] : undefined, s);
    return el;
  }

  function wireCollection() {
    ["Element", "Rarity", "Level"].forEach((k) => {
      const sel = $("#f" + k); if (!sel) return;
      sel.onchange = () => { filters[k.toLowerCase()] = sel.value; render(); };
    });
    $("#cSort") && ($("#cSort").onchange = (e) => { colSort = e.target.value; render(); });
    $("#cGroup") && ($("#cGroup").onchange = (e) => { colGroup = e.target.value; render(); });
    $("#sellAllDupes") && ($("#sellAllDupes").onclick = async () => {
      const n = store.duplicateCount();
      if (!window.confirm(`Sell ${n} duplicate card${n > 1 ? "s" : ""} for ${nibFmt(store.duplicateValue())} LOL? One of each card is always kept.`)) return;
      try { const r = await store.sellAllDuplicates(); toast(`Sold ${r.sold} → +${nibFmt(r.nib)} LOL`); render(); }
      catch (e) { toast(e.message || "Sell failed", true); }
    });
    const body = $("#colBody");
    if (!body) return;
    const stacks = buildStacks();
    if (colGroup === "none") {
      const grid = document.createElement("div"); grid.className = "cardgrid";
      stacks.forEach((s) => grid.appendChild(stackTile(s)));
      body.appendChild(grid);
      return;
    }
    // grouped: section headers
    const keyOf = (s) => colGroup === "rarity" ? s.card.rarity : s.card.element;
    const groupsOrder = colGroup === "rarity" ? NIB.engine.RARITY_ORDER.slice().reverse() : matrix.ELEMENTS;
    const label = (k) => colGroup === "rarity" ? catalog.RARITY_LABEL[k] : (matrix.META[k].glyph + " " + matrix.META[k].label);
    groupsOrder.forEach((k) => {
      const inGroup = stacks.filter((s) => keyOf(s) === k);
      if (!inGroup.length) return;
      const owned = inGroup.reduce((n, s) => n + s.count, 0);
      const sec = document.createElement("div"); sec.style.marginBottom = "20px";
      sec.innerHTML = `<div class="row" style="justify-content:space-between;margin:6px 2px 10px">
        <h3 style="margin:0">${colGroup === "rarity" ? `<span class="badge r-${k}">${label(k)}</span>` : label(k)}</h3>
        <span class="muted" style="font-size:13px">${inGroup.length} designs · ${owned} cards</span></div>
        <div class="cardgrid"></div>`;
      const grid = sec.querySelector(".cardgrid");
      inGroup.forEach((s) => grid.appendChild(stackTile(s)));
      body.appendChild(sec);
    });
  }

  // ---- CODEX (browse all designs + elemental chart) ----------------
  function renderCodex() {
    return `
      <div class="panel">
        <h2>Elemental Matrix</h2>
        <p class="muted">Attacking element gains ×${matrix.DAMAGE_MULTIPLIER} vs. what it beats; ×${matrix.RESIST_MULTIPLIER} into what it's weak to.</p>
        <div class="cardgrid" style="grid-template-columns:repeat(auto-fill,minmax(210px,1fr))">
          ${matrix.ELEMENTS.map((e) => {
            const p = matrix.profile(e);
            return `<div class="panel" style="padding:14px;border-color:${p.color}">
              <div class="row" style="justify-content:space-between"><b>${p.glyph} ${p.label}</b></div>
              <div class="muted" style="font-size:12px;margin-top:8px">Beats</div>
              <div class="row">${p.strongAgainst.map((x) => `<span class="pill">${x.glyph}</span>`).join("")}</div>
              <div class="muted" style="font-size:12px;margin-top:8px">Weak to</div>
              <div class="row">${p.weakAgainst.map((x) => `<span class="pill">${x.glyph}</span>`).join("")}</div>
            </div>`;
          }).join("")}
        </div>
      </div>`;
  }

  // ---- PROFILE ------------------------------------------------------
  function renderProfile() {
    if (!store.isLoggedIn()) {
      return `<div class="gate"><div><h3>You're not logged in</h3>
        <button class="btn" id="loginCta2" style="margin-top:10px">Log in / Sign up</button></div></div>`;
    }
    const addr = store.walletAddress();
    const orders = store.orders();
    const packs = orders.length;
    const owned = store.collection().length;
    return `
      <div class="grid cols-2" style="align-items:start">
        <div class="panel">
          <h2>Profile</h2>
          <label class="field">Display name</label>
          <div class="row"><input id="pfName" value="${(store.displayName() || "").replace(/"/g, "&quot;")}" style="flex:1"><button class="btn sm" id="pfSave">Save</button></div>
          <label class="field">Email</label>
          <div class="row" style="gap:8px">
            <span class="mono">${store.email() || "—"}</span>
            ${store.isVerified()
              ? `<span class="badge" style="background:var(--ok)">Verified</span>`
              : `<span class="badge" style="background:var(--gold)">Unverified</span> <button class="btn ghost sm" id="pfVerify">Verify</button>`}
          </div>
          <label class="field">Linked Solana wallet</label>
          ${addr
            ? `<div class="row" style="gap:8px"><span class="mono" style="user-select:all">${addr}</span></div>`
            : `<button class="btn ghost sm" id="pfLink">Link wallet</button>`}
          <div class="grid cols-3" style="margin-top:16px">
            <div class="panel" style="padding:12px;text-align:center"><div class="muted" style="font-size:12px">LOL</div><div class="stat small">${nibFmt(store.balance())}</div></div>
            <div class="panel" style="padding:12px;text-align:center"><div class="muted" style="font-size:12px">🪙 Coins</div><div class="stat small">${store.coins()}</div></div>
            <div class="panel" style="padding:12px;text-align:center"><div class="muted" style="font-size:12px">Packs</div><div class="stat small">${packs}</div></div>
          </div>
          <label class="field">Items <span class="muted" style="font-size:11px">(used in battle)</span></label>
          <div class="row" style="flex-wrap:wrap">
            ${Object.entries(store.items()).filter(([id, n]) => n > 0 && battle.ITEMS[id]).map(([id, n]) => { const it = battle.ITEMS[id]; return `<span class="pill" title="${it.desc}">${it.glyph} ${it.name} ×${n}</span>`; }).join("") || `<span class="muted" style="font-size:13px">No items — buy some in the Battle shop.</span>`}
          </div>
          <div class="row" style="margin-top:14px"><button class="btn ghost sm" id="pfLogout">Log out</button></div>
        </div>
        <div class="panel">
          <h3>Order History <span class="muted" style="font-size:14px">(${packs} packs · ${owned} cards)</span></h3>
          ${packs === 0 ? `<p class="muted">No packs opened yet.</p>` : `<div style="max-height:60vh;overflow:auto">${orders.map(orderRow).join("")}</div>`}
        </div>
      </div>`;
  }
  function orderRow(o) {
    const order = NIB.engine.RARITY_ORDER;
    const best = o.cards.reduce((b, c) => order.indexOf(c.rarity) > order.indexOf(b) ? c.rarity : b, "common");
    const when = o.at ? new Date(o.at).toLocaleString() : "—";
    const chips = o.cards
      .slice().sort((a, b) => order.indexOf(b.rarity) - order.indexOf(a.rarity))
      .map((c) => { const card = store.card(c.cardId); return `<span class="pill" style="gap:4px" title="${card ? card.name : c.cardId}">${card ? matrix.META[card.element].glyph : "❔"} <span class="badge r-${c.rarity}" style="font-size:9px">${catalog.RARITY_LABEL[c.rarity]}</span></span>`; })
      .join("");
    return `<div class="panel" style="padding:12px;margin-bottom:10px">
      <div class="row" style="justify-content:space-between"><span class="muted" style="font-size:12px">${when}</span><span class="badge r-${best}">Best: ${catalog.RARITY_LABEL[best]}</span></div>
      <div class="row" style="margin-top:8px">${chips}</div>
    </div>`;
  }
  function wireProfile() {
    $("#loginCta2")?.addEventListener("click", () => openAuthModal());
    $("#pfSave")?.addEventListener("click", async () => {
      const name = $("#pfName").value.trim();
      if (!name) return toast("Name can't be empty", true);
      try { await store.setDisplayName(name); toast("Name saved"); render(); }
      catch (e) { toast(e.message || "Save failed", true); }
    });
    $("#pfVerify")?.addEventListener("click", async () => {
      try { await store.sendVerification(); toast("Verification email sent — click the link, then reload"); }
      catch (e) { toast(e.message || "Could not send", true); }
    });
    $("#pfLink")?.addEventListener("click", async () => {
      try { await store.connectWallet(); toast("Wallet linked"); render(); }
      catch (e) { toast(e.message || "Link failed", true); }
    });
    $("#pfLogout")?.addEventListener("click", () => store.disconnect());
  }

  // ---- BATTLE -------------------------------------------------------
  const battle = NIB.battle;
  let teamPick = null;          // ids being chosen in the team builder
  let B = null;                 // active battle state

  function myTeamCards() {
    const t = store.battleTeam();
    const ids = (t && t.teamCardIds) || [];
    return ids.map((id) => store.card(id)).filter(Boolean);
  }
  function uniqueOwnedCards() {
    const map = {};
    store.collection().forEach((n) => { if (!map[n.cardId]) { const c = store.card(n.cardId); if (c) map[n.cardId] = c; } });
    return Object.values(map);
  }

  function renderBattle() {
    if (!store.isLoggedIn()) return `<div class="gate"><div><h3>Log in to battle</h3><button class="btn" id="loginCta3" style="margin-top:10px">Log in / Sign up</button></div></div>`;
    const t = store.battleTeam();
    const team = myTeamCards();
    const owned = uniqueOwnedCards().length;
    const rec = t ? `${t.rating || 1000} rating · ${t.wins || 0}W ${t.losses || 0}L` : "unranked";
    const tierBtns = Object.entries(battle.NPC_TIERS).map(([k, v]) =>
      `<button class="btn sm" data-npc="${k}" ${team.length < battle.TEAM_SIZE ? "disabled" : ""}>${v.label}</button>`).join("");
    return `
      <div class="panel" style="margin-bottom:16px">
        <div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
          <div><h2 style="margin:0">Battle Arena</h2><div class="muted" style="font-size:13px;margin-top:2px">${rec}</div></div>
          <div class="row"><span class="pill gold" style="background:#ffd75a22;border:1px solid var(--gold)">🪙 ${store.coins()} coins</span><button class="btn ghost sm" id="editTeam">${team.length ? "Edit team" : "Build team"}</button></div>
        </div>
        <div class="muted" style="font-size:13px;margin:12px 0 6px">Your team (${team.length}/${battle.TEAM_SIZE})</div>
        <div class="cardgrid" id="teamRow">${team.length ? "" : `<p class="muted">Pick ${battle.TEAM_SIZE} cards to battle. You own ${owned} unique.</p>`}</div>
      </div>
      <div class="grid cols-2" style="align-items:start">
        <div class="panel">
          <h3>Fight NPC</h3>
          <p class="muted" style="font-size:13px">Battle an AI team. Harder tiers = rarer monsters.</p>
          <div class="row">${tierBtns}</div>
          ${team.length < battle.TEAM_SIZE ? `<p class="muted" style="font-size:12px;margin-top:8px">Build a full team first.</p>` : ""}
        </div>
        <div class="panel">
          <h3>PvP <span class="muted" style="font-size:12px">— challenge other players</span></h3>
          <div id="oppList"><p class="muted">Loading opponents…</p></div>
        </div>
      </div>
      <div class="panel" style="margin-top:16px">
        <div class="row" style="justify-content:space-between"><h3 style="margin:0">Shop</h3><span class="pill">🪙 ${store.coins()} coins</span></div>
        ${(() => { const d = store.dailyStatus(); return `<div class="row" style="margin:8px 0"><button class="btn sm ${d.ready ? "gold" : "ghost"}" id="dailyBtn" ${d.ready ? "" : "disabled"}>${d.ready ? `🎁 Claim daily bonus · ${d.amount} 🪙` : `🎁 Daily claimed — back in ${fmtDuration(d.nextInMs)}`}</button></div>`; })()}
        <div class="muted" style="font-size:13px;margin:8px 0 6px">Buy coins with LOL — ${battle.COIN_PER_NIB} 🪙 per LOL (you have ${nibFmt(store.balance())} LOL)</div>
        <div class="row">${[1, 5, 10].map((n) => `<button class="btn ghost sm" data-buycoins="${n}">${n} LOL → ${n * battle.COIN_PER_NIB} 🪙</button>`).join("")}</div>
        <div class="muted" style="font-size:13px;margin:14px 0 6px">Items — used in battle</div>
        <div class="cardgrid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
          ${Object.values(battle.ITEMS).map((it) => `<div class="panel" style="padding:12px;text-align:center">
            <div style="font-size:30px">${it.glyph}</div><b>${it.name}</b>
            <div class="muted" style="font-size:11px;min-height:30px;margin:4px 0">${it.desc}</div>
            <div class="muted" style="font-size:12px">Owned: <b>${store.items()[it.id] || 0}</b></div>
            <button class="btn sm" data-buyitem="${it.id}" data-price="${it.price}" style="margin-top:6px">Buy · 🪙 ${it.price}</button>
          </div>`).join("")}
        </div>
      </div>
      <div class="panel" style="margin-top:16px">
        <h3>Leaderboard</h3>
        <div id="ladder"><p class="muted">Loading…</p></div>
      </div>`;
  }

  function miniCard(card) {
    const el = cardEl(card, { noClick: true });
    el.style.width = "110px"; el.onclick = () => openCardModal(card);
    return el;
  }
  async function wireBattle() {
    $("#loginCta3")?.addEventListener("click", () => openAuthModal());
    if (!store.isLoggedIn()) return;
    const team = myTeamCards();
    const row = $("#teamRow");
    if (row && team.length) team.forEach((c) => row.appendChild(miniCard(c)));
    $("#editTeam")?.addEventListener("click", openTeamBuilder);
    const npcReward = { easy: 30, medium: 50, hard: 80, boss: 120 };
    $$("[data-npc]").forEach((b) => b.onclick = () => startBattle(
      battle.generateNpcTeam(b.dataset.npc, battle.TEAM_SIZE),
      { name: battle.NPC_TIERS[b.dataset.npc].label + " NPC", reward: { win: npcReward[b.dataset.npc], loss: 8 } }, false));

    // shop
    $$("[data-buycoins]").forEach((b) => b.onclick = async () => {
      try { await store.buyCoins(+b.dataset.buycoins); toast(`+${b.dataset.buycoins * battle.COIN_PER_NIB} coins`); }
      catch (e) { toast(e.message || "Purchase failed", true); }
    });
    $$("[data-buyitem]").forEach((b) => b.onclick = async () => {
      try { await store.buyItem(b.dataset.buyitem, +b.dataset.price); toast("Item purchased"); }
      catch (e) { toast(e.message || "Not enough coins", true); }
    });
    $("#dailyBtn")?.addEventListener("click", async () => {
      try { const r = await store.claimDaily(); toast(`🎁 +${r.amount} coins!`); render(); }
      catch (e) { toast(e.message || "Not ready", true); }
    });

    // opponents + leaderboard
    try {
      const opps = await store.listOpponents(50);
      const oppList = $("#oppList");
      if (oppList) oppList.innerHTML = opps.length
        ? opps.slice(0, 8).map((o, i) => `<div class="row" style="justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border)">
            <span>${o.name || "Player"} <span class="muted" style="font-size:12px">· ${o.rating || 1000}</span></span>
            <button class="btn sm ${team.length < battle.TEAM_SIZE ? "ghost" : ""}" data-opp="${i}" ${team.length < battle.TEAM_SIZE ? "disabled" : ""}>Fight</button></div>`).join("")
        : `<p class="muted">No other players yet — set your team to appear here for others.</p>`;
      $$("[data-opp]").forEach((b) => b.onclick = () => {
        const o = opps[+b.dataset.opp];
        const foe = (o.teamCardIds || []).map((id) => store.card(id)).filter(Boolean);
        if (foe.length) startBattle(foe, o, true);
        else toast("Opponent has no valid team", true);
      });
      const ladder = $("#ladder");
      if (ladder) ladder.innerHTML = `<table><tr><th>#</th><th>Player</th><th>Rating</th><th>W/L</th></tr>${
        opps.concat(store.battleTeam() ? [store.battleTeam()] : []).sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 10)
          .map((o, i) => `<tr><td>${i + 1}</td><td>${o.name || "You"}</td><td>${o.rating || 1000}</td><td class="muted">${o.wins || 0}/${o.losses || 0}</td></tr>`).join("")}</table>`;
    } catch (e) { const ol = $("#oppList"); if (ol) ol.innerHTML = `<p class="muted">Couldn't load opponents.</p>`; }
  }

  let tbFilterEl = "";
  function openTeamBuilder() {
    teamPick = (store.battleTeam() && store.battleTeam().teamCardIds || []).slice();
    const all = uniqueOwnedCards();
    const power = (c) => battle.teamPower([c]);
    const opt = (v, l, sel) => `<option value="${v}" ${sel === v ? "selected" : ""}>${l}</option>`;
    const ov = document.createElement("div"); ov.className = "overlay";
    ov.innerHTML = `<div class="panel modal" style="max-width:740px;position:relative">
      <span class="close">&times;</span>
      <h2 style="margin-bottom:2px">Build your team</h2>
      <p class="muted" id="tbCount" style="font-size:13px"></p>
      ${all.length < battle.TEAM_SIZE ? `<p class="muted">You need at least ${battle.TEAM_SIZE} cards — open more packs.</p>` : ""}
      <div class="panel" id="tbTeamPanel" style="border-color:var(--accent2);padding:12px;margin:8px 0 18px">
        <div class="muted" style="font-size:12px;margin-bottom:8px;letter-spacing:.4px">⭐ YOUR TEAM — ${battle.TEAM_SIZE} slots (tap a slot to remove)</div>
        <div class="brow" id="tbTeam"></div>
      </div>
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px;margin:0 0 6px">
        <span class="muted" style="font-size:12px;align-self:center">YOUR CARDS (${all.length}) — organised by rarity</span>
        <select id="tbEl"><option value="">All Elements</option>${matrix.ELEMENTS.map((e) => opt(e, matrix.META[e].glyph + " " + matrix.META[e].label, tbFilterEl)).join("")}</select>
      </div>
      <div id="tbPool" style="max-height:44vh;overflow:auto"></div>
      <div class="row" style="margin-top:14px;justify-content:space-between">
        <button class="btn gold" id="tbSave">Save team</button>
        <button class="btn ghost sm" id="tbClear">Clear team</button>
      </div>
    </div>`;
    document.body.appendChild(ov);

    const paintTeam = () => {
      const row = $("#tbTeam"); row.innerHTML = "";
      for (let i = 0; i < battle.TEAM_SIZE; i++) {
        const id = teamPick[i];
        const slot = document.createElement("div");
        if (id) {
          const c = store.card(id);
          slot.className = `tbslot filled r-${c.rarity}${c.fullImage && c.imageUrl ? " full" : ""}`;
          slot.style.setProperty("--ec", matrix.META[c.element].color);
          slot.innerHTML = `<div class="tbx" title="remove">×</div>
            <div class="bart">${c.imageUrl ? `<img class="art-img" src="${c.imageUrl}">` : matrix.META[c.element].glyph}</div>
            <div class="bnm">${c.name}</div>
            <div class="muted" style="font-size:10px">Lv ${c.level} · ⚡${power(c)}</div>`;
          slot.onclick = () => { teamPick = teamPick.filter((x) => x !== id); paint(); };
        } else {
          slot.className = "tbslot empty";
          slot.innerHTML = `<div class="muted">+ empty slot</div>`;
        }
        row.appendChild(slot);
      }
    };
    const toggle = (id) => {
      if (teamPick.includes(id)) teamPick = teamPick.filter((x) => x !== id);
      else if (teamPick.length < battle.TEAM_SIZE) teamPick.push(id);
      else return toast(`Team is full (${battle.TEAM_SIZE}) — remove one first`, true);
      paint();
    };
    // Pool grouped into rarity sections (Hidden Rare -> Common).
    const paintPool = () => {
      const pool = $("#tbPool"); pool.innerHTML = "";
      const cards = all.filter((c) => !tbFilterEl || c.element === tbFilterEl);
      if (!cards.length) { pool.innerHTML = `<p class="muted">No cards match.</p>`; return; }
      NIB.engine.RARITY_ORDER.slice().reverse().forEach((rar) => {
        const group = cards.filter((c) => c.rarity === rar).sort((a, b) => power(b) - power(a));
        if (!group.length) return;
        const sec = document.createElement("div"); sec.style.marginBottom = "16px";
        sec.innerHTML = `<div class="row" style="justify-content:space-between;margin:4px 2px 8px">
          <span class="badge r-${rar}">${catalog.RARITY_LABEL[rar]}</span><span class="muted" style="font-size:12px">${group.length} card${group.length > 1 ? "s" : ""}</span></div>
          <div class="cardgrid"></div>`;
        const grid = sec.querySelector(".cardgrid");
        group.forEach((c) => {
          const el = cardEl(c, { noClick: true });
          if (teamPick.includes(c.id)) { el.classList.add("picked"); const b = document.createElement("div"); b.className = "pickbadge"; b.textContent = "✓ In team"; el.appendChild(b); }
          el.onclick = () => toggle(c.id);
          grid.appendChild(el);
        });
        pool.appendChild(sec);
      });
    };
    const paint = () => {
      const tp = teamPick.reduce((s, id) => s + (store.card(id) ? power(store.card(id)) : 0), 0);
      $("#tbCount").textContent = `${teamPick.length}/${battle.TEAM_SIZE} selected${teamPick.length ? " · team power ⚡" + tp : ""}`;
      paintTeam(); paintPool();
    };

    $("#tbEl").onchange = (e) => { tbFilterEl = e.target.value; paintPool(); };
    $("#tbClear").onclick = () => { teamPick = []; paint(); };
    paint();
    $("#tbSave").onclick = async () => {
      if (teamPick.length !== battle.TEAM_SIZE) return toast(`Pick exactly ${battle.TEAM_SIZE} cards`, true);
      try { await store.saveBattleTeam(teamPick); toast("Team saved"); ov.remove(); render(); }
      catch (e) { toast(e.message || "Save failed", true); }
    };
    ov.addEventListener("click", (e) => { if (e.target === ov || e.target.classList.contains("close")) ov.remove(); });
  }

  // ---- battle arena (phase-based: pick card -> ability -> target) ----
  function startBattle(foeRaw, opp, isPvp) {
    const mine = myTeamCards().map((c, i) => battle.battleCard(c, "me", i));
    const foe = foeRaw.slice(0, battle.TEAM_SIZE).map((c, i) => battle.battleCard(c, "foe", i));
    if (!mine.length || !foe.length) return toast("Teams not ready", true);
    // phase: 'card' | 'ability' | 'target' | 'itemTarget'
    B = { mine, foe, turn: "me", log: ["⚔️ Battle start!"], over: false, isPvp, opp,
      phase: "card", sel: null, ability: null, item: null,
      reward: (opp && opp.reward) || (isPvp ? { win: 60, loss: 15 } : { win: 40, loss: 8 }) };
    let ov = $("#battleOverlay");
    if (!ov) { ov = document.createElement("div"); ov.id = "battleOverlay"; ov.className = "overlay"; document.body.appendChild(ov); }
    renderArena();
  }
  function hpBar(c) {
    const pct = Math.max(0, c.hp / c.maxHp * 100);
    const col = pct > 50 ? "var(--ok)" : pct > 20 ? "var(--gold)" : "var(--danger)";
    return `<div class="bar" style="height:7px"><i style="width:${pct}%;background:${col}"></i></div><div class="muted" style="font-size:10px;text-align:center">${c.hp}/${c.maxHp}</div>`;
  }
  function battleTile(c, clickable) {
    const dead = c.hp <= 0, seld = B.sel && B.sel.uid === c.uid;
    const glyph = c.imageUrl ? `<img class="art-img" src="${c.imageUrl}">` : matrix.META[c.element].glyph;
    const psn = c.poison && c.poison.turns > 0 ? ` <span title="poisoned">☠️</span>` : "";
    const arm = c.armorBuff ? ` <span title="armor +${c.armorBuff}%">🛡️</span>` : "";
    const full = c.fullImage && c.imageUrl ? " full" : "";
    return `<div class="btile r-${c.rarity}${full} ${dead ? "dead" : ""} ${seld ? "sel" : ""} ${clickable && !dead ? "clk" : ""}" data-uid="${c.uid}" style="--ec:${matrix.META[c.element].color}">
      <div class="bart">${glyph}</div>
      <div class="bnm">${c.name}${psn}${arm}</div>
      <div class="row" style="justify-content:center;gap:6px;font-size:10px"><span>⚔${c.stats.attack}</span><span>🛡${c.stats.defense}</span><span title="${matrix.META[c.element].label}">${matrix.META[c.element].glyph}</span></div>
      ${hpBar(c)}
    </div>`;
  }
  function statusText() {
    if (B.over) return "Battle over";
    if (B.turn !== "me") return "Enemy turn…";
    if (B.phase === "card") return "Pick a card to act — or use an item";
    if (B.phase === "ability") return `${B.sel.name}: choose an ability`;
    if (B.phase === "target") return `${B.ability.glyph} ${B.ability.name} — pick a target`;
    if (B.phase === "itemTarget") return `${B.item.glyph} ${B.item.name} — pick an ally`;
    return "";
  }
  function abilityBar() {
    if (B.turn !== "me" || B.over) return "";
    if (B.phase === "ability" && B.sel) {
      const btns = battle.abilitiesFor(B.sel).map((a) => {
        const cd = B.sel.cd && B.sel.cd[a.id] || 0;
        return `<button class="btn sm ${cd ? "ghost" : ""}" data-ab="${a.id}" ${cd ? "disabled" : ""} title="${a.desc}">${a.glyph} ${a.name}${cd ? " (" + cd + ")" : ""}</button>`;
      }).join("");
      return `<div class="row" style="justify-content:center;flex-wrap:wrap;gap:8px">${btns}<button class="btn ghost sm" id="abBack">← back</button></div>`;
    }
    // item bar (phase card) — from owned inventory
    if (B.phase === "card") {
      const inv = store.items();
      const items = Object.entries(inv).filter(([id, n]) => n > 0 && battle.ITEMS[id]).map(([id, n]) => {
        const it = battle.ITEMS[id];
        return `<button class="btn ghost sm" data-item="${id}" title="${it.desc}">${it.glyph} ${it.name} ×${n}</button>`;
      }).join("");
      return `<div class="row" style="justify-content:center;flex-wrap:wrap;gap:8px"><span class="muted" style="font-size:12px;align-self:center">Items:</span>${items || `<span class="muted" style="font-size:12px">none — buy some in the Shop</span>`}</div>`;
    }
    if (B.phase === "target" || B.phase === "itemTarget") return `<div class="row" style="justify-content:center"><button class="btn ghost sm" id="abBack">← back</button></div>`;
    return "";
  }
  function renderArena() {
    const ov = $("#battleOverlay"); if (!ov) return;
    const yourTurn = B.turn === "me" && !B.over;
    const foeClk = yourTurn && (B.phase === "target") && (B.ability.target === "enemy");
    const myClk = yourTurn && (B.phase === "card" || (B.phase === "target" && B.ability.target === "ally") || B.phase === "itemTarget");
    ov.innerHTML = `<div class="panel modal battle-modal" style="max-width:780px;position:relative">
      <span class="close">&times;</span>
      <div class="row" style="justify-content:space-between"><h3 style="margin:0">Enemy — ${B.opp && B.opp.name || "Opponent"}</h3><span class="muted" style="font-size:12px">${B.isPvp ? "PvP" : "NPC"}</span></div>
      <div class="brow" id="foeRow">${B.foe.map((c) => battleTile(c, foeClk)).join("")}</div>
      <div style="text-align:center;margin:10px 0"><span class="pill">${statusText()}</span></div>
      <div id="actionBar" style="margin-bottom:8px">${abilityBar()}</div>
      <div class="brow" id="myRow">${B.mine.map((c) => battleTile(c, myClk)).join("")}</div>
      <div class="blog" id="blog" style="margin-top:12px">${B.log.slice(0, 7).map((l) => `<div>${l}</div>`).join("")}</div>
      ${B.over ? `<div class="row" style="margin-top:12px;justify-content:center;gap:10px">
          <button class="btn gold" id="bAgain">Battle again</button><button class="btn ghost" id="bLeave">Leave</button></div>` : ""}
    </div>`;

    if (yourTurn) {
      if (B.phase === "card") {
        $$("#myRow .btile.clk").forEach((t) => t.onclick = () => { B.sel = B.mine.find((c) => c.uid === t.dataset.uid); B.phase = "ability"; renderArena(); });
        $$("[data-item]").forEach((b) => b.onclick = () => chooseItem(b.dataset.item));
      } else if (B.phase === "ability") {
        $$("[data-ab]").forEach((b) => b.onclick = () => chooseAbility(b.dataset.ab));
      } else if (B.phase === "target") {
        const row = B.ability.target === "enemy" ? "#foeRow" : "#myRow";
        $$(`${row} .btile.clk`).forEach((t) => t.onclick = () => resolvePlayer(t.dataset.uid));
      } else if (B.phase === "itemTarget") {
        $$("#myRow .btile.clk").forEach((t) => t.onclick = () => useItemOn(t.dataset.uid));
      }
      $("#abBack") && ($("#abBack").onclick = () => { B.phase = "card"; B.sel = null; B.ability = null; B.item = null; renderArena(); });
    }
    $("#bAgain") && ($("#bAgain").onclick = () => { $("#battleOverlay").remove(); render(); });
    $("#bLeave") && ($("#bLeave").onclick = () => { $("#battleOverlay").remove(); B = null; render(); });
    ov.querySelector(".close").onclick = () => { $("#battleOverlay").remove(); B = null; render(); };
  }
  const ctx = () => ({ allies: B.mine, foes: B.foe });

  function chooseAbility(abId) {
    const ab = battle.abilitiesFor(B.sel).find((a) => a.id === abId);
    if (!ab || (B.sel.cd && B.sel.cd[ab.id] > 0)) return;
    B.ability = ab;
    if (ab.target === "self" || ab.target === "allEnemies" || ab.target === "allAllies") { resolvePlayer(null); return; }
    B.phase = "target"; renderArena();
  }
  function resolvePlayer(targetUid) {
    const ab = B.ability;
    const target = targetUid ? [...B.foe, ...B.mine].find((c) => c.uid === targetUid) : null;
    if ((ab.target === "enemy" || ab.target === "ally") && (!target || target.hp <= 0)) return;
    battle.applyAbility(B.sel, ab, target, ctx(), B.log);
    endPlayerTurn();
  }
  function chooseItem(id) {
    const it = battle.ITEMS[id]; if (!it || !(store.items()[id] > 0)) return;
    B.item = it;
    if (it.target === "ally") { B.phase = "itemTarget"; renderArena(); }
    else { applyItem(null); }
  }
  function useItemOn(targetUid) { applyItem(B.mine.find((c) => c.uid === targetUid)); }
  function applyItem(target) {
    const it = B.item;
    if (it.target === "ally" && (!target || target.hp <= 0)) return;
    battle.applyAbility({ name: it.name }, it, target, ctx(), B.log);
    store.consumeItem(it.id); B.item = null;   // deduct from owned inventory
    endPlayerTurn();
  }
  function endPlayerTurn() {
    B.sel = null; B.ability = null; B.phase = "card";
    if (checkEnd()) return;
    B.turn = "foe"; renderArena();
    setTimeout(foeTurn, 850);
  }
  function foeTurn() {
    if (B.over) return;
    battle.startTurnTicks(B.foe, B.log);
    if (checkEnd()) return;
    const move = battle.aiTurn(B.foe, B.mine);
    if (move) battle.applyAbility(move.actor, move.ab, move.target, { allies: B.foe, foes: B.mine }, B.log);
    if (checkEnd()) return;
    battle.startTurnTicks(B.mine, B.log);          // your regen / poison / cooldowns
    if (checkEnd()) return;
    B.turn = "me"; B.phase = "card"; renderArena();
  }
  function checkEnd() {
    const meAlive = battle.alive(B.mine).length, foeAlive = battle.alive(B.foe).length;
    if (meAlive && foeAlive) return false;
    B.over = true;
    const win = foeAlive === 0;
    B.log.unshift(win ? "🏆 Victory!" : "☠️ Defeat.");
    if (!B.awarded) {
      B.awarded = true;
      const c = win ? B.reward.win : B.reward.loss;
      if (c) { store.earnCoins(c); B.log.unshift(`🪙 +${c} coins`); }
      if (B.isPvp) { store.recordBattleResult(win); B.log.unshift(win ? "+20 rating" : "−15 rating"); }
    }
    renderArena();
    return true;
  }

  // ---- shell / routing ---------------------------------------------
  function renderTopbar() {
    const name = store.wallet();          // display label (name/email/wallet)
    const addr = store.walletAddress();
    if (store.isLoggedIn()) {
      $("#walletArea").innerHTML = `
        <span class="pill"><span class="dot"></span>${name}</span>
        <span class="pill">${nibFmt(store.balance())} LOL</span>
        ${addr
          ? `<span class="pill" title="${addr}">🔗 ${addr.slice(0, 4)}…${addr.slice(-4)}</span>`
          : `<button class="btn ghost sm" id="linkw">Link wallet</button>`}
        <button class="btn ghost sm" id="logout">Log out</button>`;
      $("#linkw")?.addEventListener("click", async () => {
        try { await store.connectWallet(); toast("Wallet linked"); }
        catch (e) { toast(e.message || "Link failed", true); }
      });
      $("#logout")?.addEventListener("click", () => store.disconnect());
    } else {
      $("#walletArea").innerHTML = `<button class="btn" id="login">Log in</button>`;
      $("#login")?.addEventListener("click", () => openAuthModal("login"));
    }
    $$(".nav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === currentTab));
  }

  function render() {
    renderTopbar();
    const main = $("#main");
    if (currentTab === "store") { main.innerHTML = renderStore(); wireStore(); }
    else if (currentTab === "collection") { main.innerHTML = renderCollection(); wireCollection(); }
    else if (currentTab === "codex") { main.innerHTML = renderCodex(); }
    else if (currentTab === "battle") { main.innerHTML = renderBattle(); wireBattle(); }
    else if (currentTab === "profile") { main.innerHTML = renderProfile(); wireProfile(); }
  }

  function init() {
    $$(".nav button").forEach((b) => b.onclick = () => { currentTab = b.dataset.tab; render(); });
    // While a rip animation plays, only refresh the topbar so we don't
    // wipe the in-progress reveal; otherwise re-render the active tab.
    window.addEventListener("nib:change", () => { ripping ? renderTopbar() : render(); });
    render();
    store.ready.then(render);   // re-render once the backend has hydrated
  }

  NIB.app = { init };
})(window.NIB = window.NIB || {});
