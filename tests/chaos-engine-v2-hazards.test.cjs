'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../dist/chaos-engine-v2.js');
const H = E.tuning.hazard, D = 25, N = 7;
const pct = value => value / 100 * D;
const names = count => Array.from({ length: count }, (_, i) => `Vịt ${i + 1}`);
const races = Array.from({ length: 1000 }, (_, seed) => E.createRace(names(N), D, seed));
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);
const of = id => races.flatMap(race => race.events.filter(e => e.hazard === id).map(e => ({ race, e })));
const enough = (list, label, min = 20) => assert.ok(list.length >= min, `${label}: only ${list.length}`);
const touched = (race, e, until) => race.events.some(o => o !== e && o.time >= e.time && o.time <= until && o.type !== 'rune-spawn'
  && [o.actorId, o.targetId, ...(o.affectedIds || [])].includes(e.actorId));

test('rock trips the leader, mostly in the last seconds', () => {
  const list = of('rock');
  enough(list, 'rock');
  for (const { race, e } of list) {
    assert.equal(e.ranksBefore[e.actorId], 1);
    if (e.outcome === 'hit' && e.time + H.rockStun < D) assert.equal(race.sample(e.time + H.rockStun - 0.05)[e.actorId].pose, 'capsized');
  }
  const late = list.filter(({ e }) => e.time >= D - H.rockLateWindow).length;
  assert.ok(late / list.length >= 0.6, `late share ${late / list.length}`);
});

test('crocodile drags a random duck back', () => {
  const list = of('croc');
  enough(list, 'croc');
  enough(list.filter(({ e }) => e.outcome === 'hit'), 'croc hits');
  for (const { e } of list) if (e.outcome === 'hit') near(e.after[e.actorId], Math.max(0, e.before[e.actorId] - pct(H.crocPull)), 'croc');
  assert.ok(new Set(list.map(({ e }) => e.ranksBefore[e.actorId])).size >= 5, 'croc victims span ranks');
});

function surgeCheck(list, amount) {
  let checked = 0;
  for (const { race, e } of list) {
    assert.equal(e.outcome, 'boost');
    near(e.surge, pct(amount), 'surge amount');
    const end = e.time + H.surgeTime;
    const impaired = t => race.sample(t)[e.actorId].stunned || race.sample(t)[e.actorId].slowed;
    if (end >= D || touched(race, e, end) || impaired(e.time + 0.05) || impaired(end)) continue;
    const fd = race.results[0].finalDistance;
    const gain = (race.sample(end)[e.actorId].progress - race.sample(e.time)[e.actorId].progress) * fd;
    assert.ok(gain >= e.surge - 1e-6, `gain ${gain} < ${e.surge}`);
    assert.equal(race.sample(e.time + H.surgeTime / 2)[e.actorId].boosting, true);
    checked++;
  }
  assert.ok(checked >= 5, `only ${checked} surges checked`);
}

test('tailwind pushes the last duck forward', () => {
  const list = of('wind');
  enough(list, 'wind');
  for (const { e } of list) assert.equal(e.ranksBefore[e.actorId], N);
  surgeCheck(list, H.windPush);
});

test('whirlpool spins a random duck in place', () => {
  const list = of('whirlpool');
  enough(list, 'whirlpool');
  enough(list.filter(({ e }) => e.outcome === 'hit'), 'whirlpool hits');
  for (const { race, e } of list) if (e.outcome === 'hit' && e.time + H.whirlStun < D) assert.equal(race.sample(e.time + H.whirlStun - 0.05)[e.actorId].pose, 'spinning');
});

test('dolphin carries a duck from the back half forward', () => {
  const list = of('dolphin');
  enough(list, 'dolphin');
  for (const { e } of list) assert.ok(e.ranksBefore[e.actorId] > Math.ceil(N / 2), `rank ${e.ranksBefore[e.actorId]}`);
  surgeCheck(list, H.dolphinPush);
});

test('hazard count per race scales with field size', () => {
  for (const count of [7, 15]) {
    const scale = Math.ceil(count / 7);
    for (let seed = 0; seed < 200; seed++) {
      const n = E.createRace(names(count), D, seed).events.filter(e => e.type === 'hazard').length;
      assert.ok(n >= H.countMin * scale && n <= H.countMax * scale, `${count} ducks: ${n}`);
    }
  }
});

test('mirror ignores hazards; buoy and bubble block them', () => {
  const blocked = races.flatMap(race => race.events.filter(e => e.type === 'hazard' && e.outcome === 'blocked').map(e => ({ race, e })));
  enough(blocked, 'blocked hazards', 5);
  for (const { race, e } of blocked) {
    assert.ok(['buoy', 'bubble'].includes(e.guard));
    if (e.guard === 'buoy') assert.ok(race.events.some(o => o.skill === 'buoy' && o.outcome === 'blocked' && o.time === e.time && o.actorId === e.actorId));
  }
  assert.equal(races.flatMap(r => r.events).filter(e => e.type === 'hazard' && e.outcome === 'reflected').length, 0);
});

test('runes keep v1 rules', () => {
  for (const race of races.slice(0, 100)) {
    assert.ok(race.events.filter(e => e.type === 'rune-spawn').length >= 3);
    for (const e of race.events.filter(e => e.type === 'rune-pickup')) {
      assert.ok(['shield', 'boost', 'hit', 'immune', 'blocked'].includes(e.outcome), e.outcome);
      if (e.rune === 'bubble') assert.equal(e.outcome, 'shield');
    }
  }
  const shields = races.flatMap(race => race.events.filter(e => e.type === 'rune-pickup' && e.rune === 'bubble').map(e => ({ race, e })));
  enough(shields, 'bubble pickups');
  for (const { race, e } of shields) {
    if (race.events.some(o => o !== e && o.time === e.time)) continue;
    assert.equal(race.sample(e.time)[e.actorId].shielded, true);
  }
});
