'use strict';
// chaos-v5: chaos-v4 (ten more skills, its own tuning) with lanes in race rooms (each lane its own obstacles and runes,
// in sight from the start) and a calm finish.
// lineup.pilots marks the ducks an owner steers from their own device; lineup.dodges holds the keys pressed per duck,
// [race time, 'up' | 'down']. A key counts for the obstacle a duck meets 1–3 s later.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../dist/chaos-engine-v2.js');
const V3 = E.v3, V5 = E.v5;
const names = count => Array.from({ length: count }, (_, i) => `V${i}`);
const D = 55;
const NEW = ['pho', 'coffee', 'cash', 'net', 'kite', 'cloud', 'hourglass', 'loudspeaker', 'portal', 'xeom'];
const room = (seed, extra = {}) => ({ ...V5.deal(7, seed), casts: Array(7).fill(null), pilots: Array(7).fill(true), dodges: Array(7).fill(null), ...extra });
const keyOf = id => V5.obstacles.find(o => o.id === id).key;
const meets = (race, duck) => race.events.filter(e => e.type === 'obstacle' && e.actorId === duck);
const kindAt = (race, e) => race.obstacles[e.line].kind;
// A duck that just tripped in its lane shows the trip, not the skill: pose checks skip that second.
const tripped = (race, id, t) => race.events.some(e => e.type === 'obstacle' && e.actorId === id && e.outcome === 'hit' && e.time <= t + 1e-9 && t - e.time < 1);
// The race with `skill` dealt to duck 0, cast at `at`.
const casting = (skill, seed, at = 12, extra = {}) => {
  const base = room(seed, extra), casts = Array(7).fill(null); casts[0] = at;
  return V5.createRace(names(7), D, seed, { ...base, skills: [skill, ...base.skills.slice(1)], casts });
};
const fired = race => race.events.find(e => e.type === 'skill' && e.actorId === 0 && e.scheduled);

test('chaos-v5 keeps the chaos-v4 deck (kite a little faster); chaos-v4 keeps its lines and its tuning', () => {
  const V4 = E.v4;
  assert.equal(V5.version, 'chaos-v5');
  assert.deepEqual(V5.skills.map(s => s.id), V4.skills.map(s => s.id));
  assert.deepEqual(V5.skills.filter(s => s.id !== 'kite'), V4.skills.filter(s => s.id !== 'kite'));
  assert.equal(V5.tuning.kite.boost, 0.45); assert.equal(V4.tuning.kite.boost, 0.35);
  assert.equal(V4.createRace(names(7), D, 3, { ...V4.deal(7, 3), casts: Array(7).fill(null), pilots: Array(7).fill(true), dodges: Array(7).fill(null) }).obstacles.length, 4, 'chaos-v4 rooms keep their four lines');
  assert.ok(V4.dayRules.some(r => r.id === 'thriller'));
  assert.equal(V3.skills.length, 37);
  assert.deepEqual(V5.skills.slice(0, 37).map(s => s.id), V3.skills.map(s => s.id));
  assert.deepEqual(V5.skills.slice(37).map(s => s.id), NEW);
  const tiers = {}; for (const s of V5.skills) tiers[s.tier] = (tiers[s.tier] || 0) + 1;
  assert.deepEqual(tiers, { S: 11, A: 12, B: 14, C: 10 });
  for (const s of V5.skills.slice(37)) assert.ok(s.name && s.icon && s.description.length > 20, s.id);
  assert.ok(NEW.every(id => !V3.skills.some(s => s.id === id)));
  assert.deepEqual([...V5.targeted].filter(id => !V3.targeted.includes(id)).sort(), ['cash', 'cloud', 'net']);
  assert.equal(V5.aims.cash, 2);
});

test('every new skill does what it says', () => {
  const pose = (race, t, id = 0) => (tripped(race, id, t) ? null : race.sample(t)[id]);
  const is = (race, t, id, check) => { const p = pose(race, t, id); if (p) assert.ok(check(p), `${id} at ${t.toFixed(2)}: ${JSON.stringify(p).slice(0, 160)}`); };
  for (let seed = 1; seed <= 8; seed++) {
    let race = casting('pho', seed), e = fired(race);
    assert.equal(e.outcome, 'eat');
    is(race, e.time + 0.3, 0, p => p.pose === 'eating');
    is(race, e.time + 2, 0, p => p.boosting); // pho: fast once eaten

    race = casting('coffee', seed); e = fired(race);
    assert.equal(e.outcome, 'awake');
    is(race, e.time + 1, 0, p => p.awake === true);

    race = casting('cash', seed); e = fired(race);
    assert.equal(e.affectedIds.length, 2);
    for (const id of e.affectedIds) if (e.outcomes[id] === 'hit') is(race, e.time + 0.3, id, p => p.pose === 'greedy');

    race = casting('net', seed); e = fired(race);
    if (e.outcome === 'hit') is(race, e.time + 0.3, e.targetId, p => p.pose === 'netted');

    race = casting('kite', seed); e = fired(race);
    assert.equal(e.outcome, 'fly');
    is(race, e.time + 1, 0, p => p.flying && p.boosting);

    race = casting('cloud', seed); e = fired(race);
    if (e.outcome === 'hit') {
      is(race, e.time + 1, e.targetId, p => p.clouded === true);
      const bolt = race.events.find(x => x.skill === 'cloud' && !x.scheduled);
      assert.ok(bolt && Math.abs(bolt.time - e.time - V5.tuning.cloud.time) < 0.06, 'the bolt strikes when the cloud ends');
    }

    race = casting('hourglass', seed); e = fired(race);
    const rank = e.ranksBefore[0];
    assert.equal(e.affectedIds.length, rank === 1 ? 2 : rank - 1);
    for (const id of e.affectedIds) if (e.outcomes[id] === 'hit') is(race, e.time + 0.3, id, p => p.pose === 'frozen');

    race = casting('loudspeaker', seed); e = fired(race);
    assert.ok(e.affectedIds.length >= 2);
    for (const id of e.affectedIds) if (e.outcomes[id] === 'hit') is(race, e.time + 0.2, id, p => p.pose === 'startled');

    race = casting('portal', seed); e = fired(race);
    assert.ok(e.rank >= 1 && e.rank <= e.ranksBefore[0], `portal lands at ${e.rank} from ${e.ranksBefore[0]}`);

    race = casting('xeom', seed); e = fired(race);
    assert.equal(e.outcome, 'ride');
    assert.ok(e.after[0] >= e.before[0]);
  }
});

test('lane items only come in race rooms: each lane has its own obstacles and runes at random spots, in sight from the start', () => {
  assert.equal(V5.createRace(names(7), D, 3, V5.deal(7, 3)).obstacles, undefined, 'a one-screen race has none');
  assert.ok(!V5.createRace(names(7), D, 3, V5.deal(7, 3)).events.some(e => e.type === 'obstacle'));
  const race = V5.createRace(names(7), D, 3, room(3)), rune = id => !!V5.obstacles.find(o => o.id === id).rune;
  assert.equal(race.obstacles.length, 7 * 6);
  for (let duck = 0; duck < 7; duck++) {
    const lane = race.obstacles.filter(o => o.duck === duck), ats = lane.map(o => o.at);
    assert.deepEqual([lane.filter(o => !rune(o.kind)).length, lane.filter(o => rune(o.kind)).length], [4, 2], 'four obstacles and two runes');
    assert.deepEqual([...ats].sort((a, b) => a - b), ats);
    for (let i = 1; i < ats.length; i++) assert.ok(ats[i] - ats[i - 1] > 0.04, `well apart: ${ats}`);
    assert.ok(ats[0] > 0.12 && ats.at(-1) < 0.82, `${ats}`);
    const lines = meets(race, duck).map(e => e.line);
    assert.deepEqual(lines, [...new Set(lines)], 'a duck meets each of its own once');
    assert.ok(lines.every(i => race.obstacles[i].duck === duck));
  }
  assert.notDeepEqual(race.obstacles.filter(o => o.duck === 0).map(o => o.kind), race.obstacles.filter(o => o.duck === 1).map(o => o.kind), 'lanes differ');
  assert.notEqual(race.obstacles[0].at, race.obstacles[6].at, 'spots differ between lanes');
  const short = V5.createRace(names(7), 40, 3, room(3)).obstacles.filter(o => o.duck === 0);
  assert.equal(short.filter(o => !rune(o.kind)).length, 3, 'a shorter race has one obstacle fewer');
  assert.equal(V5.createRace(names(7), D, 3, room(3, { rule: 'runes' })).obstacles.filter(o => o.duck === 0 && rune(o.kind)).length, 4, 'rune rain doubles the runes');
  assert.ok(!race.events.some(e => e.type.startsWith('rune-')), 'no runes that pick themselves up in a room');
  assert.equal(V3.createRace(names(7), D, 3, { ...V3.deal(7, 3), casts: Array(7).fill(null) }).obstacles, undefined, 'chaos-v3 rooms have none');
});

// Steer `duck` through every lane item with `key(kind)` pressed `before` s ahead, one at a time as a player would.
function steer(seed, duck, key, before, base = room(seed)) {
  let lineup = base;
  for (let guard = 0; guard < 10; guard++) {
    const race = V5.createRace(names(7), D, seed, lineup);
    const next = meets(race, duck).find(e => !(lineup.dodges[duck] || []).some(p => p[0] >= e.time - 3 && p[0] <= e.time - 1) && e.time - before >= 0);
    if (!next) return race;
    const dodges = [...lineup.dodges]; dodges[duck] = [...(dodges[duck] || []), [Math.round((next.time - before) * 100) / 100, key(kindAt(race, next))]];
    lineup = { ...lineup, dodges };
  }
  return V5.createRace(names(7), D, seed, lineup);
}

test('the right key 1–3 s ahead gets past an obstacle or grabs a rune; the wrong key, a late key or none trips or misses', () => {
  const tally = {};
  const count = (bucket, race) => { for (const e of meets(race, 0)) { const b = tally[`${bucket}:${e.rune ? 'rune' : 'obstacle'}`] ??= {}; b[e.outcome] = (b[e.outcome] || 0) + 1; } };
  for (let seed = 1; seed <= 25; seed++) {
    count('right', steer(seed, 0, keyOf, 2));
    count('wrong', steer(seed, 0, k => (keyOf(k) === 'up' ? 'down' : 'up'), 2));
    count('late', steer(seed, 0, keyOf, 0.5));
    count('none', V5.createRace(names(7), D, seed, room(seed)));
  }
  const show = JSON.stringify(tally), passed = b => (b.dodged || 0) + (b.over || 0) + (b.smashed || 0);
  assert.ok(tally['right:obstacle'].dodged > 50 && !tally['right:obstacle'].hit, show);
  assert.ok(tally['right:rune'].grabbed > 30 && !tally['right:rune'].missed, show);
  for (const b of ['wrong', 'late', 'none']) {
    const o = tally[`${b}:obstacle`], r = tally[`${b}:rune`];
    assert.ok(!o.dodged && !o.lucky && o.hit > passed(o), `${b}: ${show}`);
    assert.deepEqual(Object.keys(r), ['missed'], `${b}: ${show}`);
  }
});

test('a rune grabbed: ⚡ speeds the duck up, 🫧 gives it a shield', () => {
  let speed = 0, bubble = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const race = steer(seed, 0, keyOf, 2);
    for (const e of meets(race, 0).filter(x => x.rune && x.outcome === 'grabbed' && x.time < D - 1)) {
      const s = race.sample(e.time + 0.2)[0];
      assert.equal(s.dodge, e.key, 'it jumps or dives for it');
      if (e.rune === 'speed') { speed++; assert.ok(s.boosting, 'speed rune'); }
      else { bubble++; assert.equal(e.obstacle, 'pearl'); }
    }
  }
  assert.ok(speed > 3 && bubble > 3, `${speed} ${bubble}`);
});

test('a duck nobody steers gets past or grabs on luck about 60% of the time; a trip stuns it briefly', () => {
  let lucky = 0, all = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const race = V5.createRace(names(7), D, seed, room(seed, { pilots: Array(7).fill(false) }));
    for (const e of race.events.filter(x => x.type === 'obstacle' && ['lucky', 'hit', 'missed'].includes(x.outcome))) {
      all++; if (e.outcome === 'lucky') lucky++;
      if (e.outcome === 'hit') assert.ok(race.sample(e.time + 0.05)[e.actorId].stunned, 'a trip stuns'); // (coffee a moment later wakes it up)
      // (the finish cuts a late hop short; a duck thrown forward past two at once does the last one's move)
      const alone = !meets(race, e.actorId).some(x => x !== e && Math.abs(x.time - e.time) < 0.3);
      if (e.outcome === 'lucky' && e.time < D - 1 && alone) assert.equal(race.sample(e.time + 0.2)[e.actorId].dodge, e.key, 'it jumps or dives');
    }
  }
  assert.ok(lucky / all > 0.5 && lucky / all < 0.7, `${lucky}/${all}`);
});

test('a key press never changes the race before it: every page switches seamlessly', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const before = V5.createRace(names(7), D, seed, room(seed));
    const meet = meets(before, seed % 7)[0], at = Math.round((meet.time - 2) * 100) / 100;
    const dodges = Array(7).fill(null); dodges[seed % 7] = [[at, keyOf(kindAt(before, meet))]];
    const after = V5.createRace(names(7), D, seed, room(seed, { dodges }));
    const shown = (race, t) => race.sample(t).map(({ rank, ...seen }) => seen);
    for (let t = 0; t < at - 0.06; t += 0.25) assert.deepEqual(shown(after, t), shown(before, t), `seed ${seed} t ${t}`);
    assert.ok(['dodged', 'grabbed'].includes(meets(after, seed % 7)[0].outcome));
    assert.equal(after.sample(D).find(r => r.rank === 1).progress, 1, 'the winner still ends exactly on the line');
  }
});

test('a calm finish: nothing happens in the last 15% of a race, and no finale rock', () => {
  assert.ok(!V5.dayRules.some(r => r.id === 'thriller') && V5.retiredDayRules.some(r => r.id === 'thriller'), 'its day rule is retired');
  for (let seed = 1; seed <= 80; seed++) {
    const solo = V5.createRace(names(7), D, seed, V5.deal(7, seed)), steered = steer(seed % 9 + 1, seed % 7, keyOf, 2);
    for (const race of [solo, V5.createRace(names(7), D, seed, room(seed)), steered]) {
      const late = race.events.filter(e => (e.scheduled || e.type === 'obstacle') && e.time > D * 0.85 + 1e-6);
      assert.deepEqual(late.map(e => `${e.type}:${e.skill || e.hazard || e.obstacle}@${e.time}`), [], `seed ${seed}`);
      assert.ok(!race.events.some(e => e.finale));
    }
  }
});

test('pilots and dodges are validated', () => {
  const base = room(4);
  for (const pilots of [[], Array(6).fill(true), [...Array(6).fill(true), 1], 'x'])
    assert.throws(() => V5.createRace(names(7), D, 4, { ...base, pilots }), RangeError, JSON.stringify(pilots));
  const one = list => [list, ...Array(6).fill(null)];
  for (const dodges of [[], Array(6).fill(null), one('x'), one([[1]]), one([[-1, 'up']]), one([[NaN, 'up']]), one([[2, 'left']]), one([['2', 'up']]), one(Array(61).fill([1, 'up']))])
    assert.throws(() => V5.createRace(names(7), D, 4, { ...base, dodges }), RangeError, JSON.stringify(dodges).slice(0, 60));
  assert.doesNotThrow(() => V5.createRace(names(7), D, 4, { ...base, dodges: one([[3, 'up'], [9.5, 'down']]) }));
});

test('the same input always builds the same race', () => {
  const lineup = room(9, { dodges: [[[10, 'up']], null, [[20, 'down']], null, null, null, null] });
  assert.deepEqual(JSON.stringify(V5.createRace(names(7), D, 9, lineup).events), JSON.stringify(V5.createRace(names(7), D, 9, lineup).events));
});

test('balance at 55 s: every skill holder wins 0.7–1.3 × 1/7, and tier S is only a little ahead of tier C', () => {
  const stats = {};
  for (let seed = 0; seed < 6000; seed++) for (const r of V5.createRace(names(7), D, seed, V5.deal(7, seed * 7919)).results) {
    const row = stats[r.skill.id] ??= { tier: r.skill.tier, held: 0, wins: 0 };
    row.held++; if (r.rank === 1) row.wins++;
  }
  const win = s => s.wins / s.held * 7, table = '\n' + Object.entries(stats).map(([id, s]) => `${s.tier} ${id.padEnd(11)} ${win(s).toFixed(2)}× (n=${s.held})`).join('\n');
  for (const s of Object.values(stats)) assert.ok(win(s) >= 0.7 && win(s) <= 1.3, table);
  const tier = t => { const rows = Object.values(stats).filter(s => s.tier === t); return rows.reduce((sum, s) => sum + win(s), 0) / rows.length; };
  assert.ok(tier('S') - tier('C') < 0.18, `S ${tier('S')} C ${tier('C')}${table}`);
});
