'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../dist/sound-fx.js');
const V3 = require('../dist/chaos-engine-v2.js').v3;
const names = Array.from({ length: 7 }, (_, i) => `V${i}`);

// Minimal Web Audio stand-in that records which nodes a sound builds.
function fakeContext() {
  const made = [];
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = type => { made.push(type); return { type, frequency: param(), gain: param(), Q: param(), detune: param(), connect() {}, disconnect() {}, start() {}, stop() {}, buffer: null, onended: null }; };
  return {
    made, currentTime: 0, sampleRate: 48000, destination: {},
    createOscillator: () => node('osc'), createGain: () => node('gain'), createBiquadFilter: () => node('filter'), createBufferSource: () => node('noise'),
    createBuffer: (channels, length) => ({ getChannelData: () => new Float32Array(length) })
  };
}

test('every chaos-v3 twist maps to a known sound; old v1 events do not', () => {
  const seen = new Set();
  for (let seed = 0; seed < 200; seed++) {
    for (const e of V3.createRace(names, 25, seed).events.filter(e => e.type === 'skill' || e.type === 'hazard')) {
      const kind = F.kindOf(e);
      assert.ok(F.kinds.includes(kind), `${e.skill || e.hazard}/${e.outcome} → ${kind}`);
      seen.add(kind);
    }
  }
  assert.ok(seen.size >= 10, `only ${seen.size} distinct sounds used`);
  assert.equal(F.kindOf({ type: 'skill', skill: 'turbo', outcome: 'boost' }), null);
  assert.equal(F.kindOf({ type: 'rune-pickup', rune: 'speed' }), null);
});

test('each sound builds real audio nodes and never throws', () => {
  for (const kind of F.kinds) {
    const ctx = fakeContext();
    F.play(ctx, kind);
    assert.ok(ctx.made.length >= 2, `${kind} built ${ctx.made.join(',')}`);
  }
  assert.doesNotThrow(() => F.play(null, 'boom'));
  assert.doesNotThrow(() => F.play(fakeContext(), 'nope'));
});

test('river ambience loops until stopped; cheer is a known sound', () => {
  assert.ok(F.kinds.includes('cheer'));
  const ctx = fakeContext();
  const stop = F.ambience(ctx);
  assert.equal(typeof stop, 'function');
  assert.ok(ctx.made.includes('noise'));
  assert.doesNotThrow(stop);
  assert.doesNotThrow(() => F.ambience(null)());
});
