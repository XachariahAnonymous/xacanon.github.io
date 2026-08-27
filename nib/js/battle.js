/* =====================================================================
   LOLCOIN TCG — Battle Engine
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

  // Start-of-turn effects for a team (regen + poison DoT + cooldown ticks).
  function startTurnTicks(team, log) {
    team.forEach((c) => {
      if (c.cd) for (const k in c.cd) if (c.cd[k] > 0) c.cd[k]--;
      if (c.hp <= 0) return;
      const ab = abilityFor(c);
      if (ab.type === "regen" && c.hp < c.maxHp) { const h = Math.min(c.maxHp - c.hp, ab.value); c.hp += h; if (h) log.unshift(`${ab.glyph} ${c.name} regenerates ${h}`); }
      if (c.poison && c.poison.turns > 0) { const dmg = c.poison.dmg; c.hp = Math.max(0, c.hp - dmg); c.poison.turns--; log.unshift(`☠️ ${c.name} takes ${dmg} poison${c.hp === 0 ? " — KO! 💀" : ""}`); }
    });
  }

  // ---- active abilities (chosen each turn) --------------------------
  // Damage that folds in the attacker's & target's passive traits plus
  // ability options (mult, extra crit, ignore-defense, multi-hit, etc.).
  function dealDamage(user, target, o, log) {
    o = o || {}; if (target.hp <= 0) return;
    const uab = abilityFor(user), dab = abilityFor(target);
    if (dab.type === "dodge" && Math.random() * 100 < dab.value) { log.unshift(`${dab.glyph} ${target.name} dodged!`); return; }
    const hits = o.hits || 1;
    for (let h = 0; h < hits && target.hp > 0; h++) {
      let d = damage(user, target).amount * (o.mult || 1);
      const critChance = (uab.type === "crit" ? uab.value : 0) + (o.crit || 0);
      let crit = false; if (critChance && Math.random() * 100 < critChance) { d *= 2; crit = true; }
      if (!o.ignoreDef) { const armor = (dab.type === "armor" ? dab.value : 0) + (target.armorBuff || 0); if (armor) d *= (1 - Math.min(85, armor) / 100); }
      if (uab.type === "smite") d += uab.value;
      d = Math.max(1, Math.round(d));
      target.hp = Math.max(0, target.hp - d);
      log.unshift(`${user.name} ${o.verb || "hits"} ${target.name} for ${d}${crit ? " 💥CRIT" : ""}${h > 0 ? " (x2)" : ""}${target.hp === 0 ? " — KO! 💀" : ""}`);
      const ls = (uab.type === "lifesteal" ? uab.value : 0) + (o.lifesteal || 0);
      if (ls) { const heal = Math.round(d * ls / 100); if (heal) { user.hp = Math.min(user.maxHp, user.hp + heal); log.unshift(`🩸 ${user.name} drains ${heal}`); } }
      if (dab.type === "thorns" && user.hp > 0) { const ref = Math.max(1, Math.round(d * dab.value / 100)); user.hp = Math.max(0, user.hp - ref); log.unshift(`🌵 ${target.name} reflects ${ref}`); }
    }
    if (o.slow && target.hp > 0) { target.stats = Object.assign({}, target.stats, { attack: Math.max(1, Math.round(target.stats.attack * (1 - o.slow / 100))) }); log.unshift(`❄️ ${target.name} weakened`); }
    const pDmg = o.poison || (uab.type === "poison" ? uab.value : 0);
    if (pDmg && (o.poison || uab.type === "poison") && target.hp > 0) { target.poison = { dmg: pDmg, turns: 3 }; log.unshift(`☠️ ${target.name} poisoned`); }
  }

  const SPECIALS = {
    fire:     (L) => ({ id: "fireball", name: "Fireball",  glyph: "🔥", cd: 2, target: "enemy", dmg: 1.7, crit: 35, desc: "Heavy fire damage, high crit" }),
    water:    (L) => ({ id: "mend",     name: "Mend",      glyph: "💧", cd: 2, target: "ally",  heal: 20 + L * 6, desc: "Heal an ally" }),
    earth:    (L) => ({ id: "bulwark",  name: "Bulwark",   glyph: "⛰️", cd: 3, target: "self",  armorBuff: 40, desc: "Gain 40% armor" }),
    metal:    (L) => ({ id: "riposte",  name: "Riposte",   glyph: "⚙️", cd: 2, target: "enemy", dmg: 1.3, selfArmor: 25, desc: "Attack and gain armor" }),
    nature:   (L) => ({ id: "drain",    name: "Drain",     glyph: "🌿", cd: 2, target: "enemy", dmg: 1.3, lifesteal: 60, desc: "Attack and heal 60% of damage" }),
    shadow:   (L) => ({ id: "venom",    name: "Venom",     glyph: "🌑", cd: 2, target: "enemy", dmg: 1.1, poison: 4 + L * 2, desc: "Attack and poison" }),
    light:    (L) => ({ id: "smitex",   name: "Smite",     glyph: "✨", cd: 2, target: "enemy", dmg: 1.4, ignoreDef: true, desc: "Attack ignoring defense" }),
    ice:      (L) => ({ id: "frost",    name: "Frost",     glyph: "❄️", cd: 2, target: "enemy", dmg: 1.2, slow: 30, desc: "Attack and weaken the target" }),
    electric: (L) => ({ id: "chain",    name: "Chain",     glyph: "⚡", cd: 2, target: "allEnemies", dmg: 0.8, desc: "Hit all enemies" }),
    air:      (L) => ({ id: "gust",     name: "Gust",      glyph: "🌬️", cd: 2, target: "enemy", dmg: 0.9, hits: 2, desc: "Strike twice" }),
  };
  const ULTI = (L) => ({ id: "overload", name: "Overload", glyph: "🌟", cd: 3, target: "allEnemies", dmg: 1.2, lifesteal: 25, desc: "Hit all enemies + lifesteal" });

  function abilitiesFor(card) {
    const L = card.level || 1;
    const list = [{ id: "strike", name: "Strike", glyph: "⚔️", cd: 0, target: "enemy", dmg: 1.0, desc: "Basic attack" }];
    if (SPECIALS[card.element]) list.push(SPECIALS[card.element](L));
    if (["super_rare", "ultra_rare", "mega_rare", "hidden_rare"].includes(card.rarity)) list.push(ULTI(L));
    return list;
  }
  const ready = (card, ab) => !(card.cd && card.cd[ab.id] > 0);

  function targetsOf(user, ab, target, ctx) {
    if (ab.target === "allEnemies") return alive(ctx.foes);
    if (ab.target === "allAllies") return alive(ctx.allies);
    if (ab.target === "self") return [user];
    return target ? [target] : [];
  }
  // Apply an ability or item's effect. ctx = { allies, foes }.
  function applyAbility(user, ab, target, ctx, log) {
    const ts = targetsOf(user, ab, target, ctx);
    if (ab.dmg) ts.forEach((t) => dealDamage(user, t, { mult: ab.dmg, hits: ab.hits, crit: ab.crit, ignoreDef: ab.ignoreDef, poison: ab.poison, lifesteal: ab.lifesteal, slow: ab.slow, verb: "uses " + ab.name + " on" }, log));
    if (ab.flat) ts.forEach((t) => { if (t.hp > 0) { t.hp = Math.max(0, t.hp - ab.flat); log.unshift(`💥 ${t.name} takes ${ab.flat}${t.hp === 0 ? " — KO! 💀" : ""}`); } });
    if (ab.heal) ts.forEach((t) => { if (t.hp > 0) { const h = Math.min(t.maxHp - t.hp, ab.heal); if (h) { t.hp += h; log.unshift(`💚 ${t.name} heals ${h}`); } } });
    if (ab.armorBuff) ts.forEach((t) => { t.armorBuff = Math.min(80, (t.armorBuff || 0) + ab.armorBuff); log.unshift(`🛡️ ${t.name} +${ab.armorBuff}% armor`); });
    if (ab.selfArmor) { user.armorBuff = Math.min(80, (user.armorBuff || 0) + ab.selfArmor); log.unshift(`🛡️ ${user.name} +${ab.selfArmor}% armor`); }
    if (ab.cleanse) ts.forEach((t) => { if (t.poison) { t.poison = null; log.unshift(`✨ ${t.name} cured`); } });
    if (ab.cd && ab.id) { user.cd = user.cd || {}; user.cd[ab.id] = ab.cd; }
  }

  // ---- items (bought in the shop with coins) ------------------------
  const COIN_PER_NIB = 100;            // exchange rate: 1 NIB -> 100 coins
  const ITEMS = {
    potion:    { id: "potion",    name: "Potion",     glyph: "🧪", target: "ally",       heal: 70,  price: 40,  desc: "Heal an ally 70 HP" },
    elixir:    { id: "elixir",    name: "Elixir",     glyph: "⚗️", target: "ally",       heal: 160, price: 90,  desc: "Heal an ally 160 HP" },
    bomb:      { id: "bomb",      name: "Bomb",       glyph: "💣", target: "allEnemies", flat: 50,  price: 90,  desc: "50 damage to all enemies" },
    cleanse:   { id: "cleanse",   name: "Cleanse",    glyph: "✨", target: "allAllies",  cleanse: true, heal: 25, price: 55, desc: "Cure poison + heal team 25" },
    shieldkit: { id: "shieldkit", name: "Shield Kit", glyph: "🛡️", target: "allAllies",  armorBuff: 30, price: 80, desc: "All allies +30% armor" },
  };

  // ---- AI: choose a card, ability, and target -----------------------
  function aiTurn(foes, mine) {
    const actors = alive(foes); const targetsPool = alive(mine);
    if (!actors.length || !targetsPool.length) return null;
    let best = null;
    actors.forEach((a) => abilitiesFor(a).filter((ab) => ready(a, ab)).forEach((ab) => {
      // score offensive abilities by expected damage/utility
      let score = 0, target = null;
      if (ab.dmg || ab.flat) {
        targetsPool.forEach((t) => { const d = damage(a, t).amount * (ab.dmg || 1) + (ab.flat || 0); const s = d + (d >= t.hp ? 1000 : 0) + (ab.target === "allEnemies" ? 60 : 0); if (!target || s > score) { score = s; target = t; } });
      } else if (ab.heal) { const hurt = actors.filter((c) => c.hp < c.maxHp * 0.5); if (hurt.length) { score = 40; target = hurt.sort((x, y) => x.hp - y.hp)[0]; } }
      else { score = 20; target = a; }
      if (target && (!best || score > best.score)) best = { actor: a, ab, target, score };
    }));
    return best;
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
    ABILITY_META, ELEMENT_ABILITY, abilityFor, resolveAttack, startTurnTicks,
    abilitiesFor, applyAbility, dealDamage, ready, ITEMS, COIN_PER_NIB, aiTurn };
})(window.NIB = window.NIB || {});
