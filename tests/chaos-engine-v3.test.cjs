'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const V2 = require('../dist/chaos-engine-v2.js');
const V3 = V2.v3;
const names = count => Array.from({ length: count }, (_, i) => `V${i}`);
// The finale rock is an extra, scheduled-last hazard; weather counts exclude it.
const hazardsOf = race => race.events.filter(e => e.type === 'hazard' && !e.finale);

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
  assert.deepEqual(V3.weathers.map(w => w.id), ['sunny', 'rain', 'wind', 'storm', 'fog', 'night']);
  for (const w of V3.weathers) assert.ok(w.name && w.icon);
  const counts = {};
  for (let seed = 0; seed < 1000; seed++) {
    const r = V3.createRace(names(7), 25, seed);
    counts[r.weather.id] = (counts[r.weather.id] || 0) + 1;
    assert.deepEqual(V3.createRace(names(7), 25, seed).events, r.events);
  }
  for (const w of V3.weathers) assert.ok(counts[w.id] >= 60, `${w.id}: ${counts[w.id]}`);
  assert.ok(counts.sunny > counts.storm);
});

test('weather changes how many hazards come and which kind', () => {
  const stats = {};
  for (let seed = 0; seed < 2000; seed++) {
    const r = V3.createRace(names(7), 25, seed), list = hazardsOf(r), s = stats[r.weather.id] ??= { races: 0, hazards: 0, wind: 0 };
    s.races++; s.hazards += list.length; s.wind += list.filter(e => e.hazard === 'wind').length;
    const extra = { sunny: 0, rain: 1, wind: 1, storm: 2, fog: 1, night: 1 }[r.weather.id];
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

test('chaos-v3 finale rock: often, always the last twist, and the tripped leader never wins', () => {
  let finales = 0;
  const RACES = 2000;
  for (let seed = 0; seed < RACES; seed++) {
    const r = V3.createRace(names(7), 25, seed), finale = r.events.filter(e => e.finale);
    assert.ok(finale.length <= 1);
    if (!finale.length) continue;
    finales++;
    // Reactive events (a banana slip, a buoy bounce) may follow; no scheduled twist may.
    const e = finale[0], twists = r.events.filter(o => o.scheduled);
    assert.equal(e.hazard, 'rock');
    assert.equal(twists.at(-1), e, `seed ${seed}: finale is the last scheduled twist`);
    assert.ok(e.time >= 22, `seed ${seed}: at ${e.time}`);
    assert.equal(e.ranksBefore[e.actorId], 1, 'trips the leader');
    assert.equal(e.outcome, 'hit', 'cannot be blocked');
    assert.notEqual(r.results[0].id, e.actorId, `seed ${seed}: tripped leader won`);
    const end = r.sample(25)[e.actorId];
    assert.equal(end.pose, 'capsized');
    assert.ok(end.progress < 1);
  }
  assert.ok(finales / RACES >= 0.3 && finales / RACES <= 0.5, `finale in ${(finales / RACES * 100).toFixed(1)}% of races`);
});

test('chaos-v3 ordinary rocks stay out of the last 3 s', () => {
  let late = 0, all = 0;
  for (let seed = 0; seed < 2000; seed++) for (const e of V3.createRace(names(7), 25, seed).events) {
    if (e.hazard !== 'rock' || e.finale) continue;
    all++; if (e.time >= 22) late++;
  }
  assert.ok(all > 300 && late / all < 0.05, `${late}/${all} ordinary rocks in the last 3 s`);
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

// New chaos-v3 skills and the stronger hook / wave.
const lone = (race, e) => !race.events.some(o => o !== e && o.type !== 'rune-spawn' && Math.abs(o.time - e.time) < 1e-9);
const withRace = (filter, races = 2000) => {
  const out = [];
  for (let seed = 0; seed < races; seed++) { const race = V3.createRace(names(7), 25, seed); for (const e of race.events) if (filter(e)) out.push({ race, e }); }
  return out;
};
const order = ranks => ranks.map((rank, id) => ({ rank, id })).sort((a, b) => a.rank - b.rank).map(x => x.id);

test('chaos-v3 deals 21 skills on top of the 10 from chaos-v2', () => {
  assert.deepEqual(V3.skills.map(s => s.id).slice(10), ['magnet', 'lightning', 'flip', 'rewind', 'reverse', 'freeze', 'missile', 'bees', 'blackhole', 'ghost', 'balloon']);
  assert.equal(V3.skills.length, 21);
  for (const s of V3.skills) assert.ok(s.name && s.icon && s.description);
  assert.equal(require('../dist/chaos-engine-v2.js').skills.length, 10, 'chaos-v2 keeps its 10 skills');
});

test('magnet pulls its duck right behind the leader (or into the lead from 2nd)', () => {
  const list = withRace(e => e.skill === 'magnet' && e.activation);
  assert.ok(list.length > 200);
  let checked = 0;
  for (const { race, e } of list) {
    const rank = e.ranksBefore[e.actorId];
    assert.ok(e.after[e.actorId] > e.before[e.actorId]);
    if (!lone(race, e) || rank === 1) continue;
    assert.equal(race.sample(e.time)[e.actorId].currentRank, rank === 2 ? 1 : 2, `from rank ${rank}`);
    checked++;
  }
  assert.ok(checked > 50);
});

test('lightning strikes the top two (except the caster) and capsizes them', () => {
  const list = withRace(e => e.skill === 'lightning' && e.activation);
  assert.ok(list.length > 200);
  for (const { race, e } of list) {
    assert.deepEqual([...e.affectedIds].sort(), order(e.ranksBefore).filter(id => id !== e.actorId).slice(0, 2).sort());
    for (const id of e.affectedIds) if (e.outcomes[id] === 'hit' && e.time + 0.1 < 25) assert.equal(race.sample(e.time + 0.05)[id].pose, 'capsized');
  }
});

test('flip swaps the leader with the last duck (2nd with last when the caster leads)', () => {
  const list = withRace(e => e.skill === 'flip' && e.activation && e.outcome === 'swapped');
  assert.ok(list.length > 100);
  for (const { e } of list) {
    const ranked = order(e.ranksBefore), top = ranked[0] === e.actorId ? ranked[1] : ranked[0], last = ranked.at(-1);
    assert.deepEqual(e.affectedIds, [top, last]);
    assert.ok(Math.abs(e.after[top] - e.before[last]) < 1e-9 && Math.abs(e.after[last] - e.before[top]) < 1e-9);
  }
});

test('rewind sends every other unguarded duck back in time; the caster stays put', () => {
  const list = withRace(e => e.skill === 'rewind' && e.activation);
  assert.ok(list.length > 200);
  // Rare misses are fine: everyone frozen, or just knocked back inside the rewound window.
  let rewinds = 0, pulled = 0;
  for (const { e } of list) {
    assert.equal(e.after[e.actorId], e.before[e.actorId]);
    const moved = e.affectedIds.filter(id => !e.protectedIds.includes(id));
    for (const id of moved) assert.ok(e.after[id] <= e.before[id]);
    if (e.time > 4) { rewinds++; if (moved.some(id => e.after[id] < e.before[id])) pulled++; }
  }
  assert.ok(pulled / rewinds >= 0.9, `${pulled}/${rewinds} rewinds pulled someone back`);
});

test('chaos-v3 hook reels in the leader and drops it right behind the caster', () => {
  const list = withRace(e => e.skill === 'hook' && e.activation && e.outcome === 'hit');
  assert.ok(list.length > 100);
  for (const { e } of list) {
    assert.equal(e.ranksBefore[e.targetId], 1);
    assert.ok(e.after[e.targetId] < e.after[e.actorId]);
  }
});

test('chaos-v3 wave sweeps the top three back behind the caster', () => {
  const list = withRace(e => e.skill === 'wave' && e.activation);
  assert.ok(list.length > 200);
  for (const { e } of list) for (const id of e.affectedIds) if (e.outcomes[id] === 'hit') assert.ok(e.after[id] < e.before[e.actorId], `duck ${id} not behind caster`);
});

const touchedBetween = (race, e, id, until) => race.events.some(o => o !== e && o.time > e.time && o.time <= until && o.type !== 'rune-spawn'
  && [o.actorId, o.targetId, ...(o.affectedIds || [])].includes(id));

test('reverse turns the top two around: they swim backwards', () => {
  const list = withRace(e => e.skill === 'reverse' && e.activation);
  assert.ok(list.length > 200);
  let checked = 0;
  for (const { race, e } of list) {
    assert.deepEqual([...e.affectedIds].sort(), order(e.ranksBefore).filter(id => id !== e.actorId).slice(0, 2).sort());
    for (const id of e.affectedIds) {
      // Progress is clamped at the line, so only ducks short of it can show the backwards drift.
      if (e.outcomes[id] !== 'hit' || e.time + 0.6 >= 25 || touchedBetween(race, e, id, e.time + 0.6) || race.sample(e.time)[id].progress > 0.98) continue;
      assert.equal(race.sample(e.time + 0.3)[id].pose, 'reversed');
      assert.ok(race.sample(e.time + 0.55)[id].progress < race.sample(e.time + 0.05)[id].progress, 'moved backwards');
      checked++;
    }
  }
  assert.ok(checked > 50, `only ${checked} checked`);
});

test('freeze stops every other unguarded duck while the caster swims on', () => {
  const list = withRace(e => e.skill === 'freeze' && e.activation);
  assert.ok(list.length > 200);
  let checked = 0;
  for (const { race, e } of list) {
    assert.equal(e.affectedIds.length, 6);
    for (const id of e.protectedIds) assert.equal(e.outcomes[id], 'protected');
    for (const id of e.affectedIds) if (e.outcomes[id] === 'hit' && e.time + 0.4 < 25) { assert.equal(race.sample(e.time + 0.3)[id].pose, 'frozen'); checked++; }
  }
  assert.ok(checked > 200);
});

// Second wave of chaos-v3 content: five skills, three river events, two weathers.
const E2 = require('../dist/chaos-engine-v2.js');
const pose = (race, t, id) => race.sample(t)[id].pose;

test('chaos-v3 river has eight events; chaos-v2 keeps its five', () => {
  assert.deepEqual(V3.hazards.map(h => h.id), ['rock', 'croc', 'wind', 'whirlpool', 'dolphin', 'hippo', 'log', 'frog']);
  assert.equal(E2.hazards.length, 5);
  for (const h of V3.hazards) assert.ok(h.name && h.icon);
});

test('heat-seeking missile blows the leader back and capsizes it', () => {
  const list = withRace(e => e.skill === 'missile' && e.activation);
  assert.ok(list.length > 150);
  for (const { race, e } of list) {
    assert.equal(e.ranksBefore[e.targetId], e.ranksBefore[e.actorId] === 1 ? 2 : 1);
    if (e.outcome !== 'hit') continue;
    assert.ok(e.after[e.targetId] < e.before[e.targetId]);
    if (e.effect === 'hit' && e.time + 0.1 < 25 && !touchedBetween(race, e, e.targetId, e.time + 0.05)) assert.equal(pose(race, e.time + 0.05, e.targetId), 'capsized');
  }
});

test('bees swarm the top two and slow them down', () => {
  const list = withRace(e => e.skill === 'bees' && e.activation);
  assert.ok(list.length > 150);
  for (const { race, e } of list) {
    assert.deepEqual([...e.affectedIds].sort(), order(e.ranksBefore).filter(id => id !== e.actorId).slice(0, 2).sort());
    for (const id of e.affectedIds) if (e.outcomes[id] === 'hit' && e.time + 0.6 < 25 && !touchedBetween(race, e, id, e.time + 0.5)) assert.equal(race.sample(e.time + 0.5)[id].slowed, true);
  }
});

test('black hole pulls every other unguarded duck toward the caster', () => {
  const list = withRace(e => e.skill === 'blackhole' && e.activation);
  assert.ok(list.length > 150);
  for (const { e } of list) {
    const c = e.before[e.actorId];
    assert.equal(e.after[e.actorId], c);
    for (const id of e.affectedIds.filter(i => !e.protectedIds.includes(i))) assert.ok(Math.abs(e.after[id] - c) <= Math.abs(e.before[id] - c) + 1e-9);
  }
});

test('ghost turns its duck see-through: attacks pass through for 2 s', () => {
  const list = withRace(e => e.skill === 'ghost' && e.activation);
  assert.ok(list.length > 150);
  // A duck already stunned keeps that pose; check fresh ghosts only.
  for (const { race, e } of list) if (e.time + 0.6 < 25 && !pose(race, e.time - 0.05, e.actorId) && !touchedBetween(race, e, e.actorId, e.time + 0.5)) assert.equal(pose(race, e.time + 0.5, e.actorId), 'ghost');
  const passes = withRace(e => e.outcome === 'blocked' && e.guard === 'ghost' || Object.values(e.outcomes || {}).includes('blocked') && e.type === 'skill');
  assert.ok(passes.some(({ e }) => e.guard === 'ghost'), 'some attack passed through a ghost');
});

test('balloon lifts the leader out of the water', () => {
  const list = withRace(e => e.skill === 'balloon' && e.activation && e.outcome === 'hit');
  assert.ok(list.length > 100);
  let checked = 0;
  for (const { race, e } of list) {
    assert.equal(e.ranksBefore[e.targetId], e.ranksBefore[e.actorId] === 1 ? 2 : 1);
    if (e.time + 0.6 >= 25 || touchedBetween(race, e, e.targetId, e.time + 0.6)) continue;
    assert.equal(pose(race, e.time + 0.3, e.targetId), 'lifted');
    const fd = race.results[0].finalDistance;
    assert.ok(Math.abs(race.sample(e.time + 0.55)[e.targetId].progress - race.sample(e.time + 0.05)[e.targetId].progress) * fd < 1e-6, 'hangs in the air');
    checked++;
  }
  assert.ok(checked > 30);
});

test('hippo tosses a top-half duck back, log blocks the leader, frog hops a back-half duck forward', () => {
  const by = id => withRace(e => e.hazard === id && !e.finale, 1500);
  const hippo = by('hippo'), log = by('log'), frog = by('frog');
  assert.ok(hippo.length > 100 && log.length > 100 && frog.length > 100);
  for (const { race, e } of hippo) {
    assert.ok(e.ranksBefore[e.actorId] <= 4);
    if (e.outcome === 'hit') { assert.ok(e.after[e.actorId] < e.before[e.actorId]); if (e.effect === 'hit' && e.time + 0.1 < 25 && !touchedBetween(race, e, e.actorId, e.time + 0.05)) assert.equal(pose(race, e.time + 0.05, e.actorId), 'capsized'); }
  }
  for (const { race, e } of log) {
    assert.equal(e.ranksBefore[e.actorId], 1);
    if (e.outcome === 'hit' && e.time + 0.6 < 25 && !touchedBetween(race, e, e.actorId, e.time + 0.5)) assert.equal(race.sample(e.time + 0.5)[e.actorId].slowed, true);
  }
  for (const { e } of frog) { assert.ok(e.ranksBefore[e.actorId] > 4); assert.ok(e.after[e.actorId] > e.before[e.actorId]); }
});

test('chaos-v3 pacing: most twists between 1/4 and 3/4; the last quarter keeps 1-3 real plot twists', () => {
  const PLOT = new Set(['torpedo', 'missile', 'lightning', 'tornado', 'blackhole', 'hook']);
  let mid = 0, all = 0;
  for (let seed = 0; seed < 1000; seed++) {
    const r = V3.createRace(names(7), 25, seed), twists = r.events.filter(e => e.scheduled && !e.finale);
    const lastQuarter = r.events.filter(e => e.scheduled && e.time >= 18.75);
    all += twists.length; mid += twists.filter(e => e.time >= 6.25 && e.time < 18.75).length;
    assert.ok(lastQuarter.length >= 1 && lastQuarter.length <= 3, `seed ${seed}: ${lastQuarter.length} twists in the last quarter`);
    const hasPlot = r.racers.some(x => PLOT.has(x.skill.id)); // a field with no order-changing skill falls back to any active skill
    for (const e of lastQuarter) assert.ok(e.finale || PLOT.has(e.skill) || !hasPlot, `seed ${seed}: ${e.skill || e.hazard} is not a plot twist`);
  }
  assert.ok(mid / all >= 0.75, `only ${(mid / all * 100).toFixed(0)}% of twists in the middle half`);
});
