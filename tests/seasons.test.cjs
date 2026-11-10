const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../dist/tournament.js');
const S = require('../dist/seasons.js');

const names = ['Phú', 'Hiếu', 'An'];
const makeSeason = extra => S.createSeason({ name: 'Mùa vui', names, date: '2026-11-04', ...extra });
const picks = { p0: 0, p1: 1, p2: 2 };
function makeDay(date, order = [0, 1, 2], extra = {}) {
  let day = T.createSession({ names, date, roundLimit: 1, version: 3, ...extra });
  if (order) day = T.recordRound(day, { id: `${date}-r1`, picks, order, completedAt: `${date}T10:00:00.000Z` });
  return day;
}

test('season accumulates resolved daily contributions exactly once and preserves roster totals', () => {
  const season = makeSeason();
  const days = [makeDay('2026-11-04', [0, 1, 2]), makeDay('2026-11-05', [2, 0, 1]), makeDay('2026-11-06', [1, 2, 0])];
  const result = S.summary(season, days);
  assert.equal(result.daysComplete, 3);
  assert.equal(result.assessed, 300000);
  assert.equal(result.paid, 0);
  assert.equal(result.outstanding, 300000);
  assert.equal(result.items.length, 6);
  assert.deepEqual(result.rows.map(row => [row.name, row.daysPlayed, row.lastCount, row.penultimateCount, row.assessed]), [
    ['Phú', 3, 1, 1, 100000], ['Hiếu', 3, 1, 1, 100000], ['An', 3, 1, 1, 100000]
  ]);
  assert.deepEqual(S.summary(season, [...days].reverse()), result);
  assert.deepEqual(S.validateSeason(JSON.parse(JSON.stringify(season)), days), season);
  assert.throws(() => S.summary(season, [days[0], days[0]]), /một lần/);
  const duplicateDate = makeDay('2026-11-04', [1, 0, 2]);
  assert.throws(() => S.summary(season, [days[0], duplicateDate]), /một lần/);
});

test('pending days and unresolved tiebreaks do not charge even fixed contributors early', () => {
  const season = makeSeason();
  const complete = makeDay('2026-11-04');
  const pending = makeDay('2026-11-05', null);
  assert.equal(S.summary(season, [complete, pending]).assessed, 100000);
  assert.equal(S.summary(season, [complete, pending]).rows[0].daysPlayed, 1);

  let tied = T.createSession({ names, date: '2026-11-05', roundLimit: 3, version: 3 });
  for (const [index, order] of [[0, [0, 1, 2]], [1, [1, 2, 0]], [2, [2, 0, 1]]]) {
    tied = T.recordRound(tied, { id: `tie-r${index}`, picks, order, completedAt: '2026-11-05T10:00:00.000Z' });
  }
  assert.equal(T.coffeeStatus(tied).status, 'tie');
  assert.equal(S.summary(season, [complete, tied]).assessed, 100000);
  assert.throws(() => S.closeSeason(season, [complete, tied]));
  tied = T.recordTiebreak(tied, { id: 'tie-final', picks, order: [0, 1, 2], completedAt: '2026-11-05T10:01:00.000Z' });
  assert.equal(S.summary(season, [complete, tied]).assessed, 200000);

  const fourNames = [...names, 'Bình'];
  const fourSeason = S.createSeason({ names: fourNames, date: '2026-11-04' });
  let fixedLast = T.createSession({ names: fourNames, date: '2026-11-04', roundLimit: 3, version: 3 });
  for (const [index, order] of [[0, [0, 1, 2, 3]], [1, [1, 2, 0, 3]], [2, [2, 0, 1, 3]]]) {
    fixedLast = T.recordRound(fixedLast, { id: `fixed-r${index}`, picks: { ...picks, p3: 3 }, order, completedAt: '2026-11-04T10:00:00.000Z' });
  }
  assert.equal(T.coffeeStatus(fixedLast).contributions[0].amount, 60000);
  assert.equal(S.summary(fourSeason, [fixedLast]).assessed, 0, 'a known last-place payer is not booked before the whole day resolves');
});

test('paid receipts are separate, reversible and immutable with no automatic collection', () => {
  const season = makeSeason();
  const days = [makeDay('2026-11-04')];
  const key = S.summary(season, days).items.find(item => item.amount === 60000).key;
  const paid = S.markPaid(season, days, key, true);
  assert.deepEqual(season.receipts, {});
  assert.equal(S.summary(paid, days).paid, 60000);
  assert.equal(S.summary(paid, days).outstanding, 40000);
  assert.deepEqual(S.markPaid(paid, days, key, true), paid);
  const unpaid = S.markPaid(paid, days, key, false);
  assert.equal(S.summary(unpaid, days).paid, 0);
  assert.equal(paid.receipts[key], true);
  assert.throws(() => S.markPaid(season, days, 'missing:p0', true));
  assert.throws(() => S.markPaid(season, days, key, 60000));
});

test('manual close requires completed days, keeps archive data, and permits later collection', () => {
  const season = makeSeason();
  assert.throws(() => S.closeSeason(season, []));
  assert.throws(() => S.closeSeason(season, [makeDay('2026-11-04', null)]));
  const days = [makeDay('2026-11-04')];
  const closed = S.closeSeason(season, days, '2026-11-04T11:00:00.000Z');
  assert.equal(season.closedAt, null);
  assert.equal(closed.closedAt, '2026-11-04T11:00:00.000Z');
  assert.deepEqual(S.closeSeason(closed, days), closed);
  const key = S.summary(closed, days).items[0].key;
  const paid = S.markPaid(closed, days, key, true);
  assert.equal(paid.closedAt, closed.closedAt);
  assert.equal(S.summary(paid, days).paid, 60000);
  assert.deepEqual(S.validateSeason(JSON.parse(JSON.stringify(paid)), days), paid);
});

test('season restore rejects altered receipts, foreign rosters, old rules and invalid day progression', () => {
  const season = makeSeason();
  const day = makeDay('2026-11-04');
  const copy = value => JSON.parse(JSON.stringify(value));
  let corrupt = copy(season); corrupt.receipts['not-a-day:p0'] = true;
  assert.throws(() => S.validateSeason(corrupt, [day]));
  corrupt = copy(season); corrupt.receipts[`${day.id}:p2`] = 60000;
  assert.throws(() => S.validateSeason(corrupt, [day]));
  corrupt = copy(season); corrupt.players[0].id = 'someone-else';
  assert.throws(() => S.validateSeason(corrupt, [day]));
  corrupt = copy(season); corrupt.closedAt = '2026-02-30T10:00:00.000Z';
  assert.throws(() => S.validateSeason(corrupt, [day]));
  const wrongRoster = makeDay('2026-11-04', [0, 1, 2], { names: ['Phú', 'Hiếu', 'Bình'] });
  assert.throws(() => S.summary(season, [wrongRoster]));
  assert.throws(() => S.summary(season, [makeDay('2026-11-03')]));
  assert.throws(() => S.summary(season, [makeDay('2026-11-04', null), makeDay('2026-11-05')]));
  assert.throws(() => S.summary(season, [makeDay('2026-11-04', null), makeDay('2026-11-05', null)]));
  const old = T.createSession({ names, date: '2026-11-04', version: 2 });
  assert.throws(() => S.summary(season, [old]));
});

test('season setup and names follow the validated roster contract', () => {
  assert.equal(S.createSeason({ names, date: '2026-11-04' }).name, 'Mùa giải 04/11/2026');
  assert.throws(() => makeSeason({ names: ['Phú', 'phú', 'An'] }));
  assert.throws(() => makeSeason({ names: ['Phú', 'An'] }));
  assert.throws(() => makeSeason({ date: '2026-02-30' }));
  assert.throws(() => makeSeason({ name: 'x'.repeat(81) }));
});

test('season accepts v4 and v5 days alongside v3 days and keeps fund math', () => {
  const season = makeSeason();
  const v3 = makeDay('2026-11-04', [0, 1, 2]);
  let v4 = T.createSession({ names, date: '2026-11-05', roundLimit: 1, version: 4 });
  v4 = T.recordRound(v4, { id: '2026-11-05-r1', picks, order: [2, 0, 1], completedAt: '2026-11-05T10:00:00.000Z', stars: ['p2'] });
  let v5 = T.createSession({ names, date: '2026-11-06', roundLimit: 1 });
  v5 = T.recordRound(v5, { id: '2026-11-06-r1', picks, order: [2, 0, 1], completedAt: '2026-11-06T10:00:00.000Z', stars: ['p0'] });
  assert.equal(v4.version, 4); assert.equal(v5.version, 5);
  const result = S.summary(season, [v3, v4, v5]);
  assert.equal(result.daysComplete, 3);
  assert.equal(result.assessed, 300000);
  assert.deepEqual(S.validateSeason(JSON.parse(JSON.stringify(season)), [v3, v4, v5]), season);
});
