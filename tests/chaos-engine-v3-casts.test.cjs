'use strict';
// Race room casts (chaos-v3): each player casts their own active skill. lineup.casts holds, per duck, the race time
// it was cast at (null = not cast yet: that skill waits). Without lineup.casts every skill fires on its own as before.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const V3 = require('../dist/chaos-engine-v2.js').v3;
const names = count => Array.from({ length: count }, (_, i) => `V${i}`);
const D = 40;
const isActive = race => r => !V3.passive.includes(race.racers[r].skill.id);
// A skill activation by a duck holding an active skill (mirror/buoy reactions belong to passive ducks).
const casts = race => race.events.filter(e => e.type === 'skill' && e.activation && isActive(race)(e.actorId));
const withCasts = (seed, list) => V3.createRace(names(7), D, seed, { ...V3.deal(7, seed), casts: list });
const activeIds = race => race.racers.map(r => r.id).filter(isActive(race));

test('without casts every active skill still fires on its own (single-screen races are unchanged)', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const race = V3.createRace(names(7), D, seed, V3.deal(7, seed));
    assert.deepEqual([...new Set(casts(race).map(e => e.actorId))].sort(), activeIds(race), `seed ${seed}`);
  }
});

test('a skill not cast yet waits; passive skills still react on their own', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const race = withCasts(seed, Array(7).fill(null));
    assert.deepEqual(casts(race), [], `seed ${seed}`);
    assert.equal(race.results.length, 7);
  }
});

test('a cast skill fires once, at the time it was cast', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const held = withCasts(seed, Array(7).fill(null)), duck = activeIds(held)[0];
    const list = Array(7).fill(null); list[duck] = 12.3;
    const race = withCasts(seed, list), fired = casts(race);
    assert.equal(fired.length, 1, `seed ${seed}`);
    assert.equal(fired[0].actorId, duck);
    assert.ok(Math.abs(fired[0].time - 12.3) <= 0.05 + 1e-9, `fired at ${fired[0].time}`);
  }
});

test('a new cast never changes the race before it: every page can switch to the new race seamlessly', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const held = withCasts(seed, Array(7).fill(null)), [a, b] = activeIds(held);
    const one = Array(7).fill(null); one[a] = 9;
    const two = [...one]; two[b] = 21;
    const races = [held, withCasts(seed, one), withCasts(seed, two)];
    // What the screen shows so far: positions, live ranks and poses (the final rank and where a rune will be picked up
    // are about the future, so they may change).
    const shown = (race, t) => race.sample(t).map(({ rank, ...seen }) => seen);
    const past = (race, at) => race.events.filter(e => e.time < at - 0.06).map(({ progress, ...e }) => e);
    for (const [before, after, at] of [[races[0], races[1], 9], [races[1], races[2], 21]]) {
      for (let t = 0; t < at - 0.06; t += 0.25) assert.deepEqual(shown(after, t), shown(before, t), `seed ${seed} t ${t}`);
      assert.deepEqual(past(after, at), past(before, at), `seed ${seed}`);
    }
    assert.deepEqual(races[2].map.zones, held.map.zones, 'the scenery stays put');
    const end = races[2].sample(D).find(r => r.rank === 1);
    assert.equal(end.progress, 1, 'the winner still ends exactly on the line');
  }
});

test('casts are validated', () => {
  const base = V3.deal(7, 3);
  for (const bad of [[], Array(6).fill(null), [...Array(6).fill(null), -1], [...Array(6).fill(null), NaN], [...Array(6).fill(null), '5'], 'x'])
    assert.throws(() => V3.createRace(names(7), D, 3, { ...base, casts: bad }), RangeError, JSON.stringify(bad));
});

test('the race reports its cast window: from 12% to 55% of the race, twists at least `gap` apart', () => {
  const race = withCasts(5, Array(7).fill(null));
  assert.equal(race.castWindow.from, D * 0.12);
  assert.equal(race.castWindow.to, D * 0.55);
  assert.ok(race.castWindow.gap > 0 && race.castWindow.gap <= 2, race.castWindow.gap);
  assert.deepEqual(V3.passive, ['mirror', 'buoy']);
});
