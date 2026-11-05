import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadGame } from './harness.mjs';

const require = createRequire(import.meta.url);
const T = require('../dist/tournament.js');
const S = require('../dist/seasons.js');
const A = require('../dist/duck-art.js');
const V2 = require('../dist/chaos-engine-v2.js');
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
    game.advance(45000, 50);
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
    game.click('pause'); game.advance(45000, 50);
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

// A do-anything Web Audio stand-in: every property and call returns another stand-in.
function fakeAudio(window) {
  const any = () => new Proxy(function () {}, {
    get: (target, key) => key === 'then' ? undefined : key === 'state' ? 'running' : key === 'currentTime' ? 0 : key === 'sampleRate' ? 48000 : any(),
    apply: () => any(), construct: () => any(), set: () => true
  });
  window.__audio = any();
  window.AudioContext = function () { return window.__audio; };
}
// ---- chaos-v2 twist banner and visuals ----
function v2Fixture(seed, elapsed) {
  const source = fixture(elapsed);
  source.sessions[1].active = { id: 'v2-race', seed, engine: 'chaos-v2', elapsed, countdownLeft: 0 };
  return source;
}
const twists = race => race.events.filter(e => e.type === 'skill' || e.type === 'hazard');
// A twist with no other twist 0.35 s before or 2 s after it, so its banner and slow motion are alone.
function loneTwist(seed, after) {
  const race = V2.createRace(names.map((_, id) => A.name(id)), 25, seed), all = twists(race);
  const e = all.find(t => t.time > after + 0.5 && t.time + 2 < 25 && !all.some(o => o !== t && o.time > t.time - 0.35 && o.time <= t.time + 2));
  return { race, e };
}

// Earlier twists play in slow motion, so step until this twist's banner is on screen.
function advanceToTwist(game, e) {
  const banner = game.$('twist-banner'), seen = () => !banner.hidden && banner.textContent.includes(e.label) && banner.textContent.includes(names[e.actorId]);
  for (let i = 0; i < 1200 && !seen(); i++) game.advance(50, 50);
  assert.ok(seen(), `twist at ${e.time} never showed`);
}

test('twist banner shows owner name and label, then hides on race clock', async () => {
  const { e } = loneTwist(4242, 4);
  assert.ok(e, 'seed has a lone twist');
  const game = loadGame({ [KEY]: JSON.stringify(v2Fixture(4242, 4)) });
  try {
    assert.equal(game.$('twist-banner').hidden, true);
    game.click('resume-overlay'); advanceToTwist(game, e);
    const banner = game.$('twist-banner');
    assert.equal(banner.hidden, false);
    assert.ok(banner.textContent.includes(names[e.actorId]), banner.textContent);
    assert.ok(banner.textContent.includes(e.label), banner.textContent);
    game.advance(2500, 50); // 1.4 s slow motion (0.28 race-s) + 1.1 s normal > 1.2 race-s banner
    assert.equal(banner.hidden, true);
    assert.deepEqual(game.errors.map(String), []);
  } finally { await game.close(); }
});

test('pause freezes the banner; F5 does not replay past banners', async () => {
  const { e } = loneTwist(777, 4);
  assert.ok(e, 'seed has a lone twist');
  const game = loadGame({ [KEY]: JSON.stringify(v2Fixture(777, 4)) }); let restored;
  try {
    game.click('resume-overlay'); advanceToTwist(game, e);
    assert.equal(game.$('twist-banner').hidden, false);
    game.click('pause'); game.advance(5000, 50);
    assert.equal(game.$('twist-banner').hidden, false, 'banner waits on the race clock while paused');
    restored = loadGame(game.storage());
    assert.equal(restored.$('twist-banner').hidden, true, 'restore does not replay a past banner');
    restored.click('resume-overlay'); restored.advance(100, 50);
    assert.equal(restored.$('twist-banner').hidden, true);
    assert.deepEqual(game.errors.map(String), []); assert.deepEqual(restored.errors.map(String), []);
  } finally { await game.close(); if (restored) await restored.close(); }
});

test('every v2 event kind maps to a visual burst without throwing', async () => {
  const fakeContext = `
    globalThis.__drawn = []; globalThis.__calls = [];
    const fake = new Proxy({}, { get(target, key) {
      if (key in target) return target[key];
      if (key === 'fillText') return text => __drawn.push(String(text));
      if (key === 'measureText') return () => ({ width: 10 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => { __calls.push(key); return { addColorStop() {} }; };
      return () => { __calls.push(key); };
    }, set(target, key, value) { target[key] = value; return true; } });
    HTMLCanvasElement.prototype.getContext = () => fake;`;
  const game = loadGame({ [KEY]: JSON.stringify(v2Fixture(4242, 4)) }, { beforeScripts(window) { window.eval(fakeContext); } });
  try {
    const doc = game.window.document, race = V2.createRace(names.map((_, id) => A.name(id)), 25, 4242), sample = race.sample(10);
    const visuals = game.window.DuckRaceVisuals.create({ container: doc.querySelector('.race-water'), river: game.$('river'), nodes: [...doc.querySelectorAll('.racer')], reduced: () => false, seed: 1 });
    const cases = [
      ['skill', 'wings', 'fly', '🪽'], ['skill', 'torpedo', 'hit', '💣'], ['skill', 'wave', 'hit', '🌊'], ['skill', 'rocket', 'boost', '🚀'],
      ['skill', 'rocket', 'exploded', '💥'], ['skill', 'mirror', 'reflected', '🪞'], ['skill', 'mirror', 'fallback', '🪞'], ['skill', 'hook', 'hit', '🎣'],
      ['skill', 'tornado', 'shuffled', '🌪️'], ['skill', 'banana', 'dropped', '🍌'], ['skill', 'banana', 'hit', '🍌'], ['skill', 'buoy', 'blocked', '🛟'],
      ['hazard', 'rock', 'hit', '🪨'], ['hazard', 'croc', 'hit', '🐊'], ['hazard', 'wind', 'boost', '💨'], ['hazard', 'whirlpool', 'hit', '🌀'], ['hazard', 'dolphin', 'boost', '🐬']
    ];
    cases.forEach(([type, id, outcome, icon], index) => {
      game.window.__drawn.length = 0; game.window.__calls.length = 0;
      const event = { id: `event-${index}`, time: 10, type, [type === 'skill' ? 'skill' : 'hazard']: id, outcome, actorId: 0, targetId: 1, affectedIds: [1, 2, 3], icon };
      visuals.event(event, sample, 10);
      visuals.draw(sample, 10.2); visuals.draw(sample, 10.6);
      assert.ok(game.window.__drawn.includes(icon), `${id}/${outcome} drew ${JSON.stringify(game.window.__drawn)}`);
      if (id === 'mirror') assert.ok(game.window.__calls.includes('createLinearGradient') && game.window.__calls.includes('lineTo'), 'mirror draws a glassy pane and a light beam');
      if (['torpedo', 'rock'].includes(id) || outcome === 'exploded') assert.ok(game.window.__calls.filter(c => c === 'arc').length >= 10, `${id} throws up a water splash`);
    });
    assert.deepEqual(game.errors.map(String), []);
  } finally { await game.close(); }
});

test('twists play in slow motion, then the race clock returns to normal speed', async () => {
  const { e } = loneTwist(4242, 4);
  const game = loadGame({ [KEY]: JSON.stringify(v2Fixture(4242, 4)) });
  const elapsedNow = () => { game.click('pause'); const value = current(game).active.elapsed; game.click('pause'); return value; };
  try {
    game.click('resume-overlay'); advanceToTwist(game, e);
    assert.ok(game.$('twist-banner').hidden === false, 'twist reached');
    assert.ok(game.window.document.querySelector('.race-water').classList.contains('slowmo'));
    assert.ok(game.window.document.querySelectorAll('.racer.twist-focus').length >= 1, 'affected duck is spotlighted');
    const start = elapsedNow();
    game.advance(500, 50);
    const slow = elapsedNow() - start;
    assert.ok(slow > 0.07 && slow < 0.13, `slow motion (0.2x) advanced ${slow} race-s in 0.5 s`);
    game.advance(700, 50);
    assert.ok(game.window.document.querySelector('.race-water').classList.contains('slowmo'), 'slow motion still on at 1.2 s');
    game.advance(400, 50);
    assert.equal(game.window.document.querySelector('.race-water').classList.contains('slowmo'), false);
    assert.equal(game.window.document.querySelectorAll('.racer.twist-focus').length, 0);
    const mid = elapsedNow();
    game.advance(500, 50);
    const normal = elapsedNow() - mid;
    assert.ok(normal > 0.45 && normal < 0.55, `normal speed advanced ${normal} race-s in 0.5 s`);
    assert.deepEqual(game.errors.map(String), []);
  } finally { await game.close(); }
});

test('pausing during slow motion keeps the rest of the slow motion for after resume', async () => {
  const { e } = loneTwist(4242, 4);
  const game = loadGame({ [KEY]: JSON.stringify(v2Fixture(4242, 4)) });
  try {
    game.click('resume-overlay'); advanceToTwist(game, e);
    game.click('pause'); const before = current(game).active.elapsed;
    game.advance(5000, 50);
    game.click('pause'); game.advance(300, 50);
    game.click('pause'); const gained = current(game).active.elapsed - before;
    assert.ok(gained > 0.04 && gained < 0.15, `after a long pause, 0.3 s of play advanced ${gained} race-s`);
    assert.ok(game.window.document.querySelector('.race-water').classList.contains('slowmo'));
    assert.deepEqual(game.errors.map(String), []);
  } finally { await game.close(); }
});

test('commentator captions each twist and speaks Vietnamese when sound is on', async () => {
  const { e } = loneTwist(4242, 4);
  const game = loadGame({ [KEY]: JSON.stringify(v2Fixture(4242, 4)) }, { beforeScripts(window) {
    window.__spoken = [];
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak: u => window.__spoken.push({ text: u.text, lang: u.lang }), cancel() {}, getVoices: () => [] } });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(text) { this.text = text; } } });
    fakeAudio(window);
  } });
  try {
    game.click('sound');
    game.click('resume-overlay'); advanceToTwist(game, e);
    const caption = game.$('commentary');
    assert.equal(caption.hidden, false);
    assert.ok(caption.textContent.includes(names[e.actorId]), caption.textContent);
    const spoken = game.window.__spoken.at(-1);
    assert.equal(spoken.text, caption.textContent.replace(/^🎙️\s*/, ''));
    assert.equal(spoken.lang, 'vi-VN');
    game.click('sound');
    const count = game.window.__spoken.length;
    game.advance(6000, 50);
    assert.equal(game.window.__spoken.length, count, 'muted: captions only, no voice');
    assert.deepEqual(game.errors.map(String), []);
  } finally { await game.close(); }
});

test('twists play their synthesized sound effect when sound is on', async () => {
  const { e } = loneTwist(4242, 4);
  const real = require('../dist/sound-fx.js');
  // Load the real module, then wrap play() to record which sound each twist asked for.
  const spy = readFileSync(new URL('../dist/sound-fx.js', import.meta.url), 'utf8')
    + `;globalThis.__sfx = []; globalThis.DuckSfx = { ...globalThis.DuckSfx, play: (ctx, kind) => __sfx.push(kind) };`;
  const game = loadGame({ [KEY]: JSON.stringify(v2Fixture(4242, 4)) }, { scripts: { 'sound-fx.js': spy }, beforeScripts: fakeAudio });
  try {
    game.click('sound');
    game.click('resume-overlay'); advanceToTwist(game, e);
    assert.equal(game.window.__sfx.at(-1), real.kindOf(e));
    assert.deepEqual(game.errors.map(String), []);
  } finally { await game.close(); }
});

test('slow motion zooms the camera onto the twist, then zooms back out', async () => {
  const { e } = loneTwist(4242, 4);
  const game = loadGame({ [KEY]: JSON.stringify(v2Fixture(4242, 4)) });
  try {
    const water = game.window.document.querySelector('.race-water');
    game.click('resume-overlay'); advanceToTwist(game, e);
    assert.ok(water.classList.contains('zoom'));
    assert.match(water.style.getPropertyValue('--zx'), /px$/);
    assert.match(water.style.getPropertyValue('--zy'), /px$/);
    game.advance(2000, 50);
    assert.equal(water.classList.contains('zoom'), false);
    assert.deepEqual(game.errors.map(String), []);
  } finally { await game.close(); }
});

test('a close finish plays the last moments slowly and shows a photo-finish card; a clear win does not', async () => {
  for (const [seed, close] of [[11, true], [3, false]]) {
    const source = v2Fixture(seed, 20);
    source.sessions[1].active.engine = 'chaos-v3';
    const order = V2.v3.createRace(names.map((_, id) => A.name(id)), 25, seed).results;
    const game = loadGame({ [KEY]: JSON.stringify(source) });
    try {
      const water = game.window.document.querySelector('.race-water');
      game.click('resume-overlay');
      let sawPhoto = false;
      for (let i = 0; i < 1600 && current(game).active; i++) { game.advance(50, 50); sawPhoto ||= water.classList.contains('photo-finish'); }
      assert.equal(sawPhoto, close, `seed ${seed}`);
      const card = game.$('result-content').querySelector('.photo-finish-card');
      assert.equal(!!card, close, `seed ${seed} card`);
      if (close) assert.ok(card.textContent.includes(names[order[0].id]) && card.textContent.includes(names[order[1].id]), card.textContent);
      assert.deepEqual(game.errors.map(String), []);
    } finally { await game.close(); }
  }
});

test('ducks pull faces: dizzy when knocked over', async () => {
  let seed = 1, e;
  for (; seed < 400 && !e; seed++) {
    const race = V2.createRace(names.map((_, id) => A.name(id)), 25, seed), all = twists(race);
    e = all.find(t => t.skill === 'torpedo' && t.outcome === 'hit' && t.time > 5 && t.time < 20 && !all.some(o => o !== t && Math.abs(o.time - t.time) < 2.5));
  }
  seed--;
  const game = loadGame({ [KEY]: JSON.stringify(v2Fixture(seed, 4)) });
  try {
    game.click('resume-overlay'); advanceToTwist(game, e);
    game.advance(200, 50);
    const racers = game.window.document.querySelectorAll('.racer');
    assert.equal(racers[e.targetId].querySelector('.racer-emote').textContent, '😵');
    assert.equal(racers[e.actorId].querySelector('.racer-emote').textContent === '😵', false);
    game.advance(45000, 50);
    assert.deepEqual(game.errors.map(String), []);
  } finally { await game.close(); }
});
