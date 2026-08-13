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

  NIB.battle = { TEAM_SIZE, hpOf, damage, battleCard, alive, aiChoose, generateNpcTeam, teamPower, NPC_TIERS };
})(window.NIB = window.NIB || {});
