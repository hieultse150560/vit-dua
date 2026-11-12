(function (root) {
  'use strict';
  // Decoration only: this renderer never changes a race, its seed, or results.
  const TAU = Math.PI * 2;
  const noise = n => { const value = Math.sin(n * 127.1 + 311.7) * 43758.5453; return value - Math.floor(value); };
  const noop = () => {};
  const empty = () => ({ resize: noop, draw: noop, event: noop, destroy: noop });
  // chaos-v2 event kinds → [icon, colour]. chaos-v1 kinds (swap, bomb, shield, rune, boost) keep their own drawing.
  const TWIST = {
    fly: ['🪽', '#fff1a8'], torpedo: ['💣', '#d7b0ff'], wave: ['🌊', '#9fe7ff'], rocket: ['🚀', '#ffd27f'], boom: ['💥', '#ff9b73'],
    mirror: ['🪞', '#e9f7ff'], hook: ['🎣', '#c9f0c1'], tornado: ['🌪️', '#d9e4ff'], banana: ['🍌', '#fff07a'], guard: ['🛟', '#c2fbff'],
    rock: ['🪨', '#d9c6a5'], croc: ['🐊', '#b5e3a1'], wind: ['💨', '#e8fbff'], whirlpool: ['🌀', '#a9dcff'], dolphin: ['🐬', '#a6e4ff'],
    missile: ['🎯', '#ff7b29'], bees: ['🐝', '#ffd34d'], blackhole: ['🕳️', '#8a5cff'], ghost: ['👻', '#eaf1ff'], balloon: ['🎈', '#ff6b8b'],
    hippo: ['🦛', '#c9b6d9'], log: ['🪵', '#a0703a'], frog: ['🐸', '#7ed957'],
    magnet: ['🧲', '#ff7a7a'], lightning: ['⚡', '#fff6a0'], flip: ['🔃', '#ffd166'], rewind: ['⏪', '#ffe2a8'], reverse: ['↩️', '#ff6fd8'], freeze: ['🧊', '#c9f3ff'],
    timebomb: ['💣', '#ff9b4a'], dice: ['🎲', '#ffffff'], lullaby: ['💤', '#c7b8ff'], hex: ['🪄', '#9cff8a'], giant: ['🍄', '#ff7070'],
    kraken: ['🐙', '#c08cff'], dragon: ['🐉', '#5ff0d8'], meteor: ['☄️', '#ff9d3c'], whale: ['🐋', '#8fd3ff'], ufo: ['🛸', '#b6ff9e'],
    pirate: ['🏴‍☠️', '#ffcf6b'], wheel: ['🎡', '#ffd84d'], anchor: ['⚓', '#c3ccd6'], volcano: ['🌋', '#ff5a2a'], fireworks: ['🎆', '#ff7ad9']
  };
  const V2_KIND = { wings: 'fly', torpedo: 'torpedo', wave: 'wave', rocket: 'rocket', mirror: 'mirror', hook: 'hook', tornado: 'tornado', banana: 'banana', buoy: 'guard',
    rock: 'rock', croc: 'croc', wind: 'wind', whirlpool: 'whirlpool', dolphin: 'dolphin',
    missile: 'missile', bees: 'bees', blackhole: 'blackhole', ghost: 'ghost', balloon: 'balloon', hippo: 'hippo', log: 'log', frog: 'frog',
    magnet: 'magnet', lightning: 'lightning', flip: 'flip', rewind: 'rewind', reverse: 'reverse', freeze: 'freeze',
    bomb: 'timebomb', dice: 'dice', lullaby: 'lullaby', hex: 'hex', giant: 'giant',
    kraken: 'kraken', dragon: 'dragon', meteor: 'meteor', whale: 'whale', ufo: 'ufo', pirate: 'pirate', wheel: 'wheel', anchor: 'anchor', volcano: 'volcano', fireworks: 'fireworks' }; // 'bomb' is the chaos-v1 burst kind
  // Race seconds. TWIST_MAIN matches the app's slow-motion window (0.27 race-s, played over 1.8 s or 3 s),
  // so each twist's main action plays in slow motion; the rest is a slow fade.
  const BURST_LIFE = .85, TWIST_LIFE = 1.7, TWIST_MAIN = .27;
  // The app's camera zooms the canvas by CAMERA_ZOOM (CSS scale), so draw at that much extra resolution.
  const CAMERA_ZOOM = 1.45;
  const THROWN = new Set(['torpedo', 'hook']), SPREAD = new Set(['wave', 'tornado']), AT_ACTOR = new Set(['fly', 'rocket', 'boom', 'guard']);
  function kindOf(event) {
    if (event.skill === 'copycat' && event.copied) return kindOf({ ...event, skill: event.copied }); // draws what it copied
    const v2 = V2_KIND[event.skill || event.hazard];
    if (v2) return event.skill === 'rocket' && event.outcome === 'exploded' ? 'boom' : v2;
    return event.skill === 'swap' ? (event.outcome === 'swapped' ? 'swap' : 'shield')
      : event.skill === 'bomb' ? 'bomb' : event.type === 'rune-pickup' ? 'rune' : event.outcome === 'shield' ? 'shield' : 'boost';
  }
  function context(canvas) { try { return canvas.getContext('2d', { alpha: true }); } catch { return null; } }

  // lite: draw at a lower resolution so a machine that is also screen-sharing keeps its frame rate.
  // bend(progress) → px: the map's winding offset (the app moves the ducks by the same amount); map: the race's map.
  function create({ container, river, nodes, reduced = () => false, seed = 0, weather = null, duration = 0, lite = false, bend = () => 0, map = null }) {
    if (!container || !river || !nodes.length) return empty();
    const canvas = document.createElement('canvas');
    canvas.className = 'race-effects';
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '4' });
    let ctx = context(canvas);
    if (!ctx) return empty();
    container.append(canvas);
    // Map scenery sits on its own canvas under the ducks (bridges stay on top: the ducks swim under them).
    const ground = map ? document.createElement('canvas') : null, gctx = ground ? context(ground) : null;
    if (gctx) {
      ground.className = 'race-ground'; ground.setAttribute('aria-hidden', 'true');
      Object.assign(ground.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '0' });
      container.prepend(ground); container.classList.add('has-ground');
    }
    let width = 0, height = 0, metrics = [], bursts = [], lastSample = [], lastElapsed = 0, destroyed = false;

    function resize() {
      if (destroyed) return;
      const rect = container.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width)); height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(lite ? 1.25 : 2.5, (root.devicePixelRatio || 1) * CAMERA_ZOOM);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (gctx) { ground.width = canvas.width; ground.height = canvas.height; gctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
      metrics = nodes.map(node => {
        const lane = node.parentElement.getBoundingClientRect();
        const body = node.querySelector('.duck-body');
        return { x: lane.left - rect.left, y: lane.top - rect.top + river.scrollTop, laneH: lane.height || 57,
          travel: lane.width, duckWidth: node.offsetWidth || 88, duckHeight: body?.offsetHeight || 76 };
      });
    }
    const point = (id, sample) => {
      const metric = metrics[id], racer = sample[id];
      if (!metric || !racer) return { x: 0, y: 0 };
      return { x: metric.x + racer.progress * metric.travel + metric.duckWidth * .5,
        y: metric.y - river.scrollTop + metric.duckHeight * .65 + bend(racer.progress) };
    };
    function ring(x, y, rx, ry, color, alpha = 1, line = 1) {
      ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = line;
      ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.stroke();
    }
    function drawWater(time) {
      // A few translucent glints on top of the painted river, not a second scene.
      ctx.lineCap = 'round'; ctx.strokeStyle = '#f2fff9'; ctx.lineWidth = 1;
      for (let i = 0; i < 26; i++) {
        const speed = 9 + noise(i + seed) * 13;
        const x = ((noise(i + 11) * (width + 120) - time * speed) % (width + 120) + width + 120) % (width + 120) - 60;
        const y = 22 + noise(i + 45) * Math.max(1, height - 44);
        ctx.globalAlpha = .10 + .12 * (1 + Math.sin(time * 1.2 + i)) / 2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 11, y + 3, x + 25 + noise(i) * 20, y); ctx.stroke();
      }
      for (let i = 0; i < 9; i++) {
        const sparkle = Math.max(0, Math.sin(time * .8 + i * 2.4)) ** 8;
        if (sparkle < .05) continue;
        const x = noise(i + 21) * width, y = 15 + noise(i + 73) * (height - 30);
        ctx.globalAlpha = sparkle * .4; ctx.fillStyle = '#fffde3';
        ctx.beginPath(); ctx.ellipse(x, y, 3, .9, 0, 0, TAU); ctx.fill();
      }
    }
    function drawWake(racer, sample, time, running) {
      const p = point(racer.id, sample), metric = metrics[racer.id];
      if (p.y < -65 || p.y > height + 65) return;
      const left = p.x - metric.duckWidth * .24, y = p.y + 7;
      const fast = racer.boosting, slow = racer.slowed;
      const length = fast ? 83 : slow ? 22 : 46;
      ctx.fillStyle = fast ? '#fff9c4' : '#e9fffc'; ctx.globalAlpha = fast ? .19 : .12;
      ctx.beginPath(); ctx.ellipse(left - length * .25, y, length * .56, fast ? 11 : 7, 0, 0, TAU); ctx.fill();
      for (let i = 0; i < 3; i++) {
        const phase = (time * (fast ? 2 : 1.05) + i / 3 + racer.id * .17) % 1;
        const x = left - 6 - phase * length;
        ring(x, y, 6 + phase * 13, 2 + phase * 5, fast ? '#fff5b0' : '#f0fffe', (1 - phase) * (fast ? .65 : .42), fast ? 1.7 : 1.1);
      }
      if (fast) {
        const bodyY = p.y - metric.duckHeight * .3, rx = metric.duckWidth * .3, ry = metric.duckHeight * .27;
        for (let k = 1; k <= 3; k++) { ctx.globalAlpha = .2 / k; ctx.fillStyle = '#fff3b0'; ctx.beginPath(); ctx.ellipse(p.x - k * 22, bodyY, rx, ry, 0, 0, TAU); ctx.fill(); }
        ctx.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          const age = (time * 3.4 + i * .19 + racer.id * .13) % 1, x = left - 10 - age * 110, yy = y - 30 + i * 8;
          ctx.globalAlpha = (1 - age) * .85; ctx.strokeStyle = i % 2 ? '#ffffff' : '#ffd84d'; ctx.lineWidth = 3.2 - age * 1.6;
          ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x - 22 - age * 30, yy); ctx.stroke();
        }
        ctx.lineCap = 'butt';
      }
    }
    function event(event, sample, elapsed, pre = sample) {
      if (destroyed || reduced() || elapsed - event.time > .3 || event.type === 'rune-spawn') return;
      const origin = point(event.actorId, sample), target = point(Number.isInteger(event.targetId) ? event.targetId : event.actorId, sample);
      const kind = kindOf(event);
      bursts.push({ time: elapsed, kind, origin, target, blocked: ['shielded', 'immune', 'resisted'].includes(event.outcome), id: event.id.length + event.actorId * 7,
        affected: (event.affectedIds || []).map(id => point(id, sample)), shielded: (event.affectedIds || []).map(id => (event.protectedIds || []).includes(id)), atActor: AT_ACTOR.has(kind) || event.outcome === 'dropped', life: TWIST[kind] ? TWIST_LIFE : BURST_LIFE,
        outcome: event.outcome, reflected: event.outcome === 'reflected', roll: event.roll, actorId: event.actorId, targetId: event.targetId,
        segment: event.segment, outcomes: event.outcomes, affectedIds: event.affectedIds,
        // Positions just before the jump, so painters move with the ducks' on-screen glide.
        pre: { origin: point(event.actorId, pre), target: point(Number.isInteger(event.targetId) ? event.targetId : event.actorId, pre), affected: (event.affectedIds || []).map(id => point(id, pre)) } });
      // Impact layer for every chaos-v2/v3 twist: focus lines, shockwave and sparks where it lands.
      if (TWIST[kind]) {
        const victim = Number.isInteger(event.targetId) && event.targetId !== event.actorId && !['armed', 'blocked'].includes(event.outcome) ? event.targetId
          : event.type === 'hazard' ? event.actorId : null;
        const spots = victim !== null ? [point(victim, sample)] : (event.affectedIds || []).length ? event.affectedIds.map(id => point(id, sample)) : [origin];
        const focus = { x: spots.reduce((s, p) => s + p.x, 0) / spots.length, y: spots.reduce((s, p) => s + p.y, 0) / spots.length };
        bursts.push({ kind: 'impact', time: elapsed, origin: focus, color: TWIST[kind][1], life: .22, id: event.id.length * 13 + event.actorId });
      }
      if (bursts.length > 28) bursts = bursts.slice(-28);
    }
    function particles(point, progress, color, count = 11, radius = 34, tag = 0) {
      ctx.fillStyle = color;
      for (let i = 0; i < count; i++) {
        const angle = i / count * TAU + noise(tag + i) * .55;
        const distance = radius * progress * (.5 + noise(i + tag + 2));
        ctx.globalAlpha = (1 - progress) ** 1.5;
        ctx.beginPath(); ctx.arc(point.x + Math.cos(angle) * distance, point.y + Math.sin(angle) * distance * .7,
          (1 - progress) * (2 + noise(i) * 2), 0, TAU); ctx.fill();
      }
    }
    function drawBurst(burst, time) {
      const age = Math.max(0, time - burst.time), p = age / burst.life;
      if (p >= 1) return;
      if (burst.kind === 'swap') {
        for (const spot of [burst.origin, burst.target]) {
          ring(spot.x, spot.y - 12, 16 + p * 28, 28 + p * 24, '#d1b2ff', (1 - p) * .95, 4 * (1 - p) + 1);
          ring(spot.x, spot.y - 12, 10 + p * 36, 20 + p * 27, '#fff3ff', (1 - p) * .8, 2);
          particles(spot, p, '#e5b7ff', 12, 49, burst.id);
        }
      } else if (burst.kind === 'bomb') {
        const travel = Math.min(1, age / .32);
        const x = burst.origin.x + (burst.target.x - burst.origin.x) * travel;
        const y = burst.origin.y + (burst.target.y - burst.origin.y) * travel - Math.sin(travel * Math.PI) * 48;
        if (travel < 1) {
          ctx.globalAlpha = .6; ctx.strokeStyle = '#ffe7b9'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(burst.origin.x, burst.origin.y);
          ctx.quadraticCurveTo((burst.origin.x + x) / 2, Math.min(burst.origin.y, y) - 20, x, y); ctx.stroke();
          ctx.globalAlpha = 1; ctx.font = '22px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('💣', x, y);
        } else {
          const hit = Math.min(1, (age - .32) / .53);
          particles(burst.target, hit, burst.blocked ? '#e6ffff' : '#dbb5ff', 14, 45, burst.id);
          ring(burst.target.x, burst.target.y, 6 + hit * 38, 5 + hit * 23, burst.blocked ? '#eaffff' : '#d7b0ff', 1 - hit, 3);
        }
      } else if (burst.kind === 'impact') { drawImpact(burst, p);

      } else if (burst.kind === 'shield') {
        ring(burst.target.x, burst.target.y - 8, 19 + p * 18, 22 + p * 15, '#f0ffff', (1 - p) * .85, 3);
        particles(burst.target, p, '#c2fbff', 9, 32, burst.id);
      } else if (TWIST[burst.kind]) drawTwist(burst, age);
      else particles(burst.origin, p, burst.kind === 'rune' ? '#fff2a2' : '#ffe87f', 12, 44, burst.id);
    }
    function emoji(icon, x, y, size, alpha) {
      ctx.globalAlpha = Math.max(0, alpha); ctx.font = `${size}px sans-serif`; ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3; // lifts icons off the water
      ctx.fillText(icon, x, y);
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    }
    // Map scenery (chaos-v3): a tint, winding lane guides and the zones (rapids, lotus beds, ice, stone bridges).
    const MAP_TINT = { rapids: 'rgba(25,70,115,.13)', lotus: 'rgba(50,130,60,.12)', ice: 'rgba(225,246,255,.22)', canal: 'rgba(70,88,108,.14)' };
    // layer: 'ground' (tint, lane guides, water zones: under the ducks) or 'top' (bridges, over them).
    function drawMap(time, layer) {
      if (!map || !metrics.length) return;
      const m0 = metrics[0], xAt = p => m0.x + p * m0.travel + m0.duckWidth * .5, top = layer === 'top';
      if (!top && MAP_TINT[map.id]) { ctx.globalAlpha = 1; ctx.fillStyle = MAP_TINT[map.id]; ctx.fillRect(0, 0, width, height); }
      if (!top && map.bend?.amp) {
        ctx.setLineDash([8, 10]); ctx.lineWidth = 1.4; ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = .32;
        for (const m of metrics) {
          const base = m.y - river.scrollTop + m.laneH;
          if (base < -40 || base > height + 40) continue;
          ctx.beginPath();
          for (let k = 0; k <= 48; k++) { const p = k / 48, x = m.x + p * m.travel + m.duckWidth * .5, y = base + bend(p); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      for (const [zi, z] of map.zones.entries()) {
        if ((z.kind === 'bridge') !== top) continue;
        const x0 = xAt(z.from), x1 = xAt(z.to), w = Math.max(1, x1 - x0), tag = zi * 37 + seed % 97;
        ctx.save();
        if (z.kind !== 'bridge') { ctx.beginPath(); ctx.rect(0, 30, width, Math.max(0, height - 76)); ctx.clip(); } // water only: the banks stay dry
        if (z.kind === 'rapids') {
          const g = ctx.createLinearGradient(x0 - 30, 0, x1 + 30, 0);
          g.addColorStop(0, 'rgba(20,70,110,0)'); g.addColorStop(.15, 'rgba(20,70,110,.32)'); g.addColorStop(.85, 'rgba(20,70,110,.32)'); g.addColorStop(1, 'rgba(20,70,110,0)');
          ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(x0 - 30, 0, w + 60, height);
          ctx.lineCap = 'round'; ctx.strokeStyle = '#ffffff';
          for (let i = 0; i < 46; i++) {
            const run = (noise(tag + i) * w + time * (140 + noise(i) * 90)) % w, x = x0 + run, y = noise(tag + i + 7) * height, len = 16 + noise(i + 3) * 30;
            ctx.globalAlpha = .25 + .45 * Math.sin(run / w * Math.PI); ctx.lineWidth = 2 + noise(i + 9) * 2.5; line({ x, y }, { x: x + len, y: y + Math.sin(time * 6 + i) * 3 });
          }
          ctx.lineCap = 'butt';
          for (const xe of [x0, x1]) { ctx.globalAlpha = .55; ctx.strokeStyle = '#f2fdff'; ctx.lineWidth = 4; ctx.beginPath(); for (let y = 0; y <= height; y += 12) { const xx = xe + Math.sin(y * .08 + time * 5) * 5; if (y) ctx.lineTo(xx, y); else ctx.moveTo(xx, y); } ctx.stroke(); }
        } else if (z.kind === 'lotus') {
          ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(70,150,80,.16)'; ctx.fillRect(x0, 0, w, height);
          for (let i = 0; i < 34; i++) {
            const x = x0 + noise(tag + i) * w, y = noise(tag + i + 11) * height, r = 11 + noise(i + 4) * 13, a = noise(i + 8) * TAU;
            ctx.globalAlpha = .9; ctx.fillStyle = i % 3 ? '#3f9b4b' : '#57b45f';
            ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r, a + .35, a + TAU - .35); ctx.closePath(); ctx.fill();
            ctx.strokeStyle = '#2f7a3a'; ctx.lineWidth = 1; ctx.globalAlpha = .6; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a + Math.PI) * r * .8, y + Math.sin(a + Math.PI) * r * .8); ctx.stroke();
          }
          for (let i = 0; i < 6; i++) emoji('🪷', x0 + noise(tag + i + 30) * w, noise(tag + i + 40) * height + 10, 22, .95);
        } else if (z.kind === 'ice') {
          const g = ctx.createLinearGradient(x0, 0, x1, 0);
          g.addColorStop(0, 'rgba(235,250,255,.15)'); g.addColorStop(.5, 'rgba(235,250,255,.62)'); g.addColorStop(1, 'rgba(235,250,255,.15)');
          ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(x0, 0, w, height);
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.3; ctx.globalAlpha = .75;
          for (let i = 0; i < 9; i++) {
            let x = x0 + noise(tag + i) * w, y = noise(tag + i + 5) * height; ctx.beginPath(); ctx.moveTo(x, y);
            for (let k = 0; k < 5; k++) { x += (noise(i * 7 + k) - .5) * 40; y += 14 + noise(i + k) * 18; ctx.lineTo(x, y); }
            ctx.stroke();
          }
          for (let i = 0; i < 12; i++) { const tw = Math.max(0, Math.sin(time * 3 + i * 1.9)) ** 6; ctx.globalAlpha = tw; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x0 + noise(tag + i + 20) * w, noise(tag + i + 25) * height, 2.5, 0, TAU); ctx.fill(); }
        } else if (z.kind === 'bridge') {
          const bw = 34;
          ctx.globalAlpha = .22; ctx.fillStyle = '#0d2a3a'; ctx.fillRect(x0 + bw / 2, 0, 16, height);
          const g = ctx.createLinearGradient(x0 - bw / 2, 0, x0 + bw / 2, 0);
          g.addColorStop(0, '#8d7a62'); g.addColorStop(.5, '#c9b597'); g.addColorStop(1, '#8d7a62');
          ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(x0 - bw / 2, 0, bw, height);
          ctx.fillStyle = '#6b5a45';
          for (let y = 6; y < height; y += 22) { ctx.fillRect(x0 - bw / 2 - 3, y, 6, 8); ctx.fillRect(x0 + bw / 2 - 3, y, 6, 8); }
          ctx.strokeStyle = '#5a4a38'; ctx.lineWidth = 2; ctx.globalAlpha = .8; line({ x: x0 - bw / 2, y: 0 }, { x: x0 - bw / 2, y: height }); line({ x: x0 + bw / 2, y: 0 }, { x: x0 + bw / 2, y: height });
          ctx.globalAlpha = .35; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
          for (let y = 11; y < height; y += 22) line({ x: x0 - bw / 2 + 4, y }, { x: x0 + bw / 2 - 4, y });
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
    // Weather ambience (chaos-v3): rain streaks, gusts, storm lightning, sun glints.
    function drawWeather(time, sample) {
      // Night: dark river, moon and stars; each duck carries its own pool of lantern light.
      if (weather === 'night') {
        ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(8,14,42,.62)'; ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'destination-out';
        for (const r of sample) {
          const p = point(r.id, sample), g = ctx.createRadialGradient(p.x, p.y - 22, 8, p.x, p.y - 22, 74);
          g.addColorStop(0, 'rgba(0,0,0,.95)'); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y - 22, 74, 0, TAU); ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
        for (const r of sample) { const p = point(r.id, sample); glow({ x: p.x, y: p.y + 6 }, 60, 'rgba(255,214,140,.35)', 1); }
        const moon = { x: width - 110, y: 64 };
        glow({ x: moon.x, y: moon.y + 12 }, 90, 'rgba(255,248,220,.5)', 1);
        ctx.globalAlpha = 1; ctx.fillStyle = '#fff8dc'; ctx.beginPath(); ctx.arc(moon.x, moon.y, 26, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(8,14,42,.62)'; ctx.beginPath(); ctx.arc(moon.x + 11, moon.y - 6, 22, 0, TAU); ctx.fill();
        for (let i = 0; i < 40; i++) {
          const tw = (Math.sin(time * 2 + i * 2.3) + 1) / 2;
          ctx.globalAlpha = .3 + tw * .7; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(noise(i + 7) * width, noise(i + 70) * height * .35, .8 + tw * 1.4, 0, TAU); ctx.fill();
        }
      }
      // Fog: drifting banks that thin out for the final 5 s sprint.
      if (weather === 'fog') {
        const k = duration ? Math.max(0, Math.min(1, (duration - 3.5 - time) / 1.5)) : 1;
        ctx.globalAlpha = .35 * k; ctx.fillStyle = '#eef2f5'; ctx.fillRect(0, 0, width, height);
        for (let i = 0; i < 7; i++) {
          const w = 240 + noise(i) * 260, x = ((noise(i + 3) * (width + 400) + time * (14 + noise(i + 9) * 18)) % (width + 400)) - 200, y = noise(i + 20) * height;
          const g = ctx.createRadialGradient(x, y, 10, x, y, w);
          g.addColorStop(0, 'rgba(240,244,248,.75)'); g.addColorStop(1, 'rgba(240,244,248,0)');
          ctx.globalAlpha = k; ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, w, w * .45, 0, 0, TAU); ctx.fill();
        }
      }
      if (!weather || weather === 'sunny') {
        if (weather === 'sunny') for (let i = 0; i < 14; i++) {
          const twinkle = (Math.sin(time * 3 + i * 1.7) + 1) / 2;
          ctx.globalAlpha = twinkle * .5; ctx.fillStyle = '#fffbe0';
          ctx.beginPath(); ctx.arc(noise(i) * width, noise(i + 40) * height, 1.5 + twinkle * 2.5, 0, TAU); ctx.fill();
        }
        return;
      }
      if (weather === 'rain' || weather === 'storm') {
        const drops = weather === 'storm' ? 140 : 80;
        ctx.strokeStyle = '#e6f6ff'; ctx.lineWidth = 1.3;
        for (let i = 0; i < drops; i++) {
          const fall = (time * (1.6 + noise(i) * .8) + noise(i + 7)) % 1, x = (noise(i + 3) * 1.2 - .1) * width + fall * 40, y = fall * (height + 40) - 20;
          ctx.globalAlpha = .35; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 7, y + 18); ctx.stroke();
          if (fall > .92) ring(x, y + 18, 4, 1.5, '#ffffff', .4, 1);
        }
      }
      if (weather === 'wind' || weather === 'storm') {
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        for (let i = 0; i < 10; i++) {
          const run = (time * (.5 + noise(i) * .4) + noise(i + 11)) % 1, x = run * (width + 200) - 200, y = noise(i + 21) * height;
          ctx.globalAlpha = Math.sin(run * Math.PI) * .45;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 60, y - 10, x + 130, y); ctx.stroke();
        }
        ctx.lineCap = 'butt';
      }
      if (weather === 'storm') {
        const strike = (time % 4.3) / 4.3;
        if (strike > .965) { ctx.globalAlpha = (1 - strike) * 12 * .35; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); }
      }
      ctx.globalAlpha = 1;
    }
    // ---- chaos-v2 twist painters: physical-looking water, glass, fire and animals ----
    const clamp01 = v => Math.max(0, Math.min(1, v));
    const ease = t => 1 - (1 - clamp01(t)) ** 3; // matches the app's duck glide
    function line(a, b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    // Droplets thrown up and pulled down by gravity; t runs 0 → ~1.4.
    function splash(spot, t, alpha, tag, color = '#effcff', count = 26) {
      ctx.fillStyle = color;
      for (let i = 0; i < count; i++) {
        const vx = (noise(tag + i) - .5) * 150, vy = -(110 + noise(tag + i + 9) * 140), tt = t * .85;
        const y = Math.min(spot.y + 4, spot.y - 4 + vy * tt + 300 * tt * tt);
        ctx.globalAlpha = Math.max(0, alpha) * (.55 + noise(i + tag) * .45);
        ctx.beginPath(); ctx.arc(spot.x + vx * tt, y, 2.6 + noise(tag + i + 3) * 4.4, 0, TAU); ctx.fill();
      }
    }
    // Flat rings spreading on the water surface.
    function ripples(spot, t, alpha, color = '#ffffff') {
      for (let k = 0; k < 3; k++) {
        const r = t * 1.3 - k * .2;
        if (r > 0 && r < 1) ring(spot.x, spot.y + 8, 18 + r * 90, 4 + r * 20, color, alpha * (1 - r), 3.2);
      }
    }
    // Icon that springs up above a duck.
    // Icon that springs up above a duck: overshoots to 1.35x on a white halo, then settles.
    function pop(icon, spot, m, alpha, size = 58) {
      const k = clamp01(m * 3), bounce = k < .6 ? ease(k / .6) * 1.35 : 1.35 - .35 * ease((k - .6) / .4), y = spot.y - 50 - (1 - alpha) * 14;
      glow({ x: spot.x, y: y + 6 }, size * .9 * Math.max(.4, bounce), '#ffffff', alpha * .55 * (1 - clamp01(m)) + alpha * .15);
      emoji(icon, spot.x, y, size * Math.max(.3, bounce), alpha);
    }
    function glow(spot, radius, color, alpha) {
      const g = ctx.createRadialGradient(spot.x, spot.y - 12, 0, spot.x, spot.y - 12, radius);
      g.addColorStop(0, color); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = Math.max(0, alpha); ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(spot.x, spot.y - 12, radius, 0, TAU); ctx.fill();
    }
    // Arc flight from a to b; returns the current point.
    function flight(a, b, t, height = 60) {
      return { x: a.x + (b.x - a.x) * t, y: a.y - 30 + (b.y - a.y) * t - Math.sin(t * Math.PI) * height };
    }
    // A hit that knocks a duck over: white bloom, a water geyser, a foam ring, droplets and ripples.
    function capsize(spot, t, alpha, tag) {
      const k = clamp01(t);
      glow(spot, 46 + t * 60, '#ffffff', alpha * (1 - k) * .9);
      if (k < .75) {
        const h = 120 * Math.sin(k / .75 * Math.PI), g = ctx.createLinearGradient(0, spot.y - h, 0, spot.y + 6);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.25, 'rgba(240,252,255,.95)'); g.addColorStop(1, 'rgba(150,215,240,.75)');
        ctx.globalAlpha = alpha; ctx.fillStyle = g; ctx.beginPath();
        ctx.moveTo(spot.x - 26, spot.y + 6); ctx.quadraticCurveTo(spot.x - 18, spot.y - h * .6, spot.x - 6, spot.y - h);
        ctx.quadraticCurveTo(spot.x + 2, spot.y - h - 14, spot.x + 10, spot.y - h); ctx.quadraticCurveTo(spot.x + 22, spot.y - h * .6, spot.x + 30, spot.y + 6); ctx.fill();
      }
      ring(spot.x, spot.y + 6, 24 + k * 70, 7 + k * 18, '#ffffff', alpha * (1 - k), 5 * (1 - k) + 1);
      splash(spot, t, alpha, tag, '#effcff', 32); ripples(spot, t, alpha);
    }
    // Anime focus lines, a double shockwave and flying sparks; drawn under every twist's own painter.
    function drawImpact(b, p) {
      const c = { x: b.origin.x, y: b.origin.y - 24 }, e = ease(p), fade = (1 - p) ** 1.4;
      ctx.lineCap = 'round';
      for (let i = 0; i < 28; i++) {
        const a = i / 28 * TAU + noise(b.id + i) * .22, r0 = 48 + e * 46 + noise(i + 3) * 18, len = (70 + noise(i + b.id + 7) * 150) * (1 - p * .6);
        ctx.globalAlpha = fade * .85; ctx.strokeStyle = i % 3 ? '#ffffff' : b.color; ctx.lineWidth = 1.6 + noise(i + 9) * 3.6;
        ctx.beginPath(); ctx.moveTo(c.x + Math.cos(a) * r0, c.y + Math.sin(a) * r0 * .62); ctx.lineTo(c.x + Math.cos(a) * (r0 + len), c.y + Math.sin(a) * (r0 + len) * .62); ctx.stroke();
      }
      ring(c.x, c.y, 18 + e * 170, (18 + e * 170) * .5, '#ffffff', fade, 6 * (1 - p) + 1);
      ring(c.x, c.y, 10 + e * 120, (10 + e * 120) * .5, b.color, fade * .9, 4 * (1 - p) + 1);
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * TAU + noise(i + b.id * 3) * .6, d = 24 + e * (90 + noise(i + 5) * 110), dx = Math.cos(a), dy = Math.sin(a) * .62;
        ctx.globalAlpha = fade; ctx.strokeStyle = i % 2 ? '#fff4b8' : b.color; ctx.lineWidth = 3 * (1 - p) + .8;
        ctx.beginPath(); ctx.moveTo(c.x + dx * d * .72, c.y + dy * d * .72); ctx.lineTo(c.x + dx * d, c.y + dy * d); ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }
    // A duck's current spot (painters that follow a moving duck, e.g. a rocket or a gust).
    const live = id => (Number.isInteger(id) && lastSample[id] ? point(id, lastSample) : null);
    // Glass oval with a glare streak sweeping across it, above the holder.
    function mirrorPane(spot, m, alpha) {
      const scale = clamp01(m * 3), w = 58 * scale, h = 84 * scale, x = spot.x + 78, y = spot.y - 40;
      const g = ctx.createLinearGradient(x - w / 2, y - h / 2, x + w / 2, y + h / 2);
      g.addColorStop(0, '#f4fbff'); g.addColorStop(.45, '#8fd3ff'); g.addColorStop(1, '#e3f5ff');
      glow({ x, y: y + 12 }, 70 * scale + 1, '#e6f7ff', alpha * .8);
      ctx.globalAlpha = Math.max(0, alpha); ctx.fillStyle = g; ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.ellipse(x, y, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, TAU); ctx.fill(); ctx.stroke();
      const sweep = (m * 1.8) % 1;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5 * scale; ctx.globalAlpha = Math.max(0, alpha) * (1 - sweep);
      line({ x: x - w / 2 + sweep * w, y: y - h / 2 + 4 }, { x: x - w / 2 + sweep * w - 12 * scale, y: y + h / 2 - 4 });
      return { x, y };
    }
    function beam(a, b, alpha, color) {
      ctx.lineCap = 'round';
      ctx.globalAlpha = Math.max(0, alpha) * .3; ctx.strokeStyle = color; ctx.lineWidth = 34; line(a, b);
      ctx.globalAlpha = Math.max(0, alpha) * .6; ctx.strokeStyle = color; ctx.lineWidth = 14; line(a, b);
      ctx.globalAlpha = Math.max(0, alpha); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5; line(a, b);
      ctx.lineCap = 'butt';
    }
    // ---- helpers for the big-show skills ----
    // A tapered tentacle rising from `base` (straight trunk, curling tip); `t` (0..1) is how far it has risen.
    function tentacle(base, angle, len, curl, t, alpha, tag) {
      const pts = [], n = 14, step = len * Math.max(.05, t) / n;
      let x = base.x, y = base.y, a = angle;
      for (let i = 0; i <= n; i++) { pts.push({ x, y }); a += curl * (i / n) ** 2 * .09 + Math.sin(tag + i * .7) * .03; x += Math.cos(a) * step; y += Math.sin(a) * step; }
      ctx.lineCap = 'round';
      for (let i = 1; i < pts.length; i++) {
        ctx.globalAlpha = Math.max(0, alpha); ctx.strokeStyle = i % 2 ? '#7a3fa8' : '#9550c9'; ctx.lineWidth = 17 * (1 - i / pts.length) + 3; line(pts[i - 1], pts[i]);
      }
      ctx.fillStyle = '#f6d2ff';
      for (let i = 2; i < pts.length - 2; i += 2) {
        const w = 17 * (1 - i / pts.length) + 3; ctx.globalAlpha = Math.max(0, alpha) * .9;
        ctx.beginPath(); ctx.arc(pts[i].x + w * .22, pts[i].y, w * .17, 0, TAU); ctx.fill();
      }
      ctx.lineCap = 'butt';
    }
    // A shiny flying saucer with a glass dome and chasing rim lights.
    function saucer(x, y, alpha, m) {
      glow({ x, y: y + 34 }, 70, 'rgba(170,255,160,.7)', alpha * .7);
      const body = ctx.createLinearGradient(0, y - 14, 0, y + 14);
      body.addColorStop(0, '#f4f7fb'); body.addColorStop(.5, '#9aa6b6'); body.addColorStop(1, '#4b5566');
      ctx.globalAlpha = Math.max(0, alpha); ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(x, y, 64, 15, 0, 0, TAU); ctx.fill();
      const dome = ctx.createRadialGradient(x - 8, y - 22, 2, x, y - 14, 30);
      dome.addColorStop(0, 'rgba(240,255,255,.95)'); dome.addColorStop(1, 'rgba(90,210,255,.55)');
      ctx.fillStyle = dome; ctx.beginPath(); ctx.ellipse(x, y - 9, 28, 22, 0, Math.PI, 0); ctx.fill();
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * TAU, on = (Math.floor(m * 40) + i) % 3 === 0;
        ctx.globalAlpha = Math.max(0, alpha) * (Math.sin(a) > -.2 ? 1 : .45); ctx.fillStyle = on ? '#fff36b' : ['#ff5ea8', '#7cf5ff', '#7dff8a'][i % 3];
        ctx.beginPath(); ctx.arc(x + Math.cos(a) * 52, y + Math.sin(a) * 9, on ? 4.5 : 3, 0, TAU); ctx.fill();
      }
    }
    // A pirate ship: hull, two sails and a black flag.
    function ship(x, y, alpha, roll) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(roll); ctx.globalAlpha = Math.max(0, alpha);
      ctx.fillStyle = '#5b3418'; ctx.beginPath(); ctx.moveTo(-70, -6); ctx.lineTo(70, -6); ctx.lineTo(52, 22); ctx.lineTo(-56, 22); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#8a5428'; ctx.fillRect(-64, -6, 128, 7);
      ctx.fillStyle = '#1b1b1b'; for (const cx of [-34, -8, 18, 44]) { ctx.beginPath(); ctx.arc(cx, 6, 3.6, 0, TAU); ctx.fill(); }
      ctx.strokeStyle = '#3a2412'; ctx.lineWidth = 4; line({ x: -6, y: -6 }, { x: -6, y: -104 });
      for (const [top, w] of [[-100, 44], [-56, 54]]) {
        const g = ctx.createLinearGradient(-6 - w, 0, -6 + w, 0); g.addColorStop(0, '#fff8e8'); g.addColorStop(1, '#e8dcc0');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-6 - w * .8, top); ctx.quadraticCurveTo(-6, top + 14, -6 + w * .8, top);
        ctx.lineTo(-6 + w, top + 40); ctx.quadraticCurveTo(-6, top + 52, -6 - w, top + 40); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      emoji('🏴‍☠️', x - 4 + Math.sin(roll) * 104, y - 112, 26, alpha);
    }
    // Lit fireworks shell bursting into coloured stars that fall with gravity.
    function starburst(c, e, alpha, color, tag) {
      glow(c, 70 * (1 - e) + 12, color, alpha * (1 - e));
      for (let k = 0; k < 40; k++) {
        const a = k / 40 * TAU + noise(tag + k) * .25, sp = 60 + (k % 3) * 28 + noise(tag + k + 5) * 20;
        const x = c.x + Math.cos(a) * sp * e, y = c.y + Math.sin(a) * sp * e + 70 * e * e;
        ctx.globalAlpha = Math.max(0, alpha) * (1 - e) * (.6 + .4 * Math.sin(e * 30 + k)); ctx.fillStyle = k % 4 ? color : '#ffffff';
        ctx.beginPath(); ctx.arc(x, y, 2.8 * (1 - e) + 1, 0, TAU); ctx.fill();
      }
    }
    const outcomeAt = (b, i) => b.outcomes?.[b.affectedIds?.[i]];
    const blockedAt = (b, i) => ['blocked', 'immune', 'protected', 'reflected'].includes(outcomeAt(b, i)) || !!b.shielded?.[i];
    const PAINT = {
      torpedo(b, f) {
        const land = b.reflected ? .7 : .45;
        if (f.m < land) {
          const t = b.reflected ? (f.m < .35 ? f.m / .35 : 1 - (f.m - .35) / .35) : f.m / land;
          const p = flight(b.origin, b.target, t, 70);
          for (let i = 1; i <= 10; i++) { const q = flight(b.origin, b.target, Math.max(0, t - i * .035), 70); ctx.globalAlpha = (1 - i / 11) * .7; ctx.fillStyle = i < 3 ? '#ffb347' : '#cfc6dc'; ctx.beginPath(); ctx.arc(q.x, q.y, 4 + i * 1.3, 0, TAU); ctx.fill(); }
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(t * TAU * 2); emoji(f.icon, 0, 0, 42, 1); ctx.restore(); return;
        }
        const spot = b.reflected ? b.origin : b.target, t = (f.m - land) / (1 - land) * .7 + f.fade * .8;
        capsize(spot, t, f.alpha, b.id); pop('💥', spot, f.m, f.alpha, 40); pop(f.icon, { x: spot.x + 30, y: spot.y }, f.m, f.alpha, 30);
      },
      // A boulder rises under the leader: its shadow swells, it bursts up, dust cracks out and stars circle.
      rock(b, f) {
        const spot = b.target, rise = ease(f.m / .35), hit = clamp01((f.m - .3) / .7);
        ctx.globalAlpha = f.alpha * .45 * (1 - hit); ctx.fillStyle = '#0d2a3a'; ctx.beginPath(); ctx.ellipse(spot.x + 10, spot.y + 10, 20 + 30 * rise, 6 + 7 * rise, 0, 0, TAU); ctx.fill();
        ctx.save(); ctx.translate(spot.x + 12, spot.y + 14 - 34 * rise); ctx.rotate((1 - rise) * -.6); emoji(f.icon, 0, 0, 64, f.alpha); ctx.restore();
        if (hit > 0) {
          capsize(spot, hit * .7 + f.fade * .8, f.alpha, b.id);
          particles({ x: spot.x + 12, y: spot.y }, clamp01(hit + f.fade * .4), '#b8a27f', 16, 90, b.id + 2);
          for (let k = 0; k < 5; k++) { const a = (f.m + f.fade) * 7 + k * TAU / 5; emoji('⭐', spot.x + Math.cos(a) * 30, spot.y - 56 + Math.sin(a) * 10, 15, f.alpha); }
        }
      },
      boom(b, f) {
        const spot = b.origin, t = f.m * .7 + f.fade * .8;
        glow(spot, 30 + f.m * 70, '#ffb347', f.alpha * (1 - clamp01(t)));
        particles(spot, clamp01(t), '#5b5b5b', 14, 80, b.id);
        capsize(spot, t, f.alpha, b.id); pop(f.icon, spot, f.m, f.alpha, 56);
      },
      // A roaring jet that rides the duck: white-hot core, orange plume, shock diamonds and a smoke trail.
      rocket(b, f) {
        const spot = live(b.actorId) || b.origin, flick = .8 + noise(Math.floor((f.m + f.fade) * 50) + b.id) * .45, len = 170 * flick;
        for (const [w, col, a] of [[26, 'rgba(255,90,20,', .55], [16, 'rgba(255,170,40,', .85], [7, 'rgba(255,250,210,', 1]]) {
          const g = ctx.createLinearGradient(spot.x - len, spot.y, spot.x - 22, spot.y);
          g.addColorStop(0, col + '0)'); g.addColorStop(.55, col + a * .7 + ')'); g.addColorStop(1, col + a + ')');
          ctx.globalAlpha = f.alpha; ctx.fillStyle = g;
          ctx.beginPath(); ctx.moveTo(spot.x - 22, spot.y - 14 - w / 2); ctx.quadraticCurveTo(spot.x - len * .5, spot.y - 14 - w * .3, spot.x - len * (w === 7 ? .55 : 1), spot.y - 14);
          ctx.quadraticCurveTo(spot.x - len * .5, spot.y - 14 + w * .3, spot.x - 22, spot.y - 14 + w / 2); ctx.fill();
        }
        for (let d = 0; d < 3; d++) { ctx.globalAlpha = f.alpha * .8; ctx.fillStyle = '#fffbe0'; ctx.beginPath(); ctx.ellipse(spot.x - 50 - d * 34, spot.y - 14, 6, 4, 0, 0, TAU); ctx.fill(); }
        for (let i = 0; i < 14; i++) { const u = ((f.m + f.fade) * 2.2 + i / 14) % 1; ctx.globalAlpha = f.alpha * (1 - u) * .55; ctx.fillStyle = '#d7d2cc'; ctx.beginPath(); ctx.arc(spot.x - len - u * 120 + noise(i) * 20, spot.y - 14 + (noise(i + b.id) - .5) * 30 * u, 6 + u * 16, 0, TAU); ctx.fill(); }
        pop(f.icon, { x: spot.x - 34, y: spot.y + 24 }, f.m, f.alpha, 40);
      },
      fly(b, f) {
        const spot = b.origin, from = b.pre.origin, t = ease(f.m / .7);
        // Golden flight arc from where it took off, shedding feathers.
        ctx.globalAlpha = f.alpha * .8; ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.setLineDash([2, 12]);
        ctx.beginPath(); ctx.moveTo(from.x, from.y - 26); ctx.quadraticCurveTo((from.x + spot.x) / 2, Math.min(from.y, spot.y) - 120, from.x + (spot.x - from.x) * t, from.y - 26 + (spot.y - from.y) * t - Math.sin(t * Math.PI) * 60); ctx.stroke(); ctx.setLineDash([]); ctx.lineCap = 'butt';
        for (let i = 0; i < 7; i++) { const u = clamp01(t - i * .1), q = flight({ x: from.x, y: from.y - 6 }, { x: spot.x, y: spot.y - 6 }, u, 90), fall = (f.m + f.fade) * 40 * (i + 1) / 7; ctx.save(); ctx.translate(q.x, q.y + fall); ctx.rotate(fall * .08 + i); emoji('🪶', 0, 0, 18, f.alpha * (1 - i / 9)); ctx.restore(); }
        const g = ctx.createLinearGradient(spot.x - 170, spot.y, spot.x, spot.y);
        g.addColorStop(0, 'rgba(255,230,120,0)'); g.addColorStop(1, 'rgba(255,240,170,.9)');
        ctx.globalAlpha = f.alpha * clamp01(f.m * 3); ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(spot.x - 85, spot.y - 26, 90, 14, 0, 0, TAU); ctx.fill();
        for (let i = 0; i < 9; i++) {
          const drift = clamp01(f.m + f.fade * .7), x = spot.x - 30 - noise(b.id + i) * 120 - drift * 30, y = spot.y - 50 + noise(i + 4) * 40 + drift * 40;
          ctx.globalAlpha = f.alpha * .85; ctx.fillStyle = i % 2 ? '#fff6c8' : '#ffffff';
          ctx.beginPath(); ctx.ellipse(x, y, 7, 2.5, drift * 4 + i, 0, TAU); ctx.fill();
        }
        pop(f.icon, spot, f.m, f.alpha, 52);
      },
      // Each swept duck rides its own curling wave from where it was to where it lands.
      wave(b, f) {
        const after = b.affected.length ? b.affected : [b.target], before = b.pre.affected.length ? b.pre.affected : [b.pre.target];
        const k = ease(f.m / .93), lift = Math.sin(clamp01(f.m / .93) * Math.PI);
        before.forEach((p, i) => {
          const x = p.x + (after[i].x - p.x) * k + 40, y = p.y + 10, h = 70 + 50 * lift * (1 - f.fade);
          const g = ctx.createLinearGradient(x, y - h, x + 90, y);
          g.addColorStop(0, '#f2fdff'); g.addColorStop(.35, '#4fb8e8'); g.addColorStop(1, '#0f5c8c');
          ctx.globalAlpha = f.alpha * .92; ctx.fillStyle = g;
          ctx.beginPath(); ctx.moveTo(x + 120, y); ctx.lineTo(x - 6, y);
          ctx.quadraticCurveTo(x - 34, y - h * .5, x - 8, y - h + 8);
          ctx.quadraticCurveTo(x + 22, y - h - 22, x + 60, y - h + 6);
          ctx.quadraticCurveTo(x + 110, y - h * .35, x + 120, y); ctx.fill();
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(x - 10, y - h + 12); ctx.quadraticCurveTo(x + 18, y - h - 20, x + 58, y - h + 8); ctx.stroke(); ctx.lineCap = 'butt';
          splash({ x: x - 8, y: y - h + 14 }, (f.m * 2.2 + i * .3) % 1.1, f.alpha, b.id + i * 5, '#ffffff', 14);
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5;
          for (let s = 0; s < 4; s++) { ctx.globalAlpha = f.alpha * .55 * (1 - k * .6); line({ x: x + 130 + s * 14, y: y - 18 - s * 10 }, { x: x + 190 + s * 22, y: y - 18 - s * 10 }); }
          ripples({ x: after[i].x, y: p.y }, f.m + f.fade, f.alpha * .8);
        });
        pop(f.icon, b.origin, f.m, f.alpha, 58);
      },
      // The rod casts to the leader's spot, then the taut line reels it in (in step with its glide).
      hook(b, f) {
        const rod = { x: b.origin.x + 16, y: b.origin.y - 60 }, from = b.pre.target, to = b.target;
        const cast = clamp01(f.m / .37), reel = ease((f.m - .37) / .63);
        const tip = f.m < .37 ? flight(rod, { x: from.x, y: from.y - 20 }, cast, 70) : { x: from.x + (to.x - from.x) * reel, y: from.y - 20 + (to.y - from.y) * reel };
        ctx.globalAlpha = f.alpha; ctx.strokeStyle = '#1f1f1f'; ctx.lineWidth = f.m < .37 ? 2 : 3;
        ctx.beginPath(); ctx.moveTo(rod.x, rod.y);
        ctx.quadraticCurveTo((rod.x + tip.x) / 2, Math.min(rod.y, tip.y) - (f.m < .37 ? 70 : 8 * (1 - reel)), tip.x, tip.y); ctx.stroke();
        emoji(f.icon, b.origin.x + 10, b.origin.y - 46, 46, f.alpha);
        ring(rod.x - 6, rod.y + 18, 7, 7, '#ffd166', f.alpha, 3);
        ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2; const sp = (f.m + f.fade) * TAU * 6;
        line({ x: rod.x - 6, y: rod.y + 18 }, { x: rod.x - 6 + Math.cos(sp) * 7, y: rod.y + 18 + Math.sin(sp) * 7 });
        emoji('🪝', tip.x, tip.y + 4, 30, f.alpha);
        if (f.m >= .37) {
          for (let i = 1; i <= 6; i++) { const u = Math.max(0, reel - i * .06), x = from.x + (to.x - from.x) * u; ctx.globalAlpha = f.alpha * (1 - i / 7) * .7; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x + 20, from.y + 6, 5 - i * .5, 0, TAU); ctx.fill(); }
          splash({ x: tip.x, y: from.y + 4 }, reel * .8, f.alpha, b.id, '#e9fbff', 16);
        } else ripples({ x: from.x, y: from.y }, cast, f.alpha * .6);
      },
      // Each swept duck gets its own dark twister: it touches down on the duck, then carries it
      // back down the river in step with the app's tornado glide (delay .07, length .2 race-s → m .26 to 1).
      tornado(b, f) {
        const before = b.pre.affected.length ? b.pre.affected : [b.pre.target], after = b.affected.length ? b.affected : [b.target];
        const grow = ease(f.m / .2), k = ease((f.m - .26) / .74), spin = (f.m * 2.5 + f.fade) * TAU * 2;
        const H = 150 * grow * (1 - f.fade * .7), wide = t => (9 + 48 * t * t) * (.5 + .5 * grow);
        let crown = null;
        before.forEach((p, i) => {
          const q = after[i]; if (!q || b.shielded?.[i]) return; // guarded or ghosted ducks sit it out
          const x = p.x + (q.x - p.x) * k, base = p.y + 6, sway = t => Math.sin(spin * .35 + t * 4 + i) * 10 * t;
          ctx.globalAlpha = f.alpha * .4; ctx.fillStyle = '#16354a';
          ctx.beginPath(); ctx.ellipse(x, base, 36, 9, 0, 0, TAU); ctx.fill();
          const body = ctx.createLinearGradient(0, base - H, 0, base);
          body.addColorStop(0, 'rgba(214,224,244,.6)'); body.addColorStop(.5, 'rgba(92,108,142,.78)'); body.addColorStop(1, 'rgba(44,56,84,.9)');
          ctx.globalAlpha = f.alpha; ctx.fillStyle = body; ctx.beginPath();
          for (let j = 0; j <= 10; j++) { const t = j / 10, px = x + sway(t) - wide(t), py = base - H * t; if (j) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
          for (let j = 10; j >= 0; j--) { const t = j / 10; ctx.lineTo(x + sway(t) + wide(t), base - H * t); }
          ctx.fill();
          for (let j = 0; j < 10; j++) {
            const t = j / 9, st = spin * 1.2 + t * 5 + i;
            ctx.globalAlpha = f.alpha * (.5 + .5 * t); ctx.strokeStyle = j % 2 ? '#ffffff' : '#c8d3ea'; ctx.lineWidth = 1.5 + t * 2.5;
            ctx.beginPath(); ctx.ellipse(x + sway(t), base - H * t, wide(t), wide(t) * .28, 0, st, st + Math.PI * 1.2); ctx.stroke();
          }
          for (let j = 0; j < 12; j++) {
            const t = (noise(j + b.id + i * 13) + f.m * .8 + f.fade * .3) % 1, ang = spin * 1.6 + j * 2.4, r = wide(t) * 1.15;
            ctx.globalAlpha = f.alpha * (Math.sin(ang) > 0 ? 1 : .45); ctx.fillStyle = j % 3 ? '#ffffff' : '#5f8f43';
            ctx.beginPath(); ctx.ellipse(x + sway(t) + Math.cos(ang) * r, base - H * t + Math.sin(ang) * r * .28, j % 3 ? 2.6 : 5, j % 3 ? 2.6 : 2.2, ang, 0, TAU); ctx.fill();
          }
          if (k > 0 && f.m < 1) for (let s = 1; s <= 6; s++) {
            const u = Math.max(0, k - s * .07), tx = p.x + (q.x - p.x) * u;
            ctx.globalAlpha = f.alpha * (1 - s / 7) * .6; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.ellipse(tx + 30, base - 20, 14, 5, 0, spin + s, spin + s + 4); ctx.stroke();
          }
          if (f.m >= 1) { splash({ x: q.x, y: q.y }, f.fade * 1.3, f.alpha, b.id + i * 7, '#effcff', 18); ripples({ x: q.x, y: q.y }, f.fade, f.alpha * .8); }
          if (!crown || base - H < crown.y) crown = { x: x + sway(1), y: base - H };
        });
        if (crown) pop(f.icon, { x: crown.x, y: crown.y + 30 }, f.m, f.alpha, 52);
      },
      // Armed: the bomb is lobbed onto the leader (the fuse then rides the leader via CSS). Boom: a fireball where it went off.
      timebomb(b, f) {
        if (b.outcome === 'armed') {
          const t = clamp01(f.m / .7), p = flight({ x: b.origin.x, y: b.origin.y - 10 }, { x: b.target.x, y: b.target.y - 40 }, t, 90);
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(t * TAU * 1.5); emoji(f.icon, 0, 0, 40, f.alpha); ctx.restore();
          for (let i = 0; i < 8; i++) { const u = (f.m * 3 + i / 8) % 1; ctx.globalAlpha = f.alpha * (1 - u); ctx.fillStyle = i % 2 ? '#ffd84d' : '#ff6a1e'; ctx.beginPath(); ctx.arc(p.x - 14 + (noise(i + b.id) - .5) * 20 * u, p.y - 18 - u * 26, 2.5 * (1 - u) + .6, 0, TAU); ctx.fill(); }
          if (t >= 1) ripples(b.target, (f.m - .7) * 2 + f.fade, f.alpha * .7, '#ffd84d');
          return;
        }
        const s = b.target, t = f.m * .8 + f.fade * .9;
        glow({ x: s.x, y: s.y - 20 }, 40 + t * 110, '#ffe08a', f.alpha * (1 - clamp01(t)));
        const fire = ctx.createRadialGradient(s.x, s.y - 26, 0, s.x, s.y - 26, 30 + t * 90);
        fire.addColorStop(0, 'rgba(255,250,210,.95)'); fire.addColorStop(.35, 'rgba(255,170,40,.85)'); fire.addColorStop(.7, 'rgba(230,60,20,.55)'); fire.addColorStop(1, 'rgba(60,30,20,0)');
        ctx.globalAlpha = f.alpha * (1 - clamp01(t * .8)); ctx.fillStyle = fire; ctx.beginPath(); ctx.arc(s.x, s.y - 26, 30 + t * 90, 0, TAU); ctx.fill();
        for (let k = 0; k < 2; k++) { const r = t * 1.3 - k * .2; if (r > 0 && r < 1) ring(s.x, s.y - 10, 30 + r * 150, (30 + r * 150) * .35, '#ffffff', f.alpha * (1 - r), 4); }
        particles({ x: s.x, y: s.y - 26 }, clamp01(t), '#4a3a30', 18, 130, b.id);
        particles({ x: s.x, y: s.y - 26 }, clamp01(t * 1.2), '#ffb02e', 14, 95, b.id + 3);
        splash(s, t, f.alpha, b.id, '#fff2d0', 22);
        pop('💥', s, f.m, f.alpha, 70);
      },
      // A die tumbles over the roller and lands on its number (the duck then glides: delay .12 s → m .44).
      dice(b, f) {
        const s = b.pre.origin, land = clamp01(f.m / .44), y = s.y - 70 - Math.abs(Math.sin(land * Math.PI * 2.5)) * 50 * (1 - land), size = 46;
        ctx.save(); ctx.translate(s.x, y); ctx.rotate((1 - land) * TAU * 2.2);
        ctx.globalAlpha = f.alpha; ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-size / 2, -size / 2, size, size, 10) : ctx.rect(-size / 2, -size / 2, size, size); ctx.fill(); ctx.stroke();
        const face = land < 1 ? 1 + Math.floor(f.m * 40) % 6 : b.roll || 1, pip = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] }[face];
        ctx.fillStyle = face === 1 && land >= 1 ? '#e0302a' : '#1d1d1d';
        for (const [px, py] of pip) { ctx.beginPath(); ctx.arc(px * 12, py * 12, face === 1 ? 7 : 5, 0, TAU); ctx.fill(); }
        ctx.restore();
        pop(f.icon, { x: s.x - 44, y: s.y - 10 }, f.m, f.alpha, 30);
        if (land >= 1) {
          glow({ x: s.x, y: y + 20 }, 50, b.roll === 6 ? '#ffe36a' : b.roll === 1 ? '#ff7b7b' : '#ffffff', f.alpha * .8);
          emoji(b.roll === 1 ? '💀' : b.roll === 6 ? '🌟' : '✨', s.x + 36, y - 20, 30, f.alpha);
          if (b.roll === 1) capsize(b.origin, (f.m - .44) + f.fade * .8, f.alpha, b.id);
        }
      },
      // Sound waves ripple out from the singer, notes drift to each sleeper, then Z's float up.
      lullaby(b, f) {
        const s = b.origin, time = f.m + f.fade;
        for (let k = 0; k < 4; k++) { const r = (f.m * 1.6 + k / 4) % 1; ring(s.x, s.y - 20, 30 + r * 220, (30 + r * 220) * .55, '#d9ccff', f.alpha * (1 - r) * .8, 3); }
        b.affected.forEach((p, i) => {
          const u = clamp01((f.m - i * .08) / .6), q = flight({ x: s.x, y: s.y - 30 }, { x: p.x, y: p.y - 40 }, u, 40);
          if (u < 1) emoji(i % 2 ? '🎶' : '🎵', q.x, q.y, 26, f.alpha);
          else for (let z = 0; z < 3; z++) { const rise = (time * .9 + z / 3) % 1; emoji('💤', p.x + 22 + rise * 18, p.y - 50 - rise * 40, 18 + z * 4, f.alpha * (1 - rise)); }
        });
        pop(f.icon, s, f.m, f.alpha, 52);
      },
      // A wand sparkles over the caster, a bolt of glitter flies to the leader, and a green puff turns it into a frog.
      hex(b, f) {
        const from = { x: (b.reflected ? b.target : b.origin).x + 30, y: (b.reflected ? b.target : b.origin).y - 50 }, to = b.reflected ? b.origin : b.target;
        emoji(f.icon, b.origin.x + 26, b.origin.y - 56, 40, f.alpha);
        const t = clamp01(f.m / .45), p = flight(from, { x: to.x, y: to.y - 30 }, t, 50);
        for (let i = 0; i < 10; i++) { const u = Math.max(0, t - i * .04), q = flight(from, { x: to.x, y: to.y - 30 }, u, 50); ctx.globalAlpha = f.alpha * (1 - i / 10); ctx.fillStyle = i % 2 ? '#d7ff7a' : '#ffffff'; ctx.beginPath(); ctx.arc(q.x, q.y, 4 - i * .3, 0, TAU); ctx.fill(); }
        if (t < 1) emoji('✨', p.x, p.y, 24, f.alpha);
        else {
          const u = (f.m - .45) / .55 * .7 + f.fade * .6;
          for (let i = 0; i < 9; i++) { const a = i / 9 * TAU, r = 20 + u * 50; ctx.globalAlpha = f.alpha * (1 - clamp01(u)) * .8; ctx.fillStyle = i % 2 ? '#7ed957' : '#b8f58e'; ctx.beginPath(); ctx.arc(to.x + Math.cos(a) * r, to.y - 26 + Math.sin(a) * r * .6, 14 * (1 - clamp01(u)) + 4, 0, TAU); ctx.fill(); }
          pop('🐸', to, f.m - .45, f.alpha, 56);
        }
      },
      // A mushroom pops, the caster swells, and each duck just ahead is stomped aside with dust and stars.
      giant(b, f) {
        const s = b.origin;
        pop(f.icon, { x: s.x - 30, y: s.y - 20 }, f.m, f.alpha, 54);
        glow({ x: s.x, y: s.y - 30 }, 70 + 30 * Math.sin(f.m * 12), '#ffb3b3', f.alpha * .6);
        for (let k = 0; k < 3; k++) { const r = (f.m * 2 + k / 3) % 1; ring(s.x, s.y + 6, 30 + r * 160, 8 + r * 34, '#ffffff', f.alpha * (1 - r) * .7, 3); }
        b.pre.affected.forEach((p, i) => {
          const hit = clamp01((f.m - .2 - i * .1) / .3);
          if (hit <= 0) return;
          particles({ x: p.x, y: p.y }, clamp01(hit * .8 + f.fade * .5), '#c9a77a', 12, 60, b.id + i);
          for (let k = 0; k < 4; k++) { const a = (f.m + f.fade) * 6 + k * TAU / 4; emoji('⭐', p.x + Math.cos(a) * 26, p.y - 46 + Math.sin(a) * 9, 14, f.alpha); }
        });
      },
      banana(b, f) {
        const spot = b.atActor ? b.origin : b.target, spin = (f.m + f.fade) * TAU * 3;
        ctx.save(); ctx.translate(spot.x - (b.atActor ? 40 : 0), spot.y - 20); ctx.rotate(spin);
        emoji(f.icon, 0, 10, 38, f.alpha); ctx.restore();
        if (!b.atActor) {
          ctx.globalAlpha = f.alpha * .7; ctx.strokeStyle = '#ffe36a'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(spot.x, spot.y - 4, 26, spin, spin + Math.PI * 1.4); ctx.stroke();
          ripples(spot, f.m * .8 + f.fade, f.alpha);
        }
      },
      guard(b, f) {
        const spot = b.origin, r = 46 + Math.sin(clamp01(f.m * 2) * Math.PI * .5) * 10;
        const g = ctx.createRadialGradient(spot.x, spot.y - 20, r * .3, spot.x, spot.y - 20, r);
        g.addColorStop(0, 'rgba(194,251,255,0)'); g.addColorStop(.85, 'rgba(194,251,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,.9)');
        ctx.globalAlpha = f.alpha; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(spot.x, spot.y - 20, r, 0, TAU); ctx.fill();
        ripples(spot, f.m + f.fade, f.alpha, '#c2fbff');
        pop(f.icon, spot, f.m, f.alpha, 50);
      },
      croc(b, f) {
        const spot = b.target, bite = clamp01(f.m / .5), gap = 26 * (1 - bite) + 2, x = spot.x + 34;
        ctx.globalAlpha = f.alpha; ctx.fillStyle = '#3f7d3a';
        ctx.beginPath(); ctx.moveTo(x - 50, spot.y - 20 - gap); ctx.lineTo(x + 30, spot.y - 20 - gap * .3); ctx.lineTo(x + 30, spot.y - 34 - gap); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - 50, spot.y - 14 + gap); ctx.lineTo(x + 30, spot.y - 14 + gap * .3); ctx.lineTo(x + 30, spot.y + gap); ctx.fill();
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 5; i++) { const tx = x - 40 + i * 15; ctx.beginPath(); ctx.moveTo(tx, spot.y - 20 - gap * (1 - i * .15)); ctx.lineTo(tx + 5, spot.y - 13 - gap * (1 - i * .15)); ctx.lineTo(tx + 10, spot.y - 20 - gap * (1 - i * .15)); ctx.fill(); }
        if (bite >= 1) splash(spot, (f.m - .5) * 1.4 + f.fade * .8, f.alpha, b.id, '#e8fff0', 12);
        pop(f.icon, spot, f.m, f.alpha, 46);
      },
      // A swirling gust rides the boosted duck: curling wind ribbons, tumbling leaves and spray.
      wind(b, f) {
        const spot = live(b.actorId) || b.target, time = f.m * 1.6 + f.fade;
        ctx.lineCap = 'round';
        for (let i = 0; i < 9; i++) {
          const phase = (time + i / 9) % 1, x = spot.x - 230 + phase * 290, y = spot.y - 64 + i * 11, curl = 10 + noise(i + b.id) * 14;
          ctx.globalAlpha = f.alpha * Math.sin(phase * Math.PI) * .95; ctx.strokeStyle = i % 3 ? '#ffffff' : '#c9f3ff'; ctx.lineWidth = 4 - (i % 3);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x + 40, y - curl, x + 70, y + curl, x + 110, y);
          if (i % 3 === 0) ctx.arc(x + 110, y - 8, 8, Math.PI / 2, Math.PI * 2.2);
          ctx.stroke();
        }
        ctx.lineCap = 'butt';
        for (let i = 0; i < 6; i++) { const u = (time * 1.3 + i / 6) % 1; ctx.save(); ctx.translate(spot.x - 200 + u * 260, spot.y - 70 + Math.sin(u * 8 + i) * 18 + i * 8); ctx.rotate(u * 10 + i); emoji(i % 2 ? '🍃' : '🍂', 0, 0, 18, f.alpha * Math.sin(u * Math.PI)); ctx.restore(); }
        splash({ x: spot.x - 30, y: spot.y }, (time * .8) % 1.1, f.alpha * .6, b.id, '#ffffff', 10);
        pop(f.icon, spot, f.m, f.alpha, 52);
      },
      // Dark funnel with turning spiral arms and orbiting foam.
      whirlpool(b, f) {
        const c = { x: b.target.x, y: b.target.y + 4 }, spin = (f.m + f.fade) * TAU * 2.2;
        const g = ctx.createRadialGradient(c.x, c.y, 2, c.x, c.y, 76);
        g.addColorStop(0, 'rgba(4,30,58,.9)'); g.addColorStop(.5, 'rgba(26,104,156,.5)'); g.addColorStop(1, 'rgba(120,200,240,0)');
        ctx.globalAlpha = f.alpha; ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(c.x, c.y, 78, 28, 0, 0, TAU); ctx.fill();
        for (let arm = 0; arm < 3; arm++) {
          ctx.beginPath();
          for (let i = 0; i <= 25; i++) {
            const t = i / 25, ang = spin + arm * TAU / 3 + t * TAU * 1.6, r = 6 + t * 68;
            const x = c.x + Math.cos(ang) * r, y = c.y + Math.sin(ang) * r * .36;
            if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
          }
          ctx.globalAlpha = f.alpha * .9; ctx.strokeStyle = arm % 2 ? '#e9fbff' : '#8fd6ff'; ctx.lineWidth = 3.2; ctx.stroke();
        }
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 16; i++) {
          const ang = spin * 1.6 + i / 16 * TAU, r = 28 + noise(i + b.id) * 42;
          ctx.globalAlpha = f.alpha * .85; ctx.beginPath(); ctx.arc(c.x + Math.cos(ang) * r, c.y + Math.sin(ang) * r * .36, 2 + noise(i) * 2.4, 0, TAU); ctx.fill();
        }
        pop(f.icon, b.target, f.m, f.alpha, 54);
      },
      // The dolphin leaps a rainbow arc over the duck, nose along the curve.
      dolphin(b, f) {
        const spot = b.target, t = clamp01(f.m / .85), from = { x: spot.x - 160, y: spot.y + 16 }, to = { x: spot.x + 70, y: spot.y + 16 };
        const at = u => ({ x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u - Math.sin(u * Math.PI) * 120 });
        ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0'].forEach((col, i) => {
          ctx.globalAlpha = f.alpha * .4; ctx.strokeStyle = col; ctx.lineWidth = 3.5; ctx.beginPath();
          for (let k = 0; k <= 20; k++) { const p = at(t * k / 20); if (k) ctx.lineTo(p.x, p.y + 10 + i * 4); else ctx.moveTo(p.x, p.y + 10 + i * 4); }
          ctx.stroke();
        });
        ctx.fillStyle = '#eafcff';
        for (let i = 0; i < 12; i++) {
          const u = t - i * .035; if (u < 0) break;
          const p = at(u); ctx.globalAlpha = f.alpha * (1 - i / 12);
          ctx.beginPath(); ctx.arc(p.x - 6 + noise(i + b.id) * 12, p.y + 12 + i * 2.4, Math.max(.6, 3.4 - i * .22), 0, TAU); ctx.fill();
        }
        const p = at(t), q = at(Math.min(1, t + .02));
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(q.y - p.y, q.x - p.x)); ctx.scale(-1, 1); // emoji faces left
        emoji(f.icon, 0, 16, 60, f.alpha); ctx.restore();
        splash(from, t * 1.4, f.alpha * (1 - t), b.id, '#e9fbff', 18); ripples(from, t, f.alpha * (1 - t));
        if (t >= 1) { const after = (f.m - .85) * 3 + f.fade; splash(to, after, f.alpha, b.id + 5, '#e9fbff', 22); ripples(to, after, f.alpha); }
      },
      // Heat-seeking missile: smoke trail curving onto the leader, reticle, then a fireball.
      missile(b, f) {
        const a = { x: b.origin.x + 20, y: b.origin.y - 40 }, c = { x: (b.origin.x + b.target.x) / 2, y: Math.min(b.origin.y, b.target.y) - 150 };
        const at = t => ({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.target.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * (b.target.y - 20) });
        const t = clamp01(f.m / .55), hit = { x: b.target.x, y: b.target.y - 20 };
        for (let i = 14; i >= 1; i--) {
          const u = t - i * .035; if (u < 0) continue;
          const p = at(u), age = i / 14;
          ctx.globalAlpha = f.alpha * (1 - age) * .75; ctx.fillStyle = '#8f98a3';
          ctx.beginPath(); ctx.arc(p.x + (noise(i + b.id) - .5) * 8, p.y, 5 + age * 14, 0, TAU); ctx.fill();
        }
        if (t < 1) {
          const spin = f.m * TAU * 2;
          ring(hit.x, hit.y, 30, 30, '#ff3b3b', .9, 3); ring(hit.x, hit.y, 18 + Math.sin(spin) * 3, 18 + Math.sin(spin) * 3, '#ff3b3b', .7, 2);
          emoji(f.icon, hit.x + 34, hit.y - 26, 26, 1);
          const p = at(t), q = at(Math.min(1, t + .02));
          glow(p, 26, '#ffb347', .9);
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(q.y - p.y, q.x - p.x) + Math.PI / 4); emoji('🚀', 0, 12, 44, 1); ctx.restore();
          return;
        }
        const e = clamp01((f.m - .55) / .45) * .7 + f.fade * .6;
        const g = ctx.createRadialGradient(hit.x, hit.y, 0, hit.x, hit.y, 30 + e * 90);
        g.addColorStop(0, '#fffbe6'); g.addColorStop(.25, '#ffd166'); g.addColorStop(.55, '#ff7b29'); g.addColorStop(1, 'rgba(200,40,20,0)');
        ctx.globalAlpha = f.alpha * (1 - clamp01(e)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hit.x, hit.y, 30 + e * 90, 0, TAU); ctx.fill();
        ring(hit.x, hit.y + 10, 30 + e * 140, 12 + e * 50, '#ffffff', f.alpha * (1 - clamp01(e)), 4);
        particles(hit, clamp01(e), '#5d5d5d', 16, 110, b.id);
        capsize(b.target, e, f.alpha, b.id);
        emoji(f.icon, hit.x + 34, hit.y - 30, 26, f.alpha * (1 - clamp01(e)));
        pop('💥', b.target, (f.m - .55) / .45, f.alpha, 62);
      },
      // A swarm flies from the caster to each target and buzzes around it in figure-eights.
      bees(b, f) {
        const spots = b.affected.length ? b.affected : [b.target], time = f.m + f.fade, arrive = clamp01(f.m / .35);
        spots.forEach((spot, s) => {
          for (let i = 0; i < 9; i++) {
            const ph = time * 9 + i * .7 + s, r = 26 + noise(i + s * 9) * 22;
            const ox = Math.cos(ph) * r, oy = Math.sin(ph * 2) * r * .45 - 34;
            const home = { x: spot.x + ox, y: spot.y + oy }, from = { x: b.origin.x, y: b.origin.y - 30 };
            const x = from.x + (home.x - from.x) * arrive, y = from.y + (home.y - from.y) * arrive - Math.sin(arrive * Math.PI) * 40;
            ctx.fillStyle = '#ffd34d';
            for (let k = 1; k <= 3; k++) { ctx.globalAlpha = f.alpha * (.35 - k * .1); ctx.beginPath(); ctx.arc(x - Math.cos(ph) * k * 5, y - Math.sin(ph * 2) * k * 3, 2.2, 0, TAU); ctx.fill(); }
            emoji(f.icon, x, y + 6, 18, f.alpha);
          }
          if (arrive >= 1) { ctx.strokeStyle = '#3b2f00'; ctx.lineWidth = 2; for (let k = 0; k < 3; k++) { ctx.globalAlpha = f.alpha * .6; const yy = spot.y - 62 - k * 6; line({ x: spot.x - 10 + k * 8, y: yy }, { x: spot.x - 4 + k * 8, y: yy - 6 }); } }
        });
      },
      // Event horizon with a spinning accretion disk; streaks spiral in from every duck.
      // The hole opens on the swallowed duck (which shrinks into it via CSS), a wormhole streak runs back
      // down the river in step with its glide (delay .1, length .1 race-s → m .37 to .74), and a white hole spits it out.
      blackhole(b, f) {
        const P = b.reflected ? b.pre.origin : b.pre.target, L = b.reflected ? b.origin : b.target, hit = b.outcome === 'hit' || b.reflected;
        const c = { x: P.x, y: P.y - 22 }, open = ease(f.m / .3), shut = hit ? ease((f.m - .74) / .26) : ease((f.m - .4) / .4);
        const R = 44 * open * (1 - shut) + 2, spin = (f.m * 3 + f.fade) * TAU;
        if (R > 3) {
          const halo = ctx.createRadialGradient(c.x, c.y, R * .4, c.x, c.y, R * 3.2);
          halo.addColorStop(0, 'rgba(90,40,170,.75)'); halo.addColorStop(.5, 'rgba(60,20,120,.3)'); halo.addColorStop(1, 'rgba(60,20,120,0)');
          ctx.globalAlpha = f.alpha; ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(c.x, c.y, R * 3.2, 0, TAU); ctx.fill();
          for (let k = 0; k < 3; k++) { const w = 1 - ((f.m * 2.2 + k / 3) % 1); ring(c.x, c.y, R * (1 + w * 2.4), R * (1 + w * 2.4) * .42, '#d9c2ff', f.alpha * (1 - w) * .8, 2); }
          for (let j = 0; j < 26; j++) {
            const u = (noise(j + b.id) + f.m * 1.8) % 1, a = j * 2.4 + u * 5, rr = R * (3.4 - u * 3.1);
            ctx.globalAlpha = f.alpha * u; ctx.fillStyle = j % 3 ? '#ffffff' : '#ffb347';
            ctx.beginPath(); ctx.arc(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr * .45, 1.4 + u * 2, 0, TAU); ctx.fill();
          }
          ['#ffb347', '#ff5ea8', '#a97bff'].forEach((col, i) => {
            ctx.globalAlpha = f.alpha * .95; ctx.strokeStyle = col; ctx.lineWidth = 5 - i * 1.2;
            for (let k = 0; k < 3; k++) { const st = spin * (1.4 + i * .4) + k * TAU / 3; ctx.beginPath(); ctx.ellipse(c.x, c.y, R * (1.25 + i * .22), R * (.42 + i * .07), -.2, st, st + 1.7); ctx.stroke(); }
          });
          ctx.globalAlpha = f.alpha; ctx.fillStyle = '#030106'; ctx.beginPath(); ctx.arc(c.x, c.y, R * .62, 0, TAU); ctx.fill();
          ring(c.x, c.y, R * .68, R * .68, '#ffffff', f.alpha * .85, 1.8);
        }
        if (hit && f.m > .3) {
          const u = ease((f.m - .37) / .37), mid = { x: (c.x + L.x) / 2, y: Math.min(c.y, L.y) - 70 };
          ctx.globalAlpha = f.alpha * .55 * (1 - shut * .6); ctx.strokeStyle = '#b48bff'; ctx.lineWidth = 3; ctx.setLineDash([10, 8]); ctx.lineDashOffset = -f.m * 120;
          ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.quadraticCurveTo(mid.x, mid.y, L.x, L.y - 22); ctx.stroke(); ctx.setLineDash([]);
          if (u > 0 && u < 1) { const q = (1 - u) ** 2, r2 = 2 * u * (1 - u), p2 = u * u; glow({ x: q * c.x + r2 * mid.x + p2 * L.x, y: q * c.y + r2 * mid.y + p2 * (L.y - 22) + 12 }, 26, '#e7dbff', f.alpha); }
        }
        if (hit && f.m >= .74) {
          const t = clamp01((f.m - .74) / .26) * .6 + f.fade;
          glow(L, 30 + t * 70, '#ffffff', f.alpha * (1 - clamp01(t)));
          for (let k = 0; k < 3; k++) { const r = t * 1.2 - k * .18; if (r > 0 && r < 1) ring(L.x, L.y - 22, 20 + r * 90, (20 + r * 90) * .5, k ? '#c9a8ff' : '#ffffff', f.alpha * (1 - r), 3); }
          particles({ x: L.x, y: L.y - 22 }, clamp01(t), '#e7dbff', 16, 80, b.id);
          splash(L, t, f.alpha, b.id, '#f1e8ff', 16);
        }
        pop(f.icon, P, f.m, f.alpha, 54);
      },
      // The ghost streaks forward through the ducks ahead (in step with its glide: delay .03, length .2 race-s
      // → m .11 to .85), leaving wisps; each duck it passes through gets a fright.
      ghost(b, f) {
        const A = b.pre.origin, B = b.origin, k = ease((f.m - .11) / .74), x = A.x + (B.x - A.x) * k, y = B.y, time = f.m + f.fade;
        glow({ x, y }, 64, '#eef3ff', f.alpha * .75);
        ctx.strokeStyle = '#ffffff'; ctx.lineCap = 'round';
        for (let w = 0; w < 4; w++) {
          ctx.globalAlpha = f.alpha * (.55 - w * .1); ctx.lineWidth = 7 - w * 1.4; ctx.beginPath();
          for (let j = 0; j <= 12; j++) { const u = j / 12, px = A.x + (x - A.x) * u, py = y - 34 + w * 6 + Math.sin(u * 9 - time * 14 + w) * 7 * u; if (j) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
          ctx.stroke();
        }
        ctx.lineCap = 'butt';
        for (let i = 1; i <= 5; i++) { const u = Math.max(0, k - i * .09); emoji(f.icon, A.x + (B.x - A.x) * u, y - 30, 38 - i * 3, f.alpha * (.55 - i * .09)); }
        for (let i = 0; i < 10; i++) {
          const a = time * 4 + i * .63, r = 30 + noise(i + b.id) * 22, tw = (Math.sin(time * 14 + i) + 1) / 2;
          ctx.globalAlpha = f.alpha * tw; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x + Math.cos(a) * r, y - 30 + Math.sin(a) * r * .5, 1.5 + tw * 2.2, 0, TAU); ctx.fill();
        }
        b.affected.forEach((s, i) => {
          const fright = clamp01((f.m - .25 - i * .14) / .2);
          if (fright <= 0) return;
          const shake = Math.sin(time * 60 + i) * 3 * (1 - f.fade);
          emoji('😱', s.x + shake, s.y - 62, 34 * Math.min(1, fright * 1.3), f.alpha);
          emoji('❗', s.x + 26 + shake, s.y - 80, 22 * fright, f.alpha);
          for (let q = 0; q < 3; q++) { ctx.globalAlpha = f.alpha * .7; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; const a = -1.9 + q * .45; line({ x: s.x + Math.cos(a) * 30, y: s.y - 40 + Math.sin(a) * 30 }, { x: s.x + Math.cos(a) * 44, y: s.y - 40 + Math.sin(a) * 44 }); }
        });
        pop(f.icon, { x, y }, f.m, f.alpha, 58);
      },
      balloon(b, f) {
        const s = b.target, rise = 1 - (1 - clamp01(f.m * 1.6)) ** 3, bob = Math.sin((f.m + f.fade) * 9) * 5;
        const top = { x: s.x + 6 + bob * .6, y: s.y - 66 - 44 * rise + bob };
        ctx.globalAlpha = f.alpha; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(s.x, s.y - 66); ctx.bezierCurveTo(s.x - 12, s.y - 80, top.x + 12, top.y + 40, top.x, top.y + 22); ctx.stroke();
        emoji(f.icon, top.x, top.y + 22, 56, f.alpha);
        ripples(s, f.m + f.fade, f.alpha * .8);
        for (let i = 0; i < 3; i++) emoji('✨', s.x + (noise(i + b.id) - .5) * 70, s.y - 90 - noise(i + 3) * 60, 14, f.alpha * ((Math.sin((f.m + f.fade) * 10 + i * 2) + 1) / 2));
      },
      // The hippo surges up through the surface; the water domes, splashes and rings out.
      hippo(b, f) {
        const s = b.target, up = clamp01(f.m / .4), sink = f.fade, y = s.y + 40 - 52 * up + 40 * sink;
        ctx.globalAlpha = f.alpha * .7; ctx.fillStyle = '#e9fbff';
        ctx.beginPath(); ctx.ellipse(s.x + 6, s.y + 12, 46 * up + 6, 12 * up + 2, 0, 0, TAU); ctx.fill();
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, width, s.y + 14); ctx.clip();
        emoji(f.icon, s.x + 6, y, 86, f.alpha); ctx.restore();
        splash(s, up * .6 + f.fade * .9, f.alpha, b.id, '#ffffff', 30);
        ripples(s, up + f.fade, f.alpha);
      },
      // A log rolls in from upstream and slams into the leader.
      log(b, f) {
        const s = b.target, k = 1 - (1 - clamp01(f.m / .6)) ** 2, x = s.x + 230 - 172 * k;
        ctx.save(); ctx.translate(x, s.y - 4); ctx.rotate(-(1 - k) * 6); emoji(f.icon, 0, 18, 66, f.alpha); ctx.restore();
        for (let i = 0; i < 4; i++) { ctx.globalAlpha = f.alpha * .6; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; line({ x: x + 34 + i * 12, y: s.y - 10 + i * 5 }, { x: x + 54 + i * 16, y: s.y - 10 + i * 5 }); }
        if (k >= 1) { const e = (f.m - .6) / .4 * .6 + f.fade * .6; splash({ x: x - 24, y: s.y }, e, f.alpha, b.id, '#ffffff', 20); particles({ x: x - 24, y: s.y - 10 }, clamp01(e), '#a0703a', 10, 60, b.id); }
      },
      // Three frog hops carry the duck forward, a splash at every landing.
      frog(b, f) {
        const s = b.target, t = clamp01(f.m / .9) * 3, hop = Math.min(2, Math.floor(t)), u = t - hop;
        const x0 = s.x - 90 + hop * 50, p = { x: x0 + 50 * u, y: s.y - Math.sin(u * Math.PI) * 50 };
        for (let k = 0; k <= hop; k++) { const land = { x: s.x - 40 + k * 50, y: s.y + 6 }; ripples(land, (t - k - 1 + 1) * .5 + f.fade, f.alpha * .8); if (t > k + 1) splash(land, (t - k - 1) * .5, f.alpha, b.id + k, '#e9fbff', 12); }
        ctx.save(); ctx.translate(p.x, p.y - 20); ctx.rotate((u - .5) * .6); emoji(f.icon, 0, 14, 40, f.alpha); ctx.restore();
      },
      magnet(b, f) {
        const s = b.origin;
        ctx.strokeStyle = '#ff5a5a'; ctx.lineWidth = 3.5;
        for (let i = 0; i < 4; i++) {
          const r = 22 + i * 18 + (f.m * 60) % 18;
          ctx.globalAlpha = f.alpha * (1 - i * .22); ctx.beginPath(); ctx.arc(s.x + 24, s.y - 24, r, -Math.PI * .45, Math.PI * .45); ctx.stroke();
        }
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        for (let i = 0; i < 7; i++) {
          const y = s.y - 48 + i * 9, len = 70 + noise(b.id + i) * 150;
          ctx.globalAlpha = f.alpha * .75 * (1 - clamp01(f.m * .6 + f.fade)); line({ x: s.x - 34, y }, { x: s.x - 34 - len, y });
        }
        ctx.lineCap = 'butt';
        pop(f.icon, s, f.m, f.alpha, 60);
      },
      lightning(b, f) {
        const spots = b.affected.length ? b.affected : [b.target];
        if (f.m < .6) { ctx.globalAlpha = (1 - f.m / .6) * .4; ctx.fillStyle = '#eef6ff'; ctx.fillRect(0, 0, width, height); }
        spots.forEach((spot, i) => {
          if (f.m < .75 && noise(Math.floor(f.m * 40) + i * 7 + b.id) > .25) {
            let x = spot.x + (noise(b.id + i) - .5) * 70;
            ctx.beginPath(); ctx.moveTo(x, 0);
            for (let k = 1; k <= 9; k++) { x = k === 9 ? spot.x : x + (noise(b.id + i * 11 + k + Math.floor(f.m * 12)) - .5) * 56; ctx.lineTo(x, (spot.y - 30) * k / 9); }
            ctx.strokeStyle = '#fff3a0'; ctx.lineWidth = 11; ctx.globalAlpha = f.alpha * .5; ctx.stroke();
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.5; ctx.globalAlpha = f.alpha; ctx.stroke();
          }
          glow(spot, 80, '#fff6a0', f.alpha * (1 - clamp01(f.m)));
          capsize(spot, f.m * .7 + f.fade * .8, f.alpha, b.id + i);
          pop(f.icon, spot, f.m, f.alpha, 54);
        });
      },
      flip(b, f) {
        const [a, c] = b.affected.length >= 2 ? b.affected : [b.origin, b.target], k = clamp01(f.m * 1.3);
        [[a, c, '#ffd166', 1], [c, a, '#9be7ff', -1]].forEach(([from, to, col, side]) => {
          const p = flight(from, to, k, 90);
          ctx.globalAlpha = f.alpha * .85; ctx.strokeStyle = col; ctx.lineWidth = 6; ctx.setLineDash([12, 9]);
          ctx.beginPath(); ctx.moveTo(from.x, from.y - 30); ctx.quadraticCurveTo((from.x + p.x) / 2 + side * 80, Math.min(from.y, p.y) - 70, p.x, p.y); ctx.stroke(); ctx.setLineDash([]);
          glow(p, 30, col, f.alpha);
        });
        pop(f.icon, { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 }, f.m, f.alpha, 70);
      },
      // VHS rewind: tint, scanlines, a blinking ◀◀ label, and each duck's tape trail back to its old spot.
      rewind(b, f) {
        const k = ease(f.m / .93), blink = Math.floor((f.m + f.fade) * 8) % 2 === 0;
        ctx.globalAlpha = f.alpha * .22; ctx.fillStyle = '#b8955a'; ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#000000';
        for (let y = (f.m * 60) % 4; y < height; y += 4) { ctx.globalAlpha = f.alpha * .07; ctx.fillRect(0, y, width, 1.4); }
        const band = ((f.m + f.fade) * 1.6 % 1) * height;
        ctx.globalAlpha = f.alpha * .18; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, band, width, 10);
        if (blink) { ctx.globalAlpha = f.alpha; ctx.fillStyle = '#ffffff'; ctx.font = 'bold 22px monospace'; ctx.textAlign = 'left'; ctx.fillText('◀◀ TUA NGƯỢC', 18, 34); }
        b.pre.affected.forEach((p, i) => {
          const end = b.affected[i]; if (!end || Math.abs(end.x - p.x) < 2) return;
          const x = p.x + (end.x - p.x) * k;
          ctx.globalAlpha = f.alpha * .8; ctx.strokeStyle = '#ffe2a8'; ctx.lineWidth = 4; ctx.setLineDash([8, 6]);
          line({ x: p.x, y: p.y - 24 }, { x, y: p.y - 24 }); ctx.setLineDash([]);
          ring(p.x, p.y - 24, 14, 14, '#ffe2a8', f.alpha * .6 * (1 - k), 2);
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
          for (let c = 0; c < 3; c++) {
            const cx = x + 18 + c * 16 + ((f.m * 60) % 16);
            ctx.globalAlpha = f.alpha * (1 - c * .3); ctx.beginPath(); ctx.moveTo(cx + 8, p.y - 34); ctx.lineTo(cx, p.y - 24); ctx.lineTo(cx + 8, p.y - 14); ctx.stroke();
          }
        });
        const s = b.origin, ang = -(f.m + f.fade) * TAU * 4;
        glow({ x: s.x, y: s.y - 20 }, 60, '#ffe2a8', f.alpha * .6);
        ring(s.x, s.y - 34, 36, 36, '#ffe2a8', f.alpha, 4);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.globalAlpha = f.alpha;
        line({ x: s.x, y: s.y - 34 }, { x: s.x + Math.cos(ang) * 28, y: s.y - 34 + Math.sin(ang) * 28 });
        line({ x: s.x, y: s.y - 34 }, { x: s.x + Math.cos(ang / 12) * 18, y: s.y - 34 + Math.sin(ang / 12) * 18 });
        pop(f.icon, s, f.m, f.alpha, 58);
      },
      reverse(b, f) {
        const spots = b.affected.length ? b.affected : [b.target], k = clamp01(f.m * 1.5);
        spots.forEach(spot => {
          const start = -Math.PI * .1, end = start - Math.PI * 1.25 * k, cy = spot.y - 44;
          ctx.globalAlpha = f.alpha; ctx.strokeStyle = '#ff6fd8'; ctx.lineWidth = 7; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.arc(spot.x, cy, 30, start, end, true); ctx.stroke(); ctx.lineCap = 'butt';
          const ax = spot.x + Math.cos(end) * 30, ay = cy + Math.sin(end) * 30;
          ctx.fillStyle = '#ff6fd8'; ctx.beginPath(); ctx.moveTo(ax - 11, ay - 4); ctx.lineTo(ax + 4, ay + 12); ctx.lineTo(ax + 7, ay - 9); ctx.fill();
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
          for (let i = 0; i < 4; i++) { const y = spot.y - 30 + i * 9, x = spot.x + 40 + ((f.m + f.fade) * 80 + i * 13) % 40; ctx.globalAlpha = f.alpha * .7; line({ x, y }, { x: x + 26, y }); }
          pop(f.icon, { x: spot.x, y: spot.y - 6 }, f.m, f.alpha, 48);
        });
      },
      freeze(b, f) {
        const k = clamp01(f.m * 2);
        const g = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * .2, width / 2, height / 2, Math.max(width, height) * .7);
        g.addColorStop(0, 'rgba(220,245,255,0)'); g.addColorStop(1, 'rgba(220,245,255,.8)');
        ctx.globalAlpha = f.alpha * k; ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.6;
        for (let i = 0; i < 30; i++) {
          const x = noise(b.id + i) * width, y = noise(b.id + i + 50) * height, r = 4 + noise(i) * 6;
          ctx.globalAlpha = f.alpha * k * .9;
          for (let a = 0; a < 3; a++) { const ang = a / 3 * Math.PI; line({ x: x - Math.cos(ang) * r, y: y - Math.sin(ang) * r }, { x: x + Math.cos(ang) * r, y: y + Math.sin(ang) * r }); }
        }
        // An ice block grows around each frozen duck, with a glint sweeping across it.
        b.affected.forEach((spot, i) => {
          const grow = ease((f.m - i * .04) / .45), w = 92 * grow, h = 74 * grow, x = spot.x - w / 2 + 4, y = spot.y - h + 14;
          if (grow <= 0) return;
          const g = ctx.createLinearGradient(x, y, x + w, y + h);
          g.addColorStop(0, 'rgba(235,252,255,.75)'); g.addColorStop(.5, 'rgba(160,225,250,.45)'); g.addColorStop(1, 'rgba(110,190,235,.65)');
          ctx.globalAlpha = f.alpha; ctx.fillStyle = g; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, 10) : ctx.rect(x, y, w, h); ctx.fill(); ctx.stroke();
          const glint = ((f.m + f.fade) * 1.4 + i * .2) % 1;
          ctx.globalAlpha = f.alpha * .8 * grow; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6;
          ctx.beginPath(); ctx.moveTo(x + w * glint, y + 4); ctx.lineTo(x + w * glint - 22, y + h - 4); ctx.stroke();
          emoji('❄️', spot.x + 30, spot.y - 60, 22 * grow + 1, f.alpha);
        });
        pop(f.icon, b.origin, f.m, f.alpha, 62);
      },
      // ---- the big-show skills ----
      // Purple tentacles burst from the water around each grabbed duck; the beast's head and eyes surface behind them.
      kraken(b, f) {
        const spots = b.pre.affected.length ? b.pre.affected : [b.target];
        const rise = ease(f.m / .4), grip = clamp01((f.m - .4) / .6), wob = Math.sin((f.m * 4 + f.fade * 2) * TAU) * .25;
        const cx = spots.reduce((s, p) => s + p.x, 0) / spots.length, cy = spots.reduce((s, p) => s + p.y, 0) / spots.length;
        const head = { x: Math.max(...spots.map(p => p.x)) + 150, y: Math.min(height - 40, Math.max(110, cy + 40)) };
        ctx.globalAlpha = f.alpha * .55; ctx.fillStyle = '#1b0d2e'; ctx.beginPath(); ctx.ellipse(head.x - 40, head.y + 8, 170 * rise + 1, 30 * rise + 1, 0, 0, TAU); ctx.fill();
        const hg = ctx.createRadialGradient(head.x - 20, head.y - 60 * rise, 8, head.x, head.y - 30 * rise, 100);
        hg.addColorStop(0, '#c07ae6'); hg.addColorStop(.6, '#6a2f94'); hg.addColorStop(1, '#2c1145');
        ctx.globalAlpha = f.alpha; ctx.fillStyle = hg; ctx.beginPath(); ctx.ellipse(head.x, head.y, 70 * rise + 1, 72 * rise + 1, 0, Math.PI, 0); ctx.fill();
        if (rise > .6) for (const dx of [-24, 24]) {
          const ey = head.y - 40 * rise;
          glow({ x: head.x + dx, y: ey + 12 }, 22, 'rgba(255,240,90,.9)', f.alpha);
          ctx.globalAlpha = f.alpha; ctx.fillStyle = '#ffe14d'; ctx.beginPath(); ctx.ellipse(head.x + dx, ey, 11, 7, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = '#1a0a1f'; ctx.beginPath(); ctx.ellipse(head.x + dx, ey, 2.8, 6, 0, 0, TAU); ctx.fill();
        }
        spots.forEach((p, i) => {
          if (blockedAt(b, i)) { ring(p.x, p.y - 20, 36 * rise + 1, 36 * rise + 1, '#c2fbff', f.alpha, 4); return; }
          const base = { x: p.x, y: p.y + 10 };
          ripples(base, f.m * 1.2, f.alpha * .8, '#d9b8ff');
          for (let k = 0; k < 3; k++) {
            const side = k - 1;
            tentacle({ x: base.x + side * 40, y: base.y }, -Math.PI / 2 + side * .45, 110 + (k === 1 ? 24 : 0), -side * (2.6 + grip * 2.4) + (k === 1 ? 1.6 : 0) + wob, rise, f.alpha, b.id + i * 7 + k); // lean out, curl over the duck
          }
          if (grip > 0) { ring(p.x, p.y - 22, 34, 17, '#c08cff', f.alpha * .85, 5); particles({ x: p.x, y: p.y - 6 }, clamp01(grip * .8 + f.fade), '#2a0f40', 14, 70, b.id + i); }
        });
        pop(f.icon, { x: head.x, y: head.y - 70 * rise }, f.m, f.alpha, 72);
      },
      // A serpent of water scales flies along the river from behind its caster, smashing every duck ahead.
      dragon(b, f) {
        const P = b.pre.origin, spots = b.pre.affected, after = b.affected;
        const startX = P.x - 160, endX = (spots.length ? Math.max(...spots.map(p => p.x)) : P.x) + 200;
        const yMid = spots.length ? spots.reduce((s, p) => s + p.y, 0) / spots.length : P.y;
        const pathY = x => { const u = clamp01((x - startX) / (endX - startX)); return P.y - 70 + (yMid - P.y) * u + Math.sin(u * TAU * 1.5 + f.m * 5) * 48; };
        const head = startX + (endX - startX) * ease(f.m / .85);
        for (let i = 0; i < 22; i++) {
          const x = head - i * 20; if (x < startX) break;
          ctx.globalAlpha = f.alpha * (1 - i / 22) * .55; ctx.fillStyle = '#e8fbff'; ctx.beginPath(); ctx.ellipse(x, pathY(x) + 52, 16 - i * .5, 5, 0, 0, TAU); ctx.fill();
        }
        for (let i = 30; i >= 0; i--) {
          const x = head - i * 15; if (x < startX - 30) continue;
          const y = pathY(x), r = 18 * (1 - i / 38) + 5, g = ctx.createRadialGradient(x - r * .3, y - r * .4, 1, x, y, r);
          g.addColorStop(0, '#c8fff4'); g.addColorStop(.5, '#22b5a4'); g.addColorStop(1, '#0b5560');
          ctx.globalAlpha = f.alpha; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
          if (i % 3 === 0) { ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.moveTo(x - 5, y - r + 2); ctx.lineTo(x + 1, y - r - 12); ctx.lineTo(x + 6, y - r + 3); ctx.fill(); }
        }
        const hy = pathY(head);
        glow({ x: head + 16, y: hy + 14 }, 80, 'rgba(160,250,255,.9)', f.alpha * .9);
        ctx.save(); ctx.translate(head + 18, hy); ctx.scale(-1, 1); emoji(f.icon, 0, 22, 72, f.alpha); ctx.restore();
        for (let k = 0; k < 10; k++) { const t = (f.m * 3 + k / 10) % 1; ctx.globalAlpha = f.alpha * (1 - t); ctx.fillStyle = '#dffcff'; ctx.beginPath(); ctx.arc(head + 50 + t * 70, hy + (k - 5) * 5 * t, 4 * (1 - t) + 1, 0, TAU); ctx.fill(); }
        spots.forEach((p, i) => {
          const t = clamp01((head - p.x) / 140) + (f.m >= .85 ? f.fade : 0);
          if (t <= 0) return;
          if (blockedAt(b, i)) ring(p.x, p.y - 20, 34, 34, '#c2fbff', f.alpha * (1 - clamp01(t)), 4);
          else capsize(after[i] || p, t, f.alpha, b.id + i);
        });
      },
      // The sky dims; fiery meteors with long tails crash onto the front half of the field.
      meteor(b, f) {
        const spots = b.affected;
        ctx.globalAlpha = f.alpha * .1 * Math.sin(clamp01(f.m) * Math.PI); ctx.fillStyle = '#250c45'; ctx.fillRect(0, 0, width, height);
        spots.forEach((p, i) => {
          const start = i * .09, t = clamp01((f.m - start) / .45), hit = { x: p.x, y: p.y - 18 };
          if (f.m < start) return;
          if (t < 1) {
            const from = { x: hit.x + 280, y: hit.y - 340 }, x = from.x + (hit.x - from.x) * t * t, y = from.y + (hit.y - from.y) * t * t;
            const tail = ctx.createLinearGradient(x, y, x + 150, y - 180);
            tail.addColorStop(0, 'rgba(255,245,200,.95)'); tail.addColorStop(.3, 'rgba(255,150,40,.75)'); tail.addColorStop(1, 'rgba(255,70,20,0)');
            ctx.globalAlpha = f.alpha; ctx.strokeStyle = tail; ctx.lineWidth = 18; ctx.lineCap = 'round'; line({ x, y }, { x: x + 150, y: y - 180 }); ctx.lineCap = 'butt';
            glow({ x, y: y + 12 }, 46, 'rgba(255,200,90,.95)', f.alpha);
            ctx.globalAlpha = f.alpha; ctx.fillStyle = '#fff6d0'; ctx.beginPath(); ctx.arc(x, y, 10, 0, TAU); ctx.fill();
            ring(hit.x, hit.y + 26, 30, 9, '#ff7b29', f.alpha * .8 * t, 3);
            return;
          }
          const e = clamp01((f.m - start - .45) / .4) * .7 + f.fade * .5;
          if (blockedAt(b, i)) { ring(hit.x, hit.y, 30 + e * 30, 30 + e * 30, '#c2fbff', f.alpha * (1 - clamp01(e)), 4); return; }
          const g = ctx.createRadialGradient(hit.x, hit.y, 0, hit.x, hit.y, 34 + e * 100);
          g.addColorStop(0, '#fffbe6'); g.addColorStop(.3, '#ffb347'); g.addColorStop(.6, '#ff5a2a'); g.addColorStop(1, 'rgba(150,20,10,0)');
          ctx.globalAlpha = f.alpha * (1 - clamp01(e)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hit.x, hit.y, 34 + e * 100, 0, TAU); ctx.fill();
          particles(hit, clamp01(e), '#ff9d3c', 18, 120, b.id + i);
          capsize(p, e, f.alpha, b.id + i);
        });
        emoji(f.icon, width - 90, 90, 64, f.alpha * Math.min(1, f.m * 4));
      },
      // A whale surfaces under its caster and blows it sky-high on a spout; the landing splash bowls over the nearest ducks.
      whale(b, f) {
        const P = b.pre.origin, L = b.origin, rise = ease(f.m / .3), launch = clamp01((f.m - .18) / .6), land = clamp01((f.m - .78) / .22);
        const wx = P.x - 20, wy = P.y + 20, sink = 1 - clamp01(f.fade * 1.5);
        ctx.globalAlpha = f.alpha * .5; ctx.fillStyle = '#0b3550'; ctx.beginPath(); ctx.ellipse(wx, wy + 8, 150 * rise + 1, 26 * rise + 1, 0, 0, TAU); ctx.fill();
        const g = ctx.createLinearGradient(0, wy - 56 * rise, 0, wy + 10); g.addColorStop(0, '#6f9fc6'); g.addColorStop(1, '#1d4f73');
        ctx.globalAlpha = f.alpha * sink; ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(wx, wy, 124 * rise + 1, 52 * rise * sink + 1, 0, Math.PI, 0); ctx.fill();
        ctx.fillStyle = '#e9f3fa'; ctx.beginPath(); ctx.arc(wx + 70 * rise, wy - 22 * rise, 4, 0, TAU); ctx.fill();
        emoji(f.icon, wx - 140 * rise, wy - 18, 76 * rise + 1, f.alpha * sink);
        if (launch > 0) {
          const h = Math.min(wy - 24, 230) * Math.sin(Math.min(1, launch) * Math.PI * .85) * sink, col = ctx.createLinearGradient(0, wy - h, 0, wy);
          col.addColorStop(0, 'rgba(255,255,255,.2)'); col.addColorStop(.2, 'rgba(235,250,255,.95)'); col.addColorStop(1, 'rgba(130,200,240,.8)');
          ctx.globalAlpha = f.alpha; ctx.fillStyle = col; ctx.beginPath();
          ctx.moveTo(wx + 26, wy - 10); ctx.quadraticCurveTo(wx + 18, wy - h * .6, wx + 4, wy - h); ctx.quadraticCurveTo(wx + 14, wy - h - 22, wx + 26, wy - h); ctx.quadraticCurveTo(wx + 40, wy - h * .6, wx + 52, wy - 10); ctx.fill();
          splash({ x: wx + 28, y: wy - h + 10 }, launch * 1.2, f.alpha, b.id, '#f2fdff', 24);
          ['#ff6b6b', '#ffb347', '#ffe66d', '#7dff8a', '#7cc8ff', '#b67bff'].forEach((c, k) => ring(wx + 28, wy - h * .55, 90 + k * 7, 70 + k * 7, c, f.alpha * .35 * Math.sin(Math.min(1, launch) * Math.PI), 3));
          if (launch < 1) { const q = flight({ x: P.x, y: P.y }, { x: L.x, y: L.y }, launch, 190); glow({ x: q.x, y: q.y + 24 }, 40, '#ffffff', f.alpha * .8); }
        }
        if (land > 0) {
          ripples(L, land + f.fade, f.alpha); splash(L, land * 1.3 + f.fade, f.alpha, b.id + 3, '#effcff', 36);
          b.affected.forEach((q, i) => { if (blockedAt(b, i)) ring(q.x, q.y - 20, 32, 32, '#c2fbff', f.alpha, 4); else capsize(q, land + f.fade, f.alpha, b.id + i); });
        }
      },
      // A flying saucer beams the duck up, zips across the river and drops it far behind (or, by mistake, its own caster near the front).
      ufo(b, f) {
        const self = b.outcome === 'mistake', onActor = self || b.reflected, P = onActor ? b.pre.origin : b.pre.target, L = onActor ? b.origin : b.target;
        const took = self || b.reflected || b.outcome === 'hit';
        const come = ease(f.m / .22), carry = took ? ease((f.m - .5) / .32) : 0, beamOn = f.m > .2 && (f.m < .5 || f.m > .8 || !took);
        const sx = P.x + (L.x - P.x) * carry, groundY = P.y + (L.y - P.y) * carry, sy = -70 + (Math.max(46, groundY - 170) + 70) * come + Math.sin(f.m * 26) * 4;
        if (beamOn) {
          const cone = ctx.createLinearGradient(0, sy, 0, groundY + 10);
          cone.addColorStop(0, 'rgba(190,255,170,.85)'); cone.addColorStop(1, 'rgba(190,255,170,.12)');
          ctx.globalAlpha = f.alpha; ctx.fillStyle = cone; ctx.beginPath(); ctx.moveTo(sx - 22, sy + 10); ctx.lineTo(sx + 22, sy + 10); ctx.lineTo(sx + 70, groundY + 10); ctx.lineTo(sx - 70, groundY + 10); ctx.closePath(); ctx.fill();
          for (let k = 0; k < 14; k++) { const t = (f.m * 2.5 + noise(k + b.id)) % 1; ctx.globalAlpha = f.alpha * (1 - t); ctx.fillStyle = '#f4ffe8'; ctx.beginPath(); ctx.arc(sx + (noise(k + 3) - .5) * 80 * (1 - t), groundY - t * (groundY - sy), 2.4, 0, TAU); ctx.fill(); }
          ring(sx, groundY + 8, 60, 14, '#d6ffc8', f.alpha * .8, 3);
        }
        if (took && f.m >= .5 && f.m < .82) glow({ x: sx, y: sy + 70 }, 36, 'rgba(210,255,190,.95)', f.alpha);
        if (b.outcome === 'blocked') ring(P.x, P.y - 20, 36, 36, '#c2fbff', f.alpha, 4);
        saucer(sx, sy, f.alpha, f.m);
        emoji(f.icon, sx, sy - 30, 34, f.alpha);
        if (f.m > .8 && took) { ripples(L, (f.m - .8) * 4 + f.fade, f.alpha, '#d6ffc8'); particles({ x: L.x, y: L.y - 20 }, clamp01((f.m - .8) * 4 + f.fade), '#e9ffd9', 16, 70, b.id); }
      },
      // A pirate ship sails in beside its caster and fires a broadside: muzzle flashes, smoke and cannonballs.
      pirate(b, f) {
        const P = b.pre.origin, sail = ease(f.m / .22), x = P.x - 150 + sail * 70, y = Math.max(P.y - 6, 122) + Math.sin(f.m * 14) * 3;
        ctx.globalAlpha = f.alpha * .4; ctx.fillStyle = '#123a52'; ctx.beginPath(); ctx.ellipse(x, y + 26, 84, 10, 0, 0, TAU); ctx.fill();
        ship(x, y, f.alpha, Math.sin(f.m * 10) * .04);
        ripples({ x, y: y + 18 }, (f.m * 1.5) % 1, f.alpha * .7);
        b.pre.affected.forEach((p, i) => {
          const fire = .2 + i * .13, t = clamp01((f.m - fire) / .2), gun = { x: x + 44, y: y + 2 };
          if (f.m < fire) return;
          const flash = clamp01((f.m - fire) / .08);
          if (flash < 1) glow(gun, 46, 'rgba(255,190,80,.95)', f.alpha * (1 - flash));
          for (let k = 0; k < 5; k++) { const s = clamp01((f.m - fire) * 2 + f.fade) ; ctx.globalAlpha = f.alpha * (1 - s) * .6; ctx.fillStyle = '#d8d8d8'; ctx.beginPath(); ctx.arc(gun.x + 10 + s * 40 + k * 6, gun.y - s * 50 - k * 8, 8 + s * 18, 0, TAU); ctx.fill(); }
          const q = b.affected[i] || p;
          if (t < 1) { const ball = flight(gun, { x: p.x, y: p.y + 10 }, t, 90); glow(ball, 18, 'rgba(255,140,40,.8)', f.alpha); ctx.globalAlpha = f.alpha; ctx.fillStyle = '#151515'; ctx.beginPath(); ctx.arc(ball.x, ball.y, 7, 0, TAU); ctx.fill(); return; }
          const e = clamp01((f.m - fire - .2) / .3) + f.fade * .5;
          if (blockedAt(b, i)) ring(p.x, p.y - 20, 34, 34, '#c2fbff', f.alpha * (1 - clamp01(e)), 4);
          else { glow({ x: q.x, y: q.y - 10 }, 50 + e * 50, 'rgba(255,170,60,.9)', f.alpha * (1 - clamp01(e))); capsize(q, e, f.alpha, b.id + i); }
        });
      },
      // A fairground wheel spins above its caster, slows down and lands on the prize.
      wheel(b, f) {
        const SEG = [['jackpot', '#ffcf3f', '💰'], ['flip', '#b47cff', '🔃'], ['freeze', '#7fe3ff', '🧊'], ['bust', '#ff5a5a', '💥']];
        const idx = Math.max(0, SEG.findIndex(s => s[0] === b.segment)), c = { x: b.pre.origin.x, y: Math.max(76, b.pre.origin.y - 120) };
        const grow = ease(f.m * 4), R = 50 * grow + 1, spinT = clamp01(f.m / .62);
        const rot = (-Math.PI / 2 - (idx + .5) * TAU / 4 + 5 * TAU) * ease(spinT);
        glow({ x: c.x, y: c.y + 12 }, R * 2, 'rgba(255,240,170,.9)', f.alpha * .8);
        SEG.forEach(([, col, ic], i) => {
          const a0 = rot + i * TAU / 4, a1 = a0 + TAU / 4;
          ctx.globalAlpha = f.alpha; ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.arc(c.x, c.y, R, a0, a1); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
          emoji(ic, c.x + Math.cos(a0 + TAU / 8) * R * .62, c.y + Math.sin(a0 + TAU / 8) * R * .62 + 7, 20 * grow + 1, f.alpha);
        });
        ring(c.x, c.y, R + 4, R + 4, '#7a4b12', f.alpha, 7);
        for (let i = 0; i < 16; i++) { const a = i / 16 * TAU, on = (Math.floor(f.m * 30) + i) % 2; ctx.globalAlpha = f.alpha; ctx.fillStyle = on ? '#fff6b0' : '#ffb347'; ctx.beginPath(); ctx.arc(c.x + Math.cos(a) * (R + 4), c.y + Math.sin(a) * (R + 4), on ? 4 : 3, 0, TAU); ctx.fill(); }
        ctx.fillStyle = '#7a4b12'; ctx.beginPath(); ctx.arc(c.x, c.y, 8, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.moveTo(c.x - 10, c.y - R - 16); ctx.lineTo(c.x + 10, c.y - R - 16); ctx.lineTo(c.x, c.y - R + 2); ctx.closePath(); ctx.fill();
        emoji(f.icon, c.x + R + 30, c.y + 8, 30, f.alpha);
        if (f.m < .62) return;
        const r = (f.m - .62) / .38;
        pop(SEG[idx][2], { x: c.x, y: c.y + 20 }, r, f.alpha, 70);
        particles({ x: c.x, y: c.y }, clamp01(r + f.fade), SEG[idx][1], 22, 120, b.id);
        if (b.segment === 'jackpot') { glow(b.origin, 70, 'rgba(255,215,90,.95)', f.alpha); particles({ x: b.origin.x, y: b.origin.y - 30 }, clamp01(r + f.fade), '#ffd84d', 24, 90, b.id + 1); }
        if (b.segment === 'bust') capsize(b.origin, r + f.fade, f.alpha, b.id);
        if (b.segment === 'flip' || b.segment === 'freeze') b.affected.forEach((q, i) => ring(q.x, q.y - 20, 30 + r * 30, 30 + r * 30, b.segment === 'freeze' ? '#c9f3ff' : '#d1b2ff', f.alpha * (blockedAt(b, i) ? .4 : 1), 4));
      },
      // A heavy anchor is hurled on its chain, hooks the leader and drags it while the chain yanks the caster forward.
      anchor(b, f) {
        const A = { x: b.pre.origin.x + 24, y: b.pre.origin.y - 34 }, T = b.reflected ? b.pre.origin : b.pre.target;
        const throwT = clamp01(f.m / .42), tip = throwT < 1 ? flight(A, { x: T.x, y: T.y }, throwT, 120) : { x: T.x - 6, y: T.y - 8 };
        const sag = throwT < 1 ? 70 * (1 - throwT) : Math.max(0, 26 * (1 - clamp01((f.m - .5) / .3))) + Math.sin((f.m + f.fade) * 30) * 2;
        ctx.lineWidth = 3;
        for (let i = 0; i <= 22; i++) {
          const u = i / 22, x = A.x + (tip.x - A.x) * u, y = A.y + (tip.y - A.y) * u + Math.sin(u * Math.PI) * sag;
          ctx.globalAlpha = f.alpha; ctx.strokeStyle = i % 2 ? '#7d8791' : '#c3ccd6'; ctx.beginPath(); ctx.ellipse(x, y, 6, 3.5, i % 2 ? .7 : -.7, 0, TAU); ctx.stroke();
        }
        ctx.save(); ctx.translate(tip.x, tip.y); ctx.rotate(throwT < 1 ? throwT * TAU * 1.5 : .3); emoji(f.icon, 0, 16, 48, f.alpha); ctx.restore();
        if (throwT < 1) return;
        const e = clamp01((f.m - .42) / .3) + f.fade * .5;
        if (b.outcome !== 'hit' && !b.reflected) { ring(T.x, T.y - 20, 34, 34, '#c2fbff', f.alpha * (1 - clamp01(e)), 4); return; }
        splash(T, e, f.alpha, b.id, '#effcff', 30); ripples(T, e, f.alpha);
        ring(T.x, T.y - 16, 30, 13, '#9aa3ad', f.alpha, 5);
        ctx.lineCap = 'round';
        for (let i = 0; i < 8; i++) { const age = (f.m * 3 + i / 8) % 1, sx = b.origin.x - 40 - age * 90, sy = b.origin.y - 40 + i * 7; ctx.globalAlpha = f.alpha * (1 - age) * .9; ctx.strokeStyle = i % 2 ? '#ffffff' : '#c3ccd6'; ctx.lineWidth = 3; line({ x: sx, y: sy }, { x: sx - 30, y: sy }); }
        ctx.lineCap = 'butt';
      },
      // A volcano heaves out of the river and hurls glowing lava rocks: lucky ducks are tossed ahead, the rest knocked back.
      volcano(b, f) {
        const spots = b.pre.affected, after = b.affected, vx = spots.length ? spots.reduce((s, p) => s + p.x, 0) / spots.length : b.origin.x, vy = 108;
        const rise = ease(f.m / .22), top = vy - 80 * rise;
        ctx.globalAlpha = f.alpha * .06 * Math.sin(clamp01(f.m + .2) * Math.PI); ctx.fillStyle = '#ff3b1f'; ctx.fillRect(0, 0, width, height);
        const cone = ctx.createLinearGradient(0, top, 0, vy + 34); cone.addColorStop(0, '#3a2a24'); cone.addColorStop(1, '#120c0a');
        ctx.globalAlpha = f.alpha; ctx.fillStyle = cone; ctx.beginPath(); ctx.moveTo(vx - 110, vy + 34); ctx.lineTo(vx - 26, top); ctx.lineTo(vx + 26, top); ctx.lineTo(vx + 110, vy + 34); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#ff7b29'; ctx.lineWidth = 4; ctx.lineCap = 'round';
        for (const s of [-1, 1]) { ctx.globalAlpha = f.alpha * .9; ctx.beginPath(); ctx.moveTo(vx + s * 14, top + 4); ctx.quadraticCurveTo(vx + s * 34, vy - 10, vx + s * 46, vy + 30); ctx.stroke(); }
        ctx.lineCap = 'butt';
        glow({ x: vx, y: top + 8 }, 60, 'rgba(255,140,40,.95)', f.alpha);
        if (f.m > .12) for (let k = 0; k < 34; k++) {
          const t = ((f.m - .12) * 1.6 + noise(k + b.id) * .8) % 1, vx0 = (noise(k + 4) - .5) * 160, vy0 = -(160 + noise(k + 9) * 160);
          ctx.globalAlpha = f.alpha * (1 - t); ctx.fillStyle = k % 3 ? '#ff7b29' : '#ffd166';
          ctx.beginPath(); ctx.arc(vx + vx0 * t, top + vy0 * t + 260 * t * t, 3 + noise(k) * 4, 0, TAU); ctx.fill();
        }
        for (let k = 0; k < 8; k++) { const t = clamp01(f.m * 1.4 + f.fade * .5 - k * .05); ctx.globalAlpha = f.alpha * (1 - t) * .55; ctx.fillStyle = '#5c5552'; ctx.beginPath(); ctx.arc(vx + (noise(k + 2) - .5) * 60 * t, top - t * 140 - k * 10, 14 + t * 30, 0, TAU); ctx.fill(); }
        emoji(f.icon, vx, top - 30, 54 * rise + 1, f.alpha);
        spots.forEach((p, i) => {
          const start = .25 + i * .08, t = clamp01((f.m - start) / .35), q = after[i] || p;
          if (f.m < start) return;
          if (t < 1) { const rock = flight({ x: vx, y: top }, { x: p.x, y: p.y + 20 }, t, 150); glow(rock, 22, 'rgba(255,120,40,.9)', f.alpha); ctx.globalAlpha = f.alpha; ctx.fillStyle = '#3b1d10'; ctx.beginPath(); ctx.arc(rock.x, rock.y, 8, 0, TAU); ctx.fill(); return; }
          const e = clamp01((f.m - start - .35) / .3) + f.fade * .5, out = outcomeAt(b, i);
          if (out === 'boost') { glow(q, 60, 'rgba(255,225,120,.95)', f.alpha * (1 - clamp01(e))); pop('⏫', q, e, f.alpha, 44); }
          else if (blockedAt(b, i)) ring(q.x, q.y - 20, 34, 34, '#c2fbff', f.alpha * (1 - clamp01(e)), 4);
          else { capsize(q, e, f.alpha, b.id + i); particles({ x: q.x, y: q.y - 16 }, clamp01(e), '#ff7b29', 12, 70, b.id + i * 3); }
        });
      },
      // Rockets streak up from the caster and burst into coloured stars over each duck they fall on.
      fireworks(b, f) {
        const start = { x: b.pre.origin.x, y: b.pre.origin.y - 30 }, COLORS = ['#ff5ea8', '#ffd166', '#7cf5ff', '#b67bff', '#7dff8a'];
        ctx.globalAlpha = f.alpha * .06 * Math.sin(clamp01(f.m) * Math.PI); ctx.fillStyle = '#120a35'; ctx.fillRect(0, 0, width, height);
        b.pre.affected.forEach((p, i) => {
          const launch = i * .08, t = clamp01((f.m - launch) / .34), top = { x: p.x, y: Math.max(64, p.y - 150) }, col = COLORS[(i + b.id) % COLORS.length];
          if (f.m < launch) return;
          if (t < 1) {
            const at = u => ({ x: start.x + (top.x - start.x) * u, y: start.y + (top.y - start.y) * u - Math.sin(u * Math.PI) * 40 });
            for (let k = 8; k >= 0; k--) { const q = at(Math.max(0, t - k * .03)); ctx.globalAlpha = f.alpha * (1 - k / 9); ctx.fillStyle = k ? '#ffe8a3' : '#ffffff'; ctx.beginPath(); ctx.arc(q.x + (noise(k + i) - .5) * 4, q.y, k ? 2.6 : 4, 0, TAU); ctx.fill(); }
            return;
          }
          const e = clamp01((f.m - launch - .34) / .4) * .8 + f.fade * .6;
          starburst(top, clamp01(e), f.alpha, col, b.id + i * 11);
          if (e > .3) { if (blockedAt(b, i)) ring(p.x, p.y - 20, 32, 32, '#c2fbff', f.alpha, 3); else capsize(b.affected[i] || p, (e - .3) * 1.3, f.alpha * .9, b.id + i); }
        });
        emoji(f.icon, start.x, start.y - 30, 46, f.alpha);
      },
      mirror(b, f) {
        const glass = mirrorPane(b.origin, f.m, f.alpha), reach = clamp01((f.m - .2) / .5);
        emoji(f.icon, glass.x, glass.y + 14, 40 * clamp01(f.m * 3) + 1, f.alpha);
        if (reach <= 0) return;
        const hit = { x: b.target.x, y: b.target.y - 24 };
        beam(glass, { x: glass.x + (hit.x - glass.x) * reach, y: glass.y + (hit.y - glass.y) * reach }, f.alpha, '#bfe9ff');
        if (reach >= 1) {
          glow(b.target, 60, '#ffffff', f.alpha * .9);
          ring(hit.x, hit.y, 12 + f.fade * 50, 9 + f.fade * 34, '#ffffff', f.alpha, 3);
          particles(hit, clamp01(f.fade + .2), '#ffffff', 16, 60, b.id);
        }
      }
    };
    function drawTwist(burst, age) {
      const [icon] = TWIST[burst.kind];
      const m = clamp01(age / TWIST_MAIN), fade = clamp01((age - TWIST_MAIN) / (burst.life - TWIST_MAIN));
      PAINT[burst.kind](burst, { m, fade, alpha: 1 - fade, icon });
      ctx.globalAlpha = 1;
    }
    function draw(sample, elapsed, { running = true } = {}) {
      if (destroyed) return;
      lastSample = sample; lastElapsed = elapsed;
      ctx.clearRect(0, 0, width, height);
      // The map is part of the course, so it shows even with reduced motion (frozen at t = 0 there).
      const still = reduced(), t = still ? 0 : elapsed;
      if (gctx) { gctx.clearRect(0, 0, width, height); const main = ctx; ctx = gctx; try { drawMap(t, 'ground'); } finally { ctx = main; } }
      else drawMap(t, 'ground');
      drawMap(t, 'top');
      if (still) { bursts = []; return; }
      drawWater(elapsed);
      drawWeather(elapsed, sample);
      for (const racer of sample) drawWake(racer, sample, elapsed, running);
      bursts = bursts.filter(b => elapsed - b.time < b.life);
      bursts.forEach(b => drawBurst(b, elapsed)); ctx.globalAlpha = 1;
    }
    const scroll = () => { if (lastSample.length) draw(lastSample, lastElapsed, { running: false }); };
    river.addEventListener('scroll', scroll, { passive: true });
    resize();
    return { resize, draw, event, destroy() { destroyed = true; bursts = []; river.removeEventListener('scroll', scroll); canvas.remove(); ground?.remove(); container.classList.remove('has-ground'); } };
  }

  function celebrate(target, reduced) {
    if (!target || reduced || !root.requestAnimationFrame) return;
    target.querySelector('.finish-confetti')?.remove();
    const canvas = document.createElement('canvas'); canvas.className = 'finish-confetti'; canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '10' });
    const ctx = context(canvas); if (!ctx) return;
    const width = target.clientWidth || 600, height = Math.min(target.clientHeight || 600, 1000);
    canvas.width = width; canvas.height = height; target.append(canvas);
    const start = root.performance.now(); const colors = ['#f47a43', '#ffd56f', '#79d8cd', '#b59aed', '#f29ab2'];
    function frame(now) {
      if (!canvas.isConnected || !target.open) { canvas.remove(); return; }
      const time = (now - start) / 1000;
      if (time > 1.7) { canvas.remove(); return; }
      ctx.clearRect(0, 0, width, height); ctx.globalAlpha = Math.min(1, (1.7 - time) * 2);
      for (let i = 0; i < 55; i++) {
        const x = noise(i + 19) * width + Math.sin(time * 3 + i) * 18;
        const y = -40 - noise(i + 5) * 150 + time * (180 + noise(i + 44) * 170);
        ctx.save(); ctx.translate(x, y); ctx.rotate(time * (i % 2 ? 3 : -4) + i); ctx.fillStyle = colors[i % colors.length];
        ctx.fillRect(-3, -5, 5 + noise(i) * 4, 7 + noise(i + 2) * 5); ctx.restore();
      }
      root.requestAnimationFrame(frame);
    }
    root.requestAnimationFrame(frame);
  }
  root.DuckRaceVisuals = Object.freeze({ create, celebrate });
})(typeof window !== 'undefined' ? window : globalThis);
