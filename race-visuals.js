(function (root) {
  'use strict';
  // Decoration only: this renderer never changes a race, its seed, or results.
  const TAU = Math.PI * 2;
  const noise = n => { const value = Math.sin(n * 127.1 + 311.7) * 43758.5453; return value - Math.floor(value); };
  const noop = () => {};
  const empty = () => ({ resize: noop, draw: noop, event: noop, destroy: noop });
  function context(canvas) { try { return canvas.getContext('2d', { alpha: true }); } catch { return null; } }

  function create({ container, river, nodes, reduced = () => false, seed = 0 }) {
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
      const kind = event.skill === 'swap' ? (event.outcome === 'swapped' ? 'swap' : 'shield')
        : event.skill === 'bomb' ? 'bomb' : event.type === 'rune-pickup' ? 'rune' : event.outcome === 'shield' ? 'shield' : 'boost';
      bursts.push({ time: elapsed, kind, origin, target, blocked: ['shielded', 'immune', 'resisted'].includes(event.outcome), id: event.id.length + event.actorId * 7 });
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
      const age = Math.max(0, time - burst.time), p = age / .85;
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
      } else particles(burst.origin, p, burst.kind === 'rune' ? '#fff2a2' : '#ffe87f', 12, 44, burst.id);
    }
    function draw(sample, elapsed, { running = true } = {}) {
      if (destroyed) return;
      lastSample = sample; lastElapsed = elapsed;
      ctx.clearRect(0, 0, width, height);
      if (reduced()) { bursts = []; return; }
      drawWater(elapsed);
      for (const racer of sample) drawWake(racer, sample, elapsed, running);
      bursts = bursts.filter(b => elapsed - b.time < .85);
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
