'use strict';
// Race room casts (chaos-v3): each player casts their own active skill. lineup.casts holds, per duck, the race time
// it was cast at (null = not cast: that skill casts itself after the deadline, at a time fixed by the race alone).
// lineup.targets holds, per duck, the rival its owner aimed at (null = the skill picks as before).
// Without lineup.casts every skill fires on its own as before.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const V3 = require('../dist/chaos-engine-v2.js').v3;
const names = count => Array.from({ length: count }, (_, i) => `V${i}`);
const D = 40;
const isActive = race => r => !V3.passive.includes(race.racers[r].skill.id);
// A skill activation by a duck holding an active skill (mirror/buoy reactions belong to passive ducks).
const casts = race => race.events.filter(e => e.type === 'skill' && e.activation && isActive(race)(e.actorId));
const withCasts = (seed, list, extra = {}) => V3.createRace(names(7), D, seed, { ...V3.deal(7, seed), casts: list, ...extra });
const activeIds = race => race.racers.map(r => r.id).filter(isActive(race));

test('without casts every active skill still fires on its own (single-screen races are unchanged)', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const race = V3.createRace(names(7), D, seed, V3.deal(7, seed));
    assert.deepEqual([...new Set(casts(race).map(e => e.actorId))].sort(), activeIds(race), `seed ${seed}`);
    assert.equal(race.castWindow.auto, undefined, 'no auto casts outside a race room');
  }
});

test('a skill nobody cast casts itself after the deadline: once, spaced, before the finale', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const race = withCasts(seed, Array(7).fill(null)), w = race.castWindow, fired = casts(race);
    assert.deepEqual(fired.map(e => e.actorId).sort(), activeIds(race), `seed ${seed}: every active skill once`);
    const finale = race.events.find(e => e.finale);
    for (const e of fired) {
      assert.ok(e.time >= w.to + 1 - 0.05, `seed ${seed}: ${e.time} after the deadline and a wind-up`);
      assert.ok(!finale || e.time < finale.time, `seed ${seed}: before the finale`);
      assert.ok(Math.abs(e.time - w.auto[e.actorId]) <= 0.05 + 1e-9, 'the race reports when it fires');
    }
    for (const id of race.racers.map(r => r.id)) if (!isActive(race)(id)) assert.equal(w.auto[id], null);
    assert.equal(race.results.length, 7);
  }
});

test('auto casts are fixed by the race alone: another duck casting never moves them', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const idle = withCasts(seed, Array(7).fill(null)), [a] = activeIds(idle);
    const list = Array(7).fill(null); list[a] = 10;
    const race = withCasts(seed, list);
    assert.deepEqual(race.castWindow.auto, idle.castWindow.auto, `seed ${seed}`);
  }
});

test('a cast skill fires once, at the time it was cast', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const held = withCasts(seed, Array(7).fill(null)), duck = activeIds(held)[0];
    const list = Array(7).fill(null); list[duck] = 12.3;
    const fired = casts(withCasts(seed, list)).filter(e => e.actorId === duck);
    assert.equal(fired.length, 1, `seed ${seed}`);
    assert.ok(Math.abs(fired[0].time - 12.3) <= 0.05 + 1e-9, `fired at ${fired[0].time}`);
  }
});

test('a new cast never changes the race before it: every page can switch to the new race seamlessly', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const held = withCasts(seed, Array(7).fill(null)), [a, b] = activeIds(held);
    const one = Array(7).fill(null); one[a] = 9;
    const two = [...one]; two[b] = 21;
    const aimed = [Array(7).fill(null), Array(7).fill(null)]; aimed[1][b] = a;
    const races = [held, withCasts(seed, one), withCasts(seed, two), withCasts(seed, two, { targets: aimed[1] })];
    // What the screen shows so far: positions, live ranks and poses (the final rank and where a rune will be picked up
    // are about the future, so they may change).
    const shown = (race, t) => race.sample(t).map(({ rank, ...seen }) => seen);
    const past = (race, at) => race.events.filter(e => e.time < at - 0.06).map(({ progress, ...e }) => e);
    for (const [before, after, at] of [[races[0], races[1], 9], [races[1], races[2], 21], [races[1], races[3], 21]]) {
      for (let t = 0; t < at - 0.06; t += 0.25) assert.deepEqual(shown(after, t), shown(before, t), `seed ${seed} t ${t}`);
      assert.deepEqual(past(after, at), past(before, at), `seed ${seed}`);
    }
    assert.deepEqual(races[2].map.zones, held.map.zones, 'the scenery stays put');
    const end = races[2].sample(D).find(r => r.rank === 1);
    assert.equal(end.progress, 1, 'the winner still ends exactly on the line');
  }
});

test('a targeted skill hits the rival its owner aimed at, anywhere in the field', () => {
  assert.deepEqual([...V3.targeted].sort(), ['anchor', 'balloon', 'bees', 'blackhole', 'hex', 'hook', 'kraken', 'lightning', 'missile', 'reverse', 'swap', 'torpedo', 'ufo']);
  for (const skill of V3.targeted) for (let seed = 1; seed <= 12; seed++) for (const aim of [1, 6]) {
    const base = V3.deal(7, seed), skills = [skill, ...base.skills.slice(1)], list = Array(7).fill(null), targets = Array(7).fill(null);
    list[0] = 10; targets[0] = aim;
    const race = V3.createRace(names(7), D, seed, { ...base, skills, casts: list, targets });
    const event = race.events.find(e => e.type === 'skill' && e.actorId === 0 && e.scheduled);
    if (skill === 'ufo' && event.outcome === 'mistake') continue; // the saucer sometimes beams up its own caster
    if (skill === 'hook' && event.outcome === 'fallback') assert.fail('an aimed hook never falls back');
    const hit = event.targetId ?? event.affectedIds[0];
    assert.equal(hit, aim, `${skill} seed ${seed} aimed at ${aim}`);
  }
});

test('without an aim, skills read and act exactly as before (the hook still names the leader it pulls)', () => {
  let hooks = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const base = V3.deal(7, seed), race = V3.createRace(names(7), D, seed, { ...base, skills: ['hook', ...base.skills.slice(1)] });
    const hook = race.events.find(e => e.type === 'skill' && e.actorId === 0 && e.outcome === 'hit');
    if (hook) { hooks++; assert.equal(hook.label, 'CẦN CÂU GIẬT CON DẪN ĐẦU!', `seed ${seed}`); }
  }
  assert.ok(hooks > 10, `${hooks} hooks hit`);
});

test('casts and targets are validated', () => {
  const base = V3.deal(7, 3);
  for (const bad of [[], Array(6).fill(null), [...Array(6).fill(null), -1], [...Array(6).fill(null), NaN], [...Array(6).fill(null), '5'], 'x'])
    assert.throws(() => V3.createRace(names(7), D, 3, { ...base, casts: bad }), RangeError, JSON.stringify(bad));
  for (const bad of [[], Array(6).fill(null), [...Array(6).fill(null), 7], [...Array(6).fill(null), -1], [...Array(6).fill(null), 1.5], [...Array(6).fill(null), '2'], 'x'])
    assert.throws(() => V3.createRace(names(7), D, 3, { ...base, casts: Array(7).fill(null), targets: bad }), RangeError, JSON.stringify(bad));
});

test('the race reports its cast window: from 12% to 55% of the race, twists at least `gap` apart', () => {
  const race = withCasts(5, Array(7).fill(null));
  assert.equal(race.castWindow.from, D * 0.12);
  assert.equal(race.castWindow.to, D * 0.55);
  assert.ok(race.castWindow.gap > 0 && race.castWindow.gap <= 2, race.castWindow.gap);
  assert.deepEqual(V3.passive, ['mirror', 'buoy']);
});

test('freeSlot keeps `gap` from busy moments, and takes the clearest moment when the race is too full', () => {
  assert.equal(V3.freeSlot(5, 2, [], 30), 5);
  assert.equal(V3.freeSlot(5, 2, [5.5], 30), 7.5);
  assert.equal(V3.freeSlot(5, 2, [5.5, 7], 30), 9);
  assert.equal(V3.freeSlot(5, 2, [5.5, 7], 8), 8, 'too full: the latest allowed moment is the clearest');
  assert.equal(V3.freeSlot(5, 2, [5.5, 7, 8.5], 8), 6.25, 'or the midpoint between two twists');
});
