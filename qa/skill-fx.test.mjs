import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadGame } from './harness.mjs';

// Skill effects and sounds: banner colours, tier camera, S-tier intro, sounds on the hit, ✨ SIÊU CẤP, bomb hop, victim poses.
const require = createRequire(import.meta.url);
const T = require('../dist/tournament.js');
const S = require('../dist/seasons.js');
const A = require('../dist/duck-art.js');
const { v3: V3, v4: V4 } = require('../dist/chaos-engine-v2.js');
require('../dist/race-visuals.js');
const { golden } = globalThis.DuckRaceVisuals;
const KEY = 'vit-dua-seasons-v3';
const names = ['Phú', 'Hiếu', 'An', 'Bình', 'Chi', 'Dũng', 'Hà'];
const ducks = names.map((_, id) => A.name(id));
const tier = e => V3.skills.find(s => s.id === (e.copied || e.skill))?.tier;
const twists = race => race.events.filter(e => e.type === 'skill' || e.type === 'hazard');

// A chaos-v3 race restored paused at `elapsed`.
function saved(seed, elapsed) {
  const season = S.createSeason({ name: 'Mùa', names, date: '2026-11-03' });
  const session = T.createSession({ names, date: '2026-11-04', duration: 25, roundLimit: 2 });
  const picks = Object.fromEntries(names.map((_, i) => [`p${i}`, i]));
  return { [KEY]: JSON.stringify({ version: 3, currentId: session.id, currentSeasonId: season.id, seasons: [season], sessions: [
    { seasonId: season.id, session, type: 'regular', stage: 'picking', picks, active: { id: 'fx-race', seed, engine: 'chaos-v3', elapsed, countdownLeft: 0 }, raceReplays: [] }] }) };
}
// A cast twist with no other twist just before it or for 2.5 s after it.
function lone(pred) {
  for (let seed = 1; seed < 1500; seed++) {
    const race = V3.createRace(ducks, 25, seed), all = twists(race);
    const e = all.find(t => t.scheduled && t.time > 6 && t.time < 20 && pred(t, seed) && !all.some(o => o !== t && o.time > t.time - .35 && o.time <= t.time + 2.5));
    if (e) return { seed, e, race };
  }
  throw Error('no seed has such a twist');
}
function advanceToTwist(game, e) {
  const banner = game.$('twist-banner'), seen = () => !banner.hidden && banner.textContent.includes(e.label) && banner.textContent.includes(names[e.actorId]);
  for (let i = 0; i < 400 && !seen(); i++) game.advance(50, 50);
  assert.ok(seen(), `twist at ${e.time} never showed`);
}
const elapsedOf = game => { const s = JSON.parse(game.storage()[KEY]); return s.sessions.find(x => x.session.id === s.currentId).active.elapsed; };
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
// The real sound module, with play() and cancel() recorded as [kind, delay] / ['cancel'].
const sfxSpy = { scripts: { 'sound-fx.js': readFileSync(new URL('../dist/sound-fx.js', import.meta.url), 'utf8')
  + `;globalThis.__sfx = []; globalThis.DuckSfx = { ...globalThis.DuckSfx, play: (ctx, kind, delay = 0) => __sfx.push([kind, delay]), cancel: () => __sfx.push(['cancel']) };` }, beforeScripts: fakeAudio };
const reducedMotion = window => { window.matchMedia = query => ({ matches: /reduce/.test(query), media: query, addEventListener() {}, removeEventListener() {} }); };

test('banner colours: self-buffs green, tricks purple, a tornado red', async () => {
  for (const [skill, outcome, tone] of [['magnet', 'pull', 'boost'], ['ghost', 'ghost', 'boost'], ['lullaby', 'asleep', 'swap'], ['tornado', 'shuffled', 'harm']]) {
    const { seed, e } = lone((t, s) => t.skill === skill && t.outcome === outcome && !golden(s, t));
    const game = loadGame(saved(seed, e.time - .3));
    try {
      game.click('resume-overlay'); advanceToTwist(game, e);
      assert.ok(game.$('twist-banner').classList.contains(tone), `${skill}/${outcome}: ${game.$('twist-banner').className}`);
      assert.deepEqual(game.errors.map(String), []);
    } finally { await game.close(); }
  }
});

test('slow effects: S-tier skills get a soft zoom, a soft shake and a skill-name card; the slow motion keeps its length', async () => {
  const { seed, e } = lone((t, s) => tier(t) === 'S' && !golden(s, t));
  const game = loadGame(saved(seed, e.time - .3));
  try {
    game.click('resume-overlay'); advanceToTwist(game, e);
    const water = game.window.document.querySelector('.race-water'), card = water.querySelector('.s-intro');
    assert.ok(water.classList.contains('zoom'), 'soft zoom');
    assert.equal(water.style.getPropertyValue('--zoom'), '1.15');
    assert.ok(water.classList.contains('shake'), 'soft shake');
    assert.ok(Number(water.style.getPropertyValue('--shake')) < 1);
    assert.ok(card && card.textContent.includes(V3.skills.find(s => s.id === (e.copied || e.skill)).name.toUpperCase()), 'skill-name card');
    assert.ok(game.$('twist-banner').classList.contains('after-intro'), 'the banner waits for the card');
    const fx = parseFloat(game.window.document.documentElement.style.getPropertyValue('--fx-time'));
    game.click('pause'); const start = elapsedOf(game); game.click('pause');
    game.advance(500, 50);
    game.click('pause'); const slow = elapsedOf(game) - start; game.click('pause');
    assert.ok(Math.abs(slow - 0.27 * 0.5 / fx) < 0.012, `slow motion advanced ${slow} race-s in 0.5 s`);
    game.advance(1000, 50);
    assert.equal(water.querySelector('.s-intro'), null, 'the card goes away');
    assert.deepEqual(game.errors.map(String), []);
  } finally { await game.close(); }
});

test('slow effects: lower tiers keep the camera still; reduced motion never zooms or shakes', async () => {
  const low = lone((t, s) => ['B', 'C'].includes(tier(t)) && t.outcome === 'hit' && !golden(s, t));
  const big = lone((t, s) => tier(t) === 'S' && !golden(s, t));
  for (const [{ seed, e }, options] of [[low, {}], [big, { beforeScripts: reducedMotion }]]) {
    const game = loadGame(saved(seed, e.time - .3), options);
    try {
      game.click('resume-overlay'); advanceToTwist(game, e);
      const water = game.window.document.querySelector('.race-water');
      assert.equal(water.classList.contains('zoom'), false, `${e.skill}: no zoom`);
      assert.equal(water.classList.contains('shake'), false, `${e.skill}: no shake`);
      assert.deepEqual(game.errors.map(String), []);
    } finally { await game.close(); }
  }
});

test('sounds land with the hit: a torpedo booms when it lands in slow motion; pause cancels, resume queues it again', async () => {
  const { seed, e } = lone((t, s) => t.skill === 'torpedo' && t.outcome === 'hit' && !golden(s, t));
  const game = loadGame(saved(seed, e.time - .3), sfxSpy);
  try {
    game.click('resume-overlay'); advanceToTwist(game, e);
    game.click('pause');
    const fx = parseFloat(game.window.document.documentElement.style.getPropertyValue('--fx-time')), now = elapsedOf(game);
    const expected = (e.time + .45 * .27 - now) * fx / .27, sfx = () => game.window.__sfx.map(x => [...x]);
    const [whistle, boom] = ['whistle', 'boom'].map(k => sfx().find(([kind]) => kind === k));
    assert.ok(whistle && whistle[1] < .05, `the whistle starts at the throw: ${JSON.stringify(sfx())}`);
    assert.ok(boom && Math.abs(boom[1] - expected) < .02, `boom delay ${boom?.[1]} (expected ${expected})`);
    assert.ok(expected > .4, 'the hit is well after the throw in slow effects');
    assert.deepEqual(sfx().at(-1), ['cancel'], 'pausing cancels queued sounds');
    game.click('pause');
    const again = sfx().at(-1);
    assert.equal(again[0], 'boom', 'resume queues the boom again');
    assert.ok(Math.abs(again[1] - expected) < .02, `requeued boom delay ${again[1]}`);
    assert.deepEqual(game.errors.map(String), []);
  } finally { await game.close(); }
});

test('✨ SIÊU CẤP: deterministic, about 1 skill in 12, never a hazard', () => {
  let skills = 0, gold = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const race = V3.createRace(ducks, 25, seed), again = V3.createRace(ducks, 25, seed);
    race.events.forEach((e, i) => {
      if (e.type === 'hazard') assert.equal(golden(seed, e), false);
      if (e.type !== 'skill') return;
      skills++; if (golden(seed, e)) gold++;
      assert.equal(golden(seed, e), golden(seed, again.events[i]), 'a second screen computing the same race agrees');
    });
  }
  assert.ok(gold / skills > .05 && gold / skills < .12, `${gold}/${skills} golden`);
});

test('✨ SIÊU CẤP shows a golden banner and plays a sparkle; the race itself is unchanged', async () => {
  const { seed, e, race } = lone((t, s) => t.type === 'skill' && golden(s, t) && tier(t) !== 'S');
  const game = loadGame(saved(seed, e.time - .3), sfxSpy);
  try {
    game.click('resume-overlay'); advanceToTwist(game, e);
    const banner = game.$('twist-banner');
    assert.ok(banner.classList.contains('gold'), banner.className);
    assert.match(banner.textContent, /✨ ?SIÊU ?CẤP/);
    assert.ok(game.window.__sfx.some(([kind]) => kind === 'sparkle'));
    game.advance(100000, 50);
    const round = (() => { const s = JSON.parse(game.storage()[KEY]); return s.sessions.find(x => x.session.id === s.currentId).session.rounds[0]; })();
    assert.deepEqual(round.entries.map(x => x.duckId), race.results.map(r => r.id));
    assert.deepEqual(game.errors.map(String), []);
  } finally { await game.close(); }
});

test('the bomb ticks and flashes when it hops to a new leader', async () => {
  let found = null;
  for (let seed = 1; seed < 800 && !found; seed++) {
    const race = V3.createRace(ducks, 25, seed), armed = race.events.find(x => x.outcome === 'armed' && x.time > 4 && x.time < 20);
    if (!armed) continue;
    let last = -1;
    for (let t = armed.time + .05; t < armed.time + armed.fuse - .05 && !found; t += .02) {
      const holder = race.sample(t).findIndex(r => r.bomb);
      if (last >= 0 && holder >= 0 && holder !== last) found = { seed, armed };
      last = holder;
    }
  }
  assert.ok(found, 'a race where the bomb hops');
  const game = loadGame(saved(found.seed, found.armed.time - .3), sfxSpy);
  try {
    game.click('resume-overlay');
    let flashed = false;
    for (let i = 0; i < 400 && elapsedOf(game) < found.armed.time + found.armed.fuse; i++) {
      game.advance(50, 50); flashed ||= !!game.window.document.querySelector('.racer.bomb-hop');
      if (i % 20 === 0) { game.click('pause'); game.click('pause'); } // keeps the saved clock fresh
    }
    assert.ok(flashed, 'the new holder flashes');
    assert.ok(game.window.__sfx.filter(([kind]) => kind === 'tick').length >= 3, 'a tick on the hop and quicker ticks at the end');
    assert.deepEqual(game.errors.map(String), []);
  } finally { await game.close(); }
});

test('victims of a wave, a hook and a kraken move with the hit', async () => {
  for (const [skill, cls] of [['wave', 'tumbled'], ['hook', 'hooked'], ['kraken', 'dunked']]) {
    const { seed, e } = lone(t => t.skill === skill && (t.outcome === 'hit' || t.outcome === 'grabbed'));
    const victims = e.after ? Object.keys(e.after).filter(id => e.after[id] < e.before[id]).map(Number) : e.affectedIds.filter(id => e.outcomes[id] === 'hit');
    const game = loadGame(saved(seed, e.time - .3));
    try {
      game.click('resume-overlay'); advanceToTwist(game, e);
      const racers = game.window.document.querySelectorAll('.racer');
      assert.ok(victims.length && victims.every(id => racers[id].classList.contains(cls)), `${skill}: ${victims} ${cls}`);
      assert.deepEqual(game.errors.map(String), []);
    } finally { await game.close(); }
  }
});

// A canvas stand-in that records every call, and the text and icons drawn.
const fakeCanvas = `
  globalThis.__drawn = []; globalThis.__calls = [];
  const fake = new Proxy({}, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'fillText') return text => __drawn.push(String(text));
    if (key === 'measureText') return () => ({ width: 10 });
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => { __calls.push(key); return { addColorStop() {} }; };
    return () => { __calls.push(key); };
  }, set(target, key, value) { target[key] = value; return true; } });
  HTMLCanvasElement.prototype.getContext = () => fake;`;

test('chaos-v4 skills from real races paint their own scenes; a clouded duck carries a rain cloud; obstacles stay small', async () => {
  const game = loadGame(saved(1, 2), { beforeScripts(window) { window.eval(fakeCanvas); } });
  try {
    const w = game.window, doc = w.document, count = name => w.__calls.filter(c => c === name).length;
    const make = () => w.DuckRaceVisuals.create({ container: doc.querySelector('.race-water'), river: game.$('river'), nodes: [...doc.querySelectorAll('.racer')], reduced: () => false, seed: 1 });
    const ICON = { pho: '🍜', coffee: '☕', cash: '💸', net: '🕸️', kite: '🪁', cloud: '⛈️', hourglass: '⏳', loudspeaker: '📣', portal: '🌀', xeom: '🛵', bolt: '⚡' };
    const found = {};
    for (let seed = 1; seed < 400 && Object.keys(found).length < 11; seed++) {
      const race = V4.createRace(ducks, 40, seed);
      for (const e of race.events) {
        const k = e.skill === 'cloud' && !e.activation ? 'bolt' : e.skill;
        if (ICON[k] && !found[k] && ['eat', 'awake', 'hit', 'fly', 'frozen', 'startled', 'teleport', 'ride', 'struck'].includes(e.outcome)) found[k] = { race, e };
      }
    }
    assert.deepEqual(Object.keys(found).sort(), Object.keys(ICON).sort());
    const paint = (race, e) => {
      const visuals = make(); w.__drawn.length = 0; w.__calls.length = 0;
      visuals.event(e, race.sample(e.time), e.time, race.sample(Math.max(0, e.time - .05)));
      for (const dt of [.1, .4, .9]) visuals.draw(race.sample(e.time + dt), e.time + dt);
      visuals.destroy();
    };
    for (const [k, { race, e }] of Object.entries(found)) {
      paint(race, e);
      assert.ok(w.__drawn.includes(ICON[k]), `${k} drew ${JSON.stringify(w.__drawn)}`);
      assert.ok(count('fill') + count('stroke') > 20, `${k} paints a scene`);
    }
    // The closing bolt: a jagged two-layer streak on top of what a cloud that just fizzles out draws.
    paint(found.bolt.race, { ...found.bolt.e, outcome: 'immune' }); const fizzle = count('lineTo');
    paint(found.bolt.race, found.bolt.e);
    assert.ok(count('lineTo') >= fizzle + 14, `bolt lineTo ${count('lineTo')} vs ${fizzle}`);
    // The rain cloud rides its duck for the whole 4 s the sample says it is clouded, with no burst left.
    const { race, e } = found.cloud, mid = e.time + 2, visuals = make(), arcs = sample => { w.__calls.length = 0; visuals.draw(sample, mid + .2); return count('arc'); };
    assert.ok(race.sample(mid).some(r => r.clouded));
    const clear = arcs(race.sample(mid + .2).map(r => ({ ...r, clouded: false })));
    visuals.draw(race.sample(mid), mid);
    assert.ok(arcs(race.sample(mid + .2)) >= clear + 5, 'cloud puffs over the clouded duck');
    visuals.destroy();
    // Obstacles: a small splash or bubbles, never an icon (and no banner-sized impact).
    const room = V4.createRace(ducks, 40, 5, { ...V4.deal(7, 5), casts: Array(7).fill(null) }), obstacles = room.events.filter(x => x.type === 'obstacle'), quiet = make();
    assert.ok(obstacles.length > 5);
    for (const o of obstacles.slice(0, 8)) {
      w.__drawn.length = 0; quiet.event(o, room.sample(o.time), o.time); quiet.draw(room.sample(o.time + .2), o.time + .2);
      assert.deepEqual([...w.__drawn], [], `${o.obstacle}/${o.outcome} draws no icons`);
    }
    assert.deepEqual(game.errors.map(String), []);
  } finally { await game.close(); }
});
