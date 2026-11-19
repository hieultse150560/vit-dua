(function (root) {
  'use strict';
  // Lane things (chaos-v5 race rooms) drawn as the real thing, with the height you can see: a rock sits in the water
  // (jump over it), a gull flies at head height with its shadow on the water (dive under it), the gold rune floats up
  // high (jump for it) and the pearl rune lies under the water (dive for it). A log draws as a rock and a low branch
  // as a gull: same key, so two shapes are enough.
  const L = 'stroke-linejoin="round" stroke-linecap="round"';
  const ART = {
    rock: `<svg class="thing-art" viewBox="0 0 80 56" width="80" height="56"><ellipse cx="40" cy="47" rx="38" ry="7" fill="#0f5a5a" opacity=".28"/><path d="M62 47C61 41 65 37 70 37C75 37 78 41 77 47Z" fill="url(#lt-rock)" stroke="#7a5c42" stroke-width="1.3" stroke-opacity=".7" ${L}/><path d="M8 47C6 34 12 20 25 14C33 9 46 8 56 13C67 18 74 30 73 47Z" fill="url(#lt-rock)" stroke="#7a5c42" stroke-width="1.4" stroke-opacity=".75" ${L}/><path d="M56 13C64 20 67 31 64 40C62 44 58 47 53 47H73C74 30 67 18 56 13Z" fill="#6e5038" opacity=".22"/><ellipse cx="35" cy="20" rx="11" ry="4.5" fill="#fff3dc" opacity=".5" transform="rotate(-12 35 20)"/><path d="M17 33C17 26 22 20 29 18" fill="none" stroke="#fff6e2" stroke-width="3.2" opacity=".65" ${L}/><path d="M4 47Q40 53 78 47" fill="none" stroke="#effffb" stroke-width="2.4" opacity=".9" ${L}/><path d="M1 51Q11 48 21 51T41 51T61 51T80 51" fill="none" stroke="#e8fffb" stroke-width="1.6" opacity=".55" ${L}/></svg>`,
    bird: `<svg class="thing-art" viewBox="0 0 80 54" width="92" height="62"><path class="wing" d="M38 30C42 18 52 8 66 4C64 12 58 22 47 33Z" fill="url(#lt-wing-far)" stroke="#55656e" stroke-width="1.3" ${L}/><path d="M52 33L68 28L66 40Z" fill="#e6ecef" stroke="#55656e" stroke-width="1.3" ${L}/><path d="M18 32C22 26 34 25 46 28C54 30 58 34 54 38C46 43 30 43 22 40C19 38 17 35 18 32Z" fill="url(#lt-bird)" stroke="#55656e" stroke-width="1.3" ${L}/><path d="M24 39C32 42 45 41 52 37" fill="none" stroke="#b9c5cc" stroke-width="2" opacity=".7" ${L}/><path d="M38 41l-3 4M43 41l-2 4" stroke="#ef8a2b" stroke-width="2" ${L}/><circle cx="20" cy="29" r="7.5" fill="url(#lt-bird)" stroke="#55656e" stroke-width="1.3"/><path d="M13 28L3 31.5L13 33Z" fill="#f6a623" stroke="#b06c12" stroke-width="1" ${L}/><circle cx="17.5" cy="27.5" r="1.8" fill="#1b2226"/><circle cx="18.1" cy="26.9" r=".6" fill="#fff"/><g class="wing"><path d="M30 32C32 18 40 8 54 2C54 10 50 22 44 34Z" fill="url(#lt-wing)" stroke="#55656e" stroke-width="1.3" ${L}/><path d="M48.5 5L54 2L53.4 8.5" fill="none" stroke="#2c353a" stroke-width="3.6" ${L}/></g></svg>`,
    spark: `<svg class="thing-art" viewBox="0 0 46 50" width="46" height="50"><circle cx="23" cy="25" r="22" fill="#ffe680" opacity=".38"/><path d="M23 5L39 14V35L23 45L7 35V14Z" fill="url(#lt-spark)" stroke="#a8650b" stroke-width="2" ${L}/><path d="M23 5L39 14L23 23L7 14Z" fill="#fff3b8" opacity=".75"/><path d="M25 15L15 29H22L20 39L31 24H24Z" fill="#fff" stroke="#c46f00" stroke-width="1.3" ${L}/></svg>`,
    pearl: `<svg class="thing-art" viewBox="0 0 40 40" width="36" height="36"><circle cx="20" cy="20" r="19" fill="#bff0ff" opacity=".35"/><circle cx="20" cy="21" r="12" fill="url(#lt-pearl)" stroke="#3a86b8" stroke-width="1.6"/><ellipse cx="15.5" cy="16" rx="4" ry="2.6" fill="#fff" opacity=".9" transform="rotate(-30 15.5 16)"/><circle class="bubble" cx="28" cy="9" r="2.2" fill="none" stroke="#e9fbff" stroke-width="1.3"/><circle class="bubble b2" cx="23" cy="5" r="1.5" fill="none" stroke="#e9fbff" stroke-width="1.2"/></svg>`,
  };
  // Gradients shared by every drawing, added to the page once.
  const DEFS = '<svg class="lane-art-defs" width="0" height="0" aria-hidden="true"><defs>'
    + '<radialGradient id="lt-rock" cx=".38" cy=".22" r=".9"><stop offset="0" stop-color="#f6e6c6"/><stop offset=".45" stop-color="#d6b78e"/><stop offset="1" stop-color="#a5815d"/></radialGradient>'
    + '<linearGradient id="lt-bird" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#d3dce1"/></linearGradient>'
    + '<linearGradient id="lt-wing" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#f7fafb"/><stop offset="1" stop-color="#b3c1c9"/></linearGradient>'
    + '<linearGradient id="lt-wing-far" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#d4dde2"/><stop offset="1" stop-color="#93a3ad"/></linearGradient>'
    + '<radialGradient id="lt-spark" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#fff6c2"/><stop offset=".5" stop-color="#ffc93a"/><stop offset="1" stop-color="#e58e00"/></radialGradient>'
    + '<radialGradient id="lt-pearl" cx=".38" cy=".35" r=".7"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#d6f1ff"/><stop offset="1" stop-color="#7cc2ec"/></radialGradient>'
    + '</defs></svg>';
  const SHOWN = { up: { look: 'rock', name: 'Tảng đá', icon: '🪨' }, down: { look: 'bird', name: 'Chim sà', icon: '🦅' } };
  const RUNE_LOOK = { speed: 'spark', bubble: 'pearl' };
  // How an engine lane kind shows: its drawing, name and icon (for the dodge pad).
  function look(kind) {
    return kind.rune ? { ...kind, look: RUNE_LOOK[kind.rune] } : { ...kind, ...SHOWN[kind.key] };
  }
  // A high thing casts a shadow on the water; the pearl gets a ring on the surface above it.
  function html(name) {
    const shadow = name === 'bird' || name === 'spark' ? '<i class="thing-shadow"></i>' : '';
    return shadow + ART[name] + (name === 'pearl' ? '<i class="thing-surface"></i>' : '');
  }
  const api = Object.freeze({ look, html, defs: DEFS, looks: Object.freeze(Object.keys(ART)) });
  root.DuckLaneArt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
