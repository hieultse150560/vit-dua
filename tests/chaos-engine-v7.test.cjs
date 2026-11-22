'use strict';
// chaos-v7: chaos-v6 with a longer time to cast in race rooms. The skills nobody cast cast themselves 3 s apart from
// 47% of the race on (as chaos-v6 did from 45%), and each owner may cast until just before their own one: the app's
// deadline is min(castWindow.to, its auto time - windup), and castWindow.to is the calm finish.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../dist/chaos-engine-v2.js');
const V6 = E.v6, V7 = E.v7;
const names = count => Array.from({ length: count }, (_, i) => `V${i}`);
const D = 55;
const room = (V, n, seed, casts = Array(n).fill(null)) => ({ ...V.deal(n, seed), casts, pilots: Array(n).fill(false), dodges: Array(n).fill(null) });
const deadline = (race, id) => Math.min(race.castWindow.to, race.castWindow.auto[id] - 1); // the app's: windup 0.85 s + 0.15

test('chaos-v7 keeps chaos-v6 (deck, lanes, tuning, day rules); only the cast window changes', () => {
  assert.equal(V7.version, 'chaos-v7');
  assert.deepEqual(V7.skills, V6.skills);
  assert.deepEqual(V7.tuning, V6.tuning);
  assert.deepEqual(V7.dayRules, V6.dayRules);
  assert.equal(globalThis.DuckChaosEngineV7, V7);
});

test("each owner gets longer to cast: until just before their own auto cast, which stays spread out", () => {
  const v6 = [], v7 = [];
  for (let seed = 1; seed <= 60; seed++) {
    const a = V6.createRace(names(6), D, seed, room(V6, 6, seed)), b = V7.createRace(names(6), D, seed, room(V7, 6, seed));
    assert.equal(b.castWindow.to, D * 0.85);
    for (let id = 0; id < 6; id++) {
      if (b.castWindow.auto[id] === null) continue;
      v6.push(deadline(a, id)); v7.push(deadline(b, id));
      assert.ok(b.castWindow.auto[id] >= D * 0.47 + 1 - 1e-6 && b.castWindow.auto[id] <= D * 0.85 + 1e-6, `seed ${seed}: auto at ${b.castWindow.auto[id]}`);
    }
  }
  const mean = list => list.reduce((s, x) => s + x, 0) / list.length;
  assert.ok(Math.min(...v7) >= Math.min(...v6), 'nobody gets less time than before');
  assert.ok(mean(v7) > mean(v6) + 6, `about 10 s longer on average (${mean(v6).toFixed(1)} → ${mean(v7).toFixed(1)} s)`);
});

test('a late cast (before its own deadline) only changes the race from its time on, and fires then', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const base = V7.createRace(names(6), D, seed, room(V7, 6, seed));
    const id = base.castWindow.auto.findIndex(a => a !== null && a - 1 > D * 0.5);
    if (id < 0) continue;
    const at = Math.round((deadline(base, id) - 0.5) * 100) / 100, casts = Array(6).fill(null); casts[id] = at;
    const late = V7.createRace(names(6), D, seed, room(V7, 6, seed, casts));
    assert.deepEqual(late.events.filter(e => e.time < at - 1e-9), base.events.filter(e => e.time < at - 1e-9), `seed ${seed}`);
    assert.ok(late.events.some(e => e.type === 'skill' && e.actorId === id && e.scheduled && Math.abs(e.time - at) < 0.05), `seed ${seed}: cast at ${at}`);
  }
});
