const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../dist/tournament.js');
const completedAt = '2026-11-04T05:00:00.000Z';
const make = (count = 4, extra = {}) => T.createSession({ version: 2, names: Array.from({ length: count }, (_, i) => `Người ${i + 1}`), date: '2026-11-04', ...extra });
const picksFor = players => Object.fromEntries(players.map((player, index) => [player.id, index]));
const add = (session, order, id = `r${session.rounds.length + 1}`) => T.recordRound(session, { id, picks: picksFor(session.players), order, completedAt });

test('default daily tournament scores ten rounds exactly once and keeps past state unchanged', () => {
  let session = make(8);
  assert.equal(session.duration, 25);
  assert.equal(session.roundLimit, 10);
  const initial = session;
  for (let i = 0; i < 10; i++) {
    const prior = session;
    const order = Array.from({ length: 8 }, (_, index) => (index + i) % 8);
    session = add(session, order);
    assert.equal(prior.rounds.length, i);
    assert.equal(session.rounds[i].entries.reduce((sum, row) => sum + row.points, 0), 36);
  }
  assert.equal(initial.rounds.length, 0);
  const table = T.standings(session);
  assert.equal(table.reduce((sum, row) => sum + row.total, 0), 360);
  assert.ok(table.every(row => row.pointsByRound.length === 10));
  const repeated = T.recordRound(session, { id: 'r10' });
  assert.strictEqual(repeated, session);
  assert.throws(() => add(session, [0, 1, 2, 3, 4, 5, 6, 7], 'r11'));
  assert.deepEqual(T.validateSession(JSON.parse(JSON.stringify(session))), session);
});

test('picks must form one-to-one assignment; result order is a complete permutation', () => {
  const session = make(3);
  assert.equal(T.validatePicks(session.players, { p0: 2, p1: 0, p2: 1 }), true);
  for (const picks of [{ p0: 0, p1: 0, p2: 2 }, { p0: 0, p1: 1 }, { p0: 0, p1: 1, p2: 3 }, { p0: 0, p1: 1, p2: 2, p3: 3 }]) {
    assert.throws(() => T.validatePicks(session.players, picks));
  }
  for (const order of [[0, 0, 1], [0, 1], [0, 1, 3], [0, 1, ,]]) assert.throws(() => add(session, order));
  const result = T.recordRound(session, { id: 'one', picks: { p0: 2, p1: 0, p2: 1 }, order: [0, 1, 2], completedAt });
  assert.deepEqual(result.rounds[0].entries.map(row => [row.playerId, row.points]), [['p1', 3], ['p2', 2], ['p0', 1]]);
});

test('ordinary bottom two are resolved without a tiebreak and ties use competition ranks', () => {
  let session = make(4, { roundLimit: 2 });
  assert.equal(T.coffeeStatus(session).status, 'pending');
  session = add(session, [0, 1, 2, 3]);
  session = add(session, [0, 1, 3, 2]);
  assert.deepEqual(T.standings(session).map(row => row.rank), [1, 2, 3, 3]);
  assert.deepEqual(T.coffeeStatus(session), { status: 'resolved', coffeeIds: ['p2', 'p3'], tiedIds: [], slots: 0 });
  assert.throws(() => T.recordTiebreak(session, { id: 'tie', picks: { p2: 0, p3: 1 }, order: [0, 1], completedAt }));
});

test('all tied: bottom two of the extra race pay coffee without changing tournament points', () => {
  let session = make(3, { roundLimit: 3 });
  session = add(session, [0, 1, 2]);
  session = add(session, [1, 2, 0]);
  session = add(session, [2, 0, 1]);
  assert.deepEqual(T.coffeeStatus(session), { status: 'tie', coffeeIds: [], tiedIds: ['p0', 'p1', 'p2'], slots: 2 });
  const totals = T.standings(session);
  const prior = session;
  session = T.recordTiebreak(session, { id: 'tie1', picks: { p0: 1, p1: 2, p2: 0 }, order: [1, 2, 0], completedAt });
  assert.equal(prior.tiebreaks.length, 0);
  assert.deepEqual(T.coffeeStatus(session), { status: 'resolved', coffeeIds: ['p2', 'p1'], tiedIds: [], slots: 0 });
  assert.deepEqual(T.standings(session), totals);
  assert.ok(session.tiebreaks[0].entries.every(row => !Object.hasOwn(row, 'points')));
  assert.strictEqual(T.recordTiebreak(session, { id: 'tie1' }), session);
  assert.deepEqual(T.validateSession(JSON.parse(JSON.stringify(session))), session);
});

test('one fixed coffee payer plus a tie at cutoff chooses only the last tied racer', () => {
  let session = make(4, { roundLimit: 3 });
  session = add(session, [0, 1, 2, 3]);
  session = add(session, [1, 2, 0, 3]);
  session = add(session, [2, 0, 1, 3]);
  assert.deepEqual(T.coffeeStatus(session), { status: 'tie', coffeeIds: ['p3'], tiedIds: ['p0', 'p1', 'p2'], slots: 1 });
  session = T.recordTiebreak(session, { id: 'tie1', picks: { p0: 0, p1: 1, p2: 2 }, order: [2, 0, 1], completedAt });
  assert.deepEqual(T.coffeeStatus(session), { status: 'resolved', coffeeIds: ['p3', 'p1'], tiedIds: [], slots: 0 });
  assert.deepEqual(T.validateSession(JSON.parse(JSON.stringify(session))), session);
});

test('restoration rebuilds valid records and rejects altered scores, picks, ranks and duplicate rounds', () => {
  let session = make(4, { roundLimit: 3 });
  session = add(session, [0, 1, 2, 3]);
  const clone = () => JSON.parse(JSON.stringify(session));
  for (const alter of [
    data => { data.rounds[0].entries[0].points = 99; },
    data => { data.rounds[0].entries[0].duckId = data.rounds[0].entries[1].duckId; },
    data => { data.rounds[0].entries[0].rank = 2; },
    data => { data.players[0].id = 'unknown'; },
    data => { delete data.duration; },
    data => { data.rounds[0].completedAt = '2026-02-30T05:00:00.000Z'; },
    data => { data.rounds.push({ ...data.rounds[0], number: 2 }); },
    data => { data.rounds[0].number = 2; },
    data => { data.tiebreaks = [{ id: 'bad', number: 1, entries: [], completedAt }]; }
  ]) { const data = clone(); alter(data); assert.throws(() => T.validateSession(data)); }
  const data = clone(); data.unknown = 'discard';
  assert.deepEqual(T.validateSession(data), session);
});

test('setup validation rejects ambiguous names and invalid calendar/settings values', () => {
  assert.throws(() => T.createSession({ names: ['Phú', 'phú', 'An'], date: '2026-11-04' }));
  assert.throws(() => T.createSession({ names: ['Phú', 'Phu\u0301', 'An'], date: '2026-11-04' }));
  for (const options of [{ date: '2026-02-30' }, { roundLimit: 0 }, { roundLimit: 1.5 }, { duration: 9 }, { duration: 25.5 }]) assert.throws(() => make(3, options));
  assert.throws(() => make(2));
  assert.throws(() => make(101));
  assert.equal(make(100, { duration: 600, roundLimit: 100 }).players.length, 100);
  assert.equal(make(3, { date: '2028-02-29' }).date, '2028-02-29');
});

test('version 4 is the default (hope stars); unique daily last places owe 60k and 40k', () => {
  const created = T.createSession({ names: ['Phú', 'An', 'Bình'], date: '2026-11-04' });
  assert.equal(created.version, 4);
  let session = make(4, { version: 3, roundLimit: 1 });
  assert.deepEqual(T.coffeeStatus(session), { status: 'pending', coffeeIds: [], tiedIds: [], slots: 2, contributions: [] });
  session = add(session, [0, 1, 2, 3]);
  assert.deepEqual(T.coffeeStatus(session), {
    status: 'resolved', coffeeIds: ['p3', 'p2'], tiedIds: [], slots: 0,
    contributions: [
      { playerId: 'p3', amount: 60000, position: 'last' },
      { playerId: 'p2', amount: 40000, position: 'penultimate' }
    ]
  });
  assert.deepEqual(T.validateSession(JSON.parse(JSON.stringify(session))), session);
});

test('version 3 exactly two tied bottom players must race to decide 60k versus 40k', () => {
  let session = make(4, { version: 3, roundLimit: 2 });
  session = add(session, [0, 1, 2, 3]);
  session = add(session, [0, 1, 3, 2]);
  assert.deepEqual(T.coffeeStatus(session), { status: 'tie', coffeeIds: [], tiedIds: ['p2', 'p3'], slots: 2, contributions: [] });
  const totals = T.standings(session);
  assert.deepEqual(T.selectionOrder(session, 'tie'), ['p2', 'p3']);
  session = T.recordTiebreak(session, { id: 'cash-tie', picks: { p2: 0, p3: 1 }, order: [0, 1], completedAt });
  assert.deepEqual(T.coffeeStatus(session).contributions, [
    { playerId: 'p3', amount: 60000, position: 'last' },
    { playerId: 'p2', amount: 40000, position: 'penultimate' }
  ]);
  assert.deepEqual(T.selectionOrder(session, 'tie'), ['p2', 'p3']);
  assert.deepEqual(T.standings(session), totals);
  assert.deepEqual(T.validateSession(JSON.parse(JSON.stringify(session))), session);
  const legacy = { ...session, version: 2, tiebreaks: [] };
  assert.equal(T.coffeeStatus(legacy).status, 'resolved');
  assert.deepEqual(T.validateSession(JSON.parse(JSON.stringify(legacy))), legacy);
});

test('version 3 all tied uses reverse extra-race places; unique last only ties for 40k', () => {
  let all = make(3, { version: 3, roundLimit: 3 });
  all = add(all, [0, 1, 2]); all = add(all, [1, 2, 0]); all = add(all, [2, 0, 1]);
  assert.equal(T.coffeeStatus(all).slots, 2);
  all = T.recordTiebreak(all, { id: 'all', picks: { p0: 0, p1: 1, p2: 2 }, order: [1, 0, 2], completedAt });
  assert.deepEqual(T.coffeeStatus(all).contributions.map(row => [row.playerId, row.amount]), [['p2', 60000], ['p0', 40000]]);
  let cutoff = make(4, { version: 3, roundLimit: 3 });
  cutoff = add(cutoff, [0, 1, 2, 3]); cutoff = add(cutoff, [1, 2, 0, 3]); cutoff = add(cutoff, [2, 0, 1, 3]);
  assert.deepEqual(T.coffeeStatus(cutoff), {
    status: 'tie', coffeeIds: ['p3'], tiedIds: ['p0', 'p1', 'p2'], slots: 1,
    contributions: [{ playerId: 'p3', amount: 60000, position: 'last' }]
  });
  assert.deepEqual(T.selectionOrder(cutoff, 'tie'), ['p1', 'p0', 'p2']);
  cutoff = T.recordTiebreak(cutoff, { id: 'cutoff', picks: { p0: 0, p1: 1, p2: 2 }, order: [2, 0, 1], completedAt });
  assert.deepEqual(T.coffeeStatus(cutoff).contributions.map(row => [row.playerId, row.amount]), [['p3', 60000], ['p1', 40000]]);
  assert.deepEqual(T.validateSession(JSON.parse(JSON.stringify(cutoff))), cutoff);
});

test('selection follows last round worst to best, not accumulated scores', () => {
  let session = make(4, { version: 3, roundLimit: 4 });
  assert.deepEqual(T.selectionOrder(session), ['p0', 'p1', 'p2', 'p3']);
  session = add(session, [0, 1, 2, 3]);
  session = add(session, [0, 1, 2, 3]);
  session = add(session, [3, 2, 1, 0]);
  assert.equal(T.standings(session)[0].playerId, 'p0');
  assert.deepEqual(T.selectionOrder(session), ['p0', 'p1', 'p2', 'p3']);
  assert.deepEqual(T.selectionState(session, 'regular', {}), { order: ['p0', 'p1', 'p2', 'p3'], nextPlayerId: 'p0', chosenCount: 0 });
  assert.equal(T.selectionState(session, 'regular', { p0: 3, p1: 1 }).nextPlayerId, 'p2');
  assert.equal(T.selectionState(session, 'regular', { p0: 3, p1: 1, p2: 0, p3: 2 }).nextPlayerId, null);
  for (const picks of [{ p1: 0 }, { p0: 0, p2: 1 }, { p0: 0, p1: 0 }, { p0: 4 }, { p9: 0 }]) assert.throws(() => T.selectionState(session, 'regular', picks));
  const legacy = { ...session, version: 2 };
  assert.equal(T.selectionState(legacy, 'regular', { p3: 0 }).nextPlayerId, 'p0');
  assert.throws(() => T.selectionOrder(session, 'invalid'));
});

// ---- Ngôi sao hy vọng (session version 4) ----
const people = count => Array.from({ length: count }, (_, i) => `Người ${i + 1}`);
const v4 = (count, extra = {}) => T.createSession({ names: people(count), date: '2026-11-04', ...extra });
const starRound = (session, order, stars, id = `r${session.rounds.length + 1}`) => T.recordRound(session, { id, picks: picksFor(session.players), order, completedAt, stars });

test('new sessions default to v4', () => {
  assert.equal(v4(3).version, 4);
  assert.throws(() => v4(3, { version: 5 }));
});

test('star doubles top-half points and never subtracts', () => {
  const s = starRound(v4(7), [0, 1, 2, 3, 4, 5, 6], ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  assert.deepEqual(s.rounds[0].entries.map(e => e.points), [14, 12, 10, 4, 3, 2, 1]);
  assert.ok(s.rounds[0].entries.every(e => e.star === true));
  const plain = starRound(v4(7), [0, 1, 2, 3, 4, 5, 6], []);
  assert.ok(plain.rounds[0].entries.every(e => !('star' in e)));
});

test('three players: only rank 1 doubles', () => {
  const s = starRound(v4(3), [0, 1, 2], ['p0', 'p1', 'p2']);
  assert.deepEqual(s.rounds[0].entries.map(e => e.points), [6, 2, 1]);
});

test('one star per player per day', () => {
  let s = v4(4);
  assert.equal(T.starAvailable(s, 'p0'), true);
  s = starRound(s, [0, 1, 2, 3], ['p0']);
  assert.equal(T.starAvailable(s, 'p0'), false);
  assert.equal(T.starAvailable(s, 'p1'), true);
  assert.throws(() => starRound(s, [0, 1, 2, 3], ['p0']), /sao/i);
  assert.throws(() => starRound(s, [0, 1, 2, 3], ['p1', 'p1']), /sao/i);
  assert.throws(() => starRound(s, [0, 1, 2, 3], ['p9']), /sao/i);
});

test('v3 session rejects stars and keeps old points', () => {
  const s = T.createSession({ version: 3, names: people(3), date: '2026-11-04' });
  assert.equal(T.starAvailable(s, 'p0'), false);
  assert.throws(() => starRound(s, [0, 1, 2], ['p0']), /sao/i);
  assert.deepEqual(starRound(s, [0, 1, 2], []).rounds[0].entries.map(e => e.points), [3, 2, 1]);
});

test('saved v4 session with stars round-trips through validateSession', () => {
  const s = starRound(starRound(v4(4), [0, 1, 2, 3], ['p1']), [3, 2, 1, 0], ['p3']);
  const saved = JSON.parse(JSON.stringify(s));
  assert.deepEqual(T.validateSession(saved), s);
  const badPoints = JSON.parse(JSON.stringify(s)); badPoints.rounds[0].entries[1].points = 3;
  assert.throws(() => T.validateSession(badPoints));
  const badFlag = JSON.parse(JSON.stringify(s)); badFlag.rounds[0].entries[1].star = 'yes';
  assert.throws(() => T.validateSession(badFlag));
  const twice = JSON.parse(JSON.stringify(s)); twice.rounds[1].entries.find(e => e.playerId === 'p1').star = true;
  assert.throws(() => T.validateSession(twice));
  const v3 = T.createSession({ version: 3, names: people(3), date: '2026-11-04' });
  const v3Saved = JSON.parse(JSON.stringify(starRound(v3, [0, 1, 2], []))); v3Saved.rounds[0].entries[0].star = true; v3Saved.rounds[0].entries[0].points = 6;
  assert.throws(() => T.validateSession(v3Saved));
});

test('tiebreak cannot carry stars', () => {
  const base = starRound(v4(4, { roundLimit: 2 }), [0, 1, 2, 3], []);
  const level = starRound(base, [1, 0, 3, 2], []);
  assert.equal(T.coffeeStatus(level).status, 'tie');
  const ids = T.coffeeStatus(level).tiedIds;
  const players = level.players.filter(p => ids.includes(p.id));
  const picks = Object.fromEntries(players.map((p, i) => [p.id, i]));
  const done = T.recordTiebreak(level, { id: 't1', picks, order: players.map((_, i) => i), completedAt, stars: [players[0].id] });
  assert.ok(done.tiebreaks[0].entries.every(e => !('star' in e)));
  const saved = JSON.parse(JSON.stringify(done)); saved.tiebreaks[0].entries[0].star = true;
  assert.throws(() => T.validateSession(saved));
});

test('stars change who pays, and doubled totals can force a tiebreak', () => {
  const r1 = [1, 0, 2, 3], r2 = [3, 2, 1, 0];
  const plain = starRound(starRound(v4(4, { roundLimit: 2 }), r1, []), r2, []);
  assert.deepEqual(T.standings(plain).map(r => [r.playerId, r.total]).sort(), [['p0', 4], ['p1', 6], ['p2', 5], ['p3', 5]]);
  assert.ok(T.coffeeStatus(plain).coffeeIds.includes('p0'));
  const starred = starRound(starRound(v4(4, { roundLimit: 2 }), r1, ['p0']), r2, []);
  assert.equal(T.standings(starred).find(r => r.playerId === 'p0').total, 7);
  const status = T.coffeeStatus(starred);
  assert.ok(!status.coffeeIds.includes('p0'));
  assert.equal(status.status, 'tie');
  assert.deepEqual([...status.tiedIds].sort(), ['p2', 'p3']);
});
