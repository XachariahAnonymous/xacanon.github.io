/* =====================================================================
   NIBCOIN TCG — Player App UI  (index.html)
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
    el.className = `tcard r-${card.rarity}` + (shiny ? " shiny" : "");
    el.style.setProperty("--ec", matrix.META[card.element].color);
    el.innerHTML = `
      <div class="foil"></div>
      ${opts.serial ? `<div class="serial">#${opts.serial}</div>` : ""}
      <div class="art">${matrix.META[card.element].glyph}</div>
      <div class="info">
        <div class="nm">${card.name}</div>
        <div class="meta">
          <span class="lvl">Lv ${card.level}</span>
          <span class="elem" title="${matrix.META[card.element].label}">${matrix.META[card.element].glyph}</span>
        </div>
        <div style="margin-top:6px"><span class="badge">${card.rarityLabel}</span></div>
      </div>`;
    el.onclick = () => openCardModal(card, opts.serial);
    return el;
  }

  function openCardModal(card, serial) {
    const p = matrix.profile(card.element);
    const chip = (e) => `<span class="pill"><span>${e.glyph}</span>${e.label}</span>`;
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.innerHTML = `
      <div class="panel modal r-${card.rarity}" style="position:relative">
        <span class="close">&times;</span>
        <div class="row" style="gap:18px;align-items:flex-start">
          <div class="tcard r-${card.rarity} ${["super_rare","ultra_rare","mega_rare","hidden_rare"].includes(card.rarity)?"shiny":""}"
               style="width:150px;flex:none;--ec:${matrix.META[card.element].color}">
            <div class="foil"></div>
            <div class="art">${matrix.META[card.element].glyph}</div>
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
      </div>`;
    ov.onclick = (e) => { if (e.target === ov || e.target.classList.contains("close")) ov.remove(); };
    document.body.appendChild(ov);
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
                <div class="pk-logo">🃏</div>
                <div class="pk-t">NIB</div>
              </div>
              <div class="pack-top"><span class="pull-tab">PULL ▸</span></div>
            </div>
          </div>
          <div class="row" style="justify-content:space-between;margin-top:10px">
            <span class="pill">💰 Cost: <b>${cfg.packPriceTokens} NIB</b></span>
            <span class="pill">Balance: <b>${bal} NIB</b></span>
          </div>
          <button class="btn gold" id="buyBtn" style="width:100%;margin-top:14px" ${canBuy ? "" : "disabled"}>
            ${!store.isLoggedIn() ? "Log in to buy"
              : !store.isVerified() ? "Verify your email to buy"
              : !cfg.packsEnabled ? "Sales paused"
              : bal < cfg.packPriceTokens ? "Insufficient NIB"
              : "Rip Pack — " + cfg.packPriceTokens + " NIB"}
          </button>
          ${!store.isLoggedIn() ? `<button class="btn" id="loginCta" style="width:100%;margin-top:8px">Log in / Sign up</button>` : ""}
          ${store.isLive() ? "" : `<button class="btn ghost sm" id="faucet" style="margin-top:8px">+ Get 50 demo NIB</button>`}
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
        <h3>Your Pull</h3>
        <div class="reveal" id="reveal"></div>
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
    $("#faucet")?.addEventListener("click", () => { store.grantTokens(50); toast("+50 NIB granted"); });
    $("#loginCta")?.addEventListener("click", () => openAuthModal());
    wireVerifyBanner();
    if (lastOpening) paintReveal(lastOpening, false);   // repaint prior pull on re-render
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
        <p class="muted" style="font-size:13px">${m === "signup" ? "Sign up to start collecting." : "Log in to your NIBCOIN account."}</p>
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

  // Draw the 6 revealed cards from opening data. Re-attaches click
  // handlers (data-driven, not innerHTML) so cards stay interactive.
  function paintReveal(opening, animate) {
    const area = $("#revealArea"), grid = $("#reveal");
    if (!area || !grid) return;
    area.classList.remove("hidden");
    grid.innerHTML = "";
    opening.slots.forEach((s, i) => {
      const card = catalog.byId(s.cardId);
      const el = cardEl(card, { serial: opening.serials?.[i] });
      if (animate) el.style.animationDelay = (i * 0.12) + "s";
      else el.style.animation = "none", el.style.opacity = "1";
      grid.appendChild(el);
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
      ripping = false;
      renderTopbar();
    }, 1320);
  }

  function bestRarity(slots) {
    const order = NIB.engine.RARITY_ORDER;
    return slots.reduce((b, s) => order.indexOf(s.rarity) > order.indexOf(b) ? s.rarity : b, "common");
  }

  // ---- COLLECTION ---------------------------------------------------
  const filters = { element: "", rarity: "", level: "" };
  function renderCollection() {
    const col = store.collection();
    const owned = col.map((n) => ({ ...catalog.byId(n.cardId), serial: n.serial }));
    const filtered = owned.filter((c) =>
      (!filters.element || c.element === filters.element) &&
      (!filters.rarity || c.rarity === filters.rarity) &&
      (!filters.level || c.level === +filters.level));

    const opt = (v, l) => `<option value="${v}">${l}</option>`;
    return `
      <div class="panel" style="margin-bottom:16px">
        <div class="row" style="justify-content:space-between">
          <h2 style="margin:0">Collection <span class="muted" style="font-size:15px">(${owned.length} cards)</span></h2>
          <div class="row">
            <select id="fElement"><option value="">All Elements</option>${matrix.ELEMENTS.map((e) => opt(e, matrix.META[e].glyph + " " + matrix.META[e].label)).join("")}</select>
            <select id="fRarity"><option value="">All Rarities</option>${Object.keys(catalog.RARITY_LABEL).map((r) => opt(r, catalog.RARITY_LABEL[r])).join("")}</select>
            <select id="fLevel"><option value="">All Levels</option>${[...Array(10)].map((_, i) => opt(i + 1, "Lv " + (i + 1))).join("")}</select>
          </div>
        </div>
      </div>
      ${owned.length === 0
        ? `<div class="gate"><div><h3>No cards yet</h3><p class="muted">Head to the Store and rip your first pack.</p></div></div>`
        : `<div class="cardgrid" id="colGrid"></div>`}`;
  }
  function wireCollection() {
    ["Element", "Rarity", "Level"].forEach((k) => {
      const sel = $("#f" + k);
      if (!sel) return;
      sel.value = filters[k.toLowerCase()];
      sel.onchange = () => { filters[k.toLowerCase()] = sel.value; render(); };
    });
    const grid = $("#colGrid");
    if (!grid) return;
    const owned = store.collection().map((n) => ({ ...catalog.byId(n.cardId), serial: n.serial }))
      .filter((c) =>
        (!filters.element || c.element === filters.element) &&
        (!filters.rarity || c.rarity === filters.rarity) &&
        (!filters.level || c.level === +filters.level));
    const order = NIB.engine.RARITY_ORDER;
    owned.sort((a, b) => order.indexOf(b.rarity) - order.indexOf(a.rarity) || b.level - a.level);
    owned.forEach((c) => grid.appendChild(cardEl(c, { serial: c.serial })));
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
          <div class="grid cols-2" style="margin-top:16px">
            <div class="panel" style="padding:12px;text-align:center"><div class="muted" style="font-size:12px">NIB Balance</div><div class="stat small">${store.balance()}</div></div>
            <div class="panel" style="padding:12px;text-align:center"><div class="muted" style="font-size:12px">Packs Opened</div><div class="stat small">${packs}</div></div>
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
      .map((c) => { const card = catalog.byId(c.cardId); return `<span class="pill" style="gap:4px" title="${card ? card.name : c.cardId}">${card ? matrix.META[card.element].glyph : "❔"} <span class="badge r-${c.rarity}" style="font-size:9px">${catalog.RARITY_LABEL[c.rarity]}</span></span>`; })
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

  // ---- shell / routing ---------------------------------------------
  function renderTopbar() {
    const name = store.wallet();          // display label (name/email/wallet)
    const addr = store.walletAddress();
    if (store.isLoggedIn()) {
      $("#walletArea").innerHTML = `
        <span class="pill"><span class="dot"></span>${name}</span>
        <span class="pill">${store.balance()} NIB</span>
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
