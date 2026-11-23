'use strict';
// Duck looks from duck-art.js: SVG ducks by default, the bitmap atlas as the 'classic' option.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Art = require('../dist/duck-art.js');

const CLASSIC = [
  '--duck-x:0%;--duck-y:0%', '--duck-x:33.333333333333336%;--duck-y:0%', '--duck-x:66.66666666666667%;--duck-y:0%', '--duck-x:100%;--duck-y:0%',
  '--duck-x:0%;--duck-y:100%', '--duck-x:33.333333333333336%;--duck-y:100%', '--duck-x:66.66666666666667%;--duck-y:100%', '--duck-x:100%;--duck-y:100%'
].map(style => `<span class="duck-sprite" aria-hidden="true" style="${style}"></span>`);

const look = html => {
  const svg = html.match(/<svg class="ds ds-(\w+)"/);
  const body = html.match(/<radialGradient id="\w+b"[^>]*><stop offset="0" stop-color="[^"]+"\/><stop offset="\.5" stop-color="([^"]+)"/);
  return { accessory: svg && svg[1], color: body && body[1] };
};

test('names and colours keep their identities', () => {
  assert.deepEqual(Array.from({ length: 10 }, (_, i) => Art.name(i)),
    ['Vịt Vàng', 'Vịt Hồng', 'Vịt Xanh', 'Vịt Tím', 'Vịt Cam', 'Vịt Mint', 'Vịt Đào', 'Vịt Mây', 'Vịt Vàng 2', 'Vịt Hồng 2']);
  assert.equal(Art.name(17), 'Vịt Hồng 3');
  assert.equal(Art.colors.length, 8);
});

test('the new look is the default and draws a well-formed SVG duck for ids 0-15', () => {
  assert.equal(Art.style(), 'new', 'default without a saved choice');
  for (let id = 0; id < 16; id++) {
    const html = Art.svg(id);
    assert.match(html, /^<span class="duck-sprite duck-skin" aria-hidden="true" style="--ds-blink:-?\d+\.\d\ds"><svg [^>]*viewBox="0 0 100 100"/, `id ${id}`);
    assert.ok(html.endsWith('</svg></span>'), `id ${id} closes`);
    for (const tag of ['g', 'defs', 'svg', 'pattern', 'linearGradient', 'radialGradient']) {
      const open = (html.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length;
      const close = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
      assert.equal(open, close, `id ${id}: <${tag}> balanced`);
    }
    const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map(m => m[1]));
    for (const [, ref] of html.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.has(ref), `id ${id}: url(#${ref}) is defined`);
    for (const part of ['ds-open', 'ds-shut', 'ds-dizzy', 'ds-brow', 'ds-wing', 'ds-sweat', 'ds-spark', 'ds-speed', 'ds-ice']) {
      assert.ok(html.includes(`class="${part}"`), `id ${id} has ${part}`);
    }
    assert.doesNotMatch(html, /undefined|NaN/, `id ${id}`);
  }
});

test('each of the 8 ducks has its own colour and accessory; ids 8-15 swap the accessory', () => {
  const first = Array.from({ length: 8 }, (_, id) => look(Art.svg(id)));
  assert.deepEqual(first.map(l => l.color), Art.colors);
  assert.equal(new Set(first.map(l => l.accessory)).size, 8);
  for (let id = 8; id < 16; id++) {
    const second = look(Art.svg(id));
    assert.equal(second.color, first[id % 8].color, `id ${id} keeps the colour`);
    assert.notEqual(second.accessory, first[id % 8].accessory, `id ${id} wears something else`);
  }
});

test('gradient ids never clash between two ducks on the same page', () => {
  const ids = [Art.svg(3), Art.svg(3)].map(html => [...html.matchAll(/ id="([^"]+)"/g)].map(m => m[1]));
  assert.equal(ids[0].filter(id => ids[1].includes(id)).length, 0);
});

test('classic mode returns the original atlas markup, and the choice can be switched back', () => {
  assert.equal(Art.setStyle('classic'), 'classic');
  assert.equal(Art.style(), 'classic');
  for (let id = 0; id < 16; id++) assert.equal(Art.svg(id), CLASSIC[id % 8], `id ${id}`);
  assert.equal(Art.svg(-3), CLASSIC[0]);
  assert.equal(Art.setStyle('anything else'), 'new');
  assert.match(Art.svg(0), /duck-skin/);
});
