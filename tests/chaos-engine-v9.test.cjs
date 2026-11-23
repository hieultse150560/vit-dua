'use strict';
// chaos-v9: chaos-v8 with six skills that bring new rules (traps in a rival's lane, a riddle that can backfire, a speed
// camera, a pickpocket, a toll gate, an upside-down world), and luckier ducks nobody steers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../dist/chaos-engine-v2.js');
const V8 = E.v8, V9 = E.v9;
const names = count => Array.from({ length: count }, (_, i) => `V${i}`);
const D = 55, NEW = ['traps', 'riddle', 'camera', 'pickpocket', 'toll', 'upside'];
const room = (n, seed, extra = {}) => ({ ...V9.deal(n, seed), casts: Array(n).fill(null), pilots: Array(n).fill(true), dodges: Array(n).fill(null),
  answers: Array(n).fill(null), riddles: Array(n).fill(null), ...extra });
const only = (n, id, value) => Array.from({ length: n }, (_, i) => (i === id ? value : null));
const noProgress = r => r.events.map(({ progress, ...e }) => e);
// A cast time well clear of duck `id`'s own quiz (a riddle never lands on a duck about to answer; traps float by one).
const clearOfQuiz = (n, seed, id) => { const q = V9.createRace(names(n), D, seed, room(n, seed)).quizzes[id]; return q.at > 22 ? 12 : Math.min(30, q.at + 7); };

test('chaos-v9 keeps every chaos-v8 skill and adds six with new rules; ducks nobody steers are luckier', () => {
  assert.equal(V9.version, 'chaos-v9');
  assert.deepEqual(V9.skills.slice(0, V8.skills.length), V8.skills);
  assert.deepEqual(V9.skills.slice(V8.skills.length).map(s => s.id), NEW);
  for (const s of V9.skills.slice(V8.skills.length)) assert.ok(['S', 'A', 'B', 'C'].includes(s.tier) && s.description.length > 30, s.id);
  assert.equal(V9.tuning.lane.luck, 0.75);
  assert.equal(V9.tuning.quiz.luck, 0.75);
  assert.ok(['traps', 'riddle', 'pickpocket'].every(id => V9.targeted.includes(id)));
  // chaos-v8 ignores the riddle answers a page may send along
  const lineup = { ...V8.deal(5, 3), casts: Array(5).fill(null), pilots: Array(5).fill(true), dodges: Array(5).fill(null), answers: Array(5).fill(null) };
  assert.deepEqual(JSON.stringify(V8.createRace(names(5), D, 3, { ...lineup, riddles: Array(5).fill(null) }).events), JSON.stringify(V8.createRace(names(5), D, 3, lineup).events));
});

test('a duck nobody steers gets past about 3 in 4 lane obstacles and quizzes', () => {
  let lucky = 0, met = 0, guessed = 0, quizzes = 0;
  for (let seed = 1; seed <= 60; seed++) for (const e of V9.createRace(names(6), D, seed, room(6, seed, { pilots: Array(6).fill(false) })).events) {
    if (e.type === 'obstacle' && !e.rune && e.trap === undefined && ['lucky', 'hit', 'immune'].includes(e.outcome)) { met++; if (e.outcome === 'lucky') lucky++; }
    if (e.type === 'quiz') { quizzes++; if (e.outcome === 'lucky') guessed++; }
  }
  assert.ok(lucky / met > 0.67 && lucky / met < 0.83, `lane ${lucky}/${met}`);
  assert.ok(guessed / quizzes > 0.65 && guessed / quizzes < 0.85, `quiz ${guessed}/${quizzes}`);
});

test('traps: three things in the target lane from the cast on, keys alternating; each one missed pushes back, each right key gets past', () => {
  for (const seed of [5, 8, 13]) {
    const n = 4, at = clearOfQuiz(n, seed, 1), base = room(n, seed, { skills: ['traps', 'pho', 'pho', 'pho'], casts: [at, null, null, null], targets: [[1], null, null, null] });
    const race = V9.createRace(names(n), D, seed, base), laid = race.obstacles.filter(o => o.trap === 0), keyOf = id => V9.obstacles.find(o => o.id === id).key;
    assert.equal(laid.length, 3, `seed ${seed}`);
    assert.ok(laid.every(o => o.duck === 1 && Math.abs(o.from - at) < 0.02), 'in the aimed lane, from the cast on');
    assert.ok(keyOf(laid[0].kind) !== keyOf(laid[1].kind) && keyOf(laid[1].kind) !== keyOf(laid[2].kind), 'jump, dive, jump (or the other way round)');
    const met = race.events.filter(e => e.type === 'obstacle' && e.trap === 0);
    assert.deepEqual(met.map(e => e.outcome), ['hit', 'hit', 'hit'], 'a steered duck pressing nothing trips on every one');
    assert.ok(met[0].time >= at + 2.5, 'time to see the first one and press');
    // The right key a moment before each one gets past all three, and the duck ends further on.
    let presses = [], dodged = race;
    for (let k = 0; k < 3; k++) {
      const e = dodged.events.filter(x => x.type === 'obstacle' && x.trap === 0)[k];
      presses = [...presses, [Math.round((e.time - 1.6) * 100) / 100, e.key]];
      dodged = V9.createRace(names(n), D, seed, { ...base, dodges: only(n, 1, presses) });
    }
    assert.deepEqual(dodged.events.filter(e => e.type === 'obstacle' && e.trap === 0).map(e => e.outcome), ['dodged', 'dodged', 'dodged']);
    const end = r => r.results.find(x => x.id === 1).finalDistance;
    assert.ok(end(dodged) > end(race), 'the trips cost ground');
  }
});

test('riddle: right sends the punishment back to the thrower; wrong or too late punishes the duck that had to answer', () => {
  const n = 4, seed = 7, at = clearOfQuiz(n, seed, 1), base = room(n, seed, { skills: ['riddle', 'pho', 'pho', 'pho'], casts: [at, null, null, null], targets: [[1], null, null, null] });
  const race = V9.createRace(names(n), D, seed, base), [q] = race.riddles;
  assert.ok(q.duck === 1 && q.by === 0 && Math.abs(q.at - at) < 0.02 && [0, 1, 2].includes(q.right));
  assert.equal(race.riddleTime, 4);
  const settle = riddles => V9.createRace(names(n), D, seed, { ...base, riddles }).events.find(e => e.type === 'riddle');
  assert.deepEqual([settle(base.riddles).outcome, settle(base.riddles).victimId], ['late', 1], 'no answer from a steered duck: late');
  assert.deepEqual([settle(only(n, 1, [[q.at + 1, q.right]])).outcome, settle(only(n, 1, [[q.at + 1, q.right]])).victimId], ['right', 0], 'right: it backfires');
  assert.deepEqual([settle(only(n, 1, [[q.at + 1, (q.right + 1) % 3]])).victimId], [1], 'wrong: the target is punished');
  assert.equal(settle(only(n, 1, [[q.at + 4.3, q.right]])).outcome, 'late', 'after its 4 s an answer does not count');
  // an answer only changes the race from the riddle settling on; the lane keeps quiet while answering
  const answered = V9.createRace(names(n), D, seed, { ...base, riddles: only(n, 1, [[q.at + 1, q.right]]) });
  const upTo = r => noProgress(r).filter(e => e.time < q.at + 4 - 1e-9);
  assert.deepEqual(upTo(answered), upTo(race));
  assert.ok(!race.events.some(e => e.type === 'obstacle' && e.actorId === 1 && e.time >= q.at && e.time <= q.at + 4.5));
  assert.throws(() => V9.createRace(names(n), D, seed, { ...base, riddles: only(n, 1, [[1, 3]]) }), /đố mẹo/);
  // one that would settle in the calm finish is not thrown (nothing knocks a duck back there): the thrower surges instead
  const calm = race.calmFrom, late = V9.createRace(names(n), D, seed, { ...base, casts: [calm - 3, null, null, null] });
  assert.equal(late.riddles, undefined);
  assert.equal(late.events.find(e => e.type === 'skill' && e.actorId === 0).outcome, 'none');
  // a duck nobody steers guesses: about 2 in 5 right (the riddle backfires)
  let right = 0, total = 0;
  for (let s = 1; s <= 120; s++) for (const e of V9.createRace(names(5), D, s, room(5, s, { skills: Array(5).fill('riddle'), pilots: Array(5).fill(false) })).events)
    if (e.type === 'riddle') { total++; if (e.outcome === 'lucky') right++; }
  assert.ok(right / total > 0.3 && right / total < 0.5, `${right}/${total}`);
});

test('speed camera: a skill another duck casts while it is up is taken and its owner stopped; the camera owner is pushed on', () => {
  const n = 4, seed = 3, base = room(n, seed, { skills: ['camera', 'pho', 'missile', 'pho'], casts: [10, 12, 15, 25] });
  const race = V9.createRace(names(n), D, seed, base), skills = race.events.filter(e => e.type === 'skill' && e.scheduled);
  const by = id => skills.find(e => e.actorId === id);
  assert.equal(by(0).outcome, 'camera');
  assert.ok(Math.abs(by(0).until - 18) < 0.02, 'up for 8 s');
  assert.equal(by(1).outcome, 'confiscated');
  assert.equal(by(2).outcome, 'confiscated', 'an attack is taken too');
  assert.equal(by(2).cameraId, 0);
  assert.notEqual(by(3).outcome, 'confiscated', 'after it, skills fire as usual');
  assert.ok(race.sample(12.5).find(r => r.id === 0).boosting, 'the fine pushes its owner');
  assert.ok(race.sample(12.5).find(r => r.id === 1).stunned, 'the caught duck stops');
});

test('pickpocket: takes the skill a rival still holds and casts it at once; the rival is left with nothing', () => {
  const n = 4, seed = 4, lineup = skills => room(n, seed, { skills, casts: [10, 20, null, null], targets: [[1], null, null, null] });
  const plain = V9.createRace(names(n), D, seed, lineup(['pho', 'missile', 'pho', 'pho']));
  assert.ok(plain.events.some(e => e.type === 'skill' && e.actorId === 1 && e.skill === 'missile'), 'left alone, the missile fires at 20 s');
  const race = V9.createRace(names(n), D, seed, lineup(['pickpocket', 'missile', 'pho', 'pho']));
  const theft = race.events.find(e => e.type === 'skill' && e.actorId === 0);
  assert.deepEqual([theft.stolen, theft.victimId], ['missile', 1]);
  assert.match(theft.label, /^MÓC TÚI TÊN LỬA TẦM NHIỆT/);
  assert.ok(Number.isInteger(theft.targetId), 'the stolen missile strikes as a missile');
  assert.ok(!race.events.some(e => e.type === 'skill' && e.actorId === 1), 'the robbed duck casts nothing');
  // nobody left with an active skill: the purse
  const purse = V9.createRace(names(n), D, seed, room(n, seed, { skills: Array(n).fill('pickpocket'), casts: [10, null, null, null] })).events.find(e => e.type === 'skill' && e.actorId === 0);
  assert.equal(purse.outcome, 'purse');
});

test('toll gate: every duck behind it that swims past while it is open pays once, and the fees push its owner', () => {
  let paid = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const n = 6, race = V9.createRace(names(n), D, seed, room(n, seed, { skills: ['toll', 'pho', 'pho', 'pho', 'pho', 'pho'], casts: [15, null, null, null, null, null] }));
    const gate = race.events.find(e => e.type === 'skill' && e.actorId === 0), fees = race.events.filter(e => e.type === 'toll');
    assert.ok(Math.abs(gate.until - 21) < 0.02 && gate.gate > 0 && gate.gate < 1, 'open 6 s, drawn where it stands');
    assert.equal(new Set(fees.map(e => e.targetId)).size, fees.length, 'once each');
    for (const e of fees) {
      assert.ok(e.time >= 15 && e.time <= 21 && e.actorId === 0 && e.targetId !== 0);
      if (e.outcome === 'paid') { paid++; assert.ok(e.after[e.targetId] < e.before[e.targetId], 'the payer drops back'); }
    }
  }
  assert.ok(paid >= 10, `${paid} fees`);
});

test('upside-down world: for 4 s the last duck swims faster and the leader slower', () => {
  for (let seed = 1; seed <= 15; seed++) {
    const n = 5, race = V9.createRace(names(n), D, seed, room(n, seed, { skills: ['upside', 'pho', 'pho', 'pho', 'pho'], casts: [20, null, null, null, null] }));
    const flip = race.events.find(e => e.type === 'skill' && e.actorId === 0), at = flip.time;
    assert.ok(Math.abs(flip.until - at - 4) < 0.02);
    const ranks = flip.ranksBefore, last = ranks.indexOf(n), leader = ranks.indexOf(1);
    const during = race.sample(at + 1);
    assert.ok(during.find(r => r.id === last).boosting, `seed ${seed}: the last duck speeds up`);
    if (flip.outcomes[leader] === 'slower') assert.ok(during.find(r => r.id === leader).slowed, `seed ${seed}: the leader slows`);
  }
});

test('balance at 55 s: every skill holder wins 0.7–1.3 × 1/7, and tier S is only a little ahead of tier C', () => {
  const stats = {};
  for (let seed = 0; seed < 6000; seed++) for (const r of V9.createRace(names(7), D, seed, V9.deal(7, seed * 7919)).results) {
    const row = stats[r.skill.id] ??= { tier: r.skill.tier, held: 0, wins: 0 };
    row.held++; if (r.rank === 1) row.wins++;
  }
  const win = s => s.wins / s.held * 7, table = '\n' + Object.entries(stats).map(([id, s]) => `${s.tier} ${id.padEnd(11)} ${win(s).toFixed(2)}× (n=${s.held})`).join('\n');
  for (const s of Object.values(stats)) assert.ok(win(s) >= 0.7 && win(s) <= 1.3, table);
  assert.ok(NEW.every(id => stats[id]?.held > 500), 'the new skills are dealt as often as the rest');
  const tier = t => { const rows = Object.values(stats).filter(s => s.tier === t); return rows.reduce((sum, s) => sum + win(s), 0) / rows.length; };
  assert.ok(tier('S') - tier('C') < 0.18, `S ${tier('S')} C ${tier('C')}${table}`);
});
