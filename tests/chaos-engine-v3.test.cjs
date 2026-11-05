'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const V2 = require('../dist/chaos-engine-v2.js');
const V3 = V2.v3;
const names = count => Array.from({ length: count }, (_, i) => `V${i}`);
const hazardsOf = race => race.events.filter(e => e.type === 'hazard');

test('chaos-v2 replays stay byte-identical (golden hashes taken before chaos-v3 existed)', () => {
  const hash = (count, duration) => {
    const h = crypto.createHash('sha256');
    for (let seed = 0; seed < 40; seed++) {
      const r = V2.createRace(names(count), duration, seed);
      h.update(JSON.stringify([r.events, r.results, r.sample(duration / 2)]));
    }
    return h.digest('hex');
  };
  assert.equal(hash(7, 25), 'e86c737538ed5eb07aea5c3c800d3232b877e16bb379a9f28086cfbc7b377999');
  assert.equal(hash(12, 30), '65cd88adbe2285e0540ae5ed8a26720e46840e3f93fab8946562667f27dbf76c');
  assert.equal(hash(3, 10), '9516bf91c06fe64887ff64f37ba0284c2dbe14cd8d66a1e5e716137d0fcbf179');
  assert.equal(V2.createRace(names(7), 25, 1).weather, undefined);
});

test('chaos-v3 deals one of four weathers per race, deterministically', () => {
  assert.equal(V3.version, 'chaos-v3');
  assert.deepEqual(V3.weathers.map(w => w.id), ['sunny', 'rain', 'wind', 'storm']);
  for (const w of V3.weathers) assert.ok(w.name && w.icon);
  const counts = {};
  for (let seed = 0; seed < 1000; seed++) {
    const r = V3.createRace(names(7), 25, seed);
    counts[r.weather.id] = (counts[r.weather.id] || 0) + 1;
    assert.deepEqual(V3.createRace(names(7), 25, seed).events, r.events);
  }
  for (const w of V3.weathers) assert.ok(counts[w.id] >= 100, `${w.id}: ${counts[w.id]}`);
  assert.ok(counts.sunny > counts.storm);
});

test('weather changes how many hazards come and which kind', () => {
  const stats = {};
  for (let seed = 0; seed < 2000; seed++) {
    const r = V3.createRace(names(7), 25, seed), list = hazardsOf(r), s = stats[r.weather.id] ??= { races: 0, hazards: 0, wind: 0 };
    s.races++; s.hazards += list.length; s.wind += list.filter(e => e.hazard === 'wind').length;
    const extra = { sunny: 0, rain: 1, wind: 1, storm: 2 }[r.weather.id];
    assert.ok(list.length >= 2 + extra && list.length <= 4 + extra, `${r.weather.id}: ${list.length}`);
  }
  const avg = id => stats[id].hazards / stats[id].races;
  assert.ok(avg('storm') > avg('rain') && avg('rain') > avg('sunny'));
  assert.ok(stats.wind.wind / stats.wind.hazards > 0.4, 'windy races are mostly tailwinds');
});

test('chaos-v3 keeps every chaos-v2 guarantee', () => {
  for (let seed = 0; seed < 200; seed++) {
    const r = V3.createRace(names(7), 25, seed), phases = r.events.filter(e => e.scheduled);
    assert.equal(r.events.filter(e => e.activation).length, 7);
    assert.ok(phases.some(e => e.time < 25 / 3) && phases.some(e => e.time >= 23), `seed ${seed}`);
  }
  for (const [count, duration] of [[100, 10], [3, 600]]) assert.equal(V3.createRace(names(count), duration, 5).events.filter(e => e.activation).length, count);
});

test('chaos-v3 keeps last-second rock trips occasional, not routine', () => {
  let late = 0;
  const RACES = 3000;
  for (let seed = 0; seed < RACES; seed++) {
    if (V3.createRace(names(7), 25, seed).events.some(e => e.hazard === 'rock' && e.time >= 22)) late++;
  }
  assert.ok(late / RACES <= 0.2, `rock in the last 3 s in ${(late / RACES * 100).toFixed(1)}% of races`);
  assert.ok(late / RACES >= 0.05, 'still happens sometimes');
});

// Smart targeting (chaos-v3): still random, but attacks lean toward the leaders.
const v3Events = (filter, races = 2000) => {
  const out = [];
  for (let seed = 0; seed < races; seed++) for (const e of V3.createRace(names(7), 25, seed).events) if (filter(e)) out.push(e);
  return out;
};

test('chaos-v3 swap leans toward the highest duck within reach', () => {
  const swaps = v3Events(e => e.skill === 'swap' && e.activation && e.ranksBefore[e.actorId] >= 4);
  const share = d => swaps.filter(e => e.ranksBefore[e.actorId] - e.ranksBefore[e.targetId] === d).length / swaps.length;
  assert.ok(swaps.length > 200);
  assert.ok(share(3) >= 0.4 && share(1) <= 0.25, `reach 3: ${share(3).toFixed(2)}, reach 1: ${share(1).toFixed(2)}`);
});

test('chaos-v3 tornado mostly sweeps up the leading ducks', () => {
  const picked = v3Events(e => e.skill === 'tornado' && e.activation).flatMap(e => e.affectedIds.map(id => e.ranksBefore[id]));
  const top3 = picked.filter(rank => rank <= 3).length / picked.length;
  assert.ok(top3 >= 0.6, `top-3 share ${top3.toFixed(2)} (random would be 0.43)`);
});

test('chaos-v3 mirror glare goes for the leader', () => {
  const glares = v3Events(e => e.skill === 'mirror' && e.activation && e.outcome === 'fallback', 600);
  assert.ok(glares.length > 50);
  for (const e of glares) assert.equal(e.ranksBefore[e.targetId], e.ranksBefore[e.actorId] === 1 ? 2 : 1);
});
