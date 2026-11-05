'use strict';
// Monte Carlo balance gate for chaos-v2. Fixed seeds keep it reproducible; on
// failure the message prints the per-skill table used to retune `tuning`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../dist/chaos-engine-v2.js');
const names = count => Array.from({ length: count }, (_, i) => `Vịt ${i + 1}`);
const D = 25;

function skillTable(count, races, engine = E) {
  const stats = Object.fromEntries(E.skills.map(s => [s.id, { held: 0, wins: 0, top3: 0 }]));
  for (let seed = 0; seed < races; seed++) {
    for (const r of engine.createRace(names(count), D, seed).results) {
      const row = stats[r.skill.id];
      row.held++;
      if (r.rank === 1) row.wins++;
      if (r.rank <= 3) row.top3++;
    }
  }
  return stats;
}
const format = (stats, count) => '\n' + Object.entries(stats).map(([id, s]) =>
  `${id.padEnd(8)} win ${(s.wins / s.held * count).toFixed(2)}×  top3 ${(s.top3 / s.held * count / Math.min(3, count)).toFixed(2)}×  (n=${s.held})`).join('\n');

test('7 ducks × 25 s: each skill holder wins 0.7–1.3 × 1/7 and reaches top 3 at 0.7–1.3 × 3/7', () => {
  const stats = skillTable(7, 5000), table = format(stats, 7);
  for (const s of Object.values(stats)) {
    const win = s.wins / s.held * 7, top3 = s.top3 / s.held * 7 / 3;
    assert.ok(win >= 0.7 && win <= 1.3 && top3 >= 0.7 && top3 <= 1.3, table);
  }
});

test('3 and 15 ducks: no skill above 1.5× or below 0.5× average win rate', () => {
  for (const count of [3, 15]) {
    const stats = skillTable(count, 2000), table = `${count} ducks` + format(stats, count);
    for (const s of Object.values(stats)) {
      if (s.held < 200) continue;
      const win = s.wins / s.held * count;
      assert.ok(win >= 0.5 && win <= 1.5, table);
    }
  }
});

test('comebacks and busy races at 7 ducks × 25 s', () => {
  let lateLeaderWins = 0, midLeaderWins = 0, phases = 0, leadChanges = 0;
  const RACES = 5000;
  for (let seed = 0; seed < RACES; seed++) {
    const race = E.createRace(names(7), D, seed), winner = race.results[0].id;
    const leaderAt = t => race.sample(t).find(d => d.currentRank === 1).id;
    if (leaderAt(D - 3) === winner) lateLeaderWins++;
    if (leaderAt(D / 2) === winner) midLeaderWins++;
    phases += race.events.filter(e => e.scheduled).length;
    let previous = leaderAt(0.25);
    for (let t = 0.5; t <= D; t += 0.25) { const now = leaderAt(t); if (now !== previous) leadChanges++; previous = now; }
  }
  const report = `late ${(lateLeaderWins / RACES).toFixed(3)} mid ${(midLeaderWins / RACES).toFixed(3)} phases ${(phases / RACES).toFixed(2)} leadChanges ${(leadChanges / RACES).toFixed(2)}`;
  assert.ok(lateLeaderWins / RACES <= 0.5, report);
  assert.ok(midLeaderWins / RACES <= 0.35, report);
  assert.ok(phases / RACES >= 8, report);
  assert.ok(leadChanges / RACES >= 3, report);
});

test('chaos-v3 (weather) 7 ducks × 25 s: each skill holder wins 0.7–1.3 × 1/7', () => {
  const stats = skillTable(7, 5000, E.v3), table = format(stats, 7);
  for (const s of Object.values(stats)) {
    const win = s.wins / s.held * 7;
    assert.ok(win >= 0.7 && win <= 1.3, table);
  }
});
