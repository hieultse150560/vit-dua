'use strict';
// Lane things drawn by lane-art.js: the height of the drawing always matches the key (low things to jump over, high
// things to dive under), and each key's pool is drawn from.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Art = require('../dist/lane-art.js');
const { v6 } = require('../dist/chaos-engine-v2.js');

test('every obstacle is drawn at the height of its key, from its pool; runes keep their own look', () => {
  for (const kind of v6.obstacles) {
    const seen = new Set();
    for (let pick = 0; pick < 40; pick++) {
      const thing = Art.look(kind, pick);
      if (kind.rune) { assert.equal(thing.look, kind.rune === 'speed' ? 'spark' : 'pearl'); continue; }
      assert.equal(thing.tier, kind.key === 'up' ? 'low' : 'high', `${kind.id} ${pick}`);
      assert.ok(Art.pools[kind.key].some(p => p.look === thing.look));
      assert.ok(thing.name && thing.said && thing.icon && thing.chips, `${thing.look} has a name, a spoken name, an icon, a chip colour`);
      assert.deepEqual(Art.look(kind, pick), thing, 'the same pick draws the same thing');
      seen.add(thing.look);
    }
    if (!kind.rune) assert.equal(seen.size, Art.pools[kind.key].length, `${kind.id}: every drawing of its pool shows up`);
  }
});

test('each drawing is an SVG; high things and the floating rune cast a shadow, the pearl gets a ring on the water', () => {
  for (const look of Art.looks) {
    const html = Art.html(look);
    assert.match(html, /<svg class="thing-art"/);
    const high = Art.pools.down.some(p => p.look === look) || look === 'spark';
    assert.equal(html.includes('thing-shadow'), high, look);
    assert.equal(html.includes('thing-surface'), look === 'pearl', look);
  }
  for (const look of Art.looks) for (const [, id] of Art.html(look).matchAll(/url\(#([\w-]+)\)/g)) assert.ok(Art.defs.includes(`id="${id}"`), `${look} uses #${id}`);
});
