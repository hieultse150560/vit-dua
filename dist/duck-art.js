(function (root) {
  'use strict';
  const colors = ['#ffcc46', '#f79eac', '#76bbef', '#b4a0de', '#f2ac62', '#81c8ac', '#e99475', '#d7e9ed'];
  const names = ['Vịt Vàng', 'Vịt Hồng', 'Vịt Xanh', 'Vịt Tím', 'Vịt Cam', 'Vịt Mint', 'Vịt Đào', 'Vịt Mây'];
  // [highlight, shade] around each base colour, for the rubber's volume.
  const tones = [
    ['#fff4b8', '#e2961a'], ['#ffe3e8', '#d4667c'], ['#dcf1ff', '#3d82c4'], ['#efe8ff', '#7c66b4'],
    ['#ffe4c2', '#cc742c'], ['#dcf6ea', '#4b977a'], ['#ffdccd', '#c05e47'], ['#ffffff', '#97b5c0']
  ];
  const STYLE_KEY = 'vit-dua-duck-style';
  let chosen = null; // in-memory fallback when storage is blocked
  let seq = 0;

  const indexOf = id => Math.max(0, Math.trunc(Number(id) || 0));
  function name(id) {
    const index = indexOf(id);
    return names[index % 8] + (index >= 8 ? ` ${Math.floor(index / 8) + 1}` : '');
  }

  // ---- shared duck geometry (viewBox 0 0 100 100, facing right) ----
  const BODY = 'M17 50.5C11 58 10.5 75 21 84C32 92.5 66 93.5 78 87.5C88.5 82 91.5 69 85.5 60.5C80.5 54 70 53 62 55.5C53 58.5 42 58 34 54.5C27 51.5 23 46.5 18.5 47C16.5 47.2 16 49 17 50.5Z';
  const WING = 'M61 63.5C53 58.5 37 60 28.5 65.5C26.5 67 27.5 69.5 30 69.8C27.8 71.5 28.8 74.6 32 74.6C31 77.5 34.5 79.8 38.5 79C47 81.5 59 78.5 62.5 71.5C64 68.2 63.5 65.2 61 63.5Z';
  const HEAD = 'M62 18.5a21 21 0 1 1 0 42a21 21 0 1 1 0-42Z';
  const TUFT = 'M51 25C47 19 50 13.5 56 14.5C53 16.5 53.5 19.5 56.5 23Z';
  const SPARK = 'M0-5C.7-1.2 1.2-.7 5 0C1.2.7.7 1.2 0 5C-.7 1.2-1.2.7-5 0C-1.2-.7-.7-1.2 0-5Z';

  // Each accessory: defs (u = unique id prefix), `neck` drawn before the beak, `front` drawn over the face,
  // whether the head tuft shows, and where the leader's sparkle sits (left half: on the river the skill badge
  // covers the duck's top-right).
  const accessories = {
    crown: { tuft: false, spark: [47, 9], defs: u => lin(u + 'a', '#fff6b8', '#ffd23f', '#d4920f'),
      front: u => `<g transform="rotate(-10 64 20)"><path d="M52 24L51 13L56.5 18L60 9.5L64 17L68 9.5L71.5 18L77 13L76 24C70 25.8 58 25.8 52 24Z" fill="url(#${u}a)" stroke="#b07208" stroke-width=".8" stroke-linejoin="round"/>` +
        `<path d="M52.3 21.6C58 23.3 70 23.3 75.8 21.6" fill="none" stroke="#c98a12" stroke-width=".7" opacity=".7"/>` +
        [[51, 13, 1.7], [60, 9.5, 1.9], [68, 9.5, 1.9], [77, 13, 1.7]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${u}a)" stroke="#b07208" stroke-width=".6"/>`).join('') +
        `<ellipse cx="64" cy="21" rx="2.4" ry="2.1" fill="#e2344a" stroke="#9e1730" stroke-width=".5"/><circle cx="63.2" cy="20.2" r=".7" fill="#fff" opacity=".9"/>` +
        `<circle cx="57" cy="21.4" r="1.1" fill="#3fa3e8"/><circle cx="71" cy="21.4" r="1.1" fill="#3fa3e8"/><path d="M53.5 14.5L54.5 22" stroke="#fff" stroke-width="1" opacity=".55" stroke-linecap="round"/></g>` },
    bow: { tuft: false, spark: [35, 9], defs: u => lin(u + 'a', '#ff8fae', '#ec3d6c', '#b51a48'),
      front: u => `<g transform="rotate(-16 50 22)"><path d="M49 23L43.5 34L47 33L48.5 35.5L51 24Z" fill="#c8204f"/><path d="M51 23L57.5 33L54 33L53 35.5L49.5 24Z" fill="#d42a59"/>` +
        `<path d="M50 22C44 12.5 32.5 11.5 33.5 21C34.5 30 44 28.5 50 22Z" fill="url(#${u}a)" stroke="#a3173f" stroke-width=".7"/>` +
        `<path d="M50 22C56 12.5 67.5 11.5 66.5 21C65.5 30 56 28.5 50 22Z" fill="url(#${u}a)" stroke="#a3173f" stroke-width=".7"/>` +
        `<path d="M47 21.5C43 18 39 17.5 37.5 19M53 21.5C57 18 61 17.5 62.5 19" fill="none" stroke="#a3173f" stroke-width=".7" opacity=".6"/>` +
        `<ellipse cx="50" cy="22" rx="3.6" ry="4.3" fill="#d42a59" stroke="#a3173f" stroke-width=".7"/>` +
        [[38, 16.5], [41, 24.5], [36.5, 22], [60, 16.5], [63, 22.5], [58.5, 25]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1" fill="#fff" opacity=".9"/>`).join('') +
        `<path d="M36 17.5C38 15 41 14.5 43 15.5" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" opacity=".6"/></g>` },
    helmet: { tuft: false, spark: [49, 14], defs: u => rad(u + 'a', '#ff9a88', '#e5402f', '#a8211a', '.35', '.25'),
      front: u => `<path d="M46.5 35C48.5 44 51.5 53 57.5 59.5" fill="none" stroke="#3b302c" stroke-width="1.4" stroke-linecap="round" opacity=".85"/>` +
        `<path d="M83.5 27.2C89 26.3 94.5 27.4 97 30.2C92.5 31.8 87 31.6 82.8 30.8Z" fill="#2f3542" stroke="#1d2129" stroke-width=".6"/>` +
        `<path d="M40 38C38.5 22 50 12 63 12C76 12 85 19 86 28.5C73 27.5 56 30 40 38Z" fill="url(#${u}a)" stroke="#8f1c17" stroke-width=".8"/>` +
        `<path d="M47.5 21.5C54 14.5 73 14 80 21" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" opacity=".92"/>` +
        `<path d="M40.6 37.4C55 30 72 27.4 85.6 28.4" fill="none" stroke="#2b2f38" stroke-width="2" stroke-linecap="round"/>` +
        `<ellipse cx="53" cy="18.5" rx="6.5" ry="2.6" transform="rotate(-24 53 18.5)" fill="url(#${u}w)"/>` },
    phones: { tuft: false, spark: [55, 11], defs: () => '',
      front: () => `<path d="M48.5 36C44 17 68 8.5 77 24.5" fill="none" stroke="#2c2f3a" stroke-width="3.6" stroke-linecap="round"/>` +
        `<path d="M49.5 31C47.5 19 64 11.5 73.5 19" fill="none" stroke="#9aa2b8" stroke-width=".9" stroke-linecap="round" opacity=".75"/>` +
        `<ellipse cx="51" cy="39" rx="6.4" ry="7.8" fill="#2c2f3a"/><ellipse cx="51.8" cy="39" rx="4.6" ry="5.9" fill="#ffcf3f"/>` +
        `<ellipse cx="52.3" cy="39" rx="3.1" ry="4.2" fill="#3b3f4e"/><ellipse cx="49" cy="35.5" rx="1.6" ry="2.2" fill="#fff" opacity=".35"/>` },
    nonla: { tuft: false, spark: [49, 11], defs: u => `<linearGradient id="${u}a" x1="0" x2="1"><stop offset="0" stop-color="#fbf0cc"/><stop offset=".55" stop-color="#ecd597"/><stop offset="1" stop-color="#c7a457"/></linearGradient>`,
      front: u => `<g transform="rotate(-6 63 24)"><path d="M63 2L36 26.5C50 31.2 76 31.2 90 26.5Z" fill="url(#${u}a)" stroke="#a8843c" stroke-width=".8" stroke-linejoin="round"/>` +
        `<path d="M52.2 12Q63 14.8 73.8 12M45.5 18.2Q63 22.6 80.5 18.2M39.8 23.4Q63 29 86.2 23.4" fill="none" stroke="#b18f45" stroke-width=".7" opacity=".75"/>` +
        `<path d="M63 2L49.5 29.4M63 2L63 30.2M63 2L76.5 29.4" stroke="#c4a35c" stroke-width=".5" opacity=".6"/>` +
        `<path d="M36 26.5C50 31.2 76 31.2 90 26.5" fill="none" stroke="#9c7a33" stroke-width="1.3" stroke-linecap="round"/>` +
        `<path d="M61 5.5L46 20" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".55"/></g>` },
    scarf: { tuft: true, spark: [27, 49], defs: u => `<pattern id="${u}p" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-14)"><rect width="5" height="5" fill="#f4efe2"/><rect width="2.5" height="5" fill="#232836" opacity=".72"/><rect width="5" height="2.5" fill="#232836" opacity=".72"/></pattern>` +
        `<linearGradient id="${u}a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></linearGradient>`,
      neck: u => `<g class="ds-tail"><path d="M50 57C43 54.5 36 51.5 27.5 52L29.5 58.5C37 58 44 60.5 50 63Z" fill="url(#${u}p)" stroke="#232836" stroke-width=".6"/>` +
        `<path d="M50 60.5C44 62.5 38 66 31.5 69L35 73.5C41.5 69.5 46.5 67 51.5 65Z" fill="url(#${u}p)" stroke="#232836" stroke-width=".6"/>` +
        `<path d="M27.5 52L25.4 51.4M28.2 54.2L26 54.2M28.9 56.4L26.7 56.9M29.5 58.5L27.6 59.6M31.5 69L30 68M33.2 71.3L31.4 71.2M35 73.5L33.7 74.9" stroke="#232836" stroke-width=".7" stroke-linecap="round"/></g>` +
        `<path d="M45 52.5C55 58.5 72 59.5 83 53.5C85.5 57.5 85 62.5 82 64.5C71 69.5 54 68.5 44.5 61C43 58 43.5 54.5 45 52.5Z" fill="url(#${u}p)" stroke="#232836" stroke-width=".7"/>` +
        `<path d="M45 52.5C55 58.5 72 59.5 83 53.5C85.5 57.5 85 62.5 82 64.5C71 69.5 54 68.5 44.5 61C43 58 43.5 54.5 45 52.5Z" fill="url(#${u}a)"/>` +
        `<ellipse cx="49" cy="60" rx="4.4" ry="4.8" fill="url(#${u}p)" stroke="#232836" stroke-width=".7"/><ellipse cx="49" cy="60" rx="4.4" ry="4.8" fill="url(#${u}a)"/>` },
    chef: { tuft: false, spark: [53, 2], defs: u => `<linearGradient id="${u}a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#dfe7ef"/></linearGradient>`,
      front: u => {
        const puff = 'M53.5 23L52.5 12.5A7.5 7.5 0 0 1 58 4.5A8.5 8.5 0 0 1 70.5 4.5A7.5 7.5 0 0 1 76 12.5L75 23Z';
        return `<g transform="rotate(-8 64 22)"><path d="${puff}" fill="url(#${u}a)" stroke="#b9c6d2" stroke-width=".9" stroke-linejoin="round"/>` +
          `<path d="M59.5 18.5C59 14.5 59.5 11.5 61 8.5M68.5 18.5C69 14.5 68.5 11.5 67.2 8.5M56 9C57 7.5 58.5 6.7 60 6.5" fill="none" stroke="#c9d4de" stroke-width=".8" stroke-linecap="round"/>` +
          `<path d="M52 18C58 20 70 20 76.5 18L77 24.5C70 26.5 58 26.5 51.5 24.5Z" fill="#f6f9fb" stroke="#b9c6d2" stroke-width=".8"/>` +
          `<path d="M55 5.5C57 3.5 60 3 62 3.6" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></g>`;
      } },
    shades: { tuft: true, spark: [53, 11], defs: u => `<linearGradient id="${u}a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5d7096"/><stop offset=".5" stop-color="#262c3c"/><stop offset="1" stop-color="#0f1218"/></linearGradient>`,
      front: u => `<g class="ds-glasses"><path d="M63 33C57 33 52 33.6 46.5 35.2" fill="none" stroke="#1d1f26" stroke-width="1.8" stroke-linecap="round"/>` +
        `<path d="M62.5 32C66 30 76 29.6 80.5 31C81.2 36.5 78.5 42.8 72.5 42.8C66.5 42.8 63 38.5 62.5 32Z" fill="url(#${u}a)" stroke="#111318" stroke-width=".9"/>` +
        `<path d="M62.5 32C66 30 76 29.6 80.5 31M80.3 31.3L84 32.3" fill="none" stroke="#111318" stroke-width="1.9" stroke-linecap="round"/>` +
        `<path d="M66.4 33L70.6 32.6L66.8 39.6Z" fill="#fff" opacity=".42"/><path d="M72.4 32.4L74.4 32.3L70.2 40.6L69 40Z" fill="#fff" opacity=".28"/></g>` }
  };
  const order = ['crown', 'bow', 'helmet', 'phones', 'nonla', 'scarf', 'chef', 'shades'];

  function lin(id, a, b, c) {
    return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".5" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>`;
  }
  function rad(id, a, b, c, cx = '.38', cy = '.3') {
    return `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r=".85" fx="${cx}" fy="${cy}"><stop offset="0" stop-color="${a}"/><stop offset=".5" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></radialGradient>`;
  }

  function skin(index) {
    const kind = order[(index % 8 + 3 * Math.floor(index / 8)) % 8]; // id >= 8: same colour, another accessory
    const acc = accessories[kind];
    const u = `ds${(++seq).toString(36)}`;
    const [hl, shade] = tones[index % 8], base = colors[index % 8];
    const [sx, sy] = acc.spark;
    const defs = rad(u + 'b', hl, base, shade, '.42', '.22') + rad(u + 'h', hl, base, shade, '.36', '.24') +
      `<linearGradient id="${u}d" x1="0" y1="0" x2="0" y2="1"><stop offset=".5" stop-color="${shade}" stop-opacity="0"/><stop offset="1" stop-color="${shade}" stop-opacity=".55"/></linearGradient>` +
      `<radialGradient id="${u}o"><stop offset="0" stop-color="${shade}" stop-opacity=".5"/><stop offset="1" stop-color="${shade}" stop-opacity="0"/></radialGradient>` +
      `<linearGradient id="${u}k" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc664"/><stop offset=".6" stop-color="#f7942a"/><stop offset="1" stop-color="#e2701a"/></linearGradient>` +
      `<radialGradient id="${u}s"><stop offset="0" stop-color="#173c48" stop-opacity=".34"/><stop offset="1" stop-color="#173c48" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="${u}w"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="${u}c"><stop offset="0" stop-color="#ff6f8c" stop-opacity=".62"/><stop offset="1" stop-color="#ff6f8c" stop-opacity="0"/></radialGradient>` +
      `<linearGradient id="${u}i" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4fdff" stop-opacity=".8"/><stop offset="1" stop-color="#8fd8f2" stop-opacity=".62"/></linearGradient>` +
      acc.defs(u);
    const edge = `stroke="${shade}" stroke-width=".8" stroke-opacity=".45"`;
    return `<span class="duck-sprite duck-skin" aria-hidden="true" style="--ds-blink:${(-(index * 1.37) % 4.6).toFixed(2)}s">` +
      `<svg class="ds ds-${kind}" viewBox="0 0 100 100" focusable="false"><defs>${defs}</defs>` +
      `<g class="ds-speed" stroke="#fff" stroke-width="3" stroke-linecap="round"><path d="M-6 52h18M-12 60h22M-7 68h18"/></g>` +
      `<ellipse cx="50" cy="90.5" rx="35" ry="5" fill="url(#${u}s)"/>` +
      // body: colour volume, darker underside, bounce light on the bottom edge, gloss on the back
      `<path d="${BODY}" fill="url(#${u}b)" ${edge}/><path d="${BODY}" fill="url(#${u}d)"/>` +
      `<path d="M23 83.5C34 90.5 64 91.5 77 85.8" fill="none" stroke="${hl}" stroke-width="1.3" stroke-linecap="round" opacity=".35"/>` +
      `<ellipse cx="33" cy="60.5" rx="9" ry="3.4" transform="rotate(-16 33 60.5)" fill="url(#${u}w)"/>` +
      `<ellipse cx="61" cy="60" rx="17" ry="5.5" fill="url(#${u}o)"/>` +
      `<g class="ds-wing"><path d="${WING}" fill="url(#${u}b)" ${edge}/>` +
      `<path d="M35 69.4C42 67.8 50 67.8 56.5 69.4M38.5 74.4C45 73.6 51 73.8 57 74.6" fill="none" stroke="${shade}" stroke-width=".9" stroke-linecap="round" opacity=".5"/>` +
      `<path d="M32.5 65C40 61.8 50 61.4 58 63.4" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity=".65"/></g>` +
      (acc.tuft ? `<path d="${TUFT}" fill="url(#${u}h)" ${edge}/>` : '') +
      `<path d="${HEAD}" fill="url(#${u}h)" ${edge}/>` +
      `<ellipse cx="53.5" cy="28.5" rx="8" ry="4.6" transform="rotate(-38 53.5 28.5)" fill="url(#${u}w)"/>` +
      `<ellipse cx="51.5" cy="27.5" rx="2.6" ry="1.4" transform="rotate(-40 51.5 27.5)" fill="#fff" opacity=".85"/>` +
      `<ellipse cx="62" cy="47.5" rx="5.8" ry="3.5" fill="url(#${u}c)"/>` +
      (acc.neck ? acc.neck(u) : '') +
      // beak: open smile
      `<path d="M78 50C83 49.6 89 49.4 92.5 49C91.5 52.5 88 54.8 84 55C81 55.2 79 53 78 50Z" fill="#b8402b"/>` +
      `<ellipse cx="85.5" cy="53" rx="3.2" ry="1.4" fill="#ff8a8a"/>` +
      `<path d="M78.5 51.5C82 53.8 87 54.2 91 52C90.5 55.2 87 57.6 83 57.6C80.5 57.6 78.5 55 78.5 51.5Z" fill="url(#${u}k)" stroke="#cf6114" stroke-width=".6"/>` +
      `<path d="M76 43.5C82 40.5 91 41 95.5 45C97 46.5 96 48.5 93.5 48.8C89 49.3 83 49.5 78 50C76 48.5 75.5 45.5 76 43.5Z" fill="url(#${u}k)" stroke="#cf6114" stroke-width=".6"/>` +
      `<path d="M79 44C83 42.4 88 42.4 91.5 43.6" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" opacity=".7"/>` +
      `<path d="M84.6 44.6l1.6-.3" stroke="#c1561a" stroke-width=".9" stroke-linecap="round"/>` +
      // eyes: open (blinks), shut, dizzy, determined brow
      `<g class="ds-open"><ellipse cx="68.5" cy="36.5" rx="4.5" ry="5.6" fill="#1b1a21"/><circle cx="70.2" cy="34.2" r="1.9" fill="#fff"/><circle cx="67" cy="39.2" r=".85" fill="#fff" opacity=".8"/></g>` +
      `<path class="ds-shut" d="M64.3 37Q68.5 41.2 72.7 37" fill="none" stroke="#1b1a21" stroke-width="1.7" stroke-linecap="round"/>` +
      `<g class="ds-dizzy"><path d="M68 36.5a1 1 0 0 1 2 0a2 2 0 0 1-4 0a3 3 0 0 1 6 0a4 4 0 0 1-8 0" fill="none" stroke="#1b1a21" stroke-width="1.35" stroke-linecap="round"/></g>` +
      `<path class="ds-brow" d="M63.4 30.6L74 33.6" stroke="#1b1a21" stroke-width="2.3" stroke-linecap="round"/>` +
      (acc.front ? acc.front(u) : '') +
      `<path class="ds-sweat" d="M42 21C39 26 38.5 28.5 40.5 30C42.5 31.4 45 30 44.6 27.6C44.3 25.6 43.2 23.3 42 21Z" fill="#8fd6ff" stroke="#3d9bd6" stroke-width=".6"/>` +
      `<g class="ds-ice"><path d="${BODY}" fill="url(#${u}i)"/><path d="${HEAD}" fill="url(#${u}i)"/>` +
      `<path d="M24 66L31 61M59 29L65 24M70 79L77 73" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".85"/></g>` +
      `<g transform="translate(${sx} ${sy})"><path class="ds-spark" d="${SPARK}" fill="#fff8c2" stroke="#ffd23f" stroke-width=".6"/></g>` +
      `</svg></span>`;
  }

  function classic(index) {
    const cell = index % 8;
    // One decoded texture supplies every sprite, including large races; the atlas uses equal cells.
    return `<span class="duck-sprite" aria-hidden="true" style="--duck-x:${(cell % 4) * 100 / 3}%;--duck-y:${Math.floor(cell / 4) * 100}%"></span>`;
  }

  function style() {
    if (chosen) return chosen;
    try { chosen = root.localStorage?.getItem(STYLE_KEY) === 'classic' ? 'classic' : 'new'; } catch { chosen = 'new'; }
    return chosen;
  }
  function setStyle(value) {
    chosen = value === 'classic' ? 'classic' : 'new';
    try { root.localStorage?.setItem(STYLE_KEY, chosen); } catch { /* storage blocked: keep the in-memory choice */ }
    paintStatic();
    return chosen;
  }
  // The header logo and setup mascot are static markup in index.html; repaint them in the chosen style.
  function paintStatic() {
    if (typeof document === 'undefined') return;
    for (const el of document.querySelectorAll('.brand-icon, .dialog-mascot')) el.innerHTML = svg(0);
  }

  function svg(id) {
    const index = indexOf(id);
    return style() === 'classic' ? classic(index) : skin(index);
  }

  const api = Object.freeze({ name, svg, style, setStyle, colors: Object.freeze(colors) });
  root.DuckArt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paintStatic, { once: true });
    else paintStatic();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
