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
    rock: ['🪨', '#d9c6a5'], croc: ['🐊', '#b5e3a1'], wind: ['💨', '#e8fbff'], whirlpool: ['🌀', '#a9dcff'], dolphin: ['🐬', '#a6e4ff']
  };
  const V2_KIND = { wings: 'fly', torpedo: 'torpedo', wave: 'wave', rocket: 'rocket', mirror: 'mirror', hook: 'hook', tornado: 'tornado', banana: 'banana', buoy: 'guard',
    rock: 'rock', croc: 'croc', wind: 'wind', whirlpool: 'whirlpool', dolphin: 'dolphin' };
  // Race seconds. TWIST_MAIN matches the app's slow-motion window (0.2x for 1.4 s = 0.28 race-s),
  // so each twist's main action plays in slow motion; the rest is a short fade.
  const BURST_LIFE = .85, TWIST_LIFE = 1.1, TWIST_MAIN = .3;
  const THROWN = new Set(['torpedo', 'hook']), SPREAD = new Set(['wave', 'tornado']), AT_ACTOR = new Set(['fly', 'rocket', 'boom', 'guard']);
  function kindOf(event) {
    const v2 = V2_KIND[event.skill || event.hazard];
    if (v2) return event.skill === 'rocket' && event.outcome === 'exploded' ? 'boom' : v2;
    return event.skill === 'swap' ? (event.outcome === 'swapped' ? 'swap' : 'shield')
      : event.skill === 'bomb' ? 'bomb' : event.type === 'rune-pickup' ? 'rune' : event.outcome === 'shield' ? 'shield' : 'boost';
  }
  function context(canvas) { try { return canvas.getContext('2d', { alpha: true }); } catch { return null; } }

  function create({ container, river, nodes, reduced = () => false, seed = 0, weather = null }) {
    if (!container || !river || !nodes.length) return empty();
    const canvas = document.createElement('canvas');
    canvas.className = 'race-effects';
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '4' });
    const ctx = context(canvas);
    if (!ctx) return empty();
    container.append(canvas);
    let width = 0, height = 0, metrics = [], bursts = [], lastSample = [], lastElapsed = 0, destroyed = false;

    function resize() {
      if (destroyed) return;
      const rect = container.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width)); height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(1.5, root.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      metrics = nodes.map(node => {
        const lane = node.parentElement.getBoundingClientRect();
        const body = node.querySelector('.duck-body');
        return { x: lane.left - rect.left, y: lane.top - rect.top + river.scrollTop,
          travel: lane.width, duckWidth: node.offsetWidth || 88, duckHeight: body?.offsetHeight || 76 };
      });
    }
    const point = (id, sample) => {
      const metric = metrics[id], racer = sample[id];
      if (!metric || !racer) return { x: 0, y: 0 };
      return { x: metric.x + racer.progress * metric.travel + metric.duckWidth * .5,
        y: metric.y - river.scrollTop + metric.duckHeight * .65 };
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
        ctx.strokeStyle = '#fff4a8'; ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          const age = (time * 3.4 + i * .23 + racer.id * .13) % 1;
          ctx.globalAlpha = (1 - age) * .75;
          const x = left - 14 - age * 84, yy = y - 13 + i * 8;
          ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x - 10 - age * 12, yy); ctx.stroke();
        }
      }
    }
    function event(event, sample, elapsed) {
      if (destroyed || reduced() || elapsed - event.time > .3 || event.type === 'rune-spawn') return;
      const origin = point(event.actorId, sample), target = point(Number.isInteger(event.targetId) ? event.targetId : event.actorId, sample);
      const kind = kindOf(event);
      bursts.push({ time: elapsed, kind, origin, target, blocked: ['shielded', 'immune', 'resisted'].includes(event.outcome), id: event.id.length + event.actorId * 7,
        affected: (event.affectedIds || []).map(id => point(id, sample)), atActor: AT_ACTOR.has(kind) || event.outcome === 'dropped', life: TWIST[kind] ? TWIST_LIFE : BURST_LIFE,
        outcome: event.outcome, reflected: event.outcome === 'reflected' });
      if (bursts.length > 24) bursts = bursts.slice(-24);
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
      } else if (burst.kind === 'shield') {
        ring(burst.target.x, burst.target.y - 8, 19 + p * 18, 22 + p * 15, '#f0ffff', (1 - p) * .85, 3);
        particles(burst.target, p, '#c2fbff', 9, 32, burst.id);
      } else if (TWIST[burst.kind]) drawTwist(burst, age);
      else particles(burst.origin, p, burst.kind === 'rune' ? '#fff2a2' : '#ffe87f', 12, 44, burst.id);
    }
    function emoji(icon, x, y, size, alpha) {
      ctx.globalAlpha = Math.max(0, alpha); ctx.font = `${size}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText(icon, x, y);
    }
    // Weather ambience (chaos-v3): rain streaks, gusts, storm lightning, sun glints.
    function drawWeather(time) {
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
    function line(a, b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    // Droplets thrown up and pulled down by gravity; t runs 0 → ~1.4.
    function splash(spot, t, alpha, tag, color = '#effcff', count = 18) {
      ctx.fillStyle = color;
      for (let i = 0; i < count; i++) {
        const vx = (noise(tag + i) - .5) * 150, vy = -(110 + noise(tag + i + 9) * 140), tt = t * .85;
        const y = Math.min(spot.y + 4, spot.y - 4 + vy * tt + 300 * tt * tt);
        ctx.globalAlpha = Math.max(0, alpha) * (.55 + noise(i + tag) * .45);
        ctx.beginPath(); ctx.arc(spot.x + vx * tt, y, 1.8 + noise(tag + i + 3) * 3.4, 0, TAU); ctx.fill();
      }
    }
    // Flat rings spreading on the water surface.
    function ripples(spot, t, alpha, color = '#ffffff') {
      for (let k = 0; k < 3; k++) {
        const r = t * 1.3 - k * .2;
        if (r > 0 && r < 1) ring(spot.x, spot.y + 8, 18 + r * 80, 4 + r * 17, color, alpha * (1 - r) * .9, 2.2);
      }
    }
    // Icon that springs up above a duck.
    function pop(icon, spot, m, alpha, size = 46) {
      const k = clamp01(m * 2.4), bounce = k < 1 ? Math.sin(k * Math.PI * .5) * 1.15 : 1;
      emoji(icon, spot.x, spot.y - 46 - (1 - alpha) * 14, size * Math.max(.3, bounce), alpha);
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
    function capsize(spot, t, alpha, tag) {
      glow(spot, 40 + t * 40, '#ffffff', alpha * (1 - clamp01(t)) * .8);
      splash(spot, t, alpha, tag); ripples(spot, t, alpha);
    }
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
    const PAINT = {
      torpedo(b, f) {
        const land = b.reflected ? .7 : .45;
        if (f.m < land) {
          const t = b.reflected ? (f.m < .35 ? f.m / .35 : 1 - (f.m - .35) / .35) : f.m / land;
          const p = flight(b.origin, b.target, t, 70);
          ctx.globalAlpha = .55; ctx.strokeStyle = '#d7b0ff'; ctx.lineWidth = 3; line(b.origin, p);
          emoji(f.icon, p.x, p.y, 36, 1); return;
        }
        const spot = b.reflected ? b.origin : b.target, t = (f.m - land) / (1 - land) * .7 + f.fade * .8;
        capsize(spot, t, f.alpha, b.id); pop('💥', spot, f.m, f.alpha, 40); pop(f.icon, { x: spot.x + 30, y: spot.y }, f.m, f.alpha, 30);
      },
      rock(b, f) {
        const spot = b.target, fall = clamp01(f.m / .4);
        emoji(f.icon, spot.x + 30, spot.y - 110 + fall * 92, 40, f.alpha);
        if (fall >= 1) capsize(spot, (f.m - .4) / .6 * .7 + f.fade * .8, f.alpha, b.id);
      },
      boom(b, f) {
        const spot = b.origin, t = f.m * .7 + f.fade * .8;
        glow(spot, 30 + f.m * 70, '#ffb347', f.alpha * (1 - clamp01(t)));
        particles(spot, clamp01(t), '#5b5b5b', 14, 80, b.id);
        capsize(spot, t, f.alpha, b.id); pop(f.icon, spot, f.m, f.alpha, 56);
      },
      rocket(b, f) {
        const spot = b.origin, flick = .75 + noise(Math.floor(f.m * 40) + b.id) * .5;
        const g = ctx.createLinearGradient(spot.x - 110 * flick, spot.y, spot.x - 20, spot.y);
        g.addColorStop(0, 'rgba(255,90,20,0)'); g.addColorStop(.6, '#ff8a1e'); g.addColorStop(1, '#fff2a0');
        ctx.globalAlpha = f.alpha; ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(spot.x - 20, spot.y - 22); ctx.lineTo(spot.x - 110 * flick, spot.y - 6); ctx.lineTo(spot.x - 20, spot.y + 8); ctx.fill();
        particles({ x: spot.x - 70, y: spot.y }, clamp01(f.m + f.fade), '#9a9a9a', 10, 50, b.id);
        pop(f.icon, { x: spot.x - 34, y: spot.y + 24 }, f.m, f.alpha, 34);
      },
      fly(b, f) {
        const spot = b.origin;
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
      wave(b, f) {
        const spots = b.affected.length ? b.affected : [b.target];
        spots.forEach((spot, i) => {
          const x = spot.x + 160 - clamp01(f.m * 1.2) * 190;
          ctx.globalAlpha = f.alpha * .8; ctx.strokeStyle = '#2f9bd6'; ctx.lineWidth = 14; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.arc(x, spot.y - 6, 30, Math.PI * .9, Math.PI * 1.9); ctx.stroke();
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5;
          ctx.beginPath(); ctx.arc(x, spot.y - 6, 36, Math.PI * 1.05, Math.PI * 1.75); ctx.stroke(); ctx.lineCap = 'butt';
          splash({ x, y: spot.y }, clamp01(f.m) * .6 + f.fade * .6, f.alpha, b.id + i * 13, '#ffffff', 10);
        });
        pop(f.icon, spots[0], f.m, f.alpha, 52);
      },
      hook(b, f) {
        const reach = clamp01(f.m / .45), tip = flight(b.origin, b.target, reach, 40);
        ctx.globalAlpha = f.alpha; ctx.strokeStyle = '#3f3a2e'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(b.origin.x, b.origin.y - 30); ctx.quadraticCurveTo((b.origin.x + tip.x) / 2, Math.min(b.origin.y, tip.y) - (reach < 1 ? 50 : 10), tip.x, tip.y); ctx.stroke();
        emoji(f.icon, tip.x, tip.y, 32, f.alpha);
        if (reach >= 1) ripples(b.target, (f.m - .45) * 1.4 + f.fade, f.alpha);
      },
      tornado(b, f) {
        const spots = b.affected.length ? b.affected : [b.target];
        for (const spot of spots) {
          for (let arm = 0; arm < 4; arm++) {
            const start = arm / 4 * TAU + (f.m + f.fade) * TAU * 3;
            ctx.globalAlpha = f.alpha * .8; ctx.strokeStyle = arm % 2 ? '#e8eefc' : '#9fb3d9'; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.ellipse(spot.x, spot.y - 20 - arm * 6, 34 - arm * 5, 12 - arm * 2, 0, start, start + Math.PI * 1.1); ctx.stroke();
          }
          particles(spot, clamp01(f.m + f.fade * .5), '#cfd8ea', 10, 60, b.id);
        }
        pop(f.icon, spots[0], f.m, f.alpha, 52);
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
      wind(b, f) {
        const spot = b.target;
        for (let i = 0; i < 6; i++) {
          const phase = (f.m * 1.5 + f.fade + i / 6) % 1, x = spot.x - 160 + phase * 220, y = spot.y - 50 + i * 12;
          ctx.globalAlpha = f.alpha * (1 - phase) * .9; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 30, y - 6, x + 60, y); ctx.stroke(); ctx.lineCap = 'butt';
        }
        pop(f.icon, spot, f.m, f.alpha, 48);
      },
      whirlpool(b, f) {
        const spot = b.target;
        for (let k = 0; k < 4; k++) {
          const start = (f.m + f.fade) * TAU * 2.5 + k;
          ctx.globalAlpha = f.alpha * (.9 - k * .15); ctx.strokeStyle = k % 2 ? '#e9fbff' : '#2d7fb8'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.ellipse(spot.x, spot.y + 4, 16 + k * 14, 5 + k * 4, 0, start, start + Math.PI * 1.5); ctx.stroke();
        }
        pop(f.icon, spot, f.m, f.alpha, 46);
      },
      dolphin(b, f) {
        const spot = b.target, t = clamp01(f.m / .8), from = { x: spot.x - 110, y: spot.y + 10 }, to = { x: spot.x + 60, y: spot.y + 10 };
        const p = flight(from, to, t, 90);
        emoji(f.icon, p.x, p.y, 44, f.alpha);
        splash(from, t * 1.2, f.alpha * (1 - t), b.id, '#e9fbff', 10);
        if (t >= 1) splash(to, (f.m - .8) * 2 + f.fade, f.alpha, b.id + 5, '#e9fbff', 10);
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
      if (reduced()) { bursts = []; return; }
      drawWater(elapsed);
      drawWeather(elapsed);
      for (const racer of sample) drawWake(racer, sample, elapsed, running);
      bursts = bursts.filter(b => elapsed - b.time < b.life);
      bursts.forEach(b => drawBurst(b, elapsed)); ctx.globalAlpha = 1;
    }
    const scroll = () => { if (lastSample.length) draw(lastSample, lastElapsed, { running: false }); };
    river.addEventListener('scroll', scroll, { passive: true });
    resize();
    return { resize, draw, event, destroy() { destroyed = true; bursts = []; river.removeEventListener('scroll', scroll); canvas.remove(); } };
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
