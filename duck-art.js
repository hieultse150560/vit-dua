(function (root) {
  'use strict';
  const colors = ['#ffcc46', '#f79eac', '#76bbef', '#b4a0de', '#f2ac62', '#81c8ac', '#e99475', '#d7e9ed'];
  const names = ['Vịt Vàng', 'Vịt Hồng', 'Vịt Xanh', 'Vịt Tím', 'Vịt Cam', 'Vịt Mint', 'Vịt Đào', 'Vịt Mây'];
  function name(id) {
    const index = Math.max(0, Math.trunc(Number(id) || 0));
    return names[index % 8] + (index >= 8 ? ` ${Math.floor(index / 8) + 1}` : '');
  }
  function svg(id) {
    const index = Math.max(0, Math.trunc(Number(id) || 0)) % 8;
    // Stable identities and markup API preserve old picks. One decoded texture
    // supplies every sprite, including large races; the atlas uses equal cells.
    return `<span class="duck-sprite" aria-hidden="true" style="--duck-x:${(index % 4) * 100 / 3}%;--duck-y:${Math.floor(index / 4) * 100}%"></span>`;
  }
  const api = Object.freeze({ name, svg, colors: Object.freeze(colors) });
  root.DuckArt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
