(function (root) {
  'use strict';
  // Synthesized sound effects for chaos-v2/v3 twists (no audio files).
  // kindOf() picks a sound for an event; play() builds it with Web Audio.
  const BY_SKILL = { wings: 'flutter', wave: 'wave', swap: 'zap', mirror: 'ding', hook: 'zip', tornado: 'swirl', buoy: 'pop' };
  const BY_HAZARD = { rock: 'splash', croc: 'chomp', wind: 'whoosh', whirlpool: 'swirl', dolphin: 'chirp' };
  const kinds = Object.freeze(['splash', 'boom', 'whoosh', 'flutter', 'wave', 'zap', 'ding', 'zip', 'swirl', 'pop', 'slide', 'chomp', 'chirp', 'cheer']);
  const V2_SKILLS = new Set(['wings', 'torpedo', 'wave', 'swap', 'rocket', 'mirror', 'hook', 'tornado', 'banana', 'buoy']);

  function kindOf(event) {
    if (event.type === 'hazard') return BY_HAZARD[event.hazard] || null;
    if (event.type !== 'skill' || !V2_SKILLS.has(event.skill)) return null;
    if (event.outcome === 'reflected') return 'ding';
    if (event.outcome === 'blocked' || event.outcome === 'immune') return 'pop';
    if (event.skill === 'torpedo') return 'boom';
    if (event.skill === 'rocket') return event.outcome === 'exploded' ? 'boom' : 'whoosh';
    if (event.skill === 'banana') return event.outcome === 'dropped' ? 'pop' : 'slide';
    return BY_SKILL[event.skill];
  }

  const VOLUME = .28;
  function envelope(ctx, gain, start, peak, attack, decay) {
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(peak * VOLUME, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
  }
  function tone(ctx, type, from, to, start, length, peak = 1, attack = .01) {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(to, start + length);
    envelope(ctx, gain, start, peak, attack, length);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(start); osc.stop(start + attack + length + .05);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }
  function noise(ctx, filterType, from, to, start, length, peak = 1, attack = .01) {
    const frames = Math.max(1, Math.round(ctx.sampleRate * (length + attack + .05)));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1; // ponytail: Math.random is fine for audio texture
    const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    src.buffer = buffer; filter.type = filterType;
    filter.frequency.setValueAtTime(from, start);
    filter.frequency.exponentialRampToValueAtTime(to, start + length);
    envelope(ctx, gain, start, peak, attack, length);
    src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    src.start(start); src.stop(start + attack + length + .05);
    src.onended = () => { src.disconnect(); filter.disconnect(); gain.disconnect(); };
  }
  const RECIPES = {
    splash: (c, t) => { noise(c, 'lowpass', 2400, 300, t, .55, 1); tone(c, 'sine', 180, 60, t, .15, .6); },
    boom: (c, t) => { tone(c, 'sine', 140, 35, t, .7, 1.2); noise(c, 'lowpass', 900, 120, t, .8, 1); noise(c, 'lowpass', 2600, 400, t + .12, .5, .6); },
    whoosh: (c, t) => noise(c, 'bandpass', 350, 2600, t, .55, 1, .12),
    flutter: (c, t) => { for (let i = 0; i < 4; i++) noise(c, 'bandpass', 900, 600, t + i * .09, .06, .9); tone(c, 'triangle', 600, 1400, t, .4, .3); },
    wave: (c, t) => noise(c, 'lowpass', 500, 1600, t, 1, 1, .35),
    zap: (c, t) => { tone(c, 'sawtooth', 1200, 180, t, .28, .5); tone(c, 'square', 180, 1200, t + .16, .22, .3); },
    ding: (c, t) => { tone(c, 'sine', 1760, 1740, t, 1.2, .8, .003); tone(c, 'sine', 2637, 2600, t, .9, .4, .003); tone(c, 'triangle', 3520, 3500, t + .02, .5, .2, .003); },
    zip: (c, t) => tone(c, 'square', 260, 1300, t, .32, .35),
    swirl: (c, t) => { tone(c, 'sine', 320, 640, t, .45, .6); tone(c, 'sine', 640, 280, t + .4, .45, .6); noise(c, 'bandpass', 600, 1200, t, .8, .4, .2); },
    pop: (c, t) => tone(c, 'sine', 520, 1300, t, .09, 1, .003),
    slide: (c, t) => tone(c, 'sine', 1300, 260, t, .65, .7),
    chomp: (c, t) => { for (const d of [0, .14]) { noise(c, 'lowpass', 1400, 300, t + d, .06, 1, .002); tone(c, 'square', 90, 60, t + d, .06, .5, .002); } },
    chirp: (c, t) => { for (let i = 0; i < 3; i++) tone(c, 'sine', 1400, 3200, t + i * .11, .08, .6, .005); },
    // Crowd roar (band-passed noise swell) plus two whistles.
    cheer: (c, t) => { noise(c, 'bandpass', 900, 1700, t, 1.6, 1.1, .25); tone(c, 'sine', 1800, 2400, t + .2, .25, .3); tone(c, 'sine', 2000, 2700, t + .55, .3, .3); }
  };
  // Soft looping river noise for the whole race; returns stop().
  function ambience(ctx) {
    if (!ctx) return () => {};
    try {
      const frames = Math.round(ctx.sampleRate * 2), buffer = ctx.createBuffer(1, frames, ctx.sampleRate), data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain(), t = ctx.currentTime;
      src.buffer = buffer; src.loop = true; filter.type = 'lowpass'; filter.frequency.setValueAtTime(650, t);
      gain.gain.setValueAtTime(0.0001, t); gain.gain.linearRampToValueAtTime(.18 * VOLUME, t + .8);
      src.connect(filter); filter.connect(gain); gain.connect(ctx.destination); src.start(t);
      return () => { try { const end = ctx.currentTime; gain.gain.linearRampToValueAtTime(0.0001, end + .3); src.stop(end + .35); } catch { /* already stopped */ } };
    } catch { return () => {}; }
  }
  function play(ctx, kind) {
    const recipe = RECIPES[kind];
    if (!ctx || !recipe) return;
    try { recipe(ctx, ctx.currentTime); } catch { /* ponytail: a failed sound must never break the race */ }
  }
  const api = Object.freeze({ kinds, kindOf, play, ambience });
  root.DuckSfx = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
