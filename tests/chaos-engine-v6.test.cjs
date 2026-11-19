'use strict';
// chaos-v6: chaos-v5 (lanes in race rooms, a calm stretch before the line) with the finale rock back (some races, every
// race under the 🎬 day rule) and, in race rooms, a late plot twist on the river that the casts cannot move.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../dist/chaos-engine-v2.js');
const V5 = E.v5, V6 = E.v6;
const names = count => Array.from({ length: count }, (_, i) => `V${i}`);
const D = 55;
// A race room where every owner cast early (the plot skill of a solo race would then come early too).
const room = (V, seed, extra = {}) => ({ ...V.deal(6, seed), casts: [8, 10, 12, 14, 16, 18], pilots: Array(6).fill(false), dodges: Array(6).fill(null), ...extra });
const late = (race, from, to) => race.events.filter(e => e.scheduled && !e.finale && (e.type === 'skill' || e.type === 'hazard') && e.time >= from - 1e-6 && e.time <= to + 1e-6);

test('chaos-v6 keeps the chaos-v5 deck, lanes and tuning, and draws the 🎬 day rule again', () => {
  assert.equal(V6.version, 'chaos-v6');
  assert.deepEqual(V6.skills, V5.skills);
  assert.deepEqual(V6.obstacles, V5.obstacles);
  const { finale, ...tuning } = V6.tuning;
  assert.deepEqual(tuning, V5.tuning);
  assert.deepEqual(finale, { from: 0.88, to: 0.92, stun: 0.7, reach: 0.6 });
  assert.ok(V6.dayRules.some(r => r.id === 'thriller'), 'Về đích nghẹt thở is drawn again');
  assert.ok(!V5.dayRules.some(r => r.id === 'thriller'), 'chaos-v5 keeps it retired');
  assert.equal(globalThis.DuckChaosEngineV6, V6);
});

test('the finale rock is back, about 5 s before the line: some races, most races under the 🎬 day rule, chaos-v5 none', () => {
  let v6 = 0, v5 = 0, thriller = 0;
  for (let seed = 1; seed <= 200; seed++) {
    if (V6.createRace(names(6), D, seed, room(V6, seed)).events.some(e => e.finale)) v6++;
    if (V5.createRace(names(6), D, seed, room(V5, seed)).events.some(e => e.finale)) v5++;
  }
  assert.ok(v6 > 200 * 0.25 && v6 < 200 * 0.5, `about a third of races (${v6}/200)`);
  assert.equal(v5, 0);
  for (let seed = 1; seed <= 40; seed++) {
    const race = V6.createRace(names(6), D, seed, room(V6, seed, { rule: 'thriller' })), finale = race.events.find(e => e.finale);
    if (!finale) continue; // the leader was too far ahead: it may already have been at the line
    thriller++;
    assert.ok(finale.time >= D * 0.88 - 0.05 && finale.time <= D * 0.92 + 0.05, `seed ${seed}: before the line (${finale.time})`);
    const after = race.sample(finale.time + 0.1).sort((a, b) => b.progress - a.progress);
    assert.notEqual(after[0].id, finale.actorId, 'it knocks the leader out of the lead (it may still fight back in the last seconds)');
  }
  assert.ok(thriller >= 30, `most races under the 🎬 rule (${thriller}/40)`);
});

// The score follows what the river shows: the line is where the winner ends, so a duck seen at the line (or past it) and
// then knocked back would finish behind where it was seen. chaos-v4 did that to about 3 races in 10 with 3 ducks (the
// leader tripped by the finale rock in the last 2 s, or by a late twist, and sometimes scored last).
test('the first duck seen at the line always wins (3 and 6 ducks; rooms, solo, the 🎬 rule)', () => {
  const seenFirst = race => { for (let t = 30; t <= D; t += 0.05) { const at = race.sample(t).filter(r => r.progress >= 0.999); if (at.length) return at.sort((a, b) => b.progress - a.progress)[0].id; } return null; };
  for (const count of [3, 6]) for (let seed = 1; seed <= 60; seed++) {
    const deal = V6.deal(count, seed), inRoom = { ...deal, casts: Array(count).fill(null).map((_, i) => (i % 2 ? 8 + i * 2 : null)), pilots: Array(count).fill(false), dodges: Array(count).fill(null) };
    for (const [mode, lineup] of [['room', inRoom], ['solo', deal], ['thriller', { ...inRoom, rule: 'thriller' }]]) {
      const race = V6.createRace(names(count), D, seed, lineup), first = seenFirst(race);
      assert.ok(first === null || first === race.results[0].id, `${count} ducks, seed ${seed}, ${mode}: duck ${first} was seen at the line first but ${race.results[0].id} won`);
    }
  }
});

test('race rooms keep a plot twist late on the river however early the owners cast; solo races are as in chaos-v5', () => {
  for (let seed = 1; seed <= 120; seed++) {
    const race = V6.createRace(names(6), D, seed, room(V6, seed));
    assert.ok(late(race, D * 0.7, D * 0.85).some(e => e.type === 'hazard'), `seed ${seed}: a river event between 70% and 85%`);
    assert.deepEqual(late(race, D * 0.85 + 1e-3, D), [], `seed ${seed}: then calm until the finale`);
    const solo = V6.createRace(names(6), D, seed, V6.deal(6, seed)), before = V5.createRace(names(6), D, seed, V5.deal(6, seed));
    if (!solo.events.some(e => e.finale)) assert.deepEqual(solo.events, before.events, `seed ${seed}: no extra event in a solo race`);
  }
});

test('chaos-v6 rooms: a cast only changes the race from its own time on', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const base = room(V6, seed, { casts: Array(6).fill(null) }), casts = [...base.casts]; casts[2] = 15;
    const before = V6.createRace(names(6), D, seed, base), after = V6.createRace(names(6), D, seed, { ...base, casts });
    const upTo = race => race.events.filter(e => e.time < 15 - 1e-9);
    assert.deepEqual(upTo(after), upTo(before), `seed ${seed}`);
  }
});
