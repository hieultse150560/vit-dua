import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadGame } from './harness.mjs';

const require = createRequire(import.meta.url);
const T = require('../dist/tournament.js');
const S = require('../dist/seasons.js');
const KEY = 'vit-dua-seasons-v3';
const names = ['Phú "active": 0', 'Hiếu \\ quạc', 'An <vịt>', 'Bình', 'Chi', 'Dũng', 'Hà'];
const plain = value => JSON.parse(JSON.stringify(value));
const state = game => JSON.parse(game.storage()[KEY]);
const current = game => { const s = state(game); return s.sessions.find(e => e.session.id === s.currentId); };

function fixture(elapsed = 8.25) {
  const season = S.createSeason({ name: 'Mùa "active" \\ kết quả', names, date: '2026-11-03' });
  const picks = Object.fromEntries(names.map((_, i) => [`p${i}`, i]));
  let older = T.createSession({ names, date: '2026-11-03', duration: 25, roundLimit: 1 });
  older = T.recordRound(older, { id: 'old-round', picks, order: names.map((_, i) => i), completedAt: '2026-11-03T05:00:00.000Z' });
  const session = T.createSession({ names, date: '2026-11-04', duration: 25, roundLimit: 2 });
  return { version: 3, currentId: session.id, currentSeasonId: season.id, seasons: [season], sessions: [
    { seasonId: season.id, session: older, type: 'regular', stage: 'complete', picks, active: null, raceReplays: [] },
    { seasonId: season.id, session, type: 'regular', stage: 'picking', picks, active: { id: 'visual-race', seed: 118, engine: 'chaos-v1', elapsed, countdownLeft: 0 }, raceReplays: [] }
  ] };
}

const visualSpy = `
globalThis.__visualCalls = [];
globalThis.DuckRaceVisuals = {
  create(options) {
    __visualCalls.push({kind:'create', seed:options.seed, count:options.nodes.length});
    return {
      resize(){ __visualCalls.push({kind:'resize'}); },
      draw(sample, elapsed, state){ __visualCalls.push({kind:'draw',elapsed,running:state.running}); },
      event(event, sample, elapsed){ __visualCalls.push({kind:'event',id:event.id,time:event.time,elapsed}); },
      destroy(){ __visualCalls.push({kind:'destroy'}); }
    };
  },
  celebrate(){ __visualCalls.push({kind:'celebrate'}); }
};`;

test('fast checkpoints preserve prior days and quoted names while updating only active timing; next race invalidates cache', async () => {
  const source = fixture(), game = loadGame({ [KEY]: JSON.stringify(source) }); let restored;
  try {
    const before = state(game);
    game.click('resume-overlay'); game.advance(1000, 50);
    const after = state(game), beforeActive = before.sessions[1].active, afterActive = after.sessions[1].active;
    assert.ok(afterActive.elapsed > beforeActive.elapsed);
    assert.equal(afterActive.seed, beforeActive.seed);
    const normalized = plain(after); normalized.sessions[1].active = beforeActive;
    assert.deepEqual(normalized, before, 'only this active timing may change during a periodic checkpoint');
    assert.deepEqual(after.sessions[0], source.sessions[0]);
    assert.deepEqual(after.seasons, source.seasons);
    restored = loadGame(game.storage());
    assert.deepEqual(current(restored).active, afterActive);
    assert.deepEqual(current(restored).session.players.map(p => p.name), names);
    game.advance(30000, 50);
    assert.equal(current(game).active, null);
    assert.equal(current(game).session.rounds.length, 1);
    game.click('result-next');
    for (let i = 0; i < names.length; i++) {
      const nextCard = [...game.$('duck-grid').querySelectorAll('button')].find(b => !b.disabled);
      assert.ok(nextCard); nextCard.click();
    }
    game.click('start');
    assert.ok(current(game).active, `next race must start: ${game.$('toast').textContent}`);
    game.advance(3600, 50);
    const next = current(game);
    assert.notEqual(next.active.id, beforeActive.id);
    assert.ok(next.active.elapsed > 0 && next.active.elapsed < 1, `new checkpoint elapsed was ${next.active.elapsed}`);
    assert.equal(next.session.rounds.length, 1);
    assert.deepEqual(state(game).sessions[0], source.sessions[0], 'a new active cache must not splice into an old day');
    assert.deepEqual(game.errors.map(String), []);
    assert.deepEqual(restored.errors.map(String), []);
  } finally { await game.close(); if (restored) await restored.close(); }
});

test('visual lifecycle skips restored old bursts, freezes while paused, emits new events, and destroys on finish', async () => {
  const game = loadGame({ [KEY]: JSON.stringify(fixture()) }, { scripts: { 'race-visuals.js': visualSpy } });
  try {
    const calls = () => plain(game.window.__visualCalls);
    assert.equal(calls().filter(c => c.kind === 'create').length, 1);
    assert.equal(calls().filter(c => c.kind === 'event').length, 0, 'restoration must not replay past transient effects');
    const beforeResume = calls().filter(c => c.kind === 'draw').length;
    game.advance(1000, 50);
    assert.equal(calls().filter(c => c.kind === 'draw').length, beforeResume, 'paused restore must not keep a render loop');
    game.click('resume-overlay'); game.advance(4000, 50);
    const events = calls().filter(c => c.kind === 'event');
    assert.ok(events.length > 0);
    assert.ok(events.every(c => c.time > 8.25 && c.time <= c.elapsed && c.elapsed - c.time < .3 + 1e-8));
    assert.equal(new Set(events.map(c => c.id)).size, events.length);
    game.click('pause');
    const pausedCount = calls().filter(c => c.kind === 'draw').length;
    game.advance(2000, 50);
    assert.equal(calls().filter(c => c.kind === 'draw').length, pausedCount);
    game.click('pause'); game.advance(30000, 50);
    assert.ok(calls().some(c => c.kind === 'destroy'));
    assert.equal(current(game).session.rounds.length, 1);
    assert.equal(game.raf.size, 0, 'no racing RAF may remain after finishing');
    assert.deepEqual(game.errors.map(String), []);
  } finally { await game.close(); }
});

test('missing 2D canvas context does not prevent exact physics, finishing or scores', async () => {
  const game = loadGame({ [KEY]: JSON.stringify(fixture(22)) }, { beforeScripts(window) { window.HTMLCanvasElement.prototype.getContext = () => null; } });
  try {
    assert.equal(game.$('resume-overlay').hidden, false);
    game.click('resume-overlay'); game.advance(5000, 50);
    const e = current(game);
    assert.equal(e.session.rounds.length, 1);
    assert.deepEqual(e.session.rounds[0].entries.map(p => p.points), [7, 6, 5, 4, 3, 2, 1]);
    assert.deepEqual(game.errors.map(String), []);
  } finally { await game.close(); }
});
