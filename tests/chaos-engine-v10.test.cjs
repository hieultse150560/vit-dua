'use strict';
// chaos-v10: chaos-v9 without the speed camera. chaos-v9 races (camera included) still rebuild with chaos-v9.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../dist/chaos-engine-v2.js');
const V9 = E.v9, V10 = E.v10;
const names = count => Array.from({ length: count }, (_, i) => `V${i}`);
const D = 55;

test('chaos-v10 is chaos-v9 without the speed camera', () => {
  assert.equal(V10.version, 'chaos-v10');
  assert.deepEqual(V10.skills, V9.skills.filter(s => s.id !== 'camera'));
  assert.deepEqual(V10.tuning, V9.tuning);
  assert.deepEqual(V10.targeted, V9.targeted);
  for (let seed = 0; seed < 300; seed++) assert.ok(!V10.deal(8, seed).skills.includes('camera'), `seed ${seed}`);
  assert.throws(() => V10.createRace(names(4), D, 1, { ...V10.deal(4, 1), skills: ['camera', 'pho', 'pho', 'pho'] }), /skill không hợp lệ: camera/);
  // a chaos-v9 race with the camera still plays it
  const lineup = { ...V9.deal(4, 3), skills: ['camera', 'pho', 'pho', 'pho'], casts: [10, 12, null, null], pilots: Array(4).fill(true), dodges: Array(4).fill(null), answers: Array(4).fill(null), riddles: Array(4).fill(null) };
  assert.equal(V9.createRace(names(4), D, 3, lineup).events.find(e => e.type === 'skill' && e.actorId === 1).outcome, 'confiscated');
});

test('balance at 55 s: every skill holder wins 0.7–1.3 × 1/7, and tier S is only a little ahead of tier C', () => {
  const stats = {};
  for (let seed = 0; seed < 6000; seed++) for (const r of V10.createRace(names(7), D, seed, V10.deal(7, seed * 7919)).results) {
    const row = stats[r.skill.id] ??= { tier: r.skill.tier, held: 0, wins: 0 };
    row.held++; if (r.rank === 1) row.wins++;
  }
  const win = s => s.wins / s.held * 7, table = '\n' + Object.entries(stats).map(([id, s]) => `${s.tier} ${id.padEnd(11)} ${win(s).toFixed(2)}× (n=${s.held})`).join('\n');
  for (const s of Object.values(stats)) assert.ok(win(s) >= 0.7 && win(s) <= 1.3, table);
  assert.equal(stats.camera, undefined);
  const tier = t => { const rows = Object.values(stats).filter(s => s.tier === t); return rows.reduce((sum, s) => sum + win(s), 0) / rows.length; };
  assert.ok(tier('S') - tier('C') < 0.18, `S ${tier('S')} C ${tier('C')}${table}`);
});
