'use strict';
// chaos-v4: the chaos-v3 rules plus ten skills, river obstacles in race rooms and its own tuning.
// lineup.pilots marks the ducks an owner steers from their own device; lineup.dodges holds the keys pressed per duck,
// [race time, 'up' | 'down']. A key counts for the obstacle a duck meets 1–3 s later.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../dist/chaos-engine-v2.js');
const V3 = E.v3, V4 = E.v4;
const names = count => Array.from({ length: count }, (_, i) => `V${i}`);
const D = 55;
const NEW = ['pho', 'coffee', 'cash', 'net', 'kite', 'cloud', 'hourglass', 'loudspeaker', 'portal', 'xeom'];
const room = (seed, extra = {}) => ({ ...V4.deal(7, seed), casts: Array(7).fill(null), pilots: Array(7).fill(true), dodges: Array(7).fill(null), ...extra });
const keyOf = id => V4.obstacles.find(o => o.id === id).key;
const meets = (race, duck) => race.events.filter(e => e.type === 'obstacle' && e.actorId === duck);
// The race with `skill` dealt to duck 0, cast at `at`.
const casting = (skill, seed, at = 12, extra = {}) => {
  const base = room(seed, extra), casts = Array(7).fill(null); casts[0] = at;
  return V4.createRace(names(7), D, seed, { ...base, skills: [skill, ...base.skills.slice(1)], casts });
};
const fired = race => race.events.find(e => e.type === 'skill' && e.actorId === 0 && e.scheduled);

test('chaos-v4 adds ten skills with tiers; chaos-v3 keeps its own deck', () => {
  assert.equal(V4.version, 'chaos-v4');
  assert.equal(V3.skills.length, 37);
  assert.deepEqual(V4.skills.slice(0, 37).map(s => s.id), V3.skills.map(s => s.id));
  assert.deepEqual(V4.skills.slice(37).map(s => s.id), NEW);
  const tiers = {}; for (const s of V4.skills) tiers[s.tier] = (tiers[s.tier] || 0) + 1;
  assert.deepEqual(tiers, { S: 11, A: 12, B: 14, C: 10 });
  for (const s of V4.skills.slice(37)) assert.ok(s.name && s.icon && s.description.length > 20, s.id);
  assert.ok(NEW.every(id => !V3.skills.some(s => s.id === id)));
  assert.deepEqual([...V4.targeted].filter(id => !V3.targeted.includes(id)).sort(), ['cash', 'cloud', 'net']);
  assert.equal(V4.aims.cash, 2);
});

test('every new skill does what it says', () => {
  const pose = (race, t, id = 0) => race.sample(t)[id];
  for (let seed = 1; seed <= 8; seed++) {
    let race = casting('pho', seed), e = fired(race);
    assert.equal(e.outcome, 'eat');
    assert.equal(pose(race, e.time + 0.3).pose, 'eating');
    assert.ok(pose(race, e.time + 2).boosting, 'pho: fast once eaten');

    race = casting('coffee', seed); e = fired(race);
    assert.equal(e.outcome, 'awake');
    assert.equal(pose(race, e.time + 1).awake, true);

    race = casting('cash', seed); e = fired(race);
    assert.equal(e.affectedIds.length, 2);
    for (const id of e.affectedIds) if (e.outcomes[id] === 'hit') assert.equal(pose(race, e.time + 0.3, id).pose, 'greedy');

    race = casting('net', seed); e = fired(race);
    if (e.outcome === 'hit') assert.equal(pose(race, e.time + 0.3, e.targetId).pose, 'netted');

    race = casting('kite', seed); e = fired(race);
    assert.equal(e.outcome, 'fly');
    assert.ok(pose(race, e.time + 1).flying && pose(race, e.time + 1).boosting);

    race = casting('cloud', seed); e = fired(race);
    if (e.outcome === 'hit') {
      assert.equal(pose(race, e.time + 1, e.targetId).clouded, true);
      const bolt = race.events.find(x => x.skill === 'cloud' && !x.scheduled);
      assert.ok(bolt && Math.abs(bolt.time - e.time - V4.tuning.cloud.time) < 0.06, 'the bolt strikes when the cloud ends');
    }

    race = casting('hourglass', seed); e = fired(race);
    const rank = e.ranksBefore[0];
    assert.equal(e.affectedIds.length, rank === 1 ? 2 : rank - 1);
    for (const id of e.affectedIds) if (e.outcomes[id] === 'hit') assert.equal(pose(race, e.time + 0.3, id).pose, 'frozen');

    race = casting('loudspeaker', seed); e = fired(race);
    assert.ok(e.affectedIds.length >= 2);
    for (const id of e.affectedIds) if (e.outcomes[id] === 'hit') assert.equal(pose(race, e.time + 0.2, id).pose, 'startled');

    race = casting('portal', seed); e = fired(race);
    assert.ok(e.rank >= 1 && e.rank <= e.ranksBefore[0], `portal lands at ${e.rank} from ${e.ranksBefore[0]}`);

    race = casting('xeom', seed); e = fired(race);
    assert.equal(e.outcome, 'ride');
    assert.ok(e.after[0] >= e.before[0]);
  }
});

test('obstacles only come in race rooms: lines across the course, each lane its own kind', () => {
  assert.equal(V4.createRace(names(7), D, 3, V4.deal(7, 3)).obstacles, undefined, 'a one-screen race has none');
  assert.ok(!V4.createRace(names(7), D, 3, V4.deal(7, 3)).events.some(e => e.type === 'obstacle'));
  const race = V4.createRace(names(7), D, 3, room(3));
  assert.equal(race.obstacles.length, 4);
  assert.equal(V4.createRace(names(7), 40, 3, room(3)).obstacles.length, 3, 'a shorter race has one line fewer');
  for (const line of race.obstacles) {
    assert.equal(line.kinds.length, 7);
    assert.ok(line.at > 0.15 && line.at < 0.95, line.at);
    assert.ok(line.kinds.every(k => V4.obstacles.some(o => o.id === k)));
  }
  const ats = race.obstacles.map(l => l.at);
  assert.deepEqual([...ats].sort((a, b) => a - b), ats);
  for (let i = 1; i < ats.length; i++) assert.ok(ats[i] - ats[i - 1] > 0.08, 'lines are well apart');
  for (let duck = 0; duck < 7; duck++) {
    const lines = meets(race, duck).map(e => e.line);
    assert.deepEqual(lines, [...new Set(lines)], 'a duck meets each line once');
  }
  assert.equal(V3.createRace(names(7), D, 3, { ...V3.deal(7, 3), casts: Array(7).fill(null) }).obstacles, undefined, 'chaos-v3 rooms have none');
});

// Steer `duck` past every obstacle with `key(kind)` pressed `before` s ahead, one at a time as a player would.
function steer(seed, duck, key, before, base = room(seed)) {
  let lineup = base;
  for (let guard = 0; guard < 8; guard++) {
    const race = V4.createRace(names(7), D, seed, lineup);
    const next = meets(race, duck).find(e => !(lineup.dodges[duck] || []).some(p => p[0] >= e.time - 3 && p[0] <= e.time - 1) && e.time - before >= 0);
    if (!next) return race;
    const dodges = [...lineup.dodges]; dodges[duck] = [...(dodges[duck] || []), [Math.round((next.time - before) * 100) / 100, key(race.obstacles[next.line].kinds[duck])]];
    lineup = { ...lineup, dodges };
  }
  return V4.createRace(names(7), D, seed, lineup);
}

test('the right key 1–3 s ahead gets past; the wrong key, a late key or none (when steered) trips the duck', () => {
  const tally = { right: {}, wrong: {}, late: {}, none: {} };
  const count = (bucket, race) => { for (const e of meets(race, 0)) bucket[e.outcome] = (bucket[e.outcome] || 0) + 1; };
  for (let seed = 1; seed <= 25; seed++) {
    count(tally.right, steer(seed, 0, keyOf, 2));
    count(tally.wrong, steer(seed, 0, k => (keyOf(k) === 'up' ? 'down' : 'up'), 2));
    count(tally.late, steer(seed, 0, keyOf, 0.5));
    count(tally.none, V4.createRace(names(7), D, seed, room(seed)));
  }
  const passed = b => (b.dodged || 0) + (b.over || 0) + (b.smashed || 0);
  assert.ok(tally.right.dodged > 50 && !tally.right.hit, JSON.stringify(tally.right));
  for (const b of ['wrong', 'late', 'none']) {
    assert.ok(!tally[b].dodged && !tally[b].lucky, `${b}: ${JSON.stringify(tally[b])}`);
    assert.ok(tally[b].hit > passed(tally[b]), `${b}: ${JSON.stringify(tally[b])}`);
  }
});

test('a duck nobody steers gets past on luck about 60% of the time; a hit stuns it briefly', () => {
  let lucky = 0, all = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const race = V4.createRace(names(7), D, seed, room(seed, { pilots: Array(7).fill(false) }));
    for (const e of race.events.filter(x => x.type === 'obstacle' && ['lucky', 'hit'].includes(x.outcome))) {
      all++; if (e.outcome === 'lucky') lucky++;
      if (e.outcome === 'hit') assert.ok(race.sample(e.time + 0.3)[e.actorId].stunned, 'a trip stuns');
      if (e.outcome === 'lucky' && e.time < D - 1) assert.equal(race.sample(e.time + 0.2)[e.actorId].dodge, e.key, 'it jumps or dives'); // the finish cuts a late hop short
    }
  }
  assert.ok(lucky / all > 0.5 && lucky / all < 0.7, `${lucky}/${all}`);
});

test('a key press never changes the race before it: every page switches seamlessly', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const before = V4.createRace(names(7), D, seed, room(seed));
    const meet = meets(before, seed % 7)[0], at = Math.round((meet.time - 2) * 100) / 100;
    const dodges = Array(7).fill(null); dodges[seed % 7] = [[at, keyOf(before.obstacles[meet.line].kinds[seed % 7])]];
    const after = V4.createRace(names(7), D, seed, room(seed, { dodges }));
    const shown = (race, t) => race.sample(t).map(({ rank, ...seen }) => seen);
    for (let t = 0; t < at - 0.06; t += 0.25) assert.deepEqual(shown(after, t), shown(before, t), `seed ${seed} t ${t}`);
    assert.equal(meets(after, seed % 7)[0].outcome, 'dodged');
    assert.equal(after.sample(D).find(r => r.rank === 1).progress, 1, 'the winner still ends exactly on the line');
  }
});

test('pilots and dodges are validated', () => {
  const base = room(4);
  for (const pilots of [[], Array(6).fill(true), [...Array(6).fill(true), 1], 'x'])
    assert.throws(() => V4.createRace(names(7), D, 4, { ...base, pilots }), RangeError, JSON.stringify(pilots));
  const one = list => [list, ...Array(6).fill(null)];
  for (const dodges of [[], Array(6).fill(null), one('x'), one([[1]]), one([[-1, 'up']]), one([[NaN, 'up']]), one([[2, 'left']]), one([['2', 'up']]), one(Array(61).fill([1, 'up']))])
    assert.throws(() => V4.createRace(names(7), D, 4, { ...base, dodges }), RangeError, JSON.stringify(dodges).slice(0, 60));
  assert.doesNotThrow(() => V4.createRace(names(7), D, 4, { ...base, dodges: one([[3, 'up'], [9.5, 'down']]) }));
});

test('the same input always builds the same race', () => {
  const lineup = room(9, { dodges: [[[10, 'up']], null, [[20, 'down']], null, null, null, null] });
  assert.deepEqual(JSON.stringify(V4.createRace(names(7), D, 9, lineup).events), JSON.stringify(V4.createRace(names(7), D, 9, lineup).events));
});

test('balance at 55 s: every skill holder wins 0.7–1.3 × 1/7, and tier S is only a little ahead of tier C', () => {
  const stats = {};
  for (let seed = 0; seed < 6000; seed++) for (const r of V4.createRace(names(7), D, seed, V4.deal(7, seed * 7919)).results) {
    const row = stats[r.skill.id] ??= { tier: r.skill.tier, held: 0, wins: 0 };
    row.held++; if (r.rank === 1) row.wins++;
  }
  const win = s => s.wins / s.held * 7, table = '\n' + Object.entries(stats).map(([id, s]) => `${s.tier} ${id.padEnd(11)} ${win(s).toFixed(2)}× (n=${s.held})`).join('\n');
  for (const s of Object.values(stats)) assert.ok(win(s) >= 0.7 && win(s) <= 1.3, table);
  const tier = t => { const rows = Object.values(stats).filter(s => s.tier === t); return rows.reduce((sum, s) => sum + win(s), 0) / rows.length; };
  assert.ok(tier('S') - tier('C') < 0.18, `S ${tier('S')} C ${tier('C')}${table}`);
});
