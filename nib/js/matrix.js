/* =====================================================================
   LOLCOIN TCG — Elemental Advantage Matrix  (Deliverable 3)
   Classic script -> attaches to window.NIB.matrix
   Fast O(1) lookups for combat & UI strength/weakness display.
   ===================================================================== */
(function (NIB) {
  "use strict";

  const ELEMENTS = [
    "fire", "water", "earth", "metal", "nature",
    "shadow", "light", "ice", "electric", "air",
  ];

  // Display metadata: label, emoji glyph, theme color (for card frames/UI).
  const META = {
    fire:     { label: "Fire",     glyph: "🔥", color: "#ff5a3c" },
    water:    { label: "Water",    glyph: "💧", color: "#3aa0ff" },
    earth:    { label: "Earth",    glyph: "⛰️", color: "#b07d43" },
    metal:    { label: "Metal",    glyph: "⚙️", color: "#b8c0cc" },
    nature:   { label: "Nature",   glyph: "🌿", color: "#4fcf6b" },
    shadow:   { label: "Shadow",   glyph: "🌑", color: "#8a5cf6" },
    light:    { label: "Light",    glyph: "✨", color: "#ffd75a" },
    ice:      { label: "Ice",      glyph: "❄️", color: "#7fe4ff" },
    electric: { label: "Electric", glyph: "⚡", color: "#ffe23c" }, // a.k.a. Lightning
    air:      { label: "Air",      glyph: "🌬️", color: "#c9e8ff" },
  };

  // Canonical relationship table straight from the design doc.
  // "beats" = deals bonus damage to; "weakTo" = takes bonus damage from.
  const RELATIONS = {
    fire:     { beats: ["metal", "ice"],     weakTo: ["water"] },
    water:    { beats: ["fire"],             weakTo: ["earth", "electric"] },
    earth:    { beats: ["water", "air"],     weakTo: ["nature"] },
    metal:    { beats: ["nature"],           weakTo: ["fire", "light"] },
    nature:   { beats: ["earth", "shadow"],  weakTo: ["metal"] },
    shadow:   { beats: ["light"],            weakTo: ["air", "nature"] },
    light:    { beats: ["ice", "metal"],     weakTo: ["shadow"] },
    ice:      { beats: ["electric"],         weakTo: ["light", "fire"] },
    electric: { beats: ["air", "water"],     weakTo: ["ice"] },
    air:      { beats: ["shadow"],           weakTo: ["electric", "earth"] },
  };

  const DAMAGE_MULTIPLIER = 1.5;   // advantage bonus
  const RESIST_MULTIPLIER = 0.75;  // disadvantage penalty

  /** Does attacker have the elemental advantage over defender? */
  function hasAdvantage(attacker, defender) {
    return RELATIONS[attacker]?.beats.includes(defender) || false;
  }

  /** Combat multiplier for `attacker` striking `defender`. */
  function multiplier(attacker, defender) {
    if (hasAdvantage(attacker, defender)) return DAMAGE_MULTIPLIER;
    if (RELATIONS[attacker]?.weakTo.includes(defender)) return RESIST_MULTIPLIER;
    return 1.0;
  }

  /** Everything the UI needs for a given element's detail modal. */
  function profile(element) {
    const r = RELATIONS[element];
    return {
      element,
      ...META[element],
      strongAgainst: r.beats.map((e) => ({ element: e, ...META[e] })),
      weakAgainst:   r.weakTo.map((e) => ({ element: e, ...META[e] })),
    };
  }

  NIB.matrix = {
    ELEMENTS, META, RELATIONS,
    DAMAGE_MULTIPLIER, RESIST_MULTIPLIER,
    hasAdvantage, multiplier, profile,
  };
})(window.NIB = window.NIB || {});
