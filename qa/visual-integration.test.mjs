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

// Minimal Web Audio stand-in: enough nodes for tones, synthesized effects and ambience.
function fakeAudio(window) {
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ frequency: param(), gain: param(), Q: param(), connect() {}, disconnect() {}, start() {}, stop() {}, buffer: null, loop: false, onended: null });
  window.AudioContext = class {
    constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 8000; this.destination = {}; }
    resume() { return Promise.resolve(); }
    createOscillator() { return node(); } createGain() { return node(); } createBiquadFilter() { return node(); } createBufferSource() { return node(); }
    createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
  };
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
    game.advance(3000, 50); // 1.8 s slow motion (0.27 race-s) + 1.2 s normal > 1.2 race-s banner
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
      ['hazard', 'rock', 'hit', '🪨'], ['hazard', 'croc', 'hit', '🐊'], ['hazard', 'wind', 'boost', '💨'], ['hazard', 'whirlpool', 'hit', '🌀'], ['hazard', 'dolphin', 'boost', '🐬'],
      ['skill', 'magnet', 'pull', '🧲'], ['skill', 'lightning', 'hit', '⚡'], ['skill', 'flip', 'swapped', '🔃'], ['skill', 'rewind', 'rewound', '⏪'],
      ['skill', 'reverse', 'hit', '↩️'], ['skill', 'freeze', 'frozen', '🧊'],
      ['skill', 'missile', 'hit', '🎯'], ['skill', 'bees', 'hit', '🐝'], ['skill', 'blackhole', 'pulled', '🕳️'], ['skill', 'ghost', 'ghost', '👻'],
      ['skill', 'balloon', 'hit', '🎈'], ['hazard', 'hippo', 'hit', '🦛'], ['hazard', 'log', 'hit', '🪵'], ['hazard', 'frog', 'boost', '🐸']
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
    assert.ok(slow > 0.05 && slow < 0.1, `slow motion (0.15x) advanced ${slow} race-s in 0.5 s`);
    game.advance(1100, 50);
    assert.ok(game.window.document.querySelector('.race-water').classList.contains('slowmo'), 'slow motion still on at 1.6 s');
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
    assert.ok(gained > 0.02 && gained < 0.1, `after a long pause, 0.3 s of play advanced ${gained} race-s`);
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
    game.click('resume-overlay'); advanceToTwist(game, e);
    const caption = game.$('commentary');
    assert.equal(caption.hidden, false);
    assert.equal(caption.closest('.race-water'), null, 'caption sits below the river, never over a duck');
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
  // Pick seeds from the live engine so rule tweaks never stale this test.
  const gapAt = seed => { const end = [...V2.v3.createRace(names.map((_, id) => A.name(id)), 25, seed).sample(25)].sort((x, y) => x.rank - y.rank); return 1 - end[1].progress; };
  const seeds = Array.from({ length: 300 }, (_, i) => i + 1);
  for (const [seed, close] of [[seeds.find(s => gapAt(s) < 0.012), true], [seeds.find(s => gapAt(s) > 0.05), false]]) {
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

test('effects canvas renders above screen resolution so the camera zoom stays sharp', async () => {
  const game = loadGame({ [KEY]: JSON.stringify(v2Fixture(4242, 4)) }, { beforeScripts(window) { window.devicePixelRatio = 1; window.eval(`HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => k in t ? t[k] : (k === 'createLinearGradient' || k === 'createRadialGradient') ? () => ({ addColorStop() {} }) : () => {}, set: (t, k, v) => { t[k] = v; return true; } });`); } });
  try {
    const canvas = game.window.document.querySelector('.race-effects');
    assert.ok(canvas, 'effects canvas exists');
    assert.ok(canvas.width >= 800 * 1.35 - 1, `canvas backing width ${canvas.width} for an 800px river`);
    assert.deepEqual(game.errors.map(String), []);
  } finally { await game.close(); }
});

test('sound is on by default and the choice is remembered', async () => {
  const game = loadGame(); let again;
  try {
    assert.equal(game.$('sound').getAttribute('aria-pressed'), 'true');
    game.click('sound');
    assert.equal(game.$('sound').getAttribute('aria-pressed'), 'false');
    again = loadGame(game.storage());
    assert.equal(again.$('sound').getAttribute('aria-pressed'), 'false');
    assert.deepEqual(game.errors.map(String), []); assert.deepEqual(again.errors.map(String), []);
  } finally { await game.close(); if (again) await again.close(); }
});

test('a river ambience plays while racing, pauses with the race, and the crowd cheers at the finish', async () => {
  const spy = readFileSync(new URL('../dist/sound-fx.js', import.meta.url), 'utf8')
    + `;globalThis.__sfx = []; globalThis.__amb = []; globalThis.DuckSfx = { ...globalThis.DuckSfx, play: (ctx, kind) => __sfx.push(kind), ambience: () => { __amb.push('start'); return () => __amb.push('stop'); } };`;
  const game = loadGame({ [KEY]: JSON.stringify(v2Fixture(4242, 20)) }, { scripts: { 'sound-fx.js': spy }, beforeScripts: fakeAudio });
  try {
    game.click('resume-overlay'); game.advance(300, 50);
    assert.deepEqual(plain(game.window.__amb), ['start']);
    game.click('pause');
    assert.deepEqual(plain(game.window.__amb), ['start', 'stop']);
    game.click('pause'); game.advance(45000, 50);
    assert.equal(game.window.__amb.at(-1), 'stop');
    assert.ok(game.window.__sfx.includes('cheer'), JSON.stringify(game.window.__sfx));
    assert.deepEqual(game.errors.map(String), []);
  } finally { await game.close(); }
});

test('ducks show the pose of what hit them: backwards, frozen, lifted, ghost', async () => {
  // [skill, pose, face, which duck]: the caster for ghost, a hit target otherwise.
  const cases = [['reverse', 'reversed', '😱'], ['freeze', 'frozen', '🥶'], ['balloon', 'lifted', '😨'], ['ghost', 'ghost', '😇']];
  const pick = skill => { for (let seed = 1; seed < 900; seed++) {
    const race = V2.v3.createRace(names.map((_, id) => A.name(id)), 25, seed), all = twists(race);
    const e = all.find(t => t.skill === skill && t.activation && t.time > 6 && t.time < 20 && !all.some(o => o !== t && Math.abs(o.time - t.time) < 0.9));
    if (!e) continue;
    const id = skill === 'ghost' ? e.actorId : e.affectedIds ? e.affectedIds.find(i => e.outcomes[i] === 'hit') : e.outcome === 'hit' ? e.targetId : undefined;
    if (id !== undefined && !race.sample(e.time - 0.05)[id].pose) return { seed, e, id };
  } };
  for (const [skill, pose, face] of cases) {
    const { seed, e, id } = pick(skill);
    const source = v2Fixture(seed, 4); source.sessions[1].active.engine = 'chaos-v3';
    const game = loadGame({ [KEY]: JSON.stringify(source) });
    try {
      game.click('resume-overlay'); advanceToTwist(game, e); game.advance(150, 50);
      const racer = game.window.document.querySelectorAll('.racer')[id];
      assert.ok(racer.classList.contains(pose), `${skill}: ${pose} class`);
      assert.equal(racer.querySelector('.racer-emote').textContent, face, skill);
      assert.deepEqual(game.errors.map(String), []);
    } finally { await game.close(); }
  }
});

test('fog hides the rankings until the last 5 seconds', async () => {
  let seed = 1;
  while (V2.v3.createRace(names.map((_, id) => A.name(id)), 25, seed).weather.id !== 'fog') seed++;
  const source = v2Fixture(seed, 8); source.sessions[1].active.engine = 'chaos-v3';
  const game = loadGame({ [KEY]: JSON.stringify(source) });
  try {
    const water = game.window.document.querySelector('.race-water');
    assert.ok(water.classList.contains('weather-fog'));
    game.click('resume-overlay'); game.advance(500, 50);
    assert.equal(water.classList.contains('fog-lifted'), false);
    for (let i = 0; i < 1200 && current(game).active && current(game).active.elapsed < 20.2; i++) game.advance(50, 50);
    assert.ok(water.classList.contains('fog-lifted'), 'fog lifts for the final sprint');
    assert.deepEqual(game.errors.map(String), []);
  } finally { await game.close(); }
});
