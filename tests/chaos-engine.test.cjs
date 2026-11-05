'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../dist/chaos-engine.js');
const names = count => Array.from({ length: count }, (_, i) => `Vịt ${i + 1}`);
const race7 = seed => E.createRace(names(7), 25, seed);
const swap = race => race.events.find(event => event.skill === 'swap');
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test('seven public talents are stable by duck identity and immutable; skills reroll independently', () => {
  assert.equal(E.version, 'chaos-v1');
  assert.equal(E.talents.length, 7);
  assert.deepEqual(E.talents.map(t => t.id), ['steady', 'rune', 'catch', 'anchor', 'early', 'tough', 'late']);
  for (let id = 0; id < 100; id++) assert.equal(E.talentFor(id), E.talents[id % 7]);
  assert.throws(() => { E.talents[0].name = 'Changed'; }, TypeError);
  assert.throws(() => E.talentFor(-1));
  assert.throws(() => E.talentFor(1.5));
  const a = race7(0), b = race7(1);
  assert.deepEqual(a.racers.map(r => r.talent), b.racers.map(r => r.talent));
  assert.notDeepEqual(a.racers.map(r => r.skill.id), b.racers.map(r => r.skill.id));
  for (const racer of a.racers) assert.ok(racer.talent.description && racer.skill.description);
});

test('saved seed exactly replays motion, event outcomes, identities and final results at arbitrary sample order', () => {
  const a = E.createRace([' Phú ', 'Phú', 'Hiếu', 'An', 'Bình', 'Chi', 'Dũng'], 25, 118);
  const b = E.createRace([' Phú ', 'Phú', 'Hiếu', 'An', 'Bình', 'Chi', 'Dũng'], 25, 118);
  assert.deepEqual(a.events, b.events);
  assert.deepEqual(a.results, b.results);
  assert.equal(a.racers[0].name, 'Phú');
  assert.equal(new Set(a.racers.map(r => r.id)).size, 7);
  for (const t of [25, 0, 7.013, 22.99999, 23, 23.00001, 17, 25, 1]) assert.deepEqual(a.sample(t), b.sample(t));
  const original = a.sample(14);
  const sample = a.sample(14);
  sample[0].progress = 99;
  assert.deepEqual(a.sample(14), original);
  assert.throws(() => { a.events[0].outcome = 'changed'; }, TypeError);
  assert.throws(() => { a.results[0].rank = 99; }, TypeError);
});

test('every duck activates exactly one hidden skill and never reports it used ahead of time', () => {
  for (const seed of [0, 42, 92, 370]) {
    const r = race7(seed), activations = r.events.filter(e => e.type === 'skill');
    assert.equal(activations.length, 7);
    assert.equal(new Set(activations.map(e => e.actorId)).size, 7);
    assert.ok(r.sample(0).every(d => !d.skillUsed));
    for (const event of activations) {
      assert.equal(r.racers[event.actorId].skill.id, event.skill);
      assert.equal(r.sample(event.time - 0.001)[event.actorId].skillUsed, false);
      assert.equal(r.sample(event.time)[event.actorId].skillUsed, true);
      if (event.targetId !== undefined) assert.notEqual(event.actorId, event.targetId);
    }
    assert.ok(r.sample(25).every(d => d.skillUsed));
    assert.ok(activations.filter(e => e.skill === 'swap').length <= 1);
  }
});

test('a successful final-two-second swap exchanges both physical distances at one instant and can backfire', () => {
  const r = race7(0), event = swap(r);
  assert.equal(event.time, 23);
  assert.equal(event.outcome, 'swapped');
  assert.equal(event.harmedId, event.actorId);
  assert.deepEqual(event.after, [event.before[1], event.before[0]]);
  const justBefore = r.sample(23 - 1e-6), at = r.sample(23);
  const finishDistance = r.results[0].finalDistance;
  near(at[event.actorId].progress * finishDistance, event.before[1]);
  near(at[event.targetId].progress * finishDistance, event.before[0]);
  near(justBefore[event.actorId].progress * finishDistance, event.before[0], 1e-5);
  near(justBefore[event.targetId].progress * finishDistance, event.before[1], 1e-5);
  assert.equal(justBefore[event.actorId].swapping, false);
  assert.equal(at[event.actorId].swapping, true);
  assert.equal(at[event.targetId].swapping, true);
  near(event.before[0] + event.before[1], event.after[0] + event.after[1]);
  assert.ok(justBefore[event.actorId].progress > at[event.actorId].progress);
});

test('anchor resistance and one-use shields cancel BOTH ends of a harmful swap, including own backfire', () => {
  for (const [seed, expected] of [[3, 'resisted'], [9, 'shielded'], [92, 'resisted']]) {
    const r = race7(seed), event = swap(r);
    assert.equal(event.outcome, expected);
    assert.deepEqual(event.before, event.after);
    assert.equal(r.sample(23)[event.actorId].swapping, false);
    assert.equal(r.sample(23)[event.targetId].swapping, false);
    if (expected === 'resisted') assert.equal(r.racers[event.harmedId].talent.id, 'anchor');
    else {
      assert.equal(r.sample(22.999)[event.harmedId].shielded, true);
      assert.equal(r.sample(23)[event.harmedId].shielded, false);
    }
    if (seed === 92) assert.equal(event.harmedId, event.actorId);
  }
});

test('swaps can produce the promised last-to-first finish and first-to-last shock', () => {
  const comeback = race7(118), event = swap(comeback);
  const before = comeback.sample(event.time - 1e-5);
  assert.equal(before[comeback.results[0].id].currentRank, 7);
  assert.ok([event.actorId, event.targetId].includes(comeback.results[0].id));
  const shock = race7(445), shockEvent = swap(shock);
  const leader = shock.sample(shockEvent.time - 1e-5).find(r => r.currentRank === 1);
  assert.equal(shock.sample(shockEvent.time)[leader.id].currentRank, 7);
});

test('runes visibly spawn before pickup, align with the recipient position, and are not biased to the leader', () => {
  const recipients = new Set();
  for (const seed of [0, 1, 2, 3, 8, 42]) {
    const r = race7(seed), spawns = r.events.filter(e => e.type === 'rune-spawn');
    assert.equal(spawns.length, 3);
    for (const spawn of spawns) {
      const pickup = r.events.find(e => e.type === 'rune-pickup' && e.runeId === spawn.runeId);
      assert.ok(pickup);
      assert.equal(pickup.time, spawn.pickupTime);
      assert.equal(pickup.actorId, spawn.actorId);
      assert.ok(spawn.time < pickup.time);
      assert.ok(spawn.progress > 0 && spawn.progress < 1);
      near(r.sample(pickup.time)[spawn.actorId].progress, spawn.progress);
      assert.equal(spawn.outcome, undefined, 'A mystery spawn must not disclose the later outcome');
      recipients.add(pickup.actorId);
    }
  }
  assert.equal(recipients.size, 7);
  const boost = race7(0).events.find(e => e.type === 'rune-pickup' && e.actorId === 1 && e.outcome === 'boost');
  near(boost.duration, 1.95);
  const slow = race7(8).events.find(e => e.type === 'rune-pickup' && e.actorId === 1 && e.outcome === 'slowed');
  near(slow.duration, 1.05);
});

test('slow protection shortens tough-duck debuffs and prevents stacking or immediate repeated slow', () => {
  const r = race7(42);
  const toughHit = r.events.find(e => e.targetId === 5 && e.outcome === 'slowed');
  assert.ok(toughHit);
  near(toughHit.duration, 0.9);
  assert.equal(r.sample(toughHit.time)[5].slowed, true);
  assert.equal(r.sample(toughHit.time + toughHit.duration)[5].slowed, false);
  const guarded = race7(3);
  assert.ok(guarded.events.some(e => e.outcome === 'immune'));
  const ends = new Map();
  for (const event of guarded.events.filter(e => e.outcome === 'slowed')) {
    const id = event.targetId ?? event.actorId;
    assert.ok(event.time >= (ends.get(id) ?? 0));
    ends.set(id, event.time + event.duration + 1 - 1e-9);
  }
  const shieldGuard = race7(673);
  const redundantHit = shieldGuard.events.find(e => e.outcome === 'immune' && e.targetId === 3);
  assert.ok(redundantHit);
  assert.equal(shieldGuard.sample(redundantHit.time - 0.001)[3].shielded, true);
  assert.equal(shieldGuard.sample(redundantHit.time)[3].shielded, true, 'Redundant slow must not waste an existing shield');
});

test('steady talent contributes a real 2% of basic distance when unimpeded', () => {
  const r = race7(4), steady = r.results.find(d => d.id === 0);
  assert.equal(r.racers[0].skill.id, 'shield');
  assert.equal(r.boosts.some(b => b.id === 0), false);
  assert.equal(r.events.some(e => (e.type === 'rune-pickup' && e.actorId === 0) || (e.skill === 'bomb' && e.targetId === 0 && e.outcome === 'slowed') || (e.skill === 'swap' && e.outcome === 'swapped' && [e.actorId, e.targetId].includes(0))), false);
  near(steady.finalDistance, steady.baseDistance * 1.02);
});

test('2–100 ducks and 10–600 second races remain finite, uniquely ranked, and finish exactly at duration', () => {
  for (const count of [2, 7, 100]) for (const duration of [10, 25, 600]) {
    const r = E.createRace(names(count), duration, 370);
    assert.equal(r.racers.length, count);
    assert.equal(r.events.filter(e => e.type === 'skill').length, count);
    assert.deepEqual([...r.results.map(d => d.id)].sort((a, b) => a - b), Array.from({ length: count }, (_, i) => i));
    assert.deepEqual(r.sample(-1).map(d => d.progress), Array(count).fill(0));
    for (const t of [0, 0.01, duration / 2, duration - 2.001, duration - 2, duration - 0.001]) {
      const sample = r.sample(t);
      assert.equal(new Set(sample.map(d => d.currentRank)).size, count);
      assert.ok(sample.every(d => Number.isFinite(d.progress) && d.progress >= 0 && d.progress < 1));
    }
    const finished = r.sample(duration).sort((a, b) => a.currentRank - b.currentRank);
    assert.equal(finished[0].progress, 1);
    assert.ok(finished.slice(1).every(d => d.progress < 1));
    assert.deepEqual(finished.map(d => d.id), r.results.map(d => d.id));
    assert.deepEqual(r.sample(duration + 1), r.sample(duration));
    assert.ok(r.events.every(e => e.time >= 0 && e.time <= duration));
    for (let i = 1; i < r.events.length; i++) assert.ok(r.events[i].time >= r.events[i - 1].time);
  }
});

test('invalid input is rejected and random seed is replayable', () => {
  for (const list of [[], ['A'], Array(101).fill('A'), Array(2), ['A', ' '], ['A', 3], ['A', 'x'.repeat(41)]]) assert.throws(() => E.createRace(list, 25));
  for (const duration of [9, 601, 25.5, NaN, Infinity, '25']) assert.throws(() => E.createRace(names(2), duration));
  for (const seed of [-1, 0x100000000, 2.5, NaN, Infinity, '1']) assert.throws(() => E.createRace(names(2), 25, seed));
  const r = E.createRace(names(3));
  assert.deepEqual(r.results, E.createRace(names(3), r.duration, r.seed).results);
  assert.throws(() => r.sample(NaN));
  assert.throws(() => r.sample(Infinity));
});
