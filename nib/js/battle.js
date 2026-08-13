/* =====================================================================
   NIBCOIN TCG — Battle Engine
   Turn-based card combat using stats + the elemental matrix.
   Attaches to window.NIB.battle
   ===================================================================== */
(function (NIB) {
  "use strict";
  const matrix = NIB.matrix;
  const TEAM_SIZE = 3;

  const hpOf = (card) => Math.max(1, Math.round(card.stats.hp));

  // Damage = attack × elemental multiplier − half the target's defense.
  function damage(attacker, defender) {
    const mult = matrix.multiplier(attacker.element, defender.element);
    const raw = attacker.stats.attack * mult;
    return { amount: Math.max(1, Math.round(raw - defender.stats.defense * 0.5)), mult };
  }

  // ---- abilities ----------------------------------------------------
  const ABILITY_META = {
    crit:      { name: "Critical",      glyph: "💥", desc: (v) => `${v}% chance to deal double damage` },
    regen:     { name: "Regenerate",    glyph: "💚", desc: (v) => `Heal ${v} HP each turn` },
    armor:     { name: "Armor",         glyph: "🛡️", desc: (v) => `Reduce incoming damage ${v}%` },
    thorns:    { name: "Thorns",        glyph: "🌵", desc: (v) => `Reflect ${v}% of damage taken` },
    lifesteal: { name: "Lifesteal",     glyph: "🩸", desc: (v) => `Heal ${v}% of damage dealt` },
    poison:    { name: "Poison",        glyph: "☠️", desc: (v) => `Target loses ${v} HP/turn for 3 turns` },
    smite:     { name: "Smite",         glyph: "✴️", desc: (v) => `+${v} bonus damage (ignores armor)` },
    double:    { name: "Double Strike", glyph: "🗡️", desc: () => `Attack twice` },
    dodge:     { name: "Dodge",         glyph: "💨", desc: (v) => `${v}% chance to avoid an attack` },
  };
  const ELEMENT_ABILITY = {
    fire: "crit", water: "regen", earth: "armor", metal: "thorns", nature: "lifesteal",
    shadow: "poison", light: "smite", ice: "armor", electric: "double", air: "dodge",
  };
  function abilityValue(type, level) {
    const L = level || 1;
    return ({ crit: 15 + L * 3, regen: 3 + L * 2, armor: 12 + L * 2, thorns: 18 + L * 2,
      lifesteal: 22 + L * 3, poison: 2 + L * 2, smite: L * 3, dodge: 8 + L * 2, double: 0 })[type] || 0;
  }
  // The ability a card has: explicit admin override, else element default.
  function abilityFor(card) {
    if (!card) return null;
    let type, value;
    if (card.ability && card.ability.type) {
      type = card.ability.type;
      value = card.ability.value != null ? card.ability.value : abilityValue(type, card.level);
    } else {
      type = ELEMENT_ABILITY[card.element] || "crit";
      value = abilityValue(type, card.level);
    }
    const meta = ABILITY_META[type] || ABILITY_META.crit;
    return { type, value, name: meta.name, glyph: meta.glyph, desc: meta.desc(value) };
  }

  // Resolve one attack with all attacker/defender abilities. Mutates hp,
  // pushes log lines (newest first).
  function resolveAttack(attacker, target, log) {
    if (target.hp <= 0) return;
    const ab = abilityFor(attacker), dab = abilityFor(target);
    if (dab.type === "dodge" && Math.random() * 100 < dab.value) {
      log.unshift(`${dab.glyph} ${target.name} dodged the attack!`); return;
    }
    const hits = ab.type === "double" ? 2 : 1;
    for (let h = 0; h < hits && target.hp > 0; h++) {
      let d = damage(attacker, target).amount;
      let crit = false;
      if (ab.type === "crit" && Math.random() * 100 < ab.value) { d = Math.round(d * 2); crit = true; }
      if (dab.type === "armor") d = Math.round(d * (1 - dab.value / 100));
      if (ab.type === "smite") d += ab.value;
      d = Math.max(1, d);
      target.hp = Math.max(0, target.hp - d);
      log.unshift(`${attacker.name} hits ${target.name} for ${d}${crit ? " 💥CRIT" : ""}${h > 0 ? " (2nd strike)" : ""}${target.hp === 0 ? " — KO! 💀" : ""}`);
      if (ab.type === "lifesteal") { const heal = Math.round(d * ab.value / 100); if (heal) { attacker.hp = Math.min(attacker.maxHp, attacker.hp + heal); log.unshift(`${ab.glyph} ${attacker.name} drains ${heal} HP`); } }
      if (dab.type === "thorns" && attacker.hp > 0) { const ref = Math.max(1, Math.round(d * dab.value / 100)); attacker.hp = Math.max(0, attacker.hp - ref); log.unshift(`${dab.glyph} ${target.name} reflects ${ref}`); }
    }
    if (ab.type === "poison" && target.hp > 0) { target.poison = { dmg: ab.value, turns: 3 }; log.unshift(`${ab.glyph} ${target.name} is poisoned`); }
  }

  // Start-of-turn effects for a team (regen + poison damage over time).
  function startTurnTicks(team, log) {
    team.forEach((c) => {
      if (c.hp <= 0) return;
      const ab = abilityFor(c);
      if (ab.type === "regen" && c.hp < c.maxHp) { const h = Math.min(c.maxHp - c.hp, ab.value); c.hp += h; if (h) log.unshift(`${ab.glyph} ${c.name} regenerates ${h}`); }
      if (c.poison && c.poison.turns > 0) { const dmg = c.poison.dmg; c.hp = Math.max(0, c.hp - dmg); c.poison.turns--; log.unshift(`☠️ ${c.name} takes ${dmg} poison${c.hp === 0 ? " — KO! 💀" : ""}`); }
    });
  }

  // Wrap a card as a battle instance (mutable hp + instance id).
  function battleCard(card, side, i) {
    return Object.assign({}, card, { hp: hpOf(card), maxHp: hpOf(card), uid: side + "-" + i, side });
  }
  const alive = (team) => team.filter((c) => c.hp > 0);

  // AI: choose the (attacker, target) pair that does the most good —
  // prioritise kills, then elemental advantage, then raw damage.
  function aiChoose(myTeam, foeTeam) {
    const attackers = alive(myTeam), targets = alive(foeTeam);
    if (!attackers.length || !targets.length) return null;
    let best = null;
    attackers.forEach((a) => targets.forEach((t) => {
      const d = damage(a, t);
      const kills = d.amount >= t.hp;
      const score = d.amount + (kills ? 1000 : 0) + d.mult * 8;
      if (!best || score > best.score) best = { attacker: a, target: t, score };
    }));
    return best;
  }

  // Build an NPC team scaled to a difficulty tier.
  const NPC_TIERS = {
    easy:   { rarities: ["common", "uncommon"], label: "Easy" },
    medium: { rarities: ["rare", "super_rare"], label: "Medium" },
    hard:   { rarities: ["ultra_rare", "mega_rare"], label: "Hard" },
    boss:   { rarities: ["mega_rare", "hidden_rare"], label: "Boss" },
  };
  // Returns raw catalog cards (caller wraps with battleCard at battle start).
  function generateNpcTeam(difficulty, size) {
    const tier = NPC_TIERS[difficulty] || NPC_TIERS.easy;
    const pool = NIB.catalog.all().filter((c) => tier.rarities.includes(c.rarity));
    const team = [];
    for (let i = 0; i < (size || TEAM_SIZE); i++) team.push(pool[Math.floor(Math.random() * pool.length)]);
    return team;
  }

  // Rough team power, for matchmaking / display.
  function teamPower(cards) {
    return cards.reduce((s, c) => s + c.stats.attack + c.stats.defense + c.stats.hp, 0);
  }

  NIB.battle = { TEAM_SIZE, hpOf, damage, battleCard, alive, aiChoose, generateNpcTeam, teamPower, NPC_TIERS,
    ABILITY_META, ELEMENT_ABILITY, abilityFor, resolveAttack, startTurnTicks };
})(window.NIB = window.NIB || {});
