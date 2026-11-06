(function (root) {
  'use strict';
  // Synthesized sound effects for chaos-v2/v3 twists (no audio files).
  // kindOf() picks a sound for an event; play() builds it with Web Audio.
  const BY_SKILL = { wings: 'flutter', wave: 'wave', swap: 'zap', mirror: 'ding', hook: 'zip', tornado: 'swirl', buoy: 'pop',
    magnet: 'zip', lightning: 'thunder', flip: 'zap', rewind: 'warp', reverse: 'warp', freeze: 'ice',
    missile: 'missile', bees: 'buzz', blackhole: 'void', ghost: 'ghost', balloon: 'balloon',
    bomb: 'zip', dice: 'pop', lullaby: 'lull', hex: 'magic', giant: 'thud' };
  const BY_HAZARD = { rock: 'splash', croc: 'chomp', wind: 'whoosh', whirlpool: 'swirl', dolphin: 'chirp', hippo: 'splash', log: 'thud', frog: 'ribbit' };
  const kinds = Object.freeze(['splash', 'boom', 'whoosh', 'flutter', 'wave', 'zap', 'ding', 'zip', 'swirl', 'pop', 'slide', 'chomp', 'chirp', 'cheer', 'thunder', 'warp', 'ice', 'missile', 'buzz', 'ghost', 'balloon', 'thud', 'ribbit', 'void', 'lull', 'magic']);
  const V2_SKILLS = new Set(['wings', 'torpedo', 'wave', 'swap', 'rocket', 'mirror', 'hook', 'tornado', 'banana', 'buoy',
    'magnet', 'lightning', 'flip', 'rewind', 'reverse', 'freeze', 'missile', 'bees', 'blackhole', 'ghost', 'balloon',
    'bomb', 'copycat', 'dice', 'lullaby', 'hex', 'giant']); // chaos-v2 + chaos-v3 skills

  function kindOf(event) {
    if (event.type === 'hazard') return BY_HAZARD[event.hazard] || null;
    if (event.type !== 'skill' || !V2_SKILLS.has(event.skill)) return null;
    if (event.skill === 'copycat') return event.copied ? kindOf({ ...event, skill: event.copied }) : null; // sounds like what it copied
    if (event.outcome === 'reflected') return 'ding';
    if (event.outcome === 'blocked' || event.outcome === 'immune') return 'pop';
    if (event.skill === 'torpedo' || event.skill === 'bomb' && event.outcome === 'hit') return 'boom';
    if (event.skill === 'dice' && event.outcome === 'bust') return 'splash';
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
    // Crack then rolling rumble.
    thunder: (c, t) => { noise(c, 'highpass', 3000, 1200, t, .12, 1.2, .002); noise(c, 'lowpass', 600, 80, t + .05, 1.4, 1.1, .05); tone(c, 'sine', 70, 40, t + .05, 1, .8); },
    // Tape-rewind squeal sweeping down.
    warp: (c, t) => { tone(c, 'sawtooth', 1800, 120, t, .7, .35); tone(c, 'sine', 900, 60, t + .08, .65, .4); },
    // Glassy shimmer of ice.
    ice: (c, t) => { for (let i = 0; i < 5; i++) tone(c, 'triangle', 2400 + i * 380, 2300 + i * 380, t + i * .06, .5, .25, .003); noise(c, 'highpass', 6000, 4000, t, .4, .3); },
    missile: (c, t) => { noise(c, 'bandpass', 600, 3200, t, .45, .8, .05); tone(c, 'sawtooth', 300, 1400, t, .42, .25); RECIPES.boom(c, t + .45); },
    // A swarm: detuned square buzzes wobbling in pitch.
    buzz: (c, t) => { for (const f of [210, 228, 245]) for (let i = 0; i < 4; i++) tone(c, 'square', f + i * 9, f - i * 7, t + i * .18, .2, .18, .02); },
    ghost: (c, t) => { tone(c, 'sine', 420, 880, t, .5, .5, .15); tone(c, 'sine', 880, 330, t + .5, .7, .45, .05); tone(c, 'triangle', 660, 640, t, 1.1, .15, .3); },
    balloon: (c, t) => { tone(c, 'sine', 500, 1600, t, .45, .5, .02); tone(c, 'triangle', 1600, 1500, t + .45, .25, .3); },
    thud: (c, t) => { tone(c, 'sine', 110, 45, t, .35, 1.1, .003); noise(c, 'lowpass', 700, 120, t, .3, .8, .003); },
    ribbit: (c, t) => { for (const d of [0, .2]) { tone(c, 'square', 180, 260, t + d, .07, .5, .005); tone(c, 'square', 260, 150, t + d + .07, .06, .4, .005); } },
    // A deep suck down into the hole, then a bright blip when it spits the duck out.
    void: (c, t) => { tone(c, 'sine', 240, 32, t, 1.1, 1.2, .04); noise(c, 'lowpass', 2600, 110, t, 1, .7, .08); tone(c, 'triangle', 160, 1500, t + 1.05, .22, .45, .005); },
    // A soft music-box lullaby: three falling chimes.
    lull: (c, t) => { [1047, 880, 698].forEach((f, i) => tone(c, 'sine', f, f * .99, t + i * .22, .55, .5, .01)); tone(c, 'triangle', 349, 340, t, 1.1, .2, .2); },
    // Magic wand: a sparkly rising sweep and a croak-like pop.
    magic: (c, t) => { for (let i = 0; i < 6; i++) tone(c, 'triangle', 900 + i * 260, 1000 + i * 300, t + i * .05, .18, .3, .003); tone(c, 'square', 220, 140, t + .4, .12, .4, .005); },
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
