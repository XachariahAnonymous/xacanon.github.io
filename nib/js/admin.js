/* =====================================================================
   NIBCOIN TCG — Admin Panel  (admin.html)   Deliverable 4
   Role-based wallet gate + card/economy/analytics management.
   Attaches to window.NIB.admin
   ===================================================================== */
(function (NIB) {
  "use strict";
  const { store, catalog, matrix } = NIB;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  let tab = "overview";

  function toast(m, err) {
    const t = document.createElement("div");
    t.className = "toast" + (err ? " err" : ""); t.textContent = m;
    document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
  }

  // ---- AUTH GATE ----------------------------------------------------
  // In production, verify a signed nonce (wallet.signMessage) server-side
  // and check the pubkey against admin_wallets before issuing a session.
  function isAuthed() { return store.isLoggedIn() && store.isAdmin(); }

  function renderGate() {
    const loggedIn = store.isLoggedIn();
    const uid = store.uid && store.uid();
    return `<div class="gate"><div class="panel" style="max-width:440px">
      <h2>🔐 Admin Access</h2>
      ${loggedIn
        ? `<p>Signed in as <span class="mono">${store.wallet()}</span></p>
           ${uid ? `<p class="muted" style="font-size:12px">Your Firebase uid (to bootstrap the first admin):<br><span class="mono" style="user-select:all">${uid}</span></p>` : ""}
           <p class="badge" style="background:var(--danger)">This account is not an admin</p>
           <div class="row" style="margin-top:12px"><button class="btn ghost" id="logout">Log out</button></div>`
        : `<p class="muted">Log in with an admin account.</p>
           <label class="field">Email</label><input id="agEmail" type="email" placeholder="admin@email.com">
           <label class="field">Password</label><input id="agPass" type="password" placeholder="••••••••">
           <div id="agErr" class="muted" style="color:var(--danger);font-size:13px;min-height:18px;margin-top:8px"></div>
           <button class="btn gold" id="agGo" style="width:100%;margin-top:6px">Log in</button>`}
      <p class="muted" style="font-size:12px;margin-top:16px">${store.isLive()
        ? `First admin: log in, then in the Firebase console create doc <span class="mono">admins/&lt;your-uid&gt;</span> (field <span class="mono">role: super_admin</span>). Add more admins from the panel afterwards.`
        : `Demo: any email/password logs in as admin.`}</p>
    </div></div>`;
  }
  function wireGate() {
    $("#logout")?.addEventListener("click", () => store.disconnect());
    const go = $("#agGo");
    if (!go) return;
    const run = async () => {
      const email = $("#agEmail").value.trim(), pass = $("#agPass").value;
      if (!email || !pass) { $("#agErr").textContent = "Email and password required."; return; }
      go.disabled = true; go.textContent = "…";
      try { await store.signIn(email, pass); }
      catch (e) { go.disabled = false; go.textContent = "Log in"; $("#agErr").textContent = (e.message || "Login failed").replace("Firebase: ", ""); }
    };
    go.onclick = run;
    $("#agPass").addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
  }

  // ---- OVERVIEW -----------------------------------------------------
  function renderOverview() {
    const tiers = store.supplyByTier();
    const openings = store.openings();
    const cfg = store.config();
    const totalBurned = openings.reduce((s, o) => s + o.cost, 0);
    const totalPacks = openings.length;
    const totalMinted = Object.values(tiers).reduce((s, t) => s + t.minted, 0);

    return `
      <div class="grid cols-4">
        <div class="panel"><div class="muted">Packs Opened</div><div class="stat">${totalPacks}</div></div>
        <div class="panel"><div class="muted">NIB Collected/Burned</div><div class="stat">${totalBurned}</div></div>
        <div class="panel"><div class="muted">Cards Minted</div><div class="stat">${totalMinted.toLocaleString()}</div></div>
        <div class="panel"><div class="muted">Sales Status</div><div class="stat small" style="color:${cfg.packsEnabled ? "var(--ok)" : "var(--danger)"}">${cfg.packsEnabled ? "LIVE" : "PAUSED"}</div></div>
      </div>
      <div class="panel" style="margin-top:16px">
        <h3>Live Supply vs. Mint Caps</h3>
        <table>
          <tr><th>Tier</th><th>Designs</th><th>Minted</th><th>Cap</th><th>Fill</th></tr>
          ${NIB.engine.RARITY_ORDER.slice().reverse().map((r) => {
            const t = tiers[r]; const pct = t.cap ? (t.minted / t.cap * 100) : 0;
            return `<tr>
              <td><span class="badge r-${r}">${catalog.RARITY_LABEL[r]}</span></td>
              <td>${t.designs}</td>
              <td>${t.minted.toLocaleString()}</td>
              <td class="muted">${t.cap.toLocaleString()}</td>
              <td style="min-width:160px"><div class="bar"><i style="width:${Math.max(pct, pct > 0 ? 2 : 0)}%"></i></div>
                <span class="muted" style="font-size:11px">${pct.toFixed(4)}%</span></td>
            </tr>`;
          }).join("")}
        </table>
      </div>`;
  }

  // ---- ECONOMY ------------------------------------------------------
  function renderEconomy() {
    const cfg = store.config();
    const ov = cfg.dropRateOverrides || NIB.engine.DEFAULT_CONFIG.chaseTable;
    return `
      <div class="grid cols-2" style="align-items:start">
        <div class="panel">
          <h3>Sales & Pricing</h3>
          <div class="row" style="justify-content:space-between;margin-top:8px">
            <span>Pack purchases enabled</span>
            <button class="btn sm ${cfg.packsEnabled ? "" : "ghost"}" id="togglePacks">${cfg.packsEnabled ? "ON" : "OFF"}</button>
          </div>
          <div class="row" style="justify-content:space-between;margin-top:12px">
            <span>Bonus Rare slot (10%)</span>
            <button class="btn sm ${cfg.bonusRareEnabled ? "" : "ghost"}" id="toggleBonus">${cfg.bonusRareEnabled ? "ON" : "OFF"}</button>
          </div>
          <label class="field">Pack price (NIB)</label>
          <input id="price" type="number" min="1" step="1" value="${cfg.packPriceTokens}">
          <button class="btn sm" id="savePrice" style="margin-top:12px">Save price</button>
        </div>
        <div class="panel">
          <h3>Drop-Rate Overrides <span class="muted" style="font-size:12px">(event tuning)</span></h3>
          <p class="muted" style="font-size:12px">Chase-slot probabilities. Remainder becomes Rare.</p>
          ${["hidden_rare", "mega_rare", "ultra_rare", "super_rare"].map((r) => `
            <label class="field">${catalog.RARITY_LABEL[r]} <span class="mono">(${(ov[r] * 100).toFixed(4)}%)</span></label>
            <input class="ovr" data-r="${r}" type="number" step="0.0001" min="0" max="1" value="${ov[r]}">
          `).join("")}
          <div class="row" style="margin-top:12px">
            <button class="btn sm" id="saveOvr">Apply overrides</button>
            <button class="btn sm ghost" id="resetOvr">Reset to default</button>
          </div>
        </div>
      </div>
      <div class="panel" style="margin-top:16px">
        <h3>Tools</h3>
        <div class="grid cols-2" style="align-items:start">
          <div>
            <label class="field">Seed / re-seed the ${catalog.count()}-card catalogue into the database</label>
            <button class="btn sm" id="seedBtn">Seed catalogue</button>
            <p class="muted" style="font-size:12px;margin-top:8px">${store.isLive() ? "Required once before packs can open in live mode." : "LOCAL mode: catalogue is already in-memory."}</p>
          </div>
          <div>
            <label class="field">Grant NIB to a player ${store.isLive() ? "(uid)" : "(wallet)"}</label>
            <div class="row"><input id="grantWallet" placeholder="${store.isLive() ? "player uid" : "wallet"}" style="flex:2"><input id="grantAmt" type="number" placeholder="amount" style="flex:1"></div>
            <button class="btn sm" id="grantBtn" style="margin-top:10px">Grant NIB</button>
            ${store.isLive() ? `<p class="muted" style="font-size:11px;margin-top:6px">New players auto-start with 25 NIB. Find uids in the users collection.</p>` : ""}
          </div>
        </div>
      </div>`;
  }
  function wireEconomy() {
    $("#togglePacks").onclick = async () => { await store.setConfig({ packsEnabled: !store.config().packsEnabled }); };
    $("#toggleBonus").onclick = async () => { await store.setConfig({ bonusRareEnabled: !store.config().bonusRareEnabled }); };
    $("#savePrice").onclick = async () => { await store.setConfig({ packPriceTokens: Math.max(1, +$("#price").value || 5) }); toast("Price saved"); };
    $("#saveOvr").onclick = async () => {
      const ov = {}; $$(".ovr").forEach((i) => ov[i.dataset.r] = Math.min(1, Math.max(0, +i.value || 0)));
      const sum = Object.values(ov).reduce((a, b) => a + b, 0);
      if (sum >= 1) return toast("Rates sum ≥ 100% — leave room for Rare", true);
      await store.setConfig({ dropRateOverrides: ov }); toast("Overrides applied");
    };
    $("#resetOvr").onclick = async () => { await store.setConfig({ dropRateOverrides: null }); toast("Reset to defaults"); };
    $("#seedBtn").onclick = async () => {
      $("#seedBtn").disabled = true; toast("Seeding…");
      try { const r = await store.seedCatalog(); toast(`Seeded ${r.written} cards`); }
      catch (e) { toast(e.message || "Seed failed", true); }
      $("#seedBtn").disabled = false;
    };
    $("#grantBtn").onclick = async () => {
      const w = $("#grantWallet").value.trim(), amt = +$("#grantAmt").value;
      if (!w || !(amt > 0)) return toast("Enter wallet + amount", true);
      try { await store.adminGrantTokens(w, amt); toast(`Granted ${amt} NIB`); }
      catch (e) { toast(e.message || "Grant failed", true); }
    };
  }

  // ---- ON-CHAIN LINKING --------------------------------------------
  function renderOnchain() {
    const oc = store.config().onchain || {};
    const badge = oc.linked
      ? `<span class="badge" style="background:var(--ok)">LINKED</span>`
      : `<span class="badge" style="background:var(--muted)">OFF-CHAIN</span>`;
    return `
      <div class="panel">
        <div class="row" style="justify-content:space-between">
          <h3 style="margin:0">Solana Linkage ${badge}</h3>
        </div>
        <p class="muted" style="font-size:13px">Off-chain today: NIB balances &amp; card ownership live in Firestore. Fill these in and enable to settle pack payments — and later mint cards — on Solana.</p>
        <div class="grid cols-2" style="align-items:start">
          <div>
            <label class="field">Network</label>
            <select id="ocNet">
              ${["devnet", "mainnet-beta", "testnet"].map((n) => `<option value="${n}" ${oc.network === n ? "selected" : ""}>${n}</option>`).join("")}
            </select>
            <label class="field">RPC endpoint URL</label>
            <input id="ocRpc" value="${oc.rpcUrl || ""}" placeholder="https://api.devnet.solana.com">
            <label class="field">NIB token mint address</label>
            <input id="ocMint" value="${oc.mintAddress || ""}" placeholder="SPL mint pubkey">
            <label class="field">Treasury / vault wallet</label>
            <input id="ocVault" value="${oc.treasuryWallet || ""}" placeholder="vault pubkey (receives pack payments)">
          </div>
          <div>
            <div class="row" style="justify-content:space-between;margin-top:8px">
              <span>On-chain SPL payments</span>
              <button class="btn sm ${oc.paymentsEnabled ? "" : "ghost"}" id="ocPay">${oc.paymentsEnabled ? "ON" : "OFF"}</button>
            </div>
            <div class="row" style="justify-content:space-between;margin-top:12px">
              <span>On-chain cNFT minting</span>
              <button class="btn sm ${oc.mintingEnabled ? "" : "ghost"}" id="ocMintTog">${oc.mintingEnabled ? "ON" : "OFF"}</button>
            </div>
            <p class="muted" style="font-size:12px;margin-top:14px">Turning these on requires the payment-verification &amp; mint Cloud Functions to be deployed (see README). Until then, keep them OFF and the game runs fully off-chain.</p>
          </div>
        </div>
        <div class="row" style="margin-top:16px">
          <button class="btn" id="ocSave">Save linkage</button>
          <button class="btn ghost" id="ocLink">${oc.linked ? "Mark unlinked" : "Mark linked"}</button>
        </div>
      </div>`;
  }
  function wireOnchain() {
    const cur = () => store.config().onchain || {};
    $("#ocPay").onclick = async () => { await store.setConfig({ onchain: { ...cur(), paymentsEnabled: !cur().paymentsEnabled } }); };
    $("#ocMintTog").onclick = async () => { await store.setConfig({ onchain: { ...cur(), mintingEnabled: !cur().mintingEnabled } }); };
    $("#ocLink").onclick = async () => { await store.setConfig({ onchain: { ...cur(), linked: !cur().linked } }); };
    $("#ocSave").onclick = async () => {
      await store.setConfig({ onchain: {
        ...cur(),
        network: $("#ocNet").value,
        rpcUrl: $("#ocRpc").value.trim(),
        mintAddress: $("#ocMint").value.trim(),
        treasuryWallet: $("#ocVault").value.trim(),
      } });
      toast("Linkage saved");
    };
  }

  // ---- CARDS --------------------------------------------------------
  function renderCards() {
    const cfg = { r: "", e: "" };
    return `
      <div class="panel">
        <div class="row" style="justify-content:space-between">
          <h3 style="margin:0">Card Catalogue <span class="muted" style="font-size:14px">(${catalog.count()} designs)</span></h3>
          <div class="row">
            <select id="cr"><option value="">All Rarities</option>${Object.keys(catalog.RARITY_LABEL).map((r) => `<option value="${r}">${catalog.RARITY_LABEL[r]}</option>`).join("")}</select>
            <select id="ce"><option value="">All Elements</option>${matrix.ELEMENTS.map((e) => `<option value="${e}">${matrix.META[e].label}</option>`).join("")}</select>
          </div>
        </div>
        <div id="cardTable" style="margin-top:12px;max-height:60vh;overflow:auto"></div>
        <p class="muted" style="font-size:12px;margin-top:10px">Editing/bulk-upload writes to the <span class="mono">cards</span> table via service role. Demo shows read-only live supply.</p>
      </div>`;
  }
  async function fillCardTable() {
    $("#cardTable").innerHTML = `<p class="muted">Loading…</p>`;
    const cards = await store.loadCardStats($("#cr").value, $("#ce").value, 400);
    const rows = cards.map((c) => `<tr>
        <td>${matrix.META[c.element].glyph} ${c.name}</td>
        <td><span class="badge r-${c.rarity}">${catalog.RARITY_LABEL[c.rarity]}</span></td>
        <td>Lv ${c.level}</td>
        <td class="mono">${c.stats.attack}/${c.stats.defense}/${c.stats.hp}</td>
        <td>${(c.mintedCount || 0).toLocaleString()}/${c.mintCap.toLocaleString()}</td>
      </tr>`).join("");
    $("#cardTable").innerHTML = `<table><tr><th>Name</th><th>Rarity</th><th>Lvl</th><th>A/D/H</th><th>Minted</th></tr>${rows}</table>`;
  }
  function wireCards() {
    $("#cr").onchange = fillCardTable; $("#ce").onchange = fillCardTable; fillCardTable();
  }

  // ---- ANALYTICS ----------------------------------------------------
  function renderAnalytics() {
    const dist = store.rarityDistribution();
    const total = Object.values(dist).reduce((a, b) => a + b, 0) || 1;
    const openings = store.openings();
    const players = new Set(openings.map((o) => o.wallet)).size;
    return `
      <div class="grid cols-3">
        <div class="panel"><div class="muted">Active Players</div><div class="stat">${players}</div></div>
        <div class="panel"><div class="muted">Total Packs</div><div class="stat">${openings.length}</div></div>
        <div class="panel"><div class="muted">Cards Distributed</div><div class="stat">${total}</div></div>
      </div>
      <div class="panel" style="margin-top:16px">
        <h3>Rarity Distribution Curve</h3>
        ${NIB.engine.RARITY_ORDER.slice().reverse().map((r) => {
          const n = dist[r] || 0; const pct = n / total * 100;
          return `<div style="margin:10px 0">
            <div class="row" style="justify-content:space-between"><span class="badge r-${r}">${catalog.RARITY_LABEL[r]}</span><span class="muted">${n} · ${pct.toFixed(2)}%</span></div>
            <div class="bar" style="margin-top:5px"><i style="width:${pct}%"></i></div>
          </div>`;
        }).join("")}
      </div>
      <div class="panel" style="margin-top:16px">
        <h3>Recent Openings</h3>
        <table><tr><th>Time</th><th>Wallet</th><th>Cost</th><th>Best pull</th></tr>
        ${openings.slice(-12).reverse().map((o) => {
          const best = o.slots.reduce((b, s) => NIB.engine.RARITY_ORDER.indexOf(s.rarity) > NIB.engine.RARITY_ORDER.indexOf(b) ? s.rarity : b, "common");
          return `<tr><td class="muted">${new Date(o.at).toLocaleTimeString()}</td>
            <td class="mono">${o.wallet.slice(0, 6)}…</td><td>${o.cost} NIB</td>
            <td><span class="badge r-${best}">${catalog.RARITY_LABEL[best]}</span></td></tr>`;
        }).join("") || `<tr><td colspan="4" class="muted">No packs opened yet</td></tr>`}
        </table>
      </div>`;
  }

  // ---- shell --------------------------------------------------------
  function render() {
    const loggedIn = store.isLoggedIn();
    $("#walletArea").innerHTML = loggedIn
      ? `<span class="pill"><span class="dot"></span>${store.wallet()}</span><button class="btn ghost sm" id="logoutTop">Log out</button>`
      : "";
    $("#logoutTop")?.addEventListener("click", () => store.disconnect());

    const main = $("#main"), tabs = $("#tabs");
    if (!isAuthed()) { tabs.classList.add("hidden"); main.innerHTML = renderGate(); wireGate(); return; }
    tabs.classList.remove("hidden");
    $$("#tabs .tabbtn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    if (tab === "overview") main.innerHTML = renderOverview();
    else if (tab === "economy") { main.innerHTML = renderEconomy(); wireEconomy(); }
    else if (tab === "cards") { main.innerHTML = renderCards(); wireCards(); }
    else if (tab === "onchain") { main.innerHTML = renderOnchain(); wireOnchain(); }
    else if (tab === "analytics") main.innerHTML = renderAnalytics();
  }

  function init() {
    $$("#tabs .tabbtn").forEach((b) => b.onclick = () => { tab = b.dataset.tab; render(); });
    window.addEventListener("nib:change", render);
    render();
    store.ready.then(render);   // re-render once the backend has hydrated
  }

  NIB.admin = { init };
})(window.NIB = window.NIB || {});
