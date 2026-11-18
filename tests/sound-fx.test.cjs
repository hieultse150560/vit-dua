'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../dist/sound-fx.js');
const { v3: V3, v4: V4, v5: V5 } = require('../dist/chaos-engine-v2.js');
const names = Array.from({ length: 7 }, (_, i) => `V${i}`);

// Minimal Web Audio stand-in that records which nodes a sound builds, when they start and what they connect to.
function fakeContext({ compressor = false } = {}) {
  const made = [], starts = [];
  const param = () => { const calls = []; return { value: 0, calls, setValueAtTime(v, t) { calls.push(['set', v, t]); }, linearRampToValueAtTime(v, t) { calls.push(['linear', v, t]); }, exponentialRampToValueAtTime(v, t) { calls.push(['exp', v, t]); } }; };
  const node = type => { const n = { type, frequency: param(), gain: param(), Q: param(), detune: param(), threshold: undefined, outputs: [], disconnected: false,
    connect(target) { n.outputs.push(target); }, disconnect() { n.disconnected = true; }, start(t) { starts.push(t); }, stop() {}, buffer: null, onended: null }; made.push(n); return n; };
  const ctx = {
    made, starts, currentTime: 0, sampleRate: 48000, destination: { type: 'destination' },
    createOscillator: () => node('osc'), createGain: () => node('gain'), createBiquadFilter: () => node('filter'), createBufferSource: () => node('noise'),
    createBuffer: (channels, length) => ({ getChannelData: () => new Float32Array(length) })
  };
  if (compressor) ctx.createDynamicsCompressor = () => Object.assign(node('compressor'), { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() });
  return ctx;
}
const twists = race => race.events.filter(e => e.type === 'skill' || e.type === 'hazard' || e.type === 'obstacle');
// A chaos-v5 race room (casts on): its lanes have obstacles and runes.
const roomRace = seed => V5.createRace(names, 40, seed, { ...V5.deal(names.length, seed), casts: Array(names.length).fill(null), pilots: Array(names.length).fill(false), dodges: Array(names.length).fill(null) });

test('every chaos-v3 and chaos-v4 twist and obstacle maps to known sounds; old v1 events do not', () => {
  const seen = new Set();
  for (let seed = 0; seed < 200; seed++) {
    for (const e of [V3.createRace(names, 25, seed), V4.createRace(names, 40, seed), ...(seed < 40 ? [roomRace(seed)] : [])].flatMap(twists)) {
      const kind = F.kindOf(e), cues = F.cues(e);
      if (e.rune && e.outcome === 'missed') { assert.deepEqual(cues, [], 'a rune that floats by makes no sound'); continue; }
      assert.ok(F.kinds.includes(kind), `${e.skill || e.hazard || e.obstacle}/${e.outcome} → ${kind}`);
      assert.equal(cues[0][0], kind, 'the first cue is the event\'s own sound');
      for (const [k, m] of cues) { assert.ok(F.kinds.includes(k), k); assert.ok(m >= 0 && m <= 2.5, `${k} at ${m}`); } // past 1: after the slow motion
      seen.add(kind);
    }
  }
  assert.ok(seen.size >= 40, `only ${seen.size} distinct sounds used`);
  for (const k of ['hop', 'dive', 'bonk', 'sparkle']) assert.ok(seen.has(k), `obstacles and runes use ${k}`);
  assert.equal(F.kindOf({ type: 'skill', skill: 'turbo', outcome: 'boost' }), null);
  assert.equal(F.kindOf({ type: 'rune-pickup', rune: 'speed' }), null);
});

test('skills that used to share a sound each have their own', () => {
  const cast = (skill, outcome) => F.kindOf({ type: 'skill', skill, outcome });
  const own = [cast('magnet', 'pull'), cast('bomb', 'armed'), cast('flip', 'swapped'), cast('rewind', 'rewound'), cast('reverse', 'hit'), cast('buoy', 'fallback'),
    cast('banana', 'dropped'), cast('dice', 'roll'), cast('rocket', 'boost'), cast('torpedo', 'hit'), cast('hook', 'hit'), cast('swap', 'swapped')];
  assert.equal(new Set(own).size, own.length, own.join(','));
  assert.equal(cast('buoy', 'blocked'), 'boing');
  assert.deepEqual(F.cues({ type: 'skill', skill: 'wheel', outcome: 'jackpot' }).map(c => c[0]), ['wheel', 'jackpot']);
  assert.deepEqual(F.cues({ type: 'skill', skill: 'wheel', outcome: 'bust' }).map(c => c[0]), ['wheel', 'splash']);
  assert.deepEqual(F.cues({ type: 'skill', skill: 'whale', outcome: 'fly' }).map(c => c[0]), ['spout', 'splash'], 'the whale landing splashes');
});

test('cues land with the painters\' hits: one per impact, staggered', () => {
  assert.deepEqual(F.cues({ type: 'skill', skill: 'torpedo', outcome: 'hit' }), [['whistle', 0], ['boom', .45]]);
  const meteor = F.cues({ type: 'skill', skill: 'meteor', outcome: 'hit', affectedIds: [4, 2, 6], outcomes: { 4: 'hit', 2: 'blocked', 6: 'hit' } });
  assert.deepEqual(meteor.map(c => c[0]), ['meteor', 'boom', 'boom'], 'a guarded duck gets no boom');
  assert.deepEqual(meteor.slice(1).map(c => +c[1].toFixed(2)), [.45, .63]);
  const giant = F.cues({ type: 'skill', skill: 'giant', outcome: 'giant', affectedIds: [1, 2, 3] });
  assert.deepEqual(giant.slice(1).map(c => [c[0], +c[1].toFixed(2)]), [['thud', .2], ['thud', .3], ['thud', .4]]);
  assert.deepEqual(F.cues({ type: 'skill', skill: 'dice', outcome: 'roll', roll: 6 })[1], ['ding', .44]);
  assert.deepEqual(F.cues({ type: 'skill', skill: 'dice', outcome: 'bust', roll: 1 }).map(c => c[0]), ['rattle', 'sad', 'splash']);
  assert.deepEqual(F.cues({ type: 'skill', skill: 'copycat', copied: 'freeze', outcome: 'frozen' }), F.cues({ type: 'skill', skill: 'freeze', outcome: 'frozen' }));
  assert.deepEqual(F.cues({ type: 'skill', skill: 'torpedo', outcome: 'reflected' }), [['ding', 0]]);
  assert.deepEqual(F.cues({ type: 'hazard', hazard: 'rock', outcome: 'hit' }), [['splash', .3]]);
});

test('chaos-v4 skills each sound different; the rain cloud\'s bolt cracks the moment it strikes', () => {
  const ten = ['pho', 'coffee', 'cash', 'net', 'kite', 'cloud', 'hourglass', 'loudspeaker', 'portal', 'xeom'];
  assert.ok(ten.every(id => V4.skills.some(s => s.id === id)), 'the engine still has these skills');
  const cast = ten.map(skill => F.kindOf({ type: 'skill', skill, outcome: 'hit', activation: true }));
  assert.equal(new Set(cast).size, ten.length, cast.join(','));
  assert.deepEqual(F.cues({ type: 'skill', skill: 'cloud', outcome: 'hit', activation: true }), [['rain', 0]]);
  assert.deepEqual(F.cues({ type: 'skill', skill: 'cloud', icon: '⚡', outcome: 'struck' }), [['thunder', 0], ['splash', .2]]);
  assert.deepEqual(F.cues({ type: 'skill', skill: 'cloud', icon: '⚡', outcome: 'immune' }), [['pop', 0]]);
  assert.deepEqual(F.cues({ type: 'skill', skill: 'copycat', copied: 'hourglass', outcome: 'frozen' }), [['timestop', 0], ['gong', .3]]);
  assert.deepEqual(F.cues({ type: 'skill', skill: 'pho', outcome: 'eat' }), [['slurp', 0], ['whoosh', 2.2]], 'it speeds off once it has eaten (0.6 race-s)');
  const ob = (key, outcome) => F.kindOf({ type: 'obstacle', obstacle: 'log', key, outcome });
  assert.deepEqual([ob('up', 'dodged'), ob('down', 'lucky'), ob('up', 'hit'), ob('down', 'immune')], ['hop', 'dive', 'bonk', 'pop']);
  // The struck event really comes from the engine, after the cloud's 4 s.
  const struck = Array.from({ length: 300 }, (_, s) => V4.createRace(names, 40, s + 1).events.find(e => e.skill === 'cloud' && e.outcome === 'struck')).find(Boolean);
  assert.ok(struck && !struck.activation, 'a closing bolt event');
  assert.equal(F.kindOf(struck), 'thunder');
});

test('each sound builds real audio nodes and never throws', () => {
  for (const kind of F.kinds) {
    const ctx = fakeContext();
    F.play(ctx, kind);
    assert.ok(ctx.made.length >= 3, `${kind} built ${ctx.made.map(n => n.type).join(',')}`);
  }
  assert.doesNotThrow(() => F.play(null, 'boom'));
  assert.doesNotThrow(() => F.play(fakeContext(), 'nope'));
});

test('play(delay) starts the sound later on the audio clock', () => {
  const now = fakeContext(); now.currentTime = 5; F.play(now, 'boom');
  assert.equal(Math.min(...now.starts), 5);
  const later = fakeContext(); later.currentTime = 5; F.play(later, 'boom', 1.5);
  assert.equal(Math.min(...later.starts), 6.5);
  const bad = fakeContext(); bad.currentTime = 5; F.play(bad, 'pop', -2); F.play(bad, 'pop', NaN);
  assert.deepEqual(bad.starts, [5, 5]);
});

test('sounds go through a compressor; cancel() fades queued sounds out and later sounds get a fresh bus', () => {
  const ctx = fakeContext({ compressor: true });
  F.play(ctx, 'boom', 2);
  const comp = ctx.made.find(n => n.type === 'compressor');
  assert.ok(comp && comp.outputs.includes(ctx.destination), 'compressor feeds the speakers');
  const bus = ctx.made.find(n => n.type === 'gain' && n.outputs.includes(comp));
  assert.ok(ctx.made.filter(n => n.type === 'gain' && n !== bus).every(g => g.outputs.includes(bus)), 'every voice goes through the bus');
  ctx.currentTime = 1; F.cancel(ctx);
  assert.deepEqual(bus.gain.calls.at(-1).slice(0, 2), ['linear', 0.0001], 'the bus fades to silence');
  F.play(ctx, 'pop');
  const fresh = ctx.made.filter(n => n.type === 'gain' && n.outputs.includes(comp));
  assert.equal(fresh.length, 2, 'a new bus after cancel');
  assert.equal(ctx.made.filter(n => n.type === 'compressor').length, 1, 'one compressor per context');
  assert.doesNotThrow(() => { F.cancel(null); F.cancel(fakeContext()); });
});

test('river ambience loops until stopped; cheer is a known sound', () => {
  assert.ok(F.kinds.includes('cheer'));
  const ctx = fakeContext();
  const stop = F.ambience(ctx);
  assert.equal(typeof stop, 'function');
  assert.ok(ctx.made.some(n => n.type === 'noise'));
  assert.doesNotThrow(stop);
  assert.doesNotThrow(() => F.ambience(null)());
});
