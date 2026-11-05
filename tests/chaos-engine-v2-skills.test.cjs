'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../dist/chaos-engine-v2.js');
const T = E.tuning, D = 25, N = 7;
const pct = value => value / 100 * D;
const names = Array.from({ length: N }, (_, i) => `Vịt ${i + 1}`);
const races = Array.from({ length: 1000 }, (_, seed) => E.createRace(names, D, seed));
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);
const rankIds = ranks => ranks.map((rank, id) => ({ rank, id })).sort((a, b) => a.rank - b.rank).map(x => x.id);
// Events sharing a tick with another effect are skipped: their positions mix two effects.
const lone = (race, e) => !race.events.some(o => o !== e && o.type !== 'rune-spawn' && Math.abs(o.time - e.time) < 1e-9);
function collect(filter) {
  const found = [];
  for (const race of races) for (const e of race.events) if (filter(e)) found.push({ race, e });
  return found;
}
const enough = (list, label, min = 5) => assert.ok(list.length >= min, `${label}: only ${list.length} events`);

test('wings fly past 2–3 ducks and show flying; leader hops forward', () => {
  const list = collect(e => e.skill === 'wings' && e.activation && e.outcome === 'fly');
  enough(list, 'wings');
  for (const { race, e } of list) {
    const rank = e.ranksBefore[e.actorId];
    if (rank === 1) { assert.ok(e.after[e.actorId] > e.before[e.actorId]); continue; }
    if (!lone(race, e)) continue;
    const newRank = race.sample(e.time)[e.actorId].currentRank;
    assert.ok(newRank <= rank - Math.min(T.wings.passMin, rank - 1) && newRank >= rank - Math.min(T.wings.passMax, rank - 1), `rank ${rank} → ${newRank}`);
    if (e.time + 0.4 < D) assert.equal(race.sample(e.time + 0.4)[e.actorId].flying, true);
  }
});

test('torpedo capsizes the leader (or second place when the thrower leads)', () => {
  const list = collect(e => e.skill === 'torpedo' && e.activation);
  enough(list, 'torpedo');
  for (const { race, e } of list) {
    const order = rankIds(e.ranksBefore);
    assert.equal(e.targetId, order[0] === e.actorId ? order[1] : order[0]);
    if (e.outcome === 'hit' && e.time + T.torpedo.stun < D) assert.equal(race.sample(e.time + T.torpedo.stun - 0.05)[e.targetId].pose, 'capsized');
  }
});

test('wave pushes the top three (except the caster) back and surfs the caster forward', () => {
  const list = collect(e => e.skill === 'wave' && e.activation);
  enough(list, 'wave');
  for (const { race, e } of list) {
    const top = rankIds(e.ranksBefore).filter(id => id !== e.actorId).slice(0, 3);
    assert.deepEqual([...e.affectedIds].sort(), [...top].sort());
    for (const id of top) if (e.outcomes[id] === 'hit') near(e.after[id], Math.max(0, e.before[id] - pct(T.wave.push)), `wave id ${id}`);
    if (!Object.values(e.outcomes).includes('reflected') && e.time + T.wave.surgeTime < D) assert.equal(race.sample(e.time + T.wave.surgeTime / 2)[e.actorId].boosting, true);
  }
});

test('swap trades places with a duck 1–3 ranks ahead (or behind when leading)', () => {
  const list = collect(e => e.skill === 'swap' && e.activation);
  enough(list, 'swap');
  for (const { e } of list) {
    const rank = e.ranksBefore[e.actorId], target = e.ranksBefore[e.targetId];
    if (rank === 1) assert.ok(target - rank >= T.swap.reachMin && target - rank <= T.swap.reachMax);
    else assert.ok(rank - target >= T.swap.reachMin && rank - target <= T.swap.reachMax, `rank ${rank} target ${target}`);
    if (e.outcome === 'swapped') { near(e.after[e.actorId], e.before[e.targetId], 'actor'); near(e.after[e.targetId], e.before[e.actorId], 'target'); }
  }
});

test('rocket blasts off about 70% of the time and otherwise capsizes itself', () => {
  const list = collect(e => e.skill === 'rocket' && e.activation);
  enough(list, 'rocket', 100);
  const boosts = list.filter(({ e }) => e.outcome === 'boost').length;
  assert.ok(boosts / list.length >= 0.6 && boosts / list.length <= 0.8, `boost ratio ${boosts / list.length}`);
  for (const { race, e } of list) {
    assert.ok(['boost', 'exploded', 'blocked', 'immune'].includes(e.outcome));
    if (e.outcome === 'exploded') assert.equal(race.sample(e.time + 0.05)[e.actorId].pose, 'capsized');
    if (e.outcome === 'boost') assert.equal(race.sample(e.time + 0.05)[e.actorId].boosting, true);
  }
});

test('hook pulls the duck just above back and overtakes it; leader pulls itself forward', () => {
  const list = collect(e => e.skill === 'hook' && e.activation);
  enough(list, 'hook');
  for (const { e } of list) {
    const rank = e.ranksBefore[e.actorId];
    if (rank === 1) { assert.equal(e.outcome, 'fallback'); near(e.after[e.actorId] - e.before[e.actorId], pct(T.hook.selfPull), 'self pull'); continue; }
    assert.equal(e.ranksBefore[e.targetId], rank - 1);
    if (e.outcome === 'hit') assert.ok(e.after[e.actorId] > e.after[e.targetId]);
  }
});

test('tornado reshuffles three ducks so every unprotected one moves', () => {
  const list = collect(e => e.skill === 'tornado' && e.activation);
  enough(list, 'tornado');
  for (const { e } of list) {
    assert.equal(new Set(e.affectedIds).size, 3);
    const moved = e.affectedIds.filter(id => !e.protectedIds.includes(id));
    if (moved.length < 2) continue;
    for (const id of moved) assert.notEqual(e.after[id], e.before[id]);
    assert.deepEqual(moved.map(id => e.after[id]).sort(), moved.map(id => e.before[id]).sort());
  }
});

test('tornado with a protected duck swaps only the other two', () => {
  const list = collect(e => e.skill === 'tornado' && e.activation && e.protectedIds.length > 0);
  enough(list, 'protected tornado', 1);
  for (const { e } of list) for (const id of e.protectedIds) assert.equal(e.after[id] ?? e.before[id], e.before[id]);
});

test('banana drops behind the caster (or is thrown ahead by the last duck) and spins whoever steps on it', () => {
  const drops = collect(e => e.skill === 'banana' && e.activation);
  enough(drops, 'banana drops');
  for (const { e } of drops) {
    assert.equal(e.outcome, 'dropped');
    const rank = e.ranksBefore[e.actorId];
    assert.equal(e.ranksBefore[e.targetId], rank === N ? rank - 1 : rank + 1);
  }
  const slips = collect(e => e.skill === 'banana' && !e.activation && e.outcome === 'hit');
  enough(slips, 'banana slips');
  for (const { race, e } of slips) if (e.time + 0.1 < D) assert.equal(race.sample(e.time + 0.1)[e.targetId].pose, 'spinning');
});

test('mirror reflects the first skill attack back to the attacker, never tornado or hazards', () => {
  const reactions = collect(e => e.skill === 'mirror' && e.activation && e.outcome === 'reflected');
  enough(reactions, 'mirror reflections');
  for (const { race, e } of reactions) {
    const attack = race.events.find(o => o.time === e.time && o.actorId === e.targetId && o.outcome === 'reflected' && o !== e);
    assert.ok(attack, 'attacker event marked reflected');
    assert.ok(['torpedo', 'wave', 'swap', 'hook', 'banana', 'mirror'].includes(attack.skill), attack.skill);
    if (['torpedo', 'swap', 'hook'].includes(attack.skill) && e.effect === 'hit') assert.equal(race.sample(e.time + 0.05)[e.targetId].pose, 'capsized');
    if (attack.skill === 'banana' && e.effect === 'hit') assert.equal(race.sample(e.time + 0.05)[e.targetId].pose, 'spinning');
  }
  assert.equal(collect(e => (e.type === 'hazard' || e.skill === 'tornado') && e.outcome === 'reflected').length, 0);
});

test('mirror with no attacker glares at the duck just above', () => {
  const list = collect(e => e.skill === 'mirror' && e.activation && e.outcome === 'fallback');
  enough(list, 'mirror glare');
  for (const { race, e } of list) {
    const rank = e.ranksBefore[e.actorId];
    assert.equal(e.ranksBefore[e.targetId], rank === 1 ? 2 : rank - 1);
    if (e.effect === 'hit' && e.time + T.mirror.glareTime < D) assert.equal(race.sample(e.time + T.mirror.glareTime / 2)[e.targetId].slowed, true);
  }
});

test('buoy blocks the first hit and bounces forward; unused buoy inflates at its slot', () => {
  const blocks = collect(e => e.skill === 'buoy' && e.activation && e.outcome === 'blocked');
  enough(blocks, 'buoy blocks');
  for (const { race, e } of blocks) {
    assert.ok(race.events.some(o => o !== e && o.time === e.time && (o.outcome === 'blocked' || o.outcomes?.[e.actorId] === 'blocked')), 'attacker event marked blocked');
    if (e.ranksBefore[e.actorId] > 1) assert.ok(e.after[e.actorId] > e.before[e.actorId]);
  }
  const fallbacks = collect(e => e.skill === 'buoy' && e.activation && e.outcome === 'fallback');
  enough(fallbacks, 'buoy fallbacks');
  for (const { e } of fallbacks) assert.ok(e.after[e.actorId] > e.before[e.actorId]);
});

test('stun does not stack and grants immunity', () => {
  const list = collect(e => e.skill === 'torpedo' && e.outcome === 'immune');
  enough(list, 'immune torpedoes', 1);
  for (const { race, e } of list) assert.equal(race.sample(e.time + 0.05)[e.targetId].stunned, race.sample(e.time - 0.05)[e.targetId].stunned);
});
