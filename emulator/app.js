/* ============================================================
   CARTRIDGE - browser-only ROM player
   All storage is local IndexedDB. No network calls with ROM data.
   Emulation powered by EmulatorJS (loaded on demand from its CDN,
   the same way any open-source JS library is loaded via <script>).
   ============================================================ */

(() => {
  "use strict";

  // ---------- Core / system detection by extension ----------
  const EXT_TO_CORE = {
    nes: { core: "nes", label: "NES" },
    sfc: { core: "snes", label: "SNES" },
    smc: { core: "snes", label: "SNES" },
    gb:  { core: "gb",   label: "GAME BOY" },
    gbc: { core: "gb",   label: "GB COLOR" },
    gba: { core: "gba",  label: "GBA" },
    md:  { core: "segaMD", label: "GENESIS" },
    gen: { core: "segaMD", label: "GENESIS" },
    n64: { core: "n64",  label: "N64" },
    z64: { core: "n64",  label: "N64" },
    v64: { core: "n64",  label: "N64" },
    a26: { core: "atari2600", label: "ATARI 2600" },
  };

  function detectSystem(filename) {
    const ext = filename.split(".").pop().toLowerCase();
    return EXT_TO_CORE[ext] || null;
  }

  // ---------- Cover art (libretro-thumbnails CDN, no API key needed) ----------
  // Maps our system label to the exact repo/folder name used by
  // thumbnails.libretro.com, which mirrors the libretro-thumbnails project.
  const BOXART_REPO = {
    "NES": "Nintendo - Nintendo Entertainment System",
    "SNES": "Nintendo - Super Nintendo Entertainment System",
    "GAME BOY": "Nintendo - Game Boy",
    "GB COLOR": "Nintendo - Game Boy Color",
    "GBA": "Nintendo - Game Boy Advance",
    "GENESIS": "Sega - Mega Drive - Genesis",
    "N64": "Nintendo - Nintendo 64",
    "ATARI 2600": "Atari - 2600",
  };

  // ROM filenames typically carry trailing tag groups like
  // "(U) (V1.2) [!]" or "(USA) (Rev 2)". Strip all of them to get the
  // bare title, which is what the box art database is keyed on.
  function cleanRomTitle(name) {
    let title = name;
    let prev;
    do {
      prev = title;
      title = title.replace(/\s*[([][^()[\]]*[)\]]\s*$/, "");
    } while (title !== prev);
    return title.trim();
  }

  function sanitizeBoxArtName(title) {
    // Only documented substitution the thumbnail repo makes for invalid
    // filename characters.
    return title.replace(/\*/g, "_");
  }

  // Try a handful of likely region suffixes against the exact bare title,
  // since we don't know which release the person's ROM actually is.
  function buildBoxArtCandidates(rom) {
    const repo = BOXART_REPO[rom.label];
    if (!repo) return [];
    const base = sanitizeBoxArtName(cleanRomTitle(rom.name));
    const suffixes = [" (USA)", " (World)", " (Europe)", " (Japan)", ""];
    return suffixes.map(
      (suf) => `https://thumbnails.libretro.com/${encodeURI(repo)}/Named_Boxarts/${encodeURI(base + suf + ".png")}`
    );
  }

  // Stable numeric ID per ROM, derived from its (stable) record id.
  // EmulatorJS uses EJS_gameID to keep saves/save-states separate between
  // games without it, games loaded from blob: URLs can collide or fail
  // to find their previous save data, since the blob URL itself changes
  // every time a game is launched.
  function stableGameId(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) || 1;
  }

  // Stable numeric ID per ROM, derived from its (stable) record id.
  // EmulatorJS uses EJS_gameID to keep saves/save-states separate between
  // games without it, games loaded from blob: URLs can collide or fail
  // to find their previous save data, since the blob URL itself changes
  // every time a game is launched.
  function stableGameId(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) || 1;
  }

  // ---------- IndexedDB wrapper ----------
  const DB_NAME = "cartridge_db";
  const DB_VERSION = 1;
  const STORE = "roms";

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("addedAt", "addedAt");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbAll() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbPut(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbDelete(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ---------- DOM refs ----------
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const slotLabel = document.getElementById("slotLabel");
  const libraryGrid = document.getElementById("libraryGrid");
  const libraryEmpty = document.getElementById("libraryEmpty");
  const libCount = document.getElementById("libCount");
  const playerModal = document.getElementById("playerModal");
  const playerTitle = document.getElementById("playerTitle");
  const closePlayer = document.getElementById("closePlayer");
  const gameEl = document.getElementById("game");

  // ---------- Nav smooth-scroll ----------
  document.querySelectorAll("[data-scroll]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelector(btn.dataset.scroll)?.scrollIntoView({ behavior: "smooth" });
    });
  });

  // ---------- Drag & drop wiring ----------
  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("drag-over");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("drag-over");
    })
  );
  dropzone.addEventListener("drop", (e) => {
    const files = Array.from(e.dataTransfer.files || []);
    handleFiles(files);
  });
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", () => {
    handleFiles(Array.from(fileInput.files || []));
    fileInput.value = "";
  });

  async function handleFiles(files) {
    if (!files.length) return;
    let added = 0;
    for (const file of files) {
      const system = detectSystem(file.name);
      if (!system) {
        alert(`"${file.name}" isn't a recognized ROM format. Supported: NES, SNES, GB/GBC, GBA, Genesis, N64, Atari 2600.`);
        continue;
      }
      const record = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: file.name.replace(/\.[^/.]+$/, ""),
        filename: file.name,
        core: system.core,
        label: system.label,
        size: file.size,
        addedAt: Date.now(),
        blob: file,
      };
      await dbPut(record);
      added++;
    }
    if (added) {
      slotLabel.querySelector(".slot-title").textContent = `${added} CARTRIDGE${added > 1 ? "S" : ""} LOADED`;
      dropzone.classList.add("has-file");
      setTimeout(() => {
        slotLabel.querySelector(".slot-title").textContent = "DRAG ROM HERE";
        dropzone.classList.remove("has-file");
      }, 2200);
      renderLibrary();
    }
  }

  // ---------- Library rendering ----------
  async function renderLibrary() {
    const roms = (await dbAll()).sort((a, b) => b.addedAt - a.addedAt);
    libCount.textContent = `${roms.length} CARTRIDGE${roms.length === 1 ? "" : "S"}`;
    libraryEmpty.style.display = roms.length ? "none" : "block";
    libraryGrid.innerHTML = "";

    roms.forEach((rom) => {
      const card = document.createElement("div");
      card.className = "cart-card";
      card.innerHTML = `
        <div class="cart-thumb">
          <img class="cart-art" alt="" loading="lazy">
          <span class="cart-sys">${rom.label}</span>
        </div>
        <div class="cart-body">
          <div class="cart-name" title="${escapeHtml(rom.filename)}">${escapeHtml(rom.name)}</div>
          <div class="cart-meta">${formatSize(rom.size)} · ADDED ${formatDate(rom.addedAt)}</div>
          <div class="cart-actions">
            <button class="btn btn-play" data-id="${rom.id}">▶ PLAY</button>
            <button class="btn btn-ghost" data-remove="${rom.id}" aria-label="Remove ${escapeHtml(rom.name)}">✕</button>
          </div>
        </div>
      `;
      libraryGrid.appendChild(card);
      wireBoxArt(card, rom);
    });

    libraryGrid.querySelectorAll("[data-id]").forEach((btn) => {
      btn.addEventListener("click", () => launchGame(btn.dataset.id));
    });
    libraryGrid.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (confirm("Remove this cartridge from your library? This can't be undone.")) {
          await dbDelete(btn.dataset.remove);
          renderLibrary();
        }
      });
    });
  }

  // Tries each candidate box art URL in turn; if one loads, it replaces the
  // striped placeholder. If they all fail (no match in the database), the
  // placeholder with the system label just stays as-is.
  function wireBoxArt(card, rom) {
    const candidates = buildBoxArtCandidates(rom);
    if (!candidates.length) return;
    const img = card.querySelector(".cart-art");
    const thumb = card.querySelector(".cart-thumb");
    let idx = 0;
    img.addEventListener("error", () => {
      idx++;
      if (idx < candidates.length) {
        img.src = candidates[idx];
      }
    });
    img.addEventListener("load", () => {
      thumb.classList.add("has-art");
    });
    img.src = candidates[idx];
  }

  function formatSize(bytes) {
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  function formatDate(ts) {
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------- EmulatorJS launch ----------


  async function launchGame(id) {
    const roms = await dbAll();
    const rom = roms.find((r) => r.id === id);
    if (!rom) return;

    playerTitle.textContent = rom.name;
    playerModal.classList.add("open");
    playerModal.setAttribute("aria-hidden", "false");
    gameEl.innerHTML = "";

    // EmulatorJS is built to own the page it's dropped into and isn't meant
    // to be re-initialized into the same DOM node repeatedly (its own docs
    // call this out for single-page apps). Each launch gets a fresh iframe
    // so controls, input listeners, and emulator state never carry over
    // stale bindings from a previous game.
    const iframe = document.createElement("iframe");
    iframe.className = "player-iframe";
    iframe.setAttribute("allow", "gamepad *; fullscreen *; autoplay *;");
    gameEl.appendChild(iframe);
    gameEl.onclick = () => iframe.contentWindow?.focus();

    const gameId = stableGameId(rom.id);
    const doc = `<!DOCTYPE html>
<html>
<head>
<style>
  html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden;}
  #game{width:100%;height:100%;}
  #bootStatus{
    position:absolute; top:0; left:0; right:0;
    padding:14px 16px;
    font-family: monospace;
    font-size:12px;
    color:#f4c430;
    background:rgba(0,0,0,0.6);
    z-index:5;
    pointer-events:none;
  }
  #bootError{
    position:absolute; inset:0;
    display:none;
    align-items:center; justify-content:center;
    padding:24px;
    font-family: monospace;
    font-size:13px;
    color:#f2ede0;
    text-align:center;
    background:#000;
    z-index:6;
  }
</style>
</head>
<body>
<div id="bootStatus">Loading ${escapeHtml(rom.label)} engine...</div>
<div id="bootError"></div>
<div id="game"></div>
<script>
  function showBootError(msg){
    var el = document.getElementById('bootError');
    el.textContent = msg;
    el.style.display = 'flex';
  }
  window.addEventListener('error', function(e){
    showBootError('Script error: ' + (e.message || 'unknown') + (e.filename ? (' (' + e.filename.split('/').pop() + ')') : ''));
  });
  window.addEventListener('unhandledrejection', function(e){
    showBootError('Load error: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason)));
  });
  setTimeout(function(){
    var s = document.getElementById('bootStatus');
    if (s) s.textContent += ' (still loading: heavier systems like N64 can take a while on first load; if this never changes, check the browser console for errors)';
  }, 15000);

  // Wait for the ROM bytes from the parent page instead of being handed a
  // blob: URL created in a different browsing context. The blob URL below
  // is created HERE, inside this iframe, so it always resolves correctly.
  window.addEventListener('message', function(e){
    var data = e.data;
    if (!data || data.type !== 'load-rom') return;
    var blob = new Blob([data.bytes]);
    var url = URL.createObjectURL(blob);

    window.EJS_player = "#game";
    window.EJS_core = data.core;
    window.EJS_gameUrl = url;
    window.EJS_gameName = data.name;
    window.EJS_gameID = data.gameId;
    window.EJS_pathtodata = "https://cdn.emulatorjs.org/stable/data/";
    window.EJS_onGameStart = function(){
      var s = document.getElementById('bootStatus');
      if (s) s.remove();
      window.focus();
    };

    var script = document.createElement('script');
    script.src = "https://cdn.emulatorjs.org/stable/data/loader.js";
    script.onerror = function(){
      showBootError('Could not reach the emulator engine at cdn.emulatorjs.org. Check your connection or try again.');
    };
    document.body.appendChild(script);
  });
  // Tell the parent we're ready to receive the ROM.
  window.parent.postMessage({ type: 'iframe-ready' }, '*');
</script>
</body>
</html>`;

    iframe.srcdoc = doc;

    // Once the iframe signals it's ready, hand over the ROM bytes.
    const messageHandler = async (e) => {
      if (e.source !== iframe.contentWindow) return;
      if (!e.data || e.data.type !== "iframe-ready") return;
      window.removeEventListener("message", messageHandler);
      const arrayBuffer = await rom.blob.arrayBuffer();
      iframe.contentWindow.postMessage(
        {
          type: "load-rom",
          bytes: arrayBuffer,
          core: rom.core,
          name: rom.name,
          gameId,
        },
        "*",
        [arrayBuffer]
      );
    };
    window.addEventListener("message", messageHandler);
  }

  function closePlayerModal() {
    playerModal.classList.remove("open");
    playerModal.setAttribute("aria-hidden", "true");
    gameEl.innerHTML = "";
  }

  closePlayer.addEventListener("click", closePlayerModal);
  playerModal.addEventListener("click", (e) => {
    if (e.target === playerModal) closePlayerModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && playerModal.classList.contains("open")) closePlayerModal();
  });

  // ---------- Init ----------
  renderLibrary();
})();
