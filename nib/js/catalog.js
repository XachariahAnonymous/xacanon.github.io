/* =====================================================================
   LOLCOIN TCG — Card Catalogue Generator
   Procedurally builds all 1,710 unique designs so the game is fully
   playable without hand-authoring art. In production these rows live in
   the Supabase `cards` table; here we generate them deterministically.
   Attaches to window.NIB.catalog
   ===================================================================== */
(function (NIB) {
  "use strict";
  const ELEMENTS = NIB.matrix.ELEMENTS;

  // rarity -> { count PER ELEMENT, tier mint cap, level range }
  const TIERS = {
    common:      { perElement: 50, tierCap: 30000000, lvl: [1, 3] },
    uncommon:    { perElement: 50, tierCap: 20000000, lvl: [1, 3] },
    rare:        { perElement: 25, tierCap: 10000000, lvl: [3, 6] },
    super_rare:  { perElement: 25, tierCap: 500000,   lvl: [3, 6] },
    ultra_rare:  { perElement: 10, tierCap: 200000,   lvl: [6, 9] },
    mega_rare:   { perElement: 10, tierCap: 100000,   lvl: [6, 9] },
    hidden_rare: { perElement: 1,  tierCap: 10000,    lvl: [10, 10] },
  };

  const RARITY_LABEL = {
    common: "Common", uncommon: "Uncommon", rare: "Rare",
    super_rare: "Super Rare", ultra_rare: "Ultra Rare",
    mega_rare: "Mega Rare", hidden_rare: "Hidden Rare",
  };

  // Deterministic PRNG so the same catalogue regenerates identically.
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Name fragments for flavour (element-themed prefix + beast + epithet).
  const BEASTS = ["Drake", "Golem", "Wyrm", "Serpent", "Titan", "Sprite",
    "Warden", "Hound", "Phoenix", "Basilisk", "Colossus", "Revenant",
    "Behemoth", "Chimera", "Leviathan", "Griffin", "Wisp", "Sentinel"];
  const EPITHETS = ["", "the Eternal", "Prime", "Ascendant", "the Fallen",
    "Vanguard", "the Ancient", "Rex", "Nova", "the Wraith"];
  const PREFIX = {
    fire: "Ember", water: "Tidal", earth: "Terra", metal: "Chrome",
    nature: "Verdant", shadow: "Umbral", light: "Radiant", ice: "Frost",
    electric: "Volt", air: "Gale",
  };

  function buildCatalog() {
    const cards = [];
    for (const rarity of Object.keys(TIERS)) {
      const t = TIERS[rarity];
      const perCardCap = Math.floor(t.tierCap / (t.perElement * ELEMENTS.length));
      ELEMENTS.forEach((element) => {
        for (let i = 0; i < t.perElement; i++) {
          const seed =
            (rarity.length * 131 + element.charCodeAt(0) * 17 + i * 7) | 0;
          const rng = mulberry32(seed + i * 2654435761);
          const [lo, hi] = t.lvl;
          const level = lo + Math.floor(rng() * (hi - lo + 1));
          const beast = BEASTS[Math.floor(rng() * BEASTS.length)];
          const epithet = EPITHETS[Math.floor(rng() * EPITHETS.length)];
          // stat budget scales with level & rarity
          const budget = level * 14 + Object.keys(TIERS).indexOf(rarity) * 22;
          const atk = Math.round(budget * (0.35 + rng() * 0.3));
          const def = Math.round(budget * (0.25 + rng() * 0.25));
          const hp = Math.round(budget * (0.9 + rng() * 0.6)) + 20;

          cards.push({
            id: `${rarity}-${element}-${String(i + 1).padStart(2, "0")}`,
            slug: `${element}-${rarity}-${i + 1}`,
            name: `${PREFIX[element]} ${beast}${epithet ? " " + epithet : ""}`,
            element,
            rarity,
            rarityLabel: RARITY_LABEL[rarity],
            level,
            stats: { attack: atk, defense: def, hp },
            mintCap: perCardCap,
          });
        }
      });
    }
    return cards;
  }

  let _cache = null;
  function all() { return (_cache = _cache || buildCatalog()); }

  NIB.catalog = {
    TIERS, RARITY_LABEL, all,
    byId: (id) => all().find((c) => c.id === id),
    count: () => all().length, // => 1710
  };
})(window.NIB = window.NIB || {});
