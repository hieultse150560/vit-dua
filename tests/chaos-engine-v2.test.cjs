'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../dist/chaos-engine-v2.js');
const names = count => Array.from({ length: count }, (_, i) => `Vịt ${i + 1}`);
const race7 = seed => E.createRace(names(7), 25, seed);
const phases = race => race.events.filter(e => e.scheduled);
const finish = race => race.results[0].finalDistance;

test('v2 exposes 10 skills, 5 hazards and is distinct from v1', () => {
  assert.equal(E.version, 'chaos-v2');
  assert.deepEqual(E.skills.map(s => s.id), ['wings', 'torpedo', 'wave', 'swap', 'rocket', 'mirror', 'hook', 'tornado', 'banana', 'buoy']);
  assert.deepEqual(E.hazards.map(h => h.id), ['rock', 'croc', 'wind', 'whirlpool', 'dolphin']);
  for (const item of [...E.skills, ...E.hazards]) assert.ok(item.name && item.icon);
  for (const skill of E.skills) assert.ok(skill.description);
  assert.throws(() => { E.skills[0].name = 'x'; }, TypeError);
  assert.throws(() => { E.tuning.minGap = 9; }, TypeError);
  assert.equal(race7(1).racers[0].talent, undefined);
});

test('same seed replays identical events, results and samples', () => {
  const a = E.createRace(names(7), 25, 118), b = E.createRace(names(7), 25, 118);
  assert.deepEqual(a.events, b.events);
  assert.deepEqual(a.results, b.results);
  for (const t of [25, 0, 7.013, 22.99999, 23, 23.00001, 17, 25, 1]) assert.deepEqual(a.sample(t), b.sample(t));
  assert.throws(() => { a.events[0].outcome = 'changed'; }, TypeError);
  assert.throws(() => { a.results[0].rank = 99; }, TypeError);
});

test('each race deals distinct random skills; reroll across seeds', () => {
  assert.equal(new Set(race7(0).racers.map(r => r.skill.id)).size, 7);
  assert.equal(new Set(E.createRace(names(10), 25, 3).racers.map(r => r.skill.id)).size, 10);
  const counts = {};
  for (const r of E.createRace(names(23), 25, 5).racers) counts[r.skill.id] = (counts[r.skill.id] || 0) + 1;
  assert.ok(Object.values(counts).every(n => n <= Math.ceil(23 / 10)));
  assert.notDeepEqual(race7(0).racers.map(r => r.skill.id), race7(1).racers.map(r => r.skill.id));
});

test('every duck fires its skill exactly once, after second 2, inside the race', () => {
  for (let seed = 0; seed < 50; seed++) {
    const r = race7(seed), activations = r.events.filter(e => e.activation);
    assert.equal(activations.length, 7, `seed ${seed}`);
    assert.equal(new Set(activations.map(e => e.actorId)).size, 7);
    for (const e of activations) assert.equal(e.skill, r.racers[e.actorId].skill.id);
    for (const e of r.events.filter(e => e.type === 'skill' || e.type === 'hazard')) assert.ok(e.time >= 2 && e.time <= 25, `${e.time}`);
    assert.ok(r.sample(0).every(d => !d.skillUsed));
    assert.ok(r.sample(25).every(d => d.skillUsed));
  }
});

test('twist schedule: at least one phase in first third and one in final two seconds', () => {
  for (let seed = 0; seed < 200; seed++) {
    const p = phases(race7(seed));
    assert.ok(p.some(e => e.time < 25 / 3), `seed ${seed} first third`);
    assert.ok(p.some(e => e.time >= 23), `seed ${seed} final two seconds`);
  }
});

test('twist density grows toward the end', () => {
  let first = 0, last = 0, all = 0;
  for (let seed = 0; seed < 2000; seed++) {
    for (const e of phases(race7(seed))) { all++; if (e.time < 25 / 3) first++; if (e.time >= 50 / 3) last++; }
  }
  assert.ok(first / all >= 0.15 && first / all <= 0.27, `first third ${first / all}`);
  assert.ok(last / all >= 0.42 && last / all <= 0.60, `last third ${last / all}`);
});

test('phases keep the minimum gap when room allows', () => {
  for (let seed = 0; seed < 200; seed++) {
    const times = phases(race7(seed)).map(e => e.time).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= E.tuning.minGap - 1e-9, `seed ${seed}: ${times[i - 1]} → ${times[i]}`);
  }
});

test('extreme sizes complete with every skill firing', () => {
  for (const [count, duration] of [[100, 10], [3, 600], [2, 10]]) {
    const r = E.createRace(names(count), duration, 77);
    assert.equal(r.events.filter(e => e.activation).length, count);
    for (const e of r.events.filter(e => e.type === 'skill' || e.type === 'hazard')) assert.ok(e.time >= 2 && e.time <= duration);
    assert.equal(r.sample(duration).filter(d => d.progress === 1).length, 1);
  }
});

test('stunned duck does not move while capsized', () => {
  let checked = 0;
  for (let seed = 0; seed < 300 && checked < 10; seed++) {
    const r = race7(seed), fd = finish(r);
    for (const e of r.events.filter(e => e.skill === 'torpedo' && e.outcome === 'hit')) {
      const end = e.time + E.tuning.torpedo.stun - 0.05;
      const touched = r.events.some(o => o !== e && o.time >= e.time && o.time <= end + 0.05 && [o.actorId, o.targetId, ...(o.affectedIds || [])].includes(e.targetId));
      if (touched || end > 25) continue;
      const at = r.sample(e.time)[e.targetId], later = r.sample(end)[e.targetId];
      assert.ok(Math.abs(at.progress - later.progress) * fd < 1e-9, `seed ${seed}`);
      assert.equal(later.stunned, true);
      assert.equal(later.pose, 'capsized');
      checked++;
    }
  }
  assert.ok(checked >= 5, `only ${checked} torpedo hits checked`);
});

test('jumps are instant, not glides', () => {
  let checked = 0;
  for (let seed = 0; seed < 300 && checked < 10; seed++) {
    const r = race7(seed), fd = finish(r);
    for (const e of r.events.filter(e => e.skill === 'swap' && e.outcome === 'swapped')) {
      for (const id of [e.actorId, e.targetId]) {
        assert.ok(Math.abs(r.sample(e.time)[id].progress * fd - e.after[id]) < 1e-6);
        assert.ok(Math.abs(r.sample(e.time - 0.025)[id].progress * fd - e.before[id]) < 0.25);
      }
      checked++;
    }
  }
  assert.ok(checked >= 5, `only ${checked} swaps checked`);
});

test('input validation matches v1', () => {
  for (const list of [[], ['A'], Array(101).fill('A'), Array(2), ['A', ' '], ['A', 3], ['A', 'x'.repeat(41)]]) assert.throws(() => E.createRace(list, 25));
  for (const duration of [9, 601, 25.5, NaN, Infinity, '25']) assert.throws(() => E.createRace(names(2), duration));
  for (const seed of [-1, 0x100000000, 2.5, NaN, Infinity, '1']) assert.throws(() => E.createRace(names(2), 25, seed));
  const r = race7(1);
  assert.throws(() => r.sample(NaN));
  assert.throws(() => r.sample(Infinity));
});
