'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const K = require('../dist/commentary.js');
const V3 = require('../dist/chaos-engine-v2.js').v3;
const players = ['Phú', 'An', 'Bình', 'Chi', 'Dũng', 'Hà', 'Lan'];
const nameOf = id => players[id];
const races = Array.from({ length: 300 }, (_, seed) => V3.createRace(players, 25, seed));
const twists = races.flatMap(r => r.events.filter(e => e.type === 'skill' || e.type === 'hazard'));

test('every twist gets a Vietnamese line naming who did it and who got hit', () => {
  const kinds = new Set();
  for (const e of twists) {
    const text = K.line(e, nameOf);
    kinds.add(`${e.skill || e.hazard}:${e.outcome}`);
    assert.ok(text && !text.includes('{') && !text.includes('undefined'), text);
    assert.ok(text.includes(players[e.actorId]), `${e.skill || e.hazard}/${e.outcome}: ${text}`);
    if (Number.isInteger(e.targetId) && e.targetId !== e.actorId) assert.ok(text.includes(players[e.targetId]), `${e.skill}/${e.outcome}: ${text}`);
  }
  assert.ok(kinds.size >= 25, `covered ${kinds.size} kinds`);
});

test('lines are deterministic per event but varied across events', () => {
  const hits = twists.filter(e => e.skill === 'torpedo' && e.outcome === 'hit');
  for (const e of hits.slice(0, 20)) assert.equal(K.line(e, nameOf), K.line(e, nameOf));
  assert.ok(new Set(hits.map(e => K.line(e, n => `#${n}`))).size >= 3, 'torpedo hits use several phrasings');
});

test('race start mentions the weather and the finish names the winner', () => {
  const race = races.find(r => r.weather.id === 'storm');
  assert.ok(K.start(race).includes(race.weather.name));
  assert.ok(K.start({}).length > 0, 'races without weather still get an opener');
  assert.ok(K.finish('Phú', 'An', false).includes('Phú'));
  const close = K.finish('Phú', 'An', true);
  assert.ok(close.includes('Phú') && close.includes('An') && /sát nút/i.test(close), close);
});

test('new chaos-v3 skills and the finale rock get their own lines, not the generic one', () => {
  const generic = ['tung chiêu', 'ra tay!'];
  for (const e of twists.filter(e => ['magnet', 'lightning', 'flip', 'rewind', 'reverse', 'freeze', 'missile', 'bees', 'blackhole', 'ghost', 'balloon', 'bomb', 'dice', 'lullaby', 'hex', 'giant'].includes(e.skill) && e.activation && e.outcome !== 'blocked' && e.outcome !== 'none' || e.finale)) {
    const text = K.line(e, nameOf);
    assert.ok(!generic.some(g => text.includes(g)), `${e.skill || 'finale'}/${e.outcome}: ${text}`);
  }
  const finale = twists.find(e => e.finale);
  assert.ok(/vạch đích|về nhất|chiến thắng/i.test(K.line(finale, nameOf)));
});
