(function (root) {
  'use strict';
  // Lane things (race rooms) drawn as the real thing, with the height you can see. Low things sit in the water: jump
  // over them. High things fly or hang at head height over their shadow on the water: dive under them. The gold rune
  // floats up high (jump for it), the pearl rune lies under the water (dive for it). The engine only knows the key, so
  // each obstacle takes one drawing of its key's pool, picked from the race seed and its place: every page draws the same.
  const L = 'stroke-linejoin="round" stroke-linecap="round"';
  const FOAM = `<path d="M2 47Q8 43 14 47T26 47T38 47T50 47T62 47T78 47" fill="none" stroke="#f6ffff" stroke-width="3" ${L}/>`;
  const POOL_SHADOW = '<ellipse cx="40" cy="48" rx="36" ry="6" fill="#0f5a5a" opacity=".3"/>';
  const leaf = (x, y, r) => `<g transform="translate(${x} ${y}) rotate(${r})"><path d="M0 0C4 -6 13 -6 18 0C13 6 4 6 0 0Z" fill="url(#lt-leaf2)" stroke="#3f6b28" stroke-width=".9"/><path d="M2 0H15" stroke="#c6e89a" stroke-width=".8" opacity=".7"/></g>`;
  const ART = {
    // Low: jump over.
    rock: `<svg class="thing-art" viewBox="0 0 80 56" width="80" height="56"><ellipse cx="40" cy="47" rx="38" ry="7" fill="#0f5a5a" opacity=".28"/><path d="M62 47C61 41 65 37 70 37C75 37 78 41 77 47Z" fill="url(#lt-rock)" stroke="#7a5c42" stroke-width="1.3" stroke-opacity=".7" ${L}/><path d="M8 47C6 34 12 20 25 14C33 9 46 8 56 13C67 18 74 30 73 47Z" fill="url(#lt-rock)" stroke="#7a5c42" stroke-width="1.4" stroke-opacity=".75" ${L}/><path d="M56 13C64 20 67 31 64 40C62 44 58 47 53 47H73C74 30 67 18 56 13Z" fill="#6e5038" opacity=".22"/><ellipse cx="35" cy="20" rx="11" ry="4.5" fill="#fff3dc" opacity=".5" transform="rotate(-12 35 20)"/><path d="M17 33C17 26 22 20 29 18" fill="none" stroke="#fff6e2" stroke-width="3.2" opacity=".65" ${L}/><path d="M4 47Q40 53 78 47" fill="none" stroke="#effffb" stroke-width="2.4" opacity=".9" ${L}/><path d="M1 51Q11 48 21 51T41 51T61 51T80 51" fill="none" stroke="#e8fffb" stroke-width="1.6" opacity=".55" ${L}/></svg>`,
    log: `<svg class="thing-art" viewBox="0 0 80 56" width="80" height="56"><ellipse cx="41" cy="48" rx="37" ry="6" fill="#0f5a5a" opacity=".28"/><path d="M13 31H66C72 31 76 35.5 76 41C76 46.5 72 51 66 51H13Z" fill="url(#lt-bark)" stroke="#5b3d24" stroke-width="1.4" stroke-opacity=".85" ${L}/><path d="M24 41.5C36 40.5 50 42 66 41M22 47C34 46 48 47.5 64 46.5" fill="none" stroke="#4a3019" stroke-width="1.2" opacity=".45" ${L}/><path d="M20 34C34 32.5 52 33 67 34" fill="none" stroke="#d9b07a" stroke-width="1.8" opacity=".6" ${L}/><ellipse cx="13" cy="41" rx="7" ry="10" fill="#e8c38c" stroke="#5b3d24" stroke-width="1.4"/><ellipse cx="13" cy="41" rx="4.4" ry="6.5" fill="none" stroke="#b98a52" stroke-width="1.1"/><ellipse cx="13" cy="41" rx="1.8" ry="2.8" fill="none" stroke="#b98a52" stroke-width="1"/><path d="M52 32C53 26 56 22 61 19" fill="none" stroke="#5b3d24" stroke-width="2.6" ${L}/><path d="M61 19C65 15 71 16 73 20C68 21.5 64 21 61 19Z" fill="#7cb342" stroke="#4f7a2a" stroke-width="1" ${L}/>${FOAM}</svg>`,
    hyacinth: `<svg class="thing-art" viewBox="0 0 80 56" width="80" height="56">${POOL_SHADOW}<path d="M8 46C4 38 8 29 17 29C21 23 30 25 31 33C32 40 26 46 8 46Z" fill="url(#lt-leaf)" stroke="#3d6b2a" stroke-width="1.2" ${L}/><path d="M50 46C49 37 55 30 63 32C70 32 76 39 72 46Z" fill="url(#lt-leaf)" stroke="#3d6b2a" stroke-width="1.2" ${L}/><path d="M26 46C22 33 30 21 41 22C52 21 58 32 55 46Z" fill="url(#lt-leaf)" stroke="#3d6b2a" stroke-width="1.2" ${L}/><path d="M41 24V44M19 31C20 36 22 41 24 45M63 34C62 38 61 42 60 45" fill="none" stroke="#c8ec98" stroke-width="1.1" opacity=".7" ${L}/><ellipse cx="35" cy="28" rx="6" ry="2.5" fill="#efffd8" opacity=".45" transform="rotate(-20 35 28)"/><path d="M43 23C43 17 44 12 45 7" fill="none" stroke="#4f8a32" stroke-width="2" ${L}/><g stroke="#7a5cbf" stroke-width=".8"><circle cx="45" cy="5.5" r="5.2" fill="#c9b4f4"/><circle cx="38" cy="10" r="5" fill="#b59ce8"/><circle cx="52" cy="10.5" r="5" fill="#c3aef0"/><circle cx="41" cy="16" r="4.6" fill="#a98fe0"/><circle cx="49" cy="16.5" r="4.6" fill="#b9a2ec"/></g><g fill="#ffd54a" stroke="#6a4bb0" stroke-width=".5"><circle cx="45" cy="5" r="1.4"/><circle cx="38" cy="9.5" r="1.3"/><circle cx="52" cy="10" r="1.3"/><circle cx="41" cy="15.6" r="1.2"/><circle cx="49" cy="16" r="1.2"/></g>${FOAM}</svg>`,
    turtle: `<svg class="thing-art" viewBox="0 0 80 56" width="80" height="56"><ellipse cx="42" cy="48" rx="36" ry="6" fill="#0f5a5a" opacity=".3"/><path d="M64 45C70 42 76 43 78 47C74 48.5 69 48 64 47Z" fill="#8fb35a" stroke="#3f5a2a" stroke-width="1.1" ${L}/><path d="M18 41C12 37 5 38 3 42C4 46 10 48 18 46Z" fill="#9cc261" stroke="#3f5a2a" stroke-width="1.2" ${L}/><circle cx="7.5" cy="41" r="1.4" fill="#1b2226"/><circle cx="7.9" cy="40.6" r=".45" fill="#fff"/><path d="M4.5 44C6 45 8 45 9.5 44.3" fill="none" stroke="#3f5a2a" stroke-width=".9" ${L}/><path d="M16 47C16 31 27 21 43 21C59 21 70 31 70 47Z" fill="url(#lt-shell)" stroke="#3f5a2a" stroke-width="1.4" ${L}/><path d="M43 22V28M30 26L35 33M56 26L51 33M35 33H51L55 41H31ZM31 41L22 46M55 41L64 46M35 33L24 37M51 33L62 37" fill="none" stroke="#2f4a20" stroke-width="1.2" opacity=".55" ${L}/><ellipse cx="36" cy="27" rx="9" ry="3.5" fill="#f0f8c4" opacity=".4" transform="rotate(-15 36 27)"/><path d="M15 47C25 44 61 44 71 47" fill="none" stroke="#d8e08a" stroke-width="2.2" ${L}/>${FOAM}</svg>`,
    barrel: `<svg class="thing-art" viewBox="0 0 80 56" width="80" height="56"><ellipse cx="40" cy="48" rx="30" ry="6" fill="#0f5a5a" opacity=".3"/><path d="M23 14C20.5 26 20.5 38 23 49H57C59.5 38 59.5 26 57 14Z" fill="url(#lt-barrel)" stroke="#5b3d24" stroke-width="1.4" ${L}/><path d="M31 14.5C29.5 26 29.5 38 31 49M40 15V49M49 14.5C50.5 26 50.5 38 49 49" fill="none" stroke="#5b3d24" stroke-width="1" opacity=".5"/><path d="M26 20C25 28 25 34 26 42" fill="none" stroke="#f0cf9a" stroke-width="2.2" opacity=".55" ${L}/><path d="M21.8 22C33 24 47 24 58.2 22M21.3 40C33 42 47 42 58.7 40" fill="none" stroke="#5f6b75" stroke-width="3.2" ${L}/><path d="M23 21.3C33 23 47 23 57 21.3M22.5 39.3C33 41 47 41 57.5 39.3" fill="none" stroke="#b3bdc6" stroke-width="1" ${L}/><ellipse cx="40" cy="14" rx="17" ry="4.5" fill="#c99a64" stroke="#5b3d24" stroke-width="1.3"/><path d="M30 13.5H50" stroke="#8a6238" stroke-width="1" opacity=".6"/>${FOAM}</svg>`,
    // High: dive under.
    gull: `<svg class="thing-art" viewBox="0 0 80 54" width="72" height="48"><path class="wing" d="M38 30C42 18 52 8 66 4C64 12 58 22 47 33Z" fill="url(#lt-wing-far)" stroke="#55656e" stroke-width="1.3" ${L}/><path d="M52 33L68 28L66 40Z" fill="#e6ecef" stroke="#55656e" stroke-width="1.3" ${L}/><path d="M18 32C22 26 34 25 46 28C54 30 58 34 54 38C46 43 30 43 22 40C19 38 17 35 18 32Z" fill="url(#lt-bird)" stroke="#55656e" stroke-width="1.3" ${L}/><path d="M24 39C32 42 45 41 52 37" fill="none" stroke="#b9c5cc" stroke-width="2" opacity=".7" ${L}/><path d="M38 41l-3 4M43 41l-2 4" stroke="#ef8a2b" stroke-width="2" ${L}/><circle cx="20" cy="29" r="7.5" fill="url(#lt-bird)" stroke="#55656e" stroke-width="1.3"/><path d="M13 28L3 31.5L13 33Z" fill="#f6a623" stroke="#b06c12" stroke-width="1" ${L}/><circle cx="17.5" cy="27.5" r="1.8" fill="#1b2226"/><circle cx="18.1" cy="26.9" r=".6" fill="#fff"/><g class="wing"><path d="M30 32C32 18 40 8 54 2C54 10 50 22 44 34Z" fill="url(#lt-wing)" stroke="#55656e" stroke-width="1.3" ${L}/><path d="M48.5 5L54 2L53.4 8.5" fill="none" stroke="#2c353a" stroke-width="3.6" ${L}/></g></svg>`,
    kingfisher: `<svg class="thing-art" viewBox="0 0 80 54" width="72" height="48"><path class="wing" d="M40 27C44 15 54 8 66 6C63 14 57 22 47 29Z" fill="#1d6fa3" stroke="#123f5c" stroke-width="1.2" ${L}/><path d="M53 31L68 28L66 37Z" fill="#1f86c0" stroke="#123f5c" stroke-width="1.2" ${L}/><path d="M20 31C24 24 36 23 48 26C56 28 58 32 54 36C46 41 30 41 24 38C21 36 19 34 20 31Z" fill="url(#lt-king)" stroke="#123f5c" stroke-width="1.2" ${L}/><path d="M38 40l-2 3.5M42 40l-1 3.5" stroke="#e0412f" stroke-width="1.8" ${L}/><circle cx="21" cy="27" r="8" fill="#2b9ed8" stroke="#123f5c" stroke-width="1.2"/><ellipse cx="20" cy="29.5" rx="4.5" ry="2.4" fill="#f2872a"/><ellipse cx="25.5" cy="32" rx="2.6" ry="1.6" fill="#fff"/><path d="M14 25.5L1 28.5L14 30.5Z" fill="#26292b" stroke="#111" stroke-width=".8" ${L}/><circle cx="18.5" cy="25.5" r="1.7" fill="#111"/><circle cx="19" cy="25" r=".55" fill="#fff"/><g fill="#9fe0ff" opacity=".8"><circle cx="22" cy="22" r=".9"/><circle cx="25" cy="23.5" r=".8"/><circle cx="19" cy="21.5" r=".7"/></g><g class="wing"><path d="M31 29C33 17 41 8 53 3C53 11 49 21 43 31Z" fill="url(#lt-kwing)" stroke="#123f5c" stroke-width="1.2" ${L}/><path d="M36 22l3-6M41 21l3-7M45 21l2-6" stroke="#8fdcff" stroke-width="1.1" opacity=".7" ${L}/></g></svg>`,
    branch: `<svg class="thing-art" viewBox="0 0 80 72" width="64" height="58"><path d="M80 0C68 9 58 19 49 30C42 39 33 47 22 52" fill="none" stroke="#5e4128" stroke-width="5" ${L}/><path d="M78 2C67 10 58 19 50 29" fill="none" stroke="#8b6844" stroke-width="1.6" opacity=".8" ${L}/><path d="M60 18C61 26 64 31 70 34M45 35C42 42 42 49 45 56M33 45C28 44 24 40 22 35M26 50C24 56 25 61 28 65" fill="none" stroke="#5e4128" stroke-width="2.4" ${L}/>${leaf(70, 34, 30)}${leaf(52, 26, -40)}${leaf(45, 56, 80)}${leaf(28, 65, 95)}${leaf(22, 35, -110)}${leaf(20, 52, 160)}${leaf(38, 44, 60)}${leaf(49, 45, 105)}${leaf(64, 22, -15)}<g opacity=".95">${leaf(66, 4, 170)}${leaf(72, 10, 120)}${leaf(58, 10, -160)}${leaf(76, 2, -170)}${leaf(70, 16, 60)}</g></svg>`,
    hat: `<svg class="thing-art" viewBox="0 0 80 54" width="70" height="47"><path d="M27 37C26 44 30 50 37 50C44 50 47 46 53 47C58 48 61 51 64 53" fill="none" stroke="#e0435a" stroke-width="2.4" ${L}/><path d="M12 35C22 42 58 42 68 35C58 39 22 39 12 35Z" fill="#b8913f"/><path d="M12 35L40 6L68 35C58 40 22 40 12 35Z" fill="url(#lt-straw)" stroke="#8a6a2f" stroke-width="1.3" ${L}/><path d="M40 7L30 38M40 7V39M40 7L50 38M40 7L21 36M40 7L59 36" stroke="#c9a456" stroke-width=".7" opacity=".5"/><path d="M19 28C30 31.5 50 31.5 61 28M26 21C34 23.5 46 23.5 54 21M33 14C37 15.5 43 15.5 47 14" fill="none" stroke="#b08a3c" stroke-width="1.1" opacity=".75" ${L}/><path d="M38 9L22 32" fill="none" stroke="#fff7d8" stroke-width="2.2" opacity=".55" ${L}/><path d="M12 35C22 40 58 40 68 35" fill="none" stroke="#8a6a2f" stroke-width="1.5" ${L}/></svg>`,
    // Runes.
    spark: `<svg class="thing-art" viewBox="0 0 46 50" width="46" height="50"><circle cx="23" cy="25" r="22" fill="#ffe680" opacity=".38"/><path d="M23 5L39 14V35L23 45L7 35V14Z" fill="url(#lt-spark)" stroke="#a8650b" stroke-width="2" ${L}/><path d="M23 5L39 14L23 23L7 14Z" fill="#fff3b8" opacity=".75"/><path d="M25 15L15 29H22L20 39L31 24H24Z" fill="#fff" stroke="#c46f00" stroke-width="1.3" ${L}/></svg>`,
    pearl: `<svg class="thing-art" viewBox="0 0 40 40" width="36" height="36"><circle cx="20" cy="20" r="19" fill="#bff0ff" opacity=".35"/><circle cx="20" cy="21" r="12" fill="url(#lt-pearl)" stroke="#3a86b8" stroke-width="1.6"/><ellipse cx="15.5" cy="16" rx="4" ry="2.6" fill="#fff" opacity=".9" transform="rotate(-30 15.5 16)"/><circle class="bubble" cx="28" cy="9" r="2.2" fill="none" stroke="#e9fbff" stroke-width="1.3"/><circle class="bubble b2" cx="23" cy="5" r="1.5" fill="none" stroke="#e9fbff" stroke-width="1.2"/></svg>`,
  };
  const stops = list => list.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
  const linear = (id, [x1, y1, x2, y2], list) => `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops(list)}</linearGradient>`;
  const radial = (id, [cx, cy, r], list) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops(list)}</radialGradient>`;
  // Gradients shared by every drawing, added to the page once.
  const DEFS = '<svg class="lane-art-defs" width="0" height="0" aria-hidden="true"><defs>'
    + radial('lt-rock', [0.38, 0.22, 0.9], [[0, '#f6e6c6'], [0.45, '#d6b78e'], [1, '#a5815d']])
    + linear('lt-bark', [0, 0, 0, 1], [[0, '#a8784a'], [0.5, '#8a5c34'], [1, '#6b4428']])
    + radial('lt-leaf', [0.4, 0.3, 0.8], [[0, '#b2e27a'], [0.55, '#5aa63c'], [1, '#2f6b24']])
    + linear('lt-leaf2', [0, 0, 1, 1], [[0, '#8fca5a'], [1, '#4f8f34']])
    + radial('lt-shell', [0.42, 0.3, 0.8], [[0, '#b5cf74'], [0.55, '#6e8f3e'], [1, '#4c6a2c']])
    + linear('lt-barrel', [0, 0, 1, 0], [[0, '#7a4e2b'], [0.4, '#b98450'], [1, '#7a4e2b']])
    + linear('lt-bird', [0, 0, 0, 1], [[0, '#fff'], [1, '#d3dce1']])
    + linear('lt-wing', [0, 1, 1, 0], [[0, '#f7fafb'], [1, '#b3c1c9']])
    + linear('lt-wing-far', [0, 1, 1, 0], [[0, '#d4dde2'], [1, '#93a3ad']])
    + linear('lt-king', [0, 0, 0, 1], [[0, '#2aa3df'], [0.5, '#1f86c0'], [0.62, '#f2872a'], [1, '#e5701c']])
    + linear('lt-kwing', [0, 1, 1, 0], [[0, '#3cb6ee'], [1, '#1a6ea3']])
    + linear('lt-straw', [0, 0, 1, 1], [[0, '#f7e3a6'], [0.5, '#e2c06b'], [1, '#c99d45']])
    + radial('lt-spark', [0.4, 0.35, 0.75], [[0, '#fff6c2'], [0.5, '#ffc93a'], [1, '#e58e00']])
    + radial('lt-pearl', [0.38, 0.35, 0.7], [[0, '#fff'], [0.55, '#d6f1ff'], [1, '#7cc2ec']])
    + '</defs></svg>';
  // Each key's drawings: name and icon for the dodge pad, what the commentator calls it, the colour of its chips on a hit.
  const POOLS = {
    up: [
      { look: 'rock', name: 'Tảng đá', icon: '🪨', said: 'tảng đá', chips: '#8e948c' },
      { look: 'log', name: 'Khúc gỗ trôi', icon: '🪵', said: 'khúc gỗ trôi', chips: '#8a5c34' },
      { look: 'hyacinth', name: 'Bè lục bình', icon: '🌸', said: 'bè lục bình', chips: '#5d9a3a' },
      { look: 'turtle', name: 'Rùa nổi', icon: '🐢', said: 'con rùa', chips: '#6e8f3e' },
      { look: 'barrel', name: 'Thùng gỗ trôi', icon: '🛢️', said: 'thùng gỗ trôi', chips: '#8a5c34' }],
    down: [
      { look: 'gull', name: 'Hải âu sà', icon: '🐦', said: 'con hải âu', chips: '#f4f8fa' },
      { look: 'kingfisher', name: 'Bói cá lao', icon: '🐦', said: 'con bói cá', chips: '#2b9ed8' },
      { look: 'branch', name: 'Cành cây thấp', icon: '🌿', said: 'cành cây thấp', chips: '#5d9a3a' },
      { look: 'hat', name: 'Nón lá bay', icon: '👒', said: 'chiếc nón lá bay', chips: '#e2c06b' }]
  };
  const RUNES = { speed: { look: 'spark', said: 'rune tốc độ' }, bubble: { look: 'pearl', said: 'rune bong bóng' } };
  // How an engine lane kind shows. `pick` (any whole number, e.g. from the race seed and the item's place) chooses the
  // drawing; tier: low (jump), high (dive) or the rune's own.
  function look(kind, pick = 0) {
    if (kind.rune) return { ...kind, ...RUNES[kind.rune], tier: RUNES[kind.rune].look };
    const pool = POOLS[kind.key], n = Math.abs(Math.trunc(pick)) % pool.length;
    return { ...kind, ...pool[n], tier: kind.key === 'up' ? 'low' : 'high' };
  }
  const HIGH = new Set([...POOLS.down.map(p => p.look), 'spark']);
  // A high thing casts a shadow on the water; the pearl gets a ring on the surface above it.
  function html(name) {
    return (HIGH.has(name) ? '<i class="thing-shadow"></i>' : '') + ART[name] + (name === 'pearl' ? '<i class="thing-surface"></i>' : '');
  }
  const api = Object.freeze({ look, html, defs: DEFS, looks: Object.freeze(Object.keys(ART)), pools: POOLS });
  root.DuckLaneArt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
