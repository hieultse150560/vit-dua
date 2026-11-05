'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const W = require('../dist/awards.js');
const V3 = require('../dist/chaos-engine-v2.js').v3;

// A hand-made race: duck ranks 3 s before the end, then final ranks, plus a few events.
function race(lateRanks, finalRanks, events) {
  return {
    duration: 25, events,
    results: finalRanks.map((rank, id) => ({ id, rank })).sort((a, b) => a.rank - b.rank),
    sample: t => lateRanks.map((rank, id) => ({ id, currentRank: t >= 25 ? finalRanks[id] : rank, rank: finalRanks[id] }))
  };
}
const owners = { 0: 'p0', 1: 'p1', 2: 'p2', 3: 'p3' };
const byId = awards => Object.fromEntries(awards.map(a => [a.id, a]));

test('four titles go to the right players from what happened on the river', () => {
  const r1 = race([1, 2, 4, 3], [2, 3, 1, 4], [
    { type: 'skill', skill: 'torpedo', actorId: 0, targetId: 1, outcome: 'hit' },
    { type: 'hazard', hazard: 'rock', actorId: 1, outcome: 'hit' },
    { type: 'skill', skill: 'buoy', actorId: 2, outcome: 'blocked', activation: true },
    { type: 'skill', skill: 'swap', actorId: 3, targetId: 0, outcome: 'swapped', before: { 3: 5, 0: 9 }, after: { 3: 9, 0: 5 } }
  ]);
  const r2 = race([1, 2, 3, 4], [1, 2, 3, 4], [
    { type: 'skill', skill: 'wave', actorId: 0, affectedIds: [1, 2, 3], outcomes: { 1: 'hit', 2: 'blocked', 3: 'hit' }, outcome: 'hit' },
    { type: 'skill', skill: 'mirror', actorId: 2, targetId: 3, outcome: 'reflected', effect: 'hit', activation: true }
  ]);
  const awards = byId(W.compute([{ race: r1, ownerOf: owners }, { race: r2, ownerOf: owners }]));
  assert.deepEqual(awards.comeback.playerIds, ['p2']);
  assert.equal(awards.comeback.value, 3);
  assert.deepEqual(awards.unlucky.playerIds, ['p1']);
  assert.equal(awards.unlucky.value, 3);
  assert.deepEqual(awards.dodger.playerIds, ['p2']);
  assert.equal(awards.dodger.value, 3);
  assert.deepEqual(awards.hitman.playerIds, ['p0']);
  assert.equal(awards.hitman.value, 3);
  for (const a of Object.values(awards)) assert.ok(a.icon && a.title && a.detail);
});

test('ties share a title and empty categories are left out', () => {
  const quiet = race([1, 2], [1, 2], [{ type: 'hazard', hazard: 'croc', actorId: 0, outcome: 'hit', before: { 0: 5 }, after: { 0: 4 } }, { type: 'hazard', hazard: 'croc', actorId: 1, outcome: 'hit', before: { 1: 5 }, after: { 1: 4 } }]);
  const awards = byId(W.compute([{ race: quiet, ownerOf: { 0: 'p0', 1: 'p1' } }]));
  assert.deepEqual(awards.unlucky.playerIds, ['p0', 'p1']);
  assert.equal(awards.comeback, undefined);
  assert.equal(awards.hitman, undefined);
  assert.deepEqual(W.compute([]), []);
});

test('works on real chaos-v3 races without throwing', () => {
  const rounds = Array.from({ length: 10 }, (_, seed) => ({ race: V3.createRace(['A', 'B', 'C', 'D', 'E', 'F', 'G'], 25, seed), ownerOf: { 0: 'p0', 1: 'p1', 2: 'p2', 3: 'p3', 4: 'p4', 5: 'p5', 6: 'p6' } }));
  const awards = W.compute(rounds);
  assert.ok(awards.length >= 3);
  for (const a of awards) assert.ok(a.value > 0 && a.playerIds.length >= 1);
});

test('lightning, reverse and freeze hits make victims; flip and rewind count ducks sent back', () => {
  const r = race([1, 2, 3, 4], [1, 2, 3, 4], [
    { type: 'skill', skill: 'lightning', actorId: 3, affectedIds: [0, 1], outcomes: { 0: 'hit', 1: 'hit' }, outcome: 'hit' },
    { type: 'skill', skill: 'freeze', actorId: 2, affectedIds: [0, 1, 3], outcomes: { 0: 'hit', 1: 'protected', 3: 'hit' }, outcome: 'frozen' },
    { type: 'skill', skill: 'flip', actorId: 2, affectedIds: [0, 3], outcome: 'swapped', before: { 0: 9, 3: 1 }, after: { 0: 1, 3: 9 } },
    { type: 'skill', skill: 'rewind', actorId: 1, affectedIds: [0, 2, 3], protectedIds: [], outcome: 'rewound', before: { 1: 5, 0: 8, 2: 6, 3: 9 }, after: { 1: 5, 0: 7, 2: 6, 3: 8 } }
  ]);
  const awards = byId(W.compute([{ race: r, ownerOf: owners }]));
  assert.deepEqual(awards.unlucky.playerIds, ['p0']);
  assert.equal(awards.unlucky.value, 4);
});
