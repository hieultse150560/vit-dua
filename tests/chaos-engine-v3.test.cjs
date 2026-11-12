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

test('chaos-v3 keeps every skill firing once, with twists early and in the last quarter', () => {
  for (let seed = 0; seed < 200; seed++) {
    const r = V3.createRace(names(7), 30, seed), phases = r.events.filter(e => e.scheduled);
    assert.equal(r.events.filter(e => e.activation).length, 7);
    assert.ok(phases.some(e => e.time < 30 / 5) && phases.some(e => e.time >= 30 * 3 / 4), `seed ${seed}`);
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

test('chaos-v3 tornado flings the top three (never the caster) to the back of the pack, spinning', () => {
  const list = withRace(e => e.skill === 'tornado' && e.activation);
  assert.ok(list.length > 200);
  let drop = 0, hits = 0, spun = 0;
  for (const { race, e } of list) {
    sameSet(e.affectedIds, order(e.ranksBefore).filter(id => id !== e.actorId).slice(0, 3));
    assert.equal(e.after[e.actorId], e.before[e.actorId]);
    for (const id of e.affectedIds) {
      if (e.protectedIds.includes(id)) { assert.equal(e.after[id], e.before[id]); continue; }
      assert.ok(e.after[id] < e.before[id], 'thrown back');
      hits++; drop += race.sample(e.time + 0.05)[id].currentRank - e.ranksBefore[id];
      if (e.time + 0.4 < 25 && fresh(race, e, id) && !touchedBetween(race, e, id, e.time + 0.3)) { assert.equal(race.sample(e.time + 0.3)[id].pose, 'spinning'); spun++; }
    }
  }
  assert.ok(drop / hits >= 2, `victims drop only ${(drop / hits).toFixed(2)} places on average`);
  assert.ok(spun > 100, `only ${spun} spins checked`);
});

test('chaos-v3 mirror glare goes for the leader', () => {
  const glares = withRace(e => e.skill === 'mirror' && e.activation && e.outcome === 'fallback', 1200);
  assert.ok(glares.length > 50);
  let checked = 0;
  for (const { race, e } of glares) { const top = topPick(race, e, 1, e.actorId, true); if (top) { assert.equal(e.targetId, top[0]); checked++; } }
  assert.ok(checked > 30);
});

// New chaos-v3 skills and the stronger hook / wave.
const lone = (race, e) => !race.events.some(o => o !== e && o.type !== 'rune-spawn' && Math.abs(o.time - e.time) < 1e-9);
const withRace = (filter, races = 2000) => {
  const out = [];
  for (let seed = 0; seed < races; seed++) { const race = V3.createRace(names(7), 25, seed); for (const e of race.events) if (filter(e)) out.push({ race, e }); }
  return out;
};
const order = ranks => ranks.map((rank, id) => ({ rank, id })).sort((a, b) => a.rank - b.rank).map(x => x.id);
// The heavy trait halves knock-, pull- and sweep-backs, so exact-position checks skip heavy victims.
const heavy = (race, id) => race.racers[id].trait?.id === 'heavy';
// Stun-only attacks (chaos-v3) pick the highest rivals not already stunned or immune. A duck no event
// touched in the last 4 s is surely open, so when the plain top-n are all open they must be the pick.
const fresh = (race, e, id) => !race.events.some(o => o !== e && o.time <= e.time + 1e-9 && o.time > e.time - 4 && o.type !== 'rune-spawn'
  && [o.actorId, o.targetId, ...(o.affectedIds || [])].includes(id));
const topPick = (race, e, n, skip = e.actorId, slowing = false) => { const top = order(e.ranksBefore).filter(id => id !== skip && !(slowing && race.racers[id].trait?.id === 'shell')).slice(0, n); return top.every(id => fresh(race, e, id)) ? top : null; };
const sameSet = (a, b) => assert.deepEqual([...a].sort(), [...b].sort());

test('chaos-v3 deals 37 skills: the 10 from chaos-v2 plus 27 of its own', () => {
  assert.deepEqual(V3.skills.map(s => s.id).slice(10), ['magnet', 'lightning', 'flip', 'rewind', 'reverse', 'freeze', 'missile', 'bees', 'blackhole', 'ghost', 'balloon',
    'bomb', 'copycat', 'dice', 'lullaby', 'hex', 'giant', 'kraken', 'dragon', 'meteor', 'whale', 'ufo', 'pirate', 'wheel', 'anchor', 'volcano', 'fireworks']);
  assert.equal(V3.skills.length, 37);
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
  let picked = 0;
  for (const { race, e } of list) { assert.equal(e.affectedIds.length, 2); assert.ok(!e.affectedIds.includes(e.actorId)); const top = topPick(race, e, 2); if (top) { sameSet(e.affectedIds, top); picked++; } }
  assert.ok(picked > 100, `only ${picked} picks checked`);
  assert.ok(list.length > 200);
  for (const { race, e } of list) {
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
  for (const { race, e } of list) {
    assert.equal(e.ranksBefore[e.targetId], 1);
    if (!heavy(race, e.targetId)) assert.ok(e.after[e.targetId] < e.after[e.actorId]);
  }
});

test('chaos-v3 wave sweeps the top three back behind the caster', () => {
  const list = withRace(e => e.skill === 'wave' && e.activation);
  assert.ok(list.length > 200);
  for (const { race, e } of list) for (const id of e.affectedIds) if (e.outcomes[id] === 'hit' && !heavy(race, id)) assert.ok(e.after[id] < e.before[e.actorId], `duck ${id} not behind caster`);
});

const touchedBetween = (race, e, id, until) => race.events.some(o => o !== e && o.time > e.time && o.time <= until && o.type !== 'rune-spawn'
  && [o.actorId, o.targetId, ...(o.affectedIds || [])].includes(id));

test('reverse turns the top two around: they swim backwards', () => {
  const list = withRace(e => e.skill === 'reverse' && e.activation, 3000);
  let picked = 0;
  for (const { race, e } of list) { assert.equal(e.affectedIds.length, 2); assert.ok(!e.affectedIds.includes(e.actorId)); const top = topPick(race, e, 2, e.actorId, true); if (top) { sameSet(e.affectedIds, top); picked++; } }
  assert.ok(picked > 100, `only ${picked} picks checked`);
  assert.ok(list.length > 200);
  let checked = 0;
  for (const { race, e } of list) {
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
  const list = withRace(e => e.skill === 'bees' && e.activation, 3000);
  let picked = 0;
  for (const { race, e } of list) { assert.equal(e.affectedIds.length, 2); assert.ok(!e.affectedIds.includes(e.actorId)); const top = topPick(race, e, 2, e.actorId, true); if (top) { sameSet(e.affectedIds, top); picked++; } }
  assert.ok(picked > 100, `only ${picked} picks checked`);
  assert.ok(list.length > 150);
  for (const { race, e } of list) {
    for (const id of e.affectedIds) if (e.outcomes[id] === 'hit' && e.time + 0.6 < 25 && !touchedBetween(race, e, id, e.time + 0.5)) assert.equal(race.sample(e.time + 0.5)[id].slowed, true);
  }
});

test('black hole swallows the top rival and spits it out behind the last duck', () => {
  const list = withRace(e => e.skill === 'blackhole' && e.activation);
  assert.ok(list.length > 150);
  let last = 0;
  for (const { race, e } of list) {
    assert.equal(e.targetId, order(e.ranksBefore).find(id => id !== e.actorId));
    if (e.outcome !== 'hit') continue;
    assert.equal(e.after[e.actorId], e.before[e.actorId], 'the caster stays put');
    assert.ok(e.after[e.targetId] < e.before[e.targetId], 'swallowed duck goes back');
    if (lone(race, e)) { assert.equal(race.sample(e.time)[e.targetId].currentRank, 7, 'spat out last'); last++; }
  }
  assert.ok(last > 50, `only ${last} checked`);
});

test('ghost glides through the two ducks ahead, spooks them (slowed), then attacks pass through for 2 s', () => {
  const list = withRace(e => e.skill === 'ghost' && e.activation);
  assert.ok(list.length > 150);
  let passed = 0, spooked = 0;
  for (const { race, e } of list) {
    const rank = e.ranksBefore[e.actorId], ahead = order(e.ranksBefore).slice(Math.max(0, rank - 3), rank - 1);
    assert.ok(e.after[e.actorId] > e.before[e.actorId], 'the ghost moves forward');
    sameSet(e.affectedIds, rank > 1 ? ahead : order(e.ranksBefore).slice(1, 2));
    if (rank > 1 && lone(race, e)) { assert.ok(race.sample(e.time)[e.actorId].currentRank <= rank - ahead.length, 'passed them'); passed++; }
    for (const id of e.affectedIds) if (e.outcomes[id] === 'hit' && e.time + 0.6 < 25 && !touchedBetween(race, e, id, e.time + 0.5)) { assert.equal(race.sample(e.time + 0.5)[id].slowed, true); spooked++; }
  }
  assert.ok(passed > 50 && spooked > 100, `passed ${passed}, spooked ${spooked}`);
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
    const top = topPick(race, e, 1);
    if (top) assert.equal(e.targetId, top[0]);
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
    const top = topPick(race, e, 1, -1, e.hazard === 'log');
    if (top) assert.equal(e.actorId, top[0]);
    if (e.outcome === 'hit' && e.time + 0.6 < 25 && !touchedBetween(race, e, e.actorId, e.time + 0.5)) assert.equal(race.sample(e.time + 0.5)[e.actorId].slowed, true);
  }
  for (const { e } of frog) { assert.ok(e.ranksBefore[e.actorId] > 4); assert.ok(e.after[e.actorId] > e.before[e.actorId]); }
});

test('chaos-v3 pacing (30 s): twists start early, never overlap (1.5 s apart), and the last quarter keeps 1-2 plot twists', () => {
  const PLOT = new Set(['torpedo', 'missile', 'lightning', 'blackhole', 'hook', 'bomb', 'hex', 'kraken', 'meteor', 'ufo', 'anchor']), D = 30;
  let mid = 0, all = 0, worst = 0;
  for (let seed = 0; seed < 1000; seed++) {
    const r = V3.createRace(names(7), D, seed), times = r.events.filter(e => e.scheduled).map(e => e.time);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 1.49, `seed ${seed}: twists ${(times[i] - times[i - 1]).toFixed(2)} s apart`);
    assert.ok(times[0] < D / 5, `seed ${seed}: first twist only at ${times[0]} s`);
    const middle = times.filter(t => t >= D / 5 && t < D * 3 / 4);
    for (let i = 1; i < middle.length; i++) worst = Math.max(worst, middle[i] - middle[i - 1]);
    const lastQuarter = r.events.filter(e => e.scheduled && e.time >= D * 3 / 4);
    all += times.length; mid += times.filter(t => t < D * 3 / 4).length;
    assert.ok(lastQuarter.length >= 1 && lastQuarter.length <= 2, `seed ${seed}: ${lastQuarter.length} twists in the last quarter`);
    const hasPlot = r.racers.some(x => PLOT.has(x.skill.id)); // a field with no order-changing skill falls back to any active skill
    for (const e of lastQuarter) assert.ok(e.finale || PLOT.has(e.skill) || !hasPlot, `seed ${seed}: ${e.skill || e.hazard} is not a plot twist`);
  }
  assert.ok(mid / all >= 0.8, `only ${(mid / all * 100).toFixed(0)}% of twists before the last quarter`);
  assert.ok(worst < 6, `a ${worst.toFixed(1)} s lull mid-race`); // a mirror/buoy that already reacted leaves its late slot empty
  // Shorter (older 25 s) days and bigger fields squeeze the stride but still never stack twists.
  for (const [count, duration, least] of [[7, 40, 2], [7, 25, 1.2], [14, 30, 0.6]]) for (let seed = 0; seed < 300; seed++) {
    const t = V3.createRace(names(count), duration, seed).events.filter(e => e.scheduled).map(e => e.time);
    for (let i = 1; i < t.length; i++) assert.ok(t[i] - t[i - 1] >= least - 0.01, `${count} ducks ${duration} s seed ${seed}: ${(t[i] - t[i - 1]).toFixed(2)} s apart`);
  }
});

test('chaos-v3 tornado never closes a race, even in small fields with no plot skill', () => {
  for (const count of [2, 3, 4, 7]) for (let seed = 0; seed < 600; seed++) {
    const e = V3.createRace(names(count), 25, seed).events.find(x => x.skill === 'tornado' && x.scheduled);
    assert.ok(!e || e.time < 18.75, `${count} ducks, seed ${seed}: tornado at ${e?.time}`);
  }
});

test('chaos-v3 buoy: a block never costs a place; the fallback springs past one duck', () => {
  const list = withRace(e => e.skill === 'buoy' && e.activation && e.before && e.ranksBefore[e.actorId] > 2, 3000);
  assert.ok(list.length > 100);
  let checked = 0;
  for (const { race, e } of list) {
    if (!lone(race, e) && e.outcome !== 'blocked') continue;
    const ranks = Object.fromEntries(race.sample(e.time).map(d => [d.id, d.currentRank]));
    if (race.events.some(o => o !== e && Math.abs(o.time - e.time) < 1e-9 && o.type !== 'rune-spawn' && o.actorId !== e.actorId && o.targetId !== e.actorId)) continue;
    assert.ok(ranks[e.actorId] <= e.ranksBefore[e.actorId] - (e.outcome === 'fallback' ? 1 : 0), `${e.outcome}: rank ${e.ranksBefore[e.actorId]} -> ${ranks[e.actorId]}`);
    checked++;
  }
  assert.ok(checked > 50, `only ${checked} checked`);
});

test('chaos-v3 stun attacks skip ducks already stunned, so a hit is almost never wasted', () => {
  const STUN = new Set(['torpedo', 'balloon', 'lightning', 'reverse', 'bees']);
  let tries = 0, wasted = 0;
  for (let seed = 0; seed < 1500; seed++) for (const e of V3.createRace(names(7), 25, seed).events) {
    if (!e.scheduled || e.finale || !(STUN.has(e.skill) || ['rock', 'log'].includes(e.hazard))) continue;
    // A shell duck shrugs off slowing by its trait: that is not a targeting waste.
    const race = V3.createRace(names(7), 25, seed), shell = id => race.racers[id].trait?.id === 'shell';
    const immune = e.outcomes ? Object.entries(e.outcomes).filter(([id, o]) => o === 'immune' && !shell(Number(id))) : e.outcome === 'immune' && !shell(e.targetId ?? e.actorId) ? [1] : [];
    tries++; if (immune.length) wasted++;
  }
  assert.ok(tries > 1000 && wasted / tries < 0.03, `${wasted}/${tries} stun attacks wasted on stunned ducks`);
});

// ---- Lineup dealt before the picks, duck traits, and the newest skills ----
test('deal: one skill and one trait per duck, deterministic, distinct while they last; createRace uses the shown lineup', () => {
  const a = V3.deal(7, 42), b = V3.deal(7, 42);
  assert.deepEqual(a, b);
  assert.equal(new Set(a.skills).size, 7, 'no repeated skill among 7 ducks');
  assert.equal(new Set(a.traits).size, 7, 'no repeated trait among 7 ducks');
  for (const id of a.skills) assert.ok(V3.skills.some(s => s.id === id));
  for (const id of a.traits) assert.ok(V3.traits.some(t => t.id === id));
  assert.equal(V3.traits.length, 18);
  for (const t of V3.traits) assert.ok(t.name && t.icon && t.description);
  const r = V3.createRace(names(7), 30, 999, a);
  assert.deepEqual(r.racers.map(x => x.skill.id), a.skills);
  assert.deepEqual(r.racers.map(x => x.trait.id), a.traits);
  assert.deepEqual(V3.createRace(names(7), 30, 999, a).events, r.events, 'same seed + lineup replays the same');
  assert.deepEqual(V3.createRace(names(7), 30, 7).racers.map(x => x.skill.id), V3.deal(7, 7).skills, 'no lineup: dealt from the seed');
  assert.throws(() => V3.createRace(names(7), 30, 1, { skills: a.skills.slice(1), traits: a.traits }), /skill/);
  assert.throws(() => V3.createRace(names(7), 30, 1, { skills: a.skills, traits: [...a.traits.slice(1), 'flying'] }), /đặc tính/);
  assert.equal(V3.deal(30, 1).skills.length, 30, 'big fields reuse the deck');
});

const lineupWith = (count, seed, skill, trait) => {
  const d = V3.deal(count, seed);
  if (skill) { const i = d.skills.indexOf(skill); if (i >= 0) d.skills[i] = d.skills[0]; d.skills[0] = skill; }
  if (trait) { const i = d.traits.indexOf(trait); if (i >= 0) d.traits[i] = d.traits[0]; d.traits[0] = trait; }
  return d;
};
const racesWith = (skill, trait, races = 600) => Array.from({ length: races }, (_, seed) => ({ seed, race: V3.createRace(names(7), 30, seed, lineupWith(7, seed, skill, trait)) }));

test('bomb sits on whoever leads and blows up 2.5 s later on that duck', () => {
  let booms = 0;
  for (const { race } of racesWith('bomb')) {
    const armed = race.events.find(e => e.skill === 'bomb' && e.outcome === 'armed');
    if (!armed) continue;
    assert.equal(armed.actorId, 0);
    const boom = race.events.find(e => e.skill === 'bomb' && e.actorId === armed.actorId && e.time > armed.time && e.outcome !== 'armed');
    if (!boom) { assert.ok(race.events.some(e => e.finale), 'a bomb only goes quiet when the finale rock defuses it'); continue; }
    assert.ok(Math.abs(boom.time - armed.time - armed.fuse) < 0.06 && armed.fuse <= 2.5 && boom.time <= 30 - 0.29, `fuse ${boom.time - armed.time} / ${armed.fuse}`);
    assert.equal(boom.ranksBefore[boom.targetId], 1, 'it goes off on the leader of that moment');
    if (boom.outcome === 'hit') { assert.ok(boom.after[boom.targetId] < boom.before[boom.targetId]); booms++; }
    const mid = armed.time + 1.2, holder = race.sample(mid).find(d => d.bomb);
    if (holder && race.sample(mid).every(d => d.currentRank !== 1 || d.id === holder.id)) assert.equal(holder.currentRank, 1, 'the bomb rides the leader');
  }
  assert.ok(booms > 300, `${booms} explosions`);
});

test('copycat casts the latest active skill another duck used', () => {
  let checked = 0;
  for (const { race } of racesWith('copycat')) {
    const e = race.events.find(x => x.skill === 'copycat');
    assert.ok(e && e.copied && e.copiedName && e.copied !== 'copycat');
    const last = race.events.filter(x => x.type === 'skill' && x.scheduled && x.time <= e.time && x !== e && x.actorId !== 0 && !['mirror', 'buoy'].includes(x.copied || x.skill)).at(-1);
    if (last) { assert.equal(e.copied, last.copied || last.skill); checked++; }
  }
  assert.ok(checked > 300);
});

test('dice: 1 capsizes the roller, 6 puts it in front, 2-5 pass 1-4 ducks', () => {
  const rolls = new Set();
  for (const { race } of racesWith('dice')) {
    const e = race.events.find(x => x.skill === 'dice');
    rolls.add(e.roll);
    if (!lone(race, e)) continue;
    const rank = race.sample(e.time)[0].currentRank, before = e.ranksBefore[0];
    if (e.roll === 1) assert.equal(e.outcome, 'bust');
    else if (before > 1) assert.ok(rank <= Math.max(1, before - (e.roll - 1)) || e.roll === 6 && rank === 1, `roll ${e.roll}: ${before} -> ${rank}`);
    if (e.roll === 6 && before > 1) assert.equal(rank, 1);
  }
  assert.deepEqual([...rolls].sort(), [1, 2, 3, 4, 5, 6]);
});

test('lullaby puts nearby ducks to sleep (at least the two nearest)', () => {
  let slept = 0;
  for (const { race } of racesWith('lullaby')) {
    const e = race.events.find(x => x.skill === 'lullaby');
    assert.ok(e.affectedIds.length >= 2 && !e.affectedIds.includes(0));
    for (const id of e.affectedIds) if (e.outcomes[id] === 'hit' && e.time + 0.6 < 30 && !touchedBetween(race, e, id, e.time + 0.5)) {
      const d = race.sample(e.time + 0.5)[id];
      assert.equal(d.pose, 'asleep'); assert.equal(d.stunned, true); slept++;
    }
  }
  assert.ok(slept > 300, `${slept} naps`);
});

test('hex turns the leader into a slow frog; giant grows and stomps the ducks just ahead', () => {
  let frogs = 0, giants = 0;
  for (const { race } of racesWith('hex', null, 300)) {
    const e = race.events.find(x => x.skill === 'hex');
    if (e.outcome === 'hit' && e.time + 0.6 < 30 && !touchedBetween(race, e, e.targetId, e.time + 0.5)) { assert.equal(race.sample(e.time + 0.5)[e.targetId].pose, 'hex'); frogs++; }
  }
  for (const { race } of racesWith('giant', null, 300)) {
    const e = race.events.find(x => x.skill === 'giant');
    if (e.time + 0.6 < 30 && !touchedBetween(race, e, 0, e.time + 0.5) && !race.sample(e.time + 0.5)[0].stunned) { assert.equal(race.sample(e.time + 0.5)[0].pose, 'giant'); giants++; }
    for (const id of e.affectedIds) if (e.outcomes[id] === 'hit') assert.ok(e.after[id] < e.before[id]);
  }
  assert.ok(frogs > 100 && giants > 100, `frogs ${frogs}, giants ${giants}`);
});

test('mirror (v3) springs ahead when it reflects; its glare blinds the leader; buoy fallback passes one', () => {
  let reflected = 0, glares = 0, bounces = 0;
  for (const { race } of racesWith('mirror')) for (const e of race.events.filter(x => x.skill === 'mirror' && x.actorId === 0)) {
    if (e.outcome === 'reflected') { assert.ok(e.after[0] > e.before[0], 'the mirror holder springs ahead'); reflected++; }
    if (e.outcome === 'fallback') { assert.equal(e.affectedIds.length, 1); glares++; }
  }
  for (const { race } of racesWith('buoy')) {
    const e = race.events.find(x => x.skill === 'buoy' && x.outcome === 'fallback');
    if (e && e.ranksBefore[0] > 1 && lone(race, e)) { assert.ok(race.sample(e.time)[0].currentRank <= e.ranksBefore[0] - 1); bounces++; }
  }
  assert.ok(reflected > 30 && glares > 200 && bounces > 30, `reflected ${reflected}, glares ${glares}, bounces ${bounces}`);
});

test('traits: tough shortens stuns, dodgy and lucky slip some hits, revenge charges after a stun, speed traits pay off', () => {
  const T = V3.tuning.trait;
  let tough = 0, dodged = 0, lucky = 0, revenge = 0;
  for (const { race } of racesWith(null, 'tough', 400)) for (const e of race.events) {
    if ((e.skill === 'torpedo' || e.skill === 'balloon') && e.targetId === 0 && e.outcome === 'hit' && e.time + 2 < 30 && !touchedBetween(race, e, 0, e.time + 2)) {
      const stun = e.skill === 'torpedo' ? 2 : 1.5;
      assert.equal(race.sample(e.time + stun * T.tough + 0.1)[0].pose, null, 'stun ends early'); tough++;
    }
  }
  for (const { race } of racesWith(null, 'dodgy', 400)) dodged += race.events.filter(e => e.guard === 'dodge').length;
  for (const { race } of racesWith(null, 'lucky', 400)) lucky += race.events.filter(e => e.guard === 'lucky').length;
  for (const { race } of racesWith(null, 'revenge', 400)) for (const e of race.events) {
    if (e.targetId === 0 && e.outcome === 'hit' && ['torpedo', 'balloon'].includes(e.skill)) {
      const end = e.time + (e.skill === 'torpedo' ? 2 : 1.5) + 0.3;
      if (end + 0.3 < 30 && !touchedBetween(race, e, 0, end + 0.3)) { assert.equal(race.sample(end)[0].boosting, true, 'charging after the stun'); revenge++; }
    }
  }
  assert.ok(tough > 10 && dodged > 20 && lucky > 20 && revenge > 10, `tough ${tough}, dodged ${dodged}, lucky ${lucky}, revenge ${revenge}`);
});

test('chaos-v3 traits are balanced: each trait holder wins 0.7–1.3 × 1/7', () => {
  const held = {}, wins = {};
  for (let seed = 0; seed < 5000; seed++) for (const r of V3.createRace(names(7), 40, seed, V3.deal(7, seed * 7919 + 1)).results) {
    held[r.trait.id] = (held[r.trait.id] || 0) + 1;
    if (r.rank === 1) wins[r.trait.id] = (wins[r.trait.id] || 0) + 1;
  }
  const table = Object.keys(held).map(id => `${id} ${(wins[id] / held[id] * 7).toFixed(2)}`).join(', ');
  for (const id of Object.keys(held)) { const w = wins[id] / held[id] * 7; assert.ok(w >= 0.7 && w <= 1.3, table); }
});

test('comeback luck: a lucky duck is faster, escapes bad river events and draws more help; bad luck levels are rejected', () => {
  const N = 1500;
  let wins = 0, plainWins = 0, escapes = 0, helped = 0, plainHelped = 0;
  for (let seed = 0; seed < N; seed++) {
    const d = V3.deal(7, seed), lucky = V3.createRace(names(7), 40, seed, { ...d, luck: [2, 0, 0, 0, 0, 0, 0] }), plain = V3.createRace(names(7), 40, seed, d);
    if (lucky.results[0].id === 0) wins++;
    if (plain.results[0].id === 0) plainWins++;
    escapes += lucky.events.filter(e => e.type === 'hazard' && e.actorId === 0 && e.guard === 'lucky').length;
    helped += lucky.events.filter(e => ['frog', 'dolphin'].includes(e.hazard) && e.actorId === 0).length;
    plainHelped += plain.events.filter(e => ['frog', 'dolphin'].includes(e.hazard) && e.actorId === 0).length;
  }
  assert.ok(wins > plainWins * 1.15, `luck 2 wins ${wins} vs ${plainWins} without`);
  assert.ok(wins / N < 0.4, `luck must stay a nudge, not a lock (${wins}/${N})`);
  assert.ok(escapes > 20, `${escapes} lucky escapes`);
  assert.ok(helped > plainHelped, `helped ${helped} vs ${plainHelped}`);
  assert.equal(V3.createRace(names(7), 40, 3, { ...V3.deal(7, 3), luck: [2, 0, 0, 0, 0, 0, 0] }).racers[0].luck, 2);
  assert.throws(() => V3.createRace(names(7), 40, 1, { ...V3.deal(7, 1), luck: [9, 0, 0, 0, 0, 0, 0] }), /may mắn/);
});

// ---------- day rules (one per race day, carried in the lineup so replays rebuild the same race) ----------
const ruled = (seed, rule, count = 7, extra = {}) => V3.createRace(names(count), 40, seed, { ...V3.deal(count, seed), ...(rule ? { rule } : {}), ...extra });

test('day rules are listed, validated, deterministic and reported on the race', () => {
  assert.deepEqual(V3.dayRules.map(r => r.id), ['chaos', 'runes', 'storm', 'thriller', 'comeback']);
  assert.deepEqual(V3.retiredDayRules.map(r => r.id), ['double'], 'retired: never drawn, still rebuilds old races');
  for (const r of V3.dayRules) assert.ok(r.name && r.icon && r.description, r.id);
  const a = ruled(99, 'chaos'), b = ruled(99, 'chaos');
  assert.deepEqual(a.events, b.events);
  assert.deepEqual(a.results, b.results);
  assert.equal(a.rule.id, 'chaos');
  assert.equal(ruled(99, null).rule, undefined);
  assert.throws(() => ruled(99, 'nope'), /luật/i);
});

test('day rule chaos doubles the river events, runes doubles the runes', () => {
  let plain = 0, chaos = 0;
  for (let seed = 0; seed < 40; seed++) {
    plain += hazardsOf(ruled(seed, null)).length; chaos += hazardsOf(ruled(seed, 'chaos')).length;
    const runes = race => race.events.filter(e => e.type === 'rune-spawn').length;
    assert.equal(runes(ruled(seed, 'runes')), 2 * runes(ruled(seed, null)));
  }
  assert.ok(chaos >= 1.8 * plain && chaos <= 2.2 * plain, `${chaos} vs ${plain}`);
});

test('day rule storm never deals sunny weather; thriller always ends on the finale rock', () => {
  for (let seed = 0; seed < 60; seed++) {
    assert.notEqual(ruled(seed, 'storm').weather.id, 'sunny');
    assert.ok(ruled(seed, 'thriller').events.some(e => e.type === 'hazard' && e.finale), `seed ${seed}`);
  }
});

test('retired day rule double still rebuilds old races: every active skill fires twice, a passive one at most once', () => {
  const PASSIVE = new Set(['mirror', 'buoy']);
  for (let seed = 0; seed < 30; seed++) {
    const race = ruled(seed, 'double');
    for (const r of race.racers) {
      const uses = race.events.filter(e => e.type === 'skill' && e.scheduled && e.actorId === r.id).length;
      if (PASSIVE.has(r.skill.id)) assert.ok(uses <= 1, `seed ${seed} ${r.skill.id}`);
      else assert.equal(uses, 2, `seed ${seed} ${r.skill.id}`);
    }
  }
});

test('day rule comeback doubles the comeback luck', () => {
  const luck = [2, 1, 0, 0, 0, 0, 0];
  assert.deepEqual(ruled(3, null, 7, { luck }).racers.map(r => r.luck || 0), luck);
  assert.deepEqual(ruled(3, 'comeback', 7, { luck }).racers.map(r => r.luck || 0), [4, 2, 0, 0, 0, 0, 0]);
});

test('without a day rule, luck 3 keeps its full 90% river-event dodge (old replays rebuild unchanged)', () => {
  let dodged = 0, hits = 0;
  for (let seed = 0; seed < 300; seed++) {
    const race = ruled(seed, null, 7, { luck: [3, 3, 3, 3, 3, 3, 3] });
    for (const e of race.events.filter(e => e.type === 'hazard' && !e.finale && ['croc', 'whirlpool', 'hippo', 'log', 'rock'].includes(e.hazard))) e.outcome === 'blocked' ? dodged++ : hits++;
  }
  assert.ok(dodged / (dodged + hits) > 0.8, `dodge rate ${dodged / (dodged + hits)}`);
});

// ---------- skill tiers and the ten newer traits ----------
test('skill tiers: every chaos-v3 skill has one; the top tiers win a little more than the bottom ones (chaos-v2 has none)', () => {
  const counts = { S: 0, A: 0, B: 0, C: 0 };
  for (const s of V3.skills) { assert.ok(['S', 'A', 'B', 'C'].includes(s.tier), s.id); counts[s.tier]++; }
  assert.deepEqual(counts, { S: 9, A: 9, B: 11, C: 8 });
  assert.ok(V2.skills.every(s => s.tier === undefined), 'chaos-v2 skill objects stay unchanged');
  const tally = { S: [0, 0], A: [0, 0], B: [0, 0], C: [0, 0] };
  for (let seed = 1; seed <= 4000; seed++) {
    const race = V3.createRace(names(7), 25, seed, V3.deal(7, seed * 7919)), win = race.results[0].id;
    for (const r of race.racers) { tally[r.skill.tier][0]++; if (r.id === win) tally[r.skill.tier][1]++; }
  }
  const [s, a, b, c] = ['S', 'A', 'B', 'C'].map(t => tally[t][1] / tally[t][0] * 7);
  // 4000 races only separate the far ends; the full order (S 1.07 > A 1.02 > B 0.99 > C 0.91) was tuned on 40 000 races.
  assert.ok(s + a > b + c, `S ${s} A ${a} B ${b} C ${c}`);
  assert.ok(s - c > 0.04 && s / c < 1.35, `S ${s} vs C ${c}: a little stronger, not a lot`);
});

test('shell: never slowed, hexed, lulled or turned around', () => {
  let shrugged = 0;
  for (const { race } of racesWith(null, 'shell', 400)) {
    for (let t = 0; t <= 30; t += 0.25) { const d = race.sample(t)[0]; assert.ok(!d.slowed && !['hex', 'asleep', 'reversed'].includes(d.pose), `t ${t} ${d.pose}`); }
    shrugged += race.events.filter(e => e.outcome === 'immune' && (e.targetId === 0 || e.actorId === 0 && e.type === 'hazard') || e.outcomes?.[0] === 'immune').length;
  }
  assert.ok(shrugged > 20, `${shrugged} shrugged off`);
});

test('heavy: a crocodile pulls it back only half the way', () => {
  let halved = 0;
  for (const { race } of racesWith(null, 'heavy', 600)) for (const e of race.events) {
    if (e.type !== 'hazard' || e.hazard !== 'croc' || e.actorId !== 0 || e.outcome !== 'hit' || e.before[0] < 2 || !lone(race, e)) continue;
    assert.ok(Math.abs(e.before[0] - e.after[0] - 30 * V3.tuning.hazard.crocPull / 100 * V3.tuning.trait.heavy) < 1e-9, `${e.before[0] - e.after[0]}`);
    halved++;
  }
  assert.ok(halved > 10, `${halved} croc bites checked`);
});

test('grudge: a duck that lands a skill on it is slowed right after', () => {
  let punished = 0;
  for (const { race } of racesWith(null, 'grudge', 600)) for (const e of race.events) {
    if (e.type !== 'skill' || e.actorId === 0 || !(e.targetId === 0 && e.outcome === 'hit')) continue;
    if (race.sample(e.time + 0.1)[e.actorId].slowed) punished++;
  }
  assert.ok(punished > 30, `${punished} attackers slowed`);
});

test('surfer: wind, dolphin and frog push it 2.5x as far', () => {
  let rides = 0;
  for (const { race } of racesWith(null, 'surfer', 600)) for (const e of race.events) {
    if (e.type !== 'hazard' || e.actorId !== 0 || e.outcome !== 'boost') continue;
    const base = { wind: 'windPush', dolphin: 'dolphinPush', frog: 'frogHop' }[e.hazard];
    assert.ok(Math.abs((e.surge ?? e.hop) - 30 * V3.tuning.hazard[base] / 100 * V3.tuning.trait.surfer) < 1e-9, `${e.hazard} ${e.surge ?? e.hop}`);
    rides++;
  }
  assert.ok(rides > 30, `${rides} rides`);
});

test('runner: runes fall to it about three times as often as to any other duck', () => {
  let mine = 0, all = 0;
  for (const { race } of racesWith(null, 'runner', 400)) for (const e of race.events.filter(x => x.type === 'rune-pickup')) { all++; if (e.actorId === 0) mine++; }
  assert.ok(mine / all > 0.27 && mine / all < 0.4, `share ${mine / all} (weight 3 of 9)`);
});

test('a buoy that shields its duck from an area effect is spent, once, as its own activation', () => {
  let spent = 0;
  for (const { race } of racesWith('buoy', null, 600)) {
    const pop = race.events.find(e => e.skill === 'buoy' && e.actorId === 0 && e.label === 'PHAO ĐỠ ĐÒN RỒI XẸP!');
    if (!pop) continue;
    spent++;
    assert.equal(race.events.filter(e => e.skill === 'buoy' && e.actorId === 0 && e.activation).length, 1, 'fires once');
    assert.equal(race.sample(pop.time + 0.05)[0].shielded, false);
  }
  assert.ok(spent > 20, `${spent} buoys spent`);
});

test('skill and trait texts quote the tuned numbers', () => {
  const T = V3.tuning.trait, U = V3.tuning, pc = v => `${Math.round(v * 100)}%`, sec = v => `${String(v).replace('.', ',')} giây`;
  const text = (list, id) => list.find(x => x.id === id).description;
  const expect = [
    [V3.traits, 'early', pc(T.early)], [V3.traits, 'draft', pc(T.draft)], [V3.traits, 'leader', pc(T.leader)],
    [V3.traits, 'sleepy', pc(T.sleepySlow)], [V3.traits, 'sleepy', pc(T.sleepyFast)], [V3.traits, 'grudge', pc(1 - T.grudgeSlow)], [V3.traits, 'grudge', sec(T.grudgeTime)],
    [V3.traits, 'charger', pc(T.charge)], [V3.traits, 'charger', sec(T.chargeTime)], [V3.traits, 'steady', `${String(+(T.steady * 100).toFixed(1)).replace('.', ',')}%`],
    [V3.skills, 'freeze', sec(U.freeze.time)], [V3.skills, 'rewind', sec(U.rewind.seconds)], [V3.skills, 'lightning', sec(U.lightning.stun)],
    [V3.skills, 'giant', pc(U.giant.boost)], [V3.skills, 'swap', sec(U.swapV3.daze)], [V3.skills, 'mirror', sec(U.mirrorV3.glareTime)]
  ];
  for (const [list, id, piece] of expect) assert.ok(text(list, id).includes(piece), `${id}: "${text(list, id)}" should say ${piece}`);
});

// ---------- the ten big-show skills ----------
const firstUse = (id, races = 250) => racesWith(id, null, races).map(({ race }) => ({ race, e: race.events.find(x => x.skill === id && x.actorId === 0 && x.scheduled) })).filter(x => x.e);
const at = (race, t) => race.sample(Math.min(race.duration, t));

test('kraken holds up to three leading rivals still; dragon sweeps everyone ahead back', () => {
  let held = 0, swept = 0;
  for (const { race, e } of firstUse('kraken')) {
    assert.ok(e.affectedIds.length <= 3 && !e.affectedIds.includes(0));
    for (const id of e.affectedIds) if (e.outcomes[id] === 'hit') { assert.equal(at(race, e.time + 0.1)[id].pose, 'grabbed'); assert.ok(at(race, e.time + 0.1)[id].stunned); held++; }
  }
  for (const { race, e } of firstUse('dragon')) {
    if (e.outcome !== 'swept') { assert.equal(e.ranksBefore[0], 1, 'only the leader rides the dragon instead'); continue; }
    for (const id of e.affectedIds) {
      assert.ok(e.ranksBefore[id] < e.ranksBefore[0], 'only ducks ahead');
      if (e.outcomes[id] === 'hit' && !heavy(race, id)) { assert.ok(e.after[id] < e.before[id]); swept++; }
    }
    assert.ok(e.after[0] > e.before[0], 'the dragon carries its caster');
  }
  assert.ok(held > 200 && swept > 200, `held ${held}, swept ${swept}`);
});

test('meteors fall on the front half only; the whale launches its caster forward and splashes at most two', () => {
  let meteors = 0, whales = 0;
  for (const { e } of firstUse('meteor')) {
    for (const id of e.affectedIds) { assert.ok(id !== 0 && e.ranksBefore[id] <= 4, `rank ${e.ranksBefore[id]}`); meteors++; }
  }
  for (const { race, e } of firstUse('whale')) {
    assert.equal(e.outcome, 'fly'); assert.ok(e.after[0] > e.before[0]); assert.ok(e.affectedIds.length <= 2);
    assert.ok(at(race, e.time + 0.1)[0].flying, 'airborne on the spout'); whales++;
  }
  assert.ok(meteors > 300 && whales > 200, `meteors ${meteors}, whales ${whales}`);
});

test('ufo drops the leader into the back half (or, by mistake, its caster near the front); pirate shells the ducks right ahead', () => {
  let abducted = 0, mistakes = 0, shells = 0;
  for (const { race, e } of firstUse('ufo', 400)) {
    if (e.outcome === 'mistake') { assert.ok(e.after[0] >= e.before[0]); mistakes++; continue; }
    if (e.outcome !== 'hit' || !lone(race, e)) continue;
    assert.ok(e.after[e.targetId] < e.before[e.targetId]);
    assert.ok(at(race, e.time)[e.targetId].currentRank > 3, 'lands in the back half'); abducted++;
  }
  for (const { race, e } of firstUse('pirate')) {
    for (const id of e.affectedIds) {
      const r = e.ranksBefore;
      assert.ok(r[0] === 1 ? r[id] > 1 && r[id] <= 4 : r[id] < r[0] && r[id] >= r[0] - 3, 'the ducks right ahead (or right behind the leader)');
      if (e.outcomes[id] === 'hit' && !heavy(race, id)) { assert.ok(e.after[id] < e.before[id]); shells++; }
    }
  }
  assert.ok(abducted > 100 && mistakes > 40 && shells > 300, `abducted ${abducted}, mistakes ${mistakes}, shells ${shells}`);
});

test('wheel lands on every segment; anchor slows its target and pulls the caster; volcano and fireworks pick random ducks', () => {
  const segments = new Set(); let anchored = 0;
  for (const { race, e } of firstUse('wheel', 400)) {
    segments.add(e.segment);
    if (e.segment === 'jackpot') assert.ok(e.after[0] > e.before[0]);
    if (e.segment === 'bust' && e.effect === 'hit') assert.equal(at(race, e.time + 0.1)[0].pose, 'capsized');
  }
  assert.deepEqual([...segments].sort(), ['bust', 'flip', 'freeze', 'jackpot']);
  for (const { race, e } of firstUse('anchor')) if (e.outcome === 'hit') { assert.ok(at(race, e.time + 0.2)[e.targetId].slowed); anchored++; }
  for (const { e } of firstUse('volcano')) { assert.equal(e.affectedIds.length, 3); assert.equal(new Set(e.affectedIds).size, 3); }
  for (const { e } of firstUse('fireworks')) { assert.equal(e.affectedIds.length, 4); assert.equal(new Set(e.affectedIds).size, 4); }
  assert.ok(anchored > 150, `anchored ${anchored}`);
});

// ---------- maps ----------
test('maps: one per chaos-v3 race from the seed, zones reported in on-screen progress; chaos-v2 has none', () => {
  assert.deepEqual(V3.maps.map(m => m.id), ['jungle', 'rapids', 'lotus', 'canal', 'ice']);
  for (const m of V3.maps) assert.ok(m.name && m.icon && m.description, m.id);
  const seen = new Set();
  for (let seed = 0; seed < 200; seed++) {
    const a = V3.createRace(names(7), 40, seed), b = V3.createRace(names(7), 40, seed);
    assert.deepEqual(a.map, b.map); seen.add(a.map.id);
    for (const z of a.map.zones) assert.ok(z.from > 0 && z.to < 1 && z.from <= z.to, JSON.stringify(z));
  }
  assert.equal(seen.size, 5);
  assert.equal(V2.createRace(names(7), 25, 1).map, undefined);
});

test('maps are scenery only: no terrain events, and the river events stay as they were (2–4 plus the weather)', () => {
  for (let seed = 0; seed < 300; seed++) {
    const r = V3.createRace(names(7), 40, seed);
    assert.ok(!r.events.some(e => e.type === 'terrain'), `seed ${seed}`);
  }
});
