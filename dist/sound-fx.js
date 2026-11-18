(function (root) {
  'use strict';
  // Synthesized sound effects for chaos-v2/v3 twists (no audio files).
  // cues() lists an event's sounds and when each lands, as m: the share of the twist's slow-motion window
  // (0 = cast, 1 = end), in step with the painters in race-visuals.js. play() builds one with Web Audio.
  const BY_SKILL = { wings: 'flutter', torpedo: 'whistle', wave: 'wave', swap: 'zap', rocket: 'rocket', mirror: 'ding', hook: 'zip', tornado: 'tornado', banana: 'slide', buoy: 'boing',
    magnet: 'magnet', lightning: 'thunder', flip: 'flip', rewind: 'rewind', reverse: 'scratch', freeze: 'ice',
    missile: 'missile', bees: 'buzz', blackhole: 'void', ghost: 'ghost', balloon: 'balloon',
    bomb: 'fuse', dice: 'rattle', lullaby: 'lull', hex: 'magic', giant: 'grow',
    kraken: 'kraken', dragon: 'roar', meteor: 'meteor', whale: 'spout', ufo: 'ufo', pirate: 'horn', wheel: 'wheel', anchor: 'clank', volcano: 'eruption', fireworks: 'fireworks',
    pho: 'slurp', coffee: 'coffee', cash: 'cash', net: 'toss', kite: 'kite', cloud: 'rain', hourglass: 'timestop', loudspeaker: 'speaker', portal: 'portal', xeom: 'xeom' };
  const BY_HAZARD = { rock: ['splash', .3], croc: ['chomp', .35], wind: ['whoosh', 0], whirlpool: ['swirl', 0], dolphin: ['chirp', 0], hippo: ['splash', .3], log: ['thud', .6], frog: ['ribbit', 0] };
  const V2_SKILLS = new Set([...Object.keys(BY_SKILL), 'copycat']); // chaos-v2 + chaos-v3 skills
  // One sound per duck a multi-hit twist lands on, staggered like its painter (hitOnly: guarded ducks stay quiet).
  function each(e, kind, first, step, hitOnly) {
    const out = [];
    (e.affectedIds || []).forEach((id, i) => { if (!hitOnly || (e.outcomes?.[id] ?? 'hit') === 'hit') out.push([kind, first + i * step]); });
    return out.slice(0, 4);
  }
  // Hits after the cast sound: [kind, m].
  const HITS = {
    torpedo: () => [['boom', .45]], wave: () => [['crash', .3]], hook: e => (e.outcome === 'hit' ? [['reel', .37]] : []),
    magnet: () => [['clack', .66]], freeze: () => [['icethud', .45]], missile: () => [['boom', .55]], blackhole: () => [['blip', .8]],
    dice: e => (e.outcome === 'bust' ? [['sad', .44], ['splash', .5]] : [[e.roll === 6 ? 'ding' : 'pop', .44]]),
    hex: () => [['ribbit', .45]], giant: e => each(e, 'thud', .2, .1), kraken: () => [['grab', .4]],
    dragon: e => (e.outcome === 'swept' ? [['crash', .5]] : []), meteor: e => each(e, 'boom', .45, .09, true), whale: () => [['splash', .78]],
    ufo: () => [['blip', .82]], pirate: e => each(e, 'cannon', .2, .13).slice(0, 3), anchor: () => [['splash', .42]],
    wheel: e => [[{ jackpot: 'jackpot', bust: 'splash', frozen: 'ice', swapped: 'flip' }[e.outcome] || 'ding', .62]],
    volcano: e => each(e, 'thud', .6, .08, true).slice(0, 3), fireworks: e => each(e, 'crackle', .34, .08),
    // chaos-v4. Phở's whoosh is when it has eaten (0.6 race-s, past the slow motion).
    pho: () => [['whoosh', 2.2]], cash: e => each(e, 'rustle', .35, .08, true), net: e => (e.outcome === 'hit' ? [['snare', .45]] : []),
    hourglass: e => (e.outcome === 'frozen' ? [['gong', .3]] : []), portal: () => [['blip', .5]]
  };
  // River obstacles (chaos-v4 race rooms) come by the dozen, so theirs are short and soft.
  const OBSTACLE = { hit: 'bonk', smashed: 'bonk', immune: 'pop' };
  function cues(event) {
    if (event.type === 'hazard') return BY_HAZARD[event.hazard] ? [BY_HAZARD[event.hazard]] : [];
    if (event.type === 'obstacle') return [[OBSTACLE[event.outcome] || (event.key === 'down' ? 'dive' : 'hop'), 0]];
    if (event.skill === 'cloud' && event.outcome === 'struck') return [['thunder', 0], ['splash', .2]]; // the rain cloud's closing bolt
    if (event.type !== 'skill' || !V2_SKILLS.has(event.skill)) return [];
    const skill = event.skill === 'copycat' ? event.copied : event.skill, o = event.outcome; // a copycat sounds like what it copied
    if (!BY_SKILL[skill]) return [];
    if (o === 'reflected') return [['ding', 0]];
    if (o === 'blocked' || o === 'immune') return [[skill === 'buoy' ? 'boing' : 'pop', 0]];
    if (skill === 'rocket' && o === 'exploded' || skill === 'bomb' && o === 'hit') return [['boom', 0]];
    if (skill === 'banana' && o === 'dropped') return [['plop', 0]];
    return [[BY_SKILL[skill], 0], ...(HITS[skill]?.(event) || [])];
  }
  const kindOf = event => cues(event)[0]?.[0] || null;

  const VOLUME = .28;
  // Every effect goes through one bus per audio context: a compressor so stacked hits never clip, and a gain that
  // cancel() fades out, so sounds queued for later never outlive a pause. The compressor is set as a fast limiter
  // just under 0 dB: measured in Chrome (once it has run a moment), single sounds keep their loudness (+2 to +9%) and a
  // pile of 8 peaks at 1.0 instead of clipping at 1.07.
  const buses = new WeakMap();
  let out = null; // the bus of the sound being built (play() builds synchronously)
  function bus(ctx) {
    let b = buses.get(ctx);
    if (!b) {
      const master = ctx.createDynamicsCompressor ? ctx.createDynamicsCompressor() : ctx.createGain();
      if (master.threshold) { master.threshold.value = -1; master.knee.value = 0; master.ratio.value = 20; master.attack.value = 0; master.release.value = .1; }
      master.connect(ctx.destination); b = { master, gain: null }; buses.set(ctx, b);
    }
    if (!b.gain) { b.gain = ctx.createGain(); b.gain.connect(b.master); }
    return b.gain;
  }
  function cancel(ctx) {
    const b = ctx && buses.get(ctx), g = b?.gain;
    if (!g) return;
    b.gain = null;
    try { const t = ctx.currentTime; g.gain.setValueAtTime(1, t); g.gain.linearRampToValueAtTime(0.0001, t + .06); } catch { /* fall through to the disconnect */ }
    setTimeout(() => { try { g.disconnect(); } catch { /* already gone */ } }, 120);
  }
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
    osc.connect(gain); gain.connect(out || ctx.destination);
    osc.start(start); osc.stop(start + attack + length + .05);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    return osc;
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
    src.connect(filter); filter.connect(gain); gain.connect(out || ctx.destination);
    src.start(start); src.stop(start + attack + length + .05);
    src.onended = () => { src.disconnect(); filter.disconnect(); gain.disconnect(); };
    return filter;
  }
  // Wobbles an audio parameter (a filter's centre, an oscillator's pitch) by ±depth, rate times a second.
  function lfo(ctx, param, rate, depth, start, length) {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.setValueAtTime(rate, start); gain.gain.setValueAtTime(depth, start);
    osc.connect(gain); gain.connect(param);
    osc.start(start); osc.stop(start + length);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }
  const RECIPES = {
    splash: (c, t) => { noise(c, 'lowpass', 2400, 300, t, .55, 1); tone(c, 'sine', 180, 60, t, .15, .6); },
    boom: (c, t) => { tone(c, 'sine', 140, 35, t, .7, 1.2); noise(c, 'lowpass', 900, 120, t, .8, 1); noise(c, 'lowpass', 2600, 400, t + .12, .5, .6); },
    whoosh: (c, t) => noise(c, 'bandpass', 350, 2600, t, .55, 1, .12),
    flutter: (c, t) => { for (let i = 0; i < 4; i++) noise(c, 'bandpass', 900, 600, t + i * .09, .06, .9); tone(c, 'triangle', 600, 1400, t, .4, .3); },
    // Tsunami: a deep swell builds (the crest then crashes: crash).
    wave: (c, t) => { noise(c, 'lowpass', 300, 1800, t, .9, 1.1, .35); tone(c, 'sine', 70, 50, t, 1, .6, .3); },
    crash: (c, t) => { noise(c, 'lowpass', 4000, 250, t, 1.1, 1.3, .01); tone(c, 'sine', 110, 40, t, .45, .9, .005); noise(c, 'highpass', 6000, 3000, t + .08, .9, .35, .05); },
    zap: (c, t) => { tone(c, 'sawtooth', 1200, 180, t, .28, .5); tone(c, 'square', 180, 1200, t + .16, .22, .3); },
    ding: (c, t) => { tone(c, 'sine', 1760, 1740, t, 1.2, .8, .003); tone(c, 'sine', 2637, 2600, t, .9, .4, .003); tone(c, 'triangle', 3520, 3500, t + .02, .5, .2, .003); },
    zip: (c, t) => tone(c, 'square', 260, 1300, t, .32, .35),
    // Fishing reel: a fast ratchet.
    reel: (c, t) => { for (let i = 0; i < 9; i++) tone(c, 'square', 1100 - i * 30, 900 - i * 30, t + i * .045, .02, .22, .001); },
    swirl: (c, t) => { tone(c, 'sine', 320, 640, t, .45, .6); tone(c, 'sine', 640, 280, t + .4, .45, .6); noise(c, 'bandpass', 600, 1200, t, .8, .4, .2); },
    // Tornado roar: band-passed noise whose centre wobbles, a howl on top, a low rumble under.
    tornado: (c, t) => { lfo(c, noise(c, 'bandpass', 420, 560, t, 1.6, 1.3, .25).frequency, 4.5, 260, t, 1.9); lfo(c, noise(c, 'bandpass', 1300, 1800, t + .1, 1.4, .45, .3).frequency, 7, 500, t, 1.8); tone(c, 'sine', 65, 45, t, 1.5, .7, .3); },
    pop: (c, t) => tone(c, 'sine', 520, 1300, t, .09, 1, .003),
    // Banana peel dropped: a soft wet plop.
    plop: (c, t) => { tone(c, 'sine', 950, 170, t, .13, .9, .003); noise(c, 'lowpass', 1400, 300, t + .03, .12, .4, .003); },
    // Buoy: a springy boing, its pitch wobbling as it rises.
    boing: (c, t) => { lfo(c, tone(c, 'sine', 160, 480, t, .55, .8, .005).frequency, 18, 70, t, .6); tone(c, 'triangle', 320, 960, t, .3, .2, .005); },
    slide: (c, t) => tone(c, 'sine', 1300, 260, t, .65, .7),
    chomp: (c, t) => { for (const d of [0, .14]) { noise(c, 'lowpass', 1400, 300, t + d, .06, 1, .002); tone(c, 'square', 90, 60, t + d, .06, .5, .002); } },
    chirp: (c, t) => { for (let i = 0; i < 3; i++) tone(c, 'sine', 1400, 3200, t + i * .11, .08, .6, .005); },
    // Crack then rolling rumble.
    thunder: (c, t) => { noise(c, 'highpass', 3000, 1200, t, .12, 1.2, .002); noise(c, 'lowpass', 600, 80, t + .05, 1.4, 1.1, .05); tone(c, 'sine', 70, 40, t + .05, 1, .8); },
    // Rewind: tape stuttering backwards, chirps speeding up, then a clunk.
    rewind: (c, t) => { let d = 0; for (let i = 0; i < 8; i++) { tone(c, 'sawtooth', 2400 - i * 150, 1100 - i * 90, t + d, .06, .22, .004); d += .13 - i * .012; } tone(c, 'square', 140, 70, t + d + .02, .08, .4, .003); },
    // Reverse: a record scratch, back and forth.
    scratch: (c, t) => { for (const [a, b, d, l] of [[700, 3200, 0, .11], [3200, 500, .12, .15], [600, 2400, .3, .09]]) { noise(c, 'bandpass', a, b, t + d, l, 1, .004); tone(c, 'sawtooth', a / 4, b / 4, t + d, l, .14, .004); } },
    // Freeze: ice crackles across the river while glassy chimes ring (the blocks then lock shut: icethud).
    ice: (c, t) => { for (let i = 0; i < 10; i++) noise(c, 'highpass', 6500, 3500, t + i * .05 + (i % 3) * .013, .025, .7, .001); for (let i = 0; i < 4; i++) tone(c, 'triangle', 2400 + i * 380, 2300 + i * 380, t + .1 + i * .07, .45, .2, .003); },
    icethud: (c, t) => { tone(c, 'sine', 170, 55, t, .32, 1.1, .003); noise(c, 'lowpass', 2000, 300, t, .2, .8, .002); tone(c, 'triangle', 3150, 3100, t + .02, .7, .16, .003); },
    // Torpedo: a falling whistle while it flies (it lands with a boom).
    whistle: (c, t) => { tone(c, 'sine', 1900, 650, t, .45, .35, .03); noise(c, 'bandpass', 2600, 900, t, .42, .22, .05); },
    missile: (c, t) => { noise(c, 'bandpass', 600, 3200, t, .5, .8, .05); tone(c, 'sawtooth', 300, 1400, t, .48, .25); },
    // A swarm: detuned square buzzes wobbling in pitch.
    buzz: (c, t) => { for (const f of [210, 228, 245]) for (let i = 0; i < 4; i++) tone(c, 'square', f + i * 9, f - i * 7, t + i * .18, .2, .18, .02); },
    ghost: (c, t) => { tone(c, 'sine', 420, 880, t, .5, .5, .15); tone(c, 'sine', 880, 330, t + .5, .7, .45, .05); tone(c, 'triangle', 660, 640, t, 1.1, .15, .3); },
    balloon: (c, t) => { tone(c, 'sine', 500, 1600, t, .45, .5, .02); tone(c, 'triangle', 1600, 1500, t + .45, .25, .3); },
    thud: (c, t) => { tone(c, 'sine', 110, 45, t, .35, 1.1, .003); noise(c, 'lowpass', 700, 120, t, .3, .8, .003); },
    ribbit: (c, t) => { for (const d of [0, .2]) { tone(c, 'square', 180, 260, t + d, .07, .5, .005); tone(c, 'square', 260, 150, t + d + .07, .06, .4, .005); } },
    // A deep suck down into the hole (blip: it spits the duck out).
    void: (c, t) => { tone(c, 'sine', 240, 32, t, 1.1, 1.2, .04); noise(c, 'lowpass', 2600, 110, t, 1, .7, .08); },
    blip: (c, t) => tone(c, 'triangle', 160, 1500, t, .22, .45, .005),
    // A soft music-box lullaby: three falling chimes.
    lull: (c, t) => { [1047, 880, 698].forEach((f, i) => tone(c, 'sine', f, f * .99, t + i * .22, .55, .5, .01)); tone(c, 'triangle', 349, 340, t, 1.1, .2, .2); },
    // Magic wand: a sparkly rising sweep (the frog croaks when the bolt lands).
    magic: (c, t) => { for (let i = 0; i < 6; i++) tone(c, 'triangle', 900 + i * 260, 1000 + i * 300, t + i * .05, .18, .3, .003); },
    // Big-show skills.
    kraken: (c, t) => { tone(c, 'sine', 95, 45, t, .9, 1.2, .05); noise(c, 'lowpass', 900, 120, t, .8, .9, .06); },
    // Tentacles grab: two wet slaps.
    grab: (c, t) => { for (const d of [0, .14]) { noise(c, 'bandpass', 800, 300, t + d, .12, .9, .004); tone(c, 'sine', 220, 90, t + d, .1, .4, .004); } },
    roar: (c, t) => { tone(c, 'sawtooth', 200, 80, t, 1.1, .7, .06); tone(c, 'square', 140, 70, t + .05, 1, .35, .08); noise(c, 'bandpass', 500, 1200, t, 1, .8, .1); },
    meteor: (c, t) => { tone(c, 'sine', 2200, 260, t, .6, .5, .02); noise(c, 'highpass', 4000, 800, t, .55, .4, .05); },
    spout: (c, t) => { tone(c, 'sine', 320, 190, t, .9, .7, .15); tone(c, 'sine', 190, 260, t + .7, .5, .4, .05); noise(c, 'lowpass', 600, 2400, t + .3, .8, 1, .2); },
    ufo: (c, t) => { for (let i = 0; i < 8; i++) tone(c, 'sine', i % 2 ? 620 : 940, i % 2 ? 900 : 640, t + i * .1, .1, .45, .01); tone(c, 'triangle', 300, 1800, t + .8, .4, .3, .02); },
    // Pirate ship: a low horn as it sails in; each cannon shot is its own sound.
    horn: (c, t) => { tone(c, 'sawtooth', 98, 94, t, .55, .22, .08); tone(c, 'sine', 196, 190, t, .55, .4, .08); },
    cannon: (c, t) => { tone(c, 'sine', 120, 40, t, .45, 1, .003); noise(c, 'lowpass', 1600, 150, t, .4, .9, .003); },
    // Wheel: clicks slowing down (the prize sound lands when it stops).
    wheel: (c, t) => { let d = 0; for (let i = 0; i < 11; i++) { tone(c, 'square', 1500, 1400, t + d, .025, .3, .002); d += .03 + i * .008; } },
    // Jackpot: coins chime up and the crowd cheers.
    jackpot: (c, t) => { [1047, 1319, 1568, 2093].forEach((f, i) => tone(c, 'triangle', f, f, t + i * .07, .35, .35, .003)); noise(c, 'bandpass', 900, 1700, t + .1, .9, .7, .2); },
    clank: (c, t) => { for (let i = 0; i < 6; i++) tone(c, 'square', 1800 - i * 120, 1700 - i * 120, t + i * .05, .05, .25, .002); },
    eruption: (c, t) => { noise(c, 'lowpass', 300, 60, t, 1.4, 1.2, .2); tone(c, 'sine', 60, 30, t, 1.3, 1, .2); RECIPES.boom(c, t + .25); },
    fireworks: (c, t) => { for (let i = 0; i < 3; i++) tone(c, 'sine', 500, 2400, t + i * .1, .35, .3, .02); },
    crackle: (c, t) => { noise(c, 'highpass', 5000, 2000, t, .25, .6, .003); for (let i = 0; i < 4; i++) noise(c, 'highpass', 7000, 5000, t + .06 + i * .05, .02, .35, .001); },
    // Magnet: an electric hum swelling (clack: the duck snaps on behind the leader).
    magnet: (c, t) => { tone(c, 'sawtooth', 98, 104, t, .6, .14, .2); tone(c, 'sine', 196, 232, t, .6, .35, .2); tone(c, 'sine', 420, 950, t + .1, .5, .12, .2); },
    clack: (c, t) => { tone(c, 'square', 1300, 800, t, .04, .4, .001); noise(c, 'bandpass', 3200, 2200, t, .05, .8, .001); tone(c, 'sine', 300, 160, t, .12, .5, .002); },
    // Bomb armed: the fuse hisses and spits sparks.
    fuse: (c, t) => { noise(c, 'highpass', 3500, 6000, t, .8, .35, .04); for (let i = 0; i < 6; i++) noise(c, 'bandpass', 2600, 2400, t + .06 + i * .12, .02, .6, .001); },
    // Flip: two sweeps crossing (one rising, one falling), then a flop as they land.
    flip: (c, t) => { tone(c, 'triangle', 260, 1300, t, .36, .35); tone(c, 'triangle', 1300, 260, t, .36, .35); noise(c, 'bandpass', 500, 2200, t, .34, .35, .08); tone(c, 'sine', 520, 240, t + .38, .09, .5, .003); },
    // Dice rattling; a 1 gets a sad trombone.
    rattle: (c, t) => { for (let i = 0; i < 8; i++) noise(c, 'bandpass', 2300 + (i % 3) * 600, 1900, t + i * .05 + (i % 2) * .012, .025, .7, .001); },
    sad: (c, t) => { [392, 370, 349].forEach((f, i) => tone(c, 'triangle', f, f * .98, t + i * .17, i === 2 ? .45 : .16, .4, .01)); },
    // Rocket: an engine rumble with a rising whoosh.
    rocket: (c, t) => { noise(c, 'lowpass', 320, 160, t, 1, 1, .06); tone(c, 'sawtooth', 55, 85, t, .9, .22, .06); noise(c, 'bandpass', 400, 3000, t + .08, .7, .9, .2); },
    // Giant: a power-up arpeggio (each stomp is a thud).
    grow: (c, t) => { [262, 330, 392, 523, 659].forEach((f, i) => tone(c, 'square', f, f, t + i * .055, .07, .2, .003)); tone(c, 'sine', 110, 220, t, .4, .4, .05); },
    // ✨ SIÊU CẤP: a glittering high arpeggio over a shimmer.
    sparkle: (c, t) => { [1568, 2093, 2637, 3136, 4186].forEach((f, i) => tone(c, 'sine', f, f * 1.01, t + i * .05, .4, .22, .003)); noise(c, 'highpass', 8000, 6000, t, .5, .15, .05); },
    // S-tier intro: a deep bass drop under the skill-name card.
    drop: (c, t) => { tone(c, 'sine', 130, 36, t, .75, 1.3, .01); tone(c, 'triangle', 65, 32, t, .6, .45, .02); },
    // Bomb hop and its last-second countdown: a dry clock tick.
    tick: (c, t) => { tone(c, 'square', 2300, 2100, t, .025, .28, .001); noise(c, 'bandpass', 3200, 3000, t, .015, .3, .001); },
    // ---- chaos-v4 ----
    // Phở: two quick noodle slurps and a happy "ahh".
    slurp: (c, t) => { for (const d of [0, .22]) noise(c, 'bandpass', 600, 2400, t + d, .16, .9, .02); tone(c, 'sine', 520, 380, t + .45, .35, .35, .05); },
    // Cà phê sữa đá: ice clinks in the glass, a straw sip, then an awake zing.
    coffee: (c, t) => { for (const [d, f] of [[0, 2600], [.09, 3200], [.2, 2900]]) tone(c, 'triangle', f, f * .98, t + d, .25, .3, .002); noise(c, 'bandpass', 900, 1600, t + .3, .2, .5, .02); tone(c, 'sawtooth', 300, 1500, t + .5, .3, .2, .01); },
    // Rải tiền: a cash-register "ka-ching" (rustle: the notes flutter down on each leader).
    cash: (c, t) => { tone(c, 'square', 160, 120, t, .06, .4, .002); noise(c, 'bandpass', 1800, 1200, t, .05, .5, .001); tone(c, 'triangle', 2093, 2090, t + .08, .6, .45, .002); tone(c, 'triangle', 2637, 2630, t + .1, .5, .3, .002); },
    rustle: (c, t) => { for (let i = 0; i < 4; i++) noise(c, 'highpass', 3500, 2500, t + i * .06, .05, .35, .005); },
    // Lưới: the net whirls through the air (snare: it lands with a wet swish and a rope creak).
    toss: (c, t) => noise(c, 'bandpass', 700, 2200, t, .35, .7, .05),
    snare: (c, t) => { noise(c, 'lowpass', 1800, 400, t, .25, .8, .005); tone(c, 'sawtooth', 190, 140, t + .1, .2, .12, .02); },
    // Diều: a gust with the kite flapping in it, and a rising whistle.
    kite: (c, t) => { lfo(c, noise(c, 'bandpass', 500, 1400, t, 1, .7, .2).frequency, 9, 200, t, 1.1); tone(c, 'sine', 700, 1500, t + .15, .6, .2, .1); },
    // Mây đen: distant rumble and rain hiss (its closing bolt is thunder).
    rain: (c, t) => { noise(c, 'lowpass', 220, 90, t, 1, .8, .1); noise(c, 'highpass', 3500, 4500, t + .1, 1.2, .4, .3); },
    // Đồng hồ cát: a tick-tock slowing down over a reverse swell (gong: everything stops).
    timestop: (c, t) => { [0, .14, .32, .55].forEach((d, i) => tone(c, 'square', i % 2 ? 900 : 1200, i % 2 ? 880 : 1180, t + d, .03, .25, .002)); noise(c, 'lowpass', 200, 2400, t, .3, .5, .25); },
    gong: (c, t) => { tone(c, 'sine', 196, 190, t, 1.6, .9, .005); tone(c, 'sine', 392, 385, t, 1.1, .35, .005); tone(c, 'triangle', 588, 580, t, .7, .15, .005); },
    // Loa phường: the PA crackles on, plays its ding-dong chime, then squeals with feedback.
    speaker: (c, t) => { noise(c, 'bandpass', 1500, 1500, t, .12, .5, .005); tone(c, 'triangle', 784, 780, t + .12, .3, .45, .005); tone(c, 'triangle', 659, 655, t + .38, .45, .45, .005); lfo(c, tone(c, 'sine', 2300, 2500, t + .8, .3, .12, .05).frequency, 12, 60, t + .8, .4); },
    // Cổng không gian: a warbling swirl dropping into the portal (blip: out the other side).
    portal: (c, t) => { lfo(c, tone(c, 'sine', 900, 260, t, .6, .5, .05).frequency, 14, 90, t, .7); noise(c, 'bandpass', 2000, 500, t, .55, .4, .1); },
    // Xe ôm: "bíp bíp", then the scooter putters off.
    xeom: (c, t) => { for (const d of [0, .16]) tone(c, 'square', 620, 610, t + d, .09, .3, .005); lfo(c, tone(c, 'sawtooth', 70, 190, t + .32, .7, .25, .05).frequency, 28, 12, t + .32, .8); noise(c, 'lowpass', 600, 300, t + .32, .7, .4, .1); },
    // River obstacles: a light spring for a jump, a bubbly bloop for a dive, a soft wooden knock for a hit.
    hop: (c, t) => { tone(c, 'sine', 320, 760, t, .12, .35, .005); noise(c, 'highpass', 4000, 3000, t + .02, .06, .12, .005); },
    dive: (c, t) => { tone(c, 'sine', 600, 160, t, .14, .35, .005); for (const d of [.1, .17, .23]) tone(c, 'sine', 900, 1400, t + d, .04, .15, .003); },
    bonk: (c, t) => { tone(c, 'triangle', 320, 180, t, .08, .45, .002); noise(c, 'lowpass', 900, 300, t, .06, .3, .002); },
    // Crowd roar (band-passed noise swell) plus two whistles.
    cheer:(c, t) => { noise(c, 'bandpass', 900, 1700, t, 1.6, 1.1, .25); tone(c, 'sine', 1800, 2400, t + .2, .25, .3); tone(c, 'sine', 2000, 2700, t + .55, .3, .3); }
  };
  const kinds = Object.freeze(Object.keys(RECIPES));
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
  // delay: seconds from now on the audio clock (cancel() drops it if it has not played yet).
  function play(ctx, kind, delay = 0) {
    const recipe = RECIPES[kind];
    if (!ctx || !recipe) return;
    try { out = bus(ctx); recipe(ctx, ctx.currentTime + Math.max(0, Number(delay) || 0)); } catch { /* ponytail: a failed sound must never break the race */ } finally { out = null; }
  }
  const api = Object.freeze({ kinds, kindOf, cues, play, cancel, ambience });
  root.DuckSfx = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
