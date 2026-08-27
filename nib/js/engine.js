/* =====================================================================
   LOLCOIN TCG — Pack Opening RNG Engine (browser port of packEngine.ts)
   Deliverable 2, running client-side for the demo.

   ⚠️  In production this logic MUST run inside a Supabase Edge Function
       with the service-role key. Client-side rolls are exploitable — a
       player could re-roll for Hidden Rares. The seam is store.openPack().
   Attaches to window.NIB.engine
   ===================================================================== */
(function (NIB) {
  "use strict";

  const RARITY_ORDER = [
    "common", "uncommon", "rare", "super_rare",
    "ultra_rare", "mega_rare", "hidden_rare",
  ];

  const DEFAULT_CONFIG = {
    fixedSlots: [
      { rarity: "common", count: 3 },
      { rarity: "uncommon", count: 2 },
    ],
    chaseTable: {
      hidden_rare: 0.0001,
      mega_rare: 0.01,
      ultra_rare: 0.02,
      super_rare: 0.05,
    },
    chaseFloor: "rare",
    bonusRare: { enabled: true, chance: 0.1, from: "uncommon", to: "rare" },
  };

  // Cryptographically-strong uniform float in [0,1). Good enough for a
  // client demo; production uses provably-fair HMAC seeds (see .ts file).
  function rng() {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return (buf[0] * 4294967296 + buf[1]) / 2 ** 64;
  }

  function rollChaseRarity(cfg, roll) {
    let cum = 0;
    const ordered = Object.entries(cfg.chaseTable).sort(
      (a, b) => RARITY_ORDER.indexOf(b[0]) - RARITY_ORDER.indexOf(a[0]),
    );
    for (const [rarity, prob] of ordered) {
      cum += prob;
      if (roll < cum) return rarity;
    }
    return cfg.chaseFloor;
  }

  /**
   * Allocate 6 cards.
   * @param pool    array of { id, rarity, element, mintCap, mintedCount }
   * @param reserve (cardId) => boolean  atomically reserves a copy (cap check)
   * @param cfg     economy config (drop-rate overrides etc.)
   */
  function openPack(pool, reserve, cfg) {
    cfg = cfg || DEFAULT_CONFIG;

    const planned = [];
    for (const s of cfg.fixedSlots)
      for (let i = 0; i < s.count; i++) planned.push(s.rarity);

    if (cfg.bonusRare.enabled && rng() < cfg.bonusRare.chance) {
      const idx = planned.indexOf(cfg.bonusRare.from);
      if (idx !== -1) planned[idx] = cfg.bonusRare.to;
    }

    planned.push(rollChaseRarity(cfg, rng()));

    const slots = [];
    for (let i = 0; i < planned.length; i++) {
      slots.push(selectCard(pool, planned[i], reserve));
    }
    return slots; // [{ cardId, rarity, downtiered }]
  }

  function selectCard(pool, desired, reserve) {
    const start = RARITY_ORDER.indexOf(desired);
    // Prefer the rolled rarity, step DOWN toward common, then UP toward rarer
    // so packs still fill when whole tiers are disabled/empty.
    const tiers = [];
    for (let t = start; t >= 0; t--) tiers.push(t);
    for (let t = start + 1; t < RARITY_ORDER.length; t++) tiers.push(t);
    for (const t of tiers) {
      const rarity = RARITY_ORDER[t];
      let candidates = pool.filter(
        (c) => c.rarity === rarity && c.mintedCount < c.mintCap,
      );
      while (candidates.length) {
        const pick = candidates[Math.floor(rng() * candidates.length)];
        if (reserve(pick.id)) {
          pick.mintedCount++;
          return { cardId: pick.id, rarity, downtiered: t !== start };
        }
        candidates = candidates.filter((c) => c.id !== pick.id);
      }
    }
    throw new Error("Card pool exhausted");
  }

  NIB.engine = { RARITY_ORDER, DEFAULT_CONFIG, openPack };
})(window.NIB = window.NIB || {});
