'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRace } = require('../dist/race-engine.js');
const names = count => Array.from({ length: count }, (_, i) => `Vịt ${i + 1}`);

test('seed replay preserves all motion, boosts, duplicate identities and results', () => {
  const list = [' Phú ', 'Phú', 'Bình', 'Chi'];
  const a = createRace(list, 25, 42), b = createRace(list, 25, 42);
  assert.deepEqual(a.racers.map(r => r.name), ['Phú', 'Phú', 'Bình', 'Chi']);
  assert.equal(new Set(a.results.map(r => r.id)).size, 4);
  assert.deepEqual(a.results.map(r => r.rank), [1, 2, 3, 4]);
  assert.deepEqual(a.results, b.results);
  assert.deepEqual(a.boosts, b.boosts);
  for (const time of [0, 5.25, 19.99, 20, 22.25, 25]) assert.deepEqual(a.sample(time), b.sample(time));
});

test('2 and 100 racers move forward; a unique winner reaches the finish at the configured time', () => {
  for (const count of [2, 100]) for (const duration of [10, 25, 600]) {
    const race = createRace(names(count), duration, 13);
    let previous = race.sample(-5);
    assert.ok(previous.every(r => r.progress === 0));
    for (let step = 1; step < 1000; step++) {
      const current = race.sample(duration * step / 1000);
      current.forEach((r, i) => {
        assert.ok(Number.isFinite(r.progress) && r.progress >= 0 && r.progress < 1);
        assert.ok(r.progress >= previous[i].progress, `Racer ${i} moved backwards at ${step}`);
      });
      assert.equal(new Set(current.map(r => r.currentRank)).size, count);
      previous = current;
    }
    const finish = race.sample(duration).sort((a, b) => a.currentRank - b.currentRank);
    assert.deepEqual(finish.map(r => r.id), race.results.map(r => r.id));
    assert.equal(finish[0].progress, 1);
    assert.ok(finish.slice(1).every(r => r.progress < 1));
    assert.deepEqual(race.sample(duration + 1), race.sample(duration));
  }
});

test('positive smooth boosts occur only during the final five seconds and add real distance', () => {
  const race = createRace(names(12), 25, 53);
  assert.equal(race.sprintStart, 20);
  assert.ok(race.boosts.length > 0 && race.boosts.length < 12);
  assert.ok(race.sample(19.999).every(r => !r.boosting));
  assert.ok(race.sample(25).every(r => !r.boosting));
  for (const boost of race.boosts) {
    assert.ok(boost.start >= 20 && boost.end <= 25 && boost.end > boost.start && boost.strength > 0);
    assert.equal(race.sample((boost.start + boost.end) / 2)[boost.id].boosting, true);
    const result = race.results.find(r => r.id === boost.id);
    const expectedGain = boost.strength * (boost.end - boost.start) / 2;
    assert.ok(Math.abs(result.finalDistance - result.baseDistance - expectedGain) < 1e-10);
    const before = race.sample(boost.start - 1e-7)[boost.id].progress;
    const after = race.sample(boost.start + 1e-7)[boost.id].progress;
    assert.ok(after >= before && after - before < 1e-6, 'Boost starts without a position jump');
  }
});

test('a last-place duck can win via a real final-five-second boost', () => {
  let comeback = null;
  for (let seed = 0; seed < 500; seed++) {
    const race = createRace(names(8), 25, seed);
    const last = race.sample(20).find(r => r.currentRank === 8);
    if (race.results[0].id === last.id) { comeback = race; break; }
  }
  assert.ok(comeback, 'Seed range must contain a last-to-first comeback');
  const winner = comeback.results[0];
  assert.ok(comeback.boosts.some(b => b.id === winner.id));
  const baselineWinner = [...comeback.results].sort((a, b) => b.baseDistance - a.baseDistance)[0];
  assert.notEqual(winner.id, baselineWinner.id, 'The boost must change the winning result');
});

test('seed variation changes winners and always produces complete ID permutations', () => {
  const winners = new Set();
  for (let seed = 0; seed < 100; seed++) {
    const race = createRace(names(8), 25, seed);
    winners.add(race.results[0].id);
    assert.deepEqual([...race.results.map(r => r.id)].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
  }
  assert.equal(winners.size, 8);
  const randomRace = createRace(names(3));
  assert.equal(randomRace.duration, 25);
  assert.ok(Number.isInteger(randomRace.seed) && randomRace.seed >= 0 && randomRace.seed < 0x100000000);
  assert.deepEqual(randomRace.results, createRace(names(3), 25, randomRace.seed).results);
});

test('invalid names, duration, seed and sample values are rejected', () => {
  for (const list of [[], ['A'], Array(101).fill('A'), Array(2), ['A', ' '], ['A', 3], ['A', 'x'.repeat(41)]]) assert.throws(() => createRace(list, 25));
  for (const duration of [9, 601, 25.5, NaN, Infinity, '25']) assert.throws(() => createRace(names(2), duration));
  for (const seed of [-1, 0x100000000, 2.5, NaN, Infinity, '1', () => .5]) assert.throws(() => createRace(names(2), 25, seed));
  assert.doesNotThrow(() => createRace(names(2), 25, 0));
  assert.doesNotThrow(() => createRace(names(2), 25, 0xffffffff));
  assert.throws(() => createRace(names(2)).sample(NaN));
});
