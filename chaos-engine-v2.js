(function (root) {
  'use strict';

  // Versioned replay contract, same rule as chaos-v1: never retune in place.
  // Saved races replay from (count, duration, seed); a rule change needs chaos-v3.
  const VERSION = 'chaos-v2';
  const UINT32 = 0x100000000;
  const HZ = 20;
  const TIME_EXPONENT = 0.8; // phase density grows toward the finish
  const freeze = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };
  // Percent values are % of the course; seconds are race seconds.
  const tuning = freeze({
    firstPhase: 2, minGap: 0.4, stunImmunity: 1,
    wings: { passMin: 2, passMax: 3, lead: 0.3, leaderHop: 2, flyTime: 0.8 },
    torpedo: { stun: 2 },
    wave: { push: 4, surge: 3, surgeTime: 1 },
    swap: { reachMin: 1, reachMax: 3 },
    rocket: { success: 0.7, boost: 1.5, time: 1.5, stun: 2 },
    mirror: { glareSlow: 0.5, glareTime: 1.5, reflectStun: 1.5 },
    hook: { lead: 0.3, selfPull: 3 },
    banana: { stun: 1.5 },
    buoy: { lead: 0.3, leaderHop: 2 },
    // chaos-v3 only
    magnet: { lead: 0.3, leaderHop: 2 }, lightning: { stun: 1.2 }, rewind: { seconds: 1.2 },
    reverse: { time: 1.5, factor: -0.7 }, freeze: { time: 1 },
    missile: { knock: 4, stun: 1 }, bees: { time: 2, slow: 0.4 }, blackhole: { behind: 1 }, ghost: { time: 2, pass: 2, lead: 0.3, leaderHop: 2, spookTime: 1.2, spookSlow: 0.5 }, balloon: { time: 1.5 },
    epic: { hookGap: 0.4, waveGap: 0.4, wavePush: 7, hookPull: 6, buoyPass: 2 }, // knockbacks: % of the course; buoyPass: ducks a v3 buoy bounce springs past
    tornado: { keep: 0.5, behind: 2, spin: 0.8 },
    bomb: { fuse: 2.5, knock: 5, stun: 1.2 }, dice: { leadBy: 0.3, leaderHop: 0.6, bustStun: 1 },
    lullaby: { range: 6, min: 2, time: 1.5 }, hex: { time: 2, slow: 0.45 }, giant: { time: 2, boost: 0.35, range: 5, max: 3, knock: 2, spin: 0.6 },
    mirrorV3: { glareTargets: 2, glareTime: 2, glareSlow: 0.5 }, buoyV3: { fallbackPass: 3 },
    // Duck traits (chaos-v3), dealt with the skills before the picks. Speeds are extra fractions of base speed.
    // Comeback luck (chaos-v3): per level, extra speed, a chance to escape bad river events, more weight for helpful ones.
    luck: { speed: 0.02, dodge: 0.3, help: 2, maxDodge: 0.75 },
    trait: { steady: 0.035, early: 0.18, earlyUntil: 0.25, late: 0.07, lateFrom: 0.8, catchup: 0.08, tough: 0.6, dodge: 0.3, lucky: 0.75, revengePush: 2.5, revengeTime: 1 }, // chaos-v3: victims land from `behind` % past the last duck up to `keep` of their lead over it
    rune: { boost: 0.4, time: 1.5, slow: 0.6 },
    hazard: { countMin: 2, countMax: 4, rockStun: 1.5, rockLateWindow: 3, rockLateChance: 0.7, crocPull: 5, windPush: 6, whirlStun: 1.5, dolphinPush: 5, surgeTime: 1, finaleKnock: 0.6,
      hippoKnock: 3, hippoStun: 1, logTime: 1.5, logSlow: 0.1, frogHop: 3 }
  });
  const skills = freeze([
    { id: 'wings', name: 'Cánh vàng', icon: '🪽', description: 'Bay vượt lên 2–3 con phía trước.' },
    { id: 'torpedo', name: 'Thủy lôi', icon: '💣', description: 'Ném vào con đang dẫn đầu, làm nó lật thuyền 2 giây.' },
    { id: 'wave', name: 'Sóng thần', icon: '🌊', description: 'Đánh dạt top 3 lùi lại, còn mình lướt sóng tiến lên.' },
    { id: 'swap', name: 'Đổi đời', icon: '🔄', description: 'Đổi chỗ với một con đang hơn mình 1–3 bậc.' },
    { id: 'rocket', name: 'Tên lửa', icon: '🚀', description: '70% phóng cực mạnh, 30% nổ máy tự lật.' },
    { id: 'mirror', name: 'Gương phản đòn', icon: '🪞', description: 'Dội ngược đòn đầu tiên từ skill vịt khác; không bị đánh thì chiếu chói con phía trên.' },
    { id: 'hook', name: 'Móc câu', icon: '🎣', description: 'Kéo con ngay trên mình lùi lại và vượt lên.' },
    { id: 'tornado', name: 'Lốc xoáy', icon: '🌪️', description: 'Xáo trộn vị trí của 3 con ngẫu nhiên, có thể gồm cả mình.' },
    { id: 'banana', name: 'Vỏ chuối', icon: '🍌', description: 'Thả vỏ chuối, con bám ngay sau đạp phải sẽ trượt quay vòng.' },
    { id: 'buoy', name: 'Phao thần', icon: '🛟', description: 'Chặn đòn đầu tiên rồi bật lên vượt 1 con.' }
  ]);
  const v3Skills = freeze([
    { id: 'magnet', name: 'Nam châm', icon: '🧲', description: 'Hút mình lên ngay sau con dẫn đầu; đang nhì thì vọt lên dẫn luôn.' },
    { id: 'lightning', name: 'Sét đánh', icon: '⚡', description: 'Sét đánh trúng 2 con dẫn đầu, lật thuyền 1,2 giây.' },
    { id: 'flip', name: 'Lộn đầu đuôi', icon: '🔃', description: 'Con dẫn đầu và con chót đổi chỗ cho nhau.' },
    { id: 'rewind', name: 'Tua ngược', icon: '⏪', description: 'Mọi con khác bị tua lùi về chỗ của 1,2 giây trước.' },
    { id: 'reverse', name: 'Bơi ngược', icon: '↩️', description: 'Hai con dẫn đầu quay đầu bơi ngược chiều 1,5 giây.' },
    { id: 'freeze', name: 'Đóng băng', icon: '🧊', description: 'Cả sông đóng băng 1 giây, chỉ mình bơi.' },
    { id: 'missile', name: 'Tên lửa tầm nhiệt', icon: '🎯', description: 'Tên lửa bám đuôi con dẫn đầu, nổ tung hất nó lùi và lật thuyền.' },
    { id: 'bees', name: 'Đàn ong', icon: '🐝', description: 'Đàn ong đuổi 2 con dẫn đầu, chậm 60% trong 2 giây.' },
    { id: 'blackhole', name: 'Hố đen', icon: '🕳️', description: 'Hố đen mở ngay trên con dẫn đầu, nuốt chửng nó rồi nhả ra ở cuối đoàn.' },
    { id: 'ghost', name: 'Tàng hình', icon: '👻', description: 'Hóa ma lướt xuyên qua 2 con phía trước, hù chúng chậm lại, rồi tàng hình 2 giây: mọi đòn xuyên qua.' },
    { id: 'balloon', name: 'Bóng bay', icon: '🎈', description: 'Buộc bóng bay vào con dẫn đầu, nhấc nó lơ lửng khỏi mặt nước 1,5 giây.' },
    { id: 'bomb', name: 'Bom hẹn giờ', icon: '🧨', description: 'Gắn bom vào con dẫn đầu; ai vượt lên dẫn thì bom nhảy sang người đó. 2,5 giây sau nổ: hất lùi và lật thuyền.' },
    { id: 'copycat', name: 'Đạo chích', icon: '🦝', description: 'Học lỏm skill vừa được dùng gần nhất và tung lại ngay cho mình.' },
    { id: 'dice', name: 'Xúc xắc', icon: '🎲', description: 'Gieo 1–6: ra 1 tự lật thuyền, 2–5 vượt 1–4 con, ra 6 vọt lên dẫn đầu.' },
    { id: 'lullaby', name: 'Ru ngủ', icon: '💤', description: 'Hát ru: mọi con trong tầm 6% quanh mình (ít nhất 2 con gần nhất) ngủ gật 1,5 giây.' },
    { id: 'hex', name: 'Biến ếch', icon: '🪄', description: 'Biến con dẫn đầu thành ếch 2 giây, nhảy chậm còn 45%.' },
    { id: 'giant', name: 'Nấm khổng lồ', icon: '🍄', description: 'Hóa khổng lồ 2 giây, nhanh hơn 35%, giẫm văng tối đa 3 con ngay phía trước.' }
  ]);
  const traits = freeze([
    { id: 'steady', name: 'Bền bỉ', icon: '💪', description: 'Nhanh hơn 3,5% suốt trận.' },
    { id: 'early', name: 'Xuất phát thần tốc', icon: '🏃', description: 'Nhanh hơn 18% trong 1/4 đầu trận.' },
    { id: 'late', name: 'Nước rút', icon: '🏁', description: 'Nhanh hơn 7% trong 1/5 cuối trận.' },
    { id: 'catchup', name: 'Bám đuổi', icon: '🔥', description: 'Nhanh hơn 8% khi đang ở nửa sau đoàn.' },
    { id: 'tough', name: 'Lì đòn', icon: '🦾', description: 'Bị lật, choáng, làm chậm ngắn hơn 40%.' },
    { id: 'dodgy', name: 'Né đòn', icon: '🤸', description: '30% né được đòn skill của vịt khác.' },
    { id: 'lucky', name: 'Tốt số', icon: '🍀', description: '75% thoát nạn sự kiện sông nước xấu.' },
    { id: 'revenge', name: 'Phục thù', icon: '😤', description: 'Hết bị choáng thì nổi giận lao lên thêm 2,5%.' }
  ]);
  const hazards = freeze([
    { id: 'rock', name: 'Vấp đá', icon: '🪨' },
    { id: 'croc', name: 'Cá sấu đớp', icon: '🐊' },
    { id: 'wind', name: 'Gió thuận', icon: '💨' },
    { id: 'whirlpool', name: 'Xoáy nước', icon: '🌀' },
    { id: 'dolphin', name: 'Cá heo cõng', icon: '🐬' }
  ]);
  const runeTypes = freeze([
    { id: 'speed', icon: '⚡', name: 'Nước tăng lực' },
    { id: 'bubble', icon: '🫧', name: 'Bong bóng bảo vệ' },
    { id: 'mystery', icon: '🎁', name: 'Hộp hên xui' }
  ]);
  const PASSIVE = new Set(['mirror', 'buoy']);
  // Skills that hit the leader or scramble the order: the only ones chaos-v3 saves for the last quarter.
  // Self-boosting skills (wings, swap, magnet, rewind, wave, flip) stay mid-race: late, they would all but decide the winner.
  const PLOT_TWISTS = new Set(['torpedo', 'missile', 'lightning', 'blackhole', 'hook', 'bomb', 'hex']);
  // chaos-v3 = chaos-v2 + one weather per race. Weather adds hazards and reweights them.
  // chaos-v2 never touches this table, so its replays stay identical.
  const v3Hazards = freeze([
    { id: 'hippo', name: 'Hà mã trồi lên', icon: '🦛' },
    { id: 'log', name: 'Khúc gỗ trôi', icon: '🪵' },
    { id: 'frog', name: 'Ếch bật nhảy', icon: '🐸' }
  ]);
  const weathers = freeze([
    { id: 'sunny', name: 'Nắng đẹp', icon: '☀️', chance: 32, extra: 0, weights: {} },
    { id: 'rain', name: 'Mưa rào', icon: '🌧️', chance: 20, extra: 1, weights: { whirlpool: 2, croc: 2, frog: 2 } },
    { id: 'wind', name: 'Gió lớn', icon: '💨', chance: 16, extra: 1, weights: { wind: 5 } },
    { id: 'storm', name: 'Bão sông', icon: '⛈️', chance: 12, extra: 2, weights: { whirlpool: 2, croc: 2, hippo: 2 } },
    // Fog hides the rankings until the last 5 s (app side); night lights only the ducks.
    { id: 'fog', name: 'Sương mù', icon: '🌫️', chance: 10, extra: 1, weights: { log: 3, croc: 2 } },
    { id: 'night', name: 'Đêm trăng', icon: '🌙', chance: 10, extra: 1, weights: { frog: 3, hippo: 2, whirlpool: 2 } }
  ]);
  function weighted(list, weightOf, rng) {
    const total = list.reduce((sum, item) => sum + weightOf(item), 0);
    let roll = rng.integer(total);
    return list.find(item => (roll -= weightOf(item)) < 0);
  }

  // ponytail: helpers copied from chaos-v1 so v1 stays frozen.
  function newSeed() {
    let crypto = root.crypto;
    if (!crypto && typeof require === 'function') crypto = require('node:crypto').webcrypto;
    if (!crypto || !crypto.getRandomValues) throw new Error('Trình duyệt cần hỗ trợ Web Crypto để tạo cuộc đua.');
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }
  function randomFor(seed, salt) {
    let state = (seed ^ salt) >>> 0;
    const uint = () => {
      state = (state + 0x6D2B79F5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return (value ^ (value >>> 14)) >>> 0;
    };
    return {
      unit: () => uint() / UINT32,
      integer(limit) {
        const ceiling = UINT32 - UINT32 % limit;
        let value;
        do { value = uint(); } while (value >= ceiling);
        return value % limit;
      }
    };
  }
  function shuffled(values, rng) {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i--) {
      const j = rng.integer(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  function pulseIntegral(boost, time) {
    if (!boost || time <= boost.start) return 0;
    const span = boost.end - boost.start;
    const elapsed = Math.min(span, time - boost.start);
    return boost.strength * (elapsed / 2 - span * Math.sin(2 * Math.PI * elapsed / span) / (4 * Math.PI));
  }

  function cleanInput(names, durationSeconds, seed) {
    if (!Array.isArray(names) || names.length < 2 || names.length > 100) throw new RangeError('Mỗi cuộc đua cần từ 2 đến 100 con vịt.');
    if (!Number.isInteger(durationSeconds) || durationSeconds < 10 || durationSeconds > 600) throw new RangeError('Thời gian đua phải từ 10 đến 600 giây nguyên.');
    if (!Number.isInteger(seed) || seed < 0 || seed >= UINT32) throw new RangeError('Seed phải là số nguyên uint32.');
    return Array.from(names, name => {
      if (typeof name !== 'string' || !name.trim()) throw new TypeError('Tên vịt không được để trống.');
      if (Array.from(name.trim()).length > 40) throw new RangeError('Tên vịt tối đa 40 ký tự.');
      return name.trim();
    });
  }

  // Twist slots: one per duck skill plus hazards, spread over the race with
  // density rising toward the finish, then spaced in whole ticks.
  // rules: chaos-v2 = V2_RULES (frozen by golden hashes); chaos-v3 makes last-second rock trips rarer.
  function planSlots(racers, duration, hazardRng, scheduleRng, weather, rules, finaleRng) {
    const H = tuning.hazard, count = racers.length;
    const slots = racers.map(r => ({ kind: 'skill', actorId: r.id, passive: PASSIVE.has(r.skill.id) }));
    // Day rule "double": every active skill gets a second slot.
    if (rules.doubleSkill) racers.filter(r => !PASSIVE.has(r.skill.id)).forEach(r => slots.push({ kind: 'skill', actorId: r.id, passive: false }));
    const hazardCount = (H.countMin + hazardRng.integer(H.countMax - H.countMin + 1) + (weather?.extra || 0)) * Math.ceil(count / 7) * (rules.hazardScale || 1);
    const pickHazard = weather ? () => weighted(rules.hazards, h => weather.weights[h.id] || 1, hazardRng) : () => rules.hazards[hazardRng.integer(rules.hazards.length)];
    for (let i = 0; i < hazardCount; i++) slots.push({ kind: 'hazard', hazard: pickHazard() });
    const first = tuning.firstPhase, last = duration - 0.2, minGap = rules.gap ?? tuning.minGap;
    let stride = minGap; // seconds between twists; chaos-v3 shrinks it only when the field is too big to fit
    if (!rules.midSpread) for (const slot of slots) {
      const lateRock = slot.hazard?.id === 'rock' && scheduleRng.unit() < rules.rockLateChance;
      const end = rules.finaleChance && slot.hazard?.id === 'rock' ? duration - H.rockLateWindow : duration;
      slot.time = lateRock
        ? duration - H.rockLateWindow + scheduleRng.unit() * (H.rockLateWindow - 0.3)
        : first + (end - first) * scheduleRng.unit() ** TIME_EXPONENT;
    }
    // chaos-v3 pacing: twists spread evenly from ~1/8 to ~3/4 (one equal stratum each, random order),
    // jittered only as far as keeps them `stride` apart, so no two ever overlap; the last quarter
    // keeps one order-changing skill (plus the finale rock in some races).
    if (rules.midSpread) {
      const active = slots.filter(sl => sl.kind === 'skill' && !sl.passive), plot = active.filter(sl => PLOT_TWISTS.has(racers[sl.actorId].skill.id));
      // With no plot skill dealt, any active skill may close the race, but never the tornado (too decisive late).
      const pool = plot.length ? plot : active.filter(sl => racers[sl.actorId].skill.id !== 'tornado');
      shuffled(pool, scheduleRng).slice(0, 1).forEach(sl => { sl.plot = true; });
      const ordinary = slots.filter(sl => !sl.plot), from = duration * .12, to = duration * .74;
      stride = Math.min(minGap, (to - from) / ordinary.length);
      const spread = (list, a, b) => { const w = (b - a) / list.length, slack = Math.max(0, w - stride);
        list.forEach((sl, i) => { sl.time = a + w * (i + .5) + (scheduleRng.unit() - .5) * slack; }); };
      // Passive slots (mirror, buoy) take the last strata, so they have most of the race to react
      // before their fallback fires (a used one just leaves a short calm before the last quarter).
      spread([...shuffled(ordinary.filter(sl => !sl.passive), scheduleRng), ...ordinary.filter(sl => sl.passive)], from, to);
      spread(slots.filter(sl => sl.plot), duration * .8, duration - 1);
    }
    // chaos-v3 finale: a rock in the last 2 s that always trips the leader out of the win.
    if (finaleRng && finaleRng.unit() < rules.finaleChance) slots.push({ kind: 'hazard', hazard: hazards[0], finale: true, time: duration - 0.6 - finaleRng.unit() * 1.4 });
    const visible = slot => slot.kind === 'hazard' || !slot.passive;
    const byTime = () => slots.sort((a, b) => a.time - b.time);
    byTime();
    // Late guarantee first: it may pull an early slot, which the early guarantee then refills.
    // (chaos-v3 skips both: its even spread already covers the start and the last quarter.)
    if (!rules.midSpread && !slots.some(s => visible(s) && s.time >= duration - 2)) {
      const late = [...slots].reverse();
      const pick = (rules.lateGuaranteePrefersRock ? late.find(s => s.hazard?.id === 'rock') : late.find(s => s.kind === 'hazard' && s.hazard.id !== 'rock'))
        || late.find(s => s.kind === 'hazard') || late.find(visible);
      pick.time = duration - 2 + scheduleRng.unit() * 1.7;
      byTime();
    }
    // Spacing can push a slot later by one gap per earlier (passive) slot, so the
    // early guarantee keeps that much margin before the first third ends.
    const earlyEnd = Math.max(first, duration / 3 - (slots.filter(s => !visible(s)).length + 1) * minGap - 0.05);
    if (!rules.midSpread && !slots.some(s => visible(s) && s.time < earlyEnd)) {
      slots.find(visible).time = first + scheduleRng.unit() * (earlyEnd - first);
      byTime();
    }
    // Whole-tick spacing keeps the gap exact after quantization.
    const firstTick = Math.round(first * HZ), lastTick = Math.round(last * HZ);
    const gap = Math.max(0, Math.min(Math.floor(stride * HZ + 1e-6), Math.floor((lastTick - firstTick) / slots.length)));
    slots.forEach(s => { s.tick = Math.min(lastTick, Math.max(firstTick, Math.round(s.time * HZ))); });
    for (let i = 1; i < slots.length; i++) slots[i].tick = Math.max(slots[i].tick, slots[i - 1].tick + gap);
    slots[slots.length - 1].tick = Math.min(slots[slots.length - 1].tick, lastTick);
    for (let i = slots.length - 2; i >= 0; i--) slots[i].tick = Math.min(slots[i].tick, slots[i + 1].tick - gap);
    // The finale takes the latest tick so no twist can undo it.
    const finale = slots.find(sl => sl.finale);
    if (finale) { const lastSlot = slots.reduce((a, b) => (b.tick >= a.tick ? b : a)); [finale.tick, lastSlot.tick] = [lastSlot.tick, finale.tick]; }
    return slots;
  }

  // Day rules (chaos-v3): one per race day, carried in the lineup so a replay rebuilds the same race.
  const dayRules = freeze([
    { id: 'chaos', name: 'Ngày hỗn loạn', icon: '🌀', description: 'Sự kiện sông nước nhiều gấp đôi.' },
    { id: 'double', name: 'Skill kép', icon: '⚡', description: 'Mỗi vịt tung skill chủ động 2 lần (Gương, Phao vẫn 1 lần).' },
    { id: 'runes', name: 'Mưa rune', icon: '💎', description: 'Rune trên sông nhiều gấp đôi.' },
    { id: 'storm', name: 'Trời nổi giông', icon: '⛈️', description: 'Không có nắng đẹp: trận nào cũng mưa, gió, bão, sương mù hoặc đêm.' },
    { id: 'thriller', name: 'Về đích nghẹt thở', icon: '🎬', description: 'Trận nào cũng có cú vấp đá sát đích quật ngã con dẫn đầu.' },
    { id: 'comeback', name: 'Lội ngược dòng', icon: '🍀', description: 'Bùa may của người đang thua mạnh gấp đôi.' }
  ]);
  const RULE_TWEAKS = { chaos: { hazardScale: 2 }, double: { doubleSkill: true }, runes: { runeScale: 2 }, storm: { noSun: true }, thriller: { finaleChance: 1 }, comeback: { luckScale: 2 } };

  // smartTargets (chaos-v3): random picks lean toward the leading ducks.
  // epic (chaos-v3): hook reels in the leader, wave sweeps the top 3 behind the caster.
  // finaleChance (chaos-v3): share of races ending with a decisive rock trip.
  const V2_RULES = freeze({ skills, hazards, weather: false, rockLateChance: tuning.hazard.rockLateChance, lateGuaranteePrefersRock: true, smartTargets: false });
  // chaos-v2 skills that work differently in chaos-v3 get their own description there.
  const V3_TEXT = { tornado: 'Cuốn 3 con dẫn đầu lên trời, quăng văng về cuối đoàn, quay mòng mòng.',
    buoy: 'Chặn đòn đầu tiên rồi nảy tưng tưng vượt 2 con; không ai đánh thì đến giờ nảy vượt 3 con.',
    mirror: 'Dội ngược đòn đầu tiên và bật lên vượt 2 con; không ai đánh thì đến giờ chiếu chói 2 con dẫn đầu (chậm 50% trong 2 giây) và bật lên vượt 1 con.' };
  const V3_RULES = freeze({ skills: freeze([...skills.map(s => (V3_TEXT[s.id] ? { ...s, description: V3_TEXT[s.id] } : s)), ...v3Skills]), hazards: freeze([...hazards, ...v3Hazards]), weather: true, rockLateChance: 0, lateGuaranteePrefersRock: false, smartTargets: true, epic: true, finaleChance: .4, midSpread: true, gap: 2, traits });
  // Skills and traits for each duck, dealt before the picks (chaos-v3); the same seed always deals the same lineup.
  function dealLineup(rules, count, seed) {
    const deckOf = (list, salt) => shuffled(Array.from({ length: Math.ceil(count / list.length) }, () => list).flat(), randomFor(seed, salt)).slice(0, count);
    return { skills: deckOf(rules.skills, 0x534b4932).map(s => s.id), traits: deckOf(rules.traits, 0x54524954).map(t => t.id) };
  }
  function cleanLineup(rules, count, lineup) {
    const read = (ids, list, what) => {
      if (!Array.isArray(ids) || ids.length !== count) throw new RangeError(`Danh sách ${what} phải có đúng ${count} mục.`);
      return ids.map(id => list.find(item => item.id === id) || (() => { throw new RangeError(`${what} không hợp lệ: ${id}`); })());
    };
    if (!lineup || typeof lineup !== 'object') throw new TypeError('Đội hình skill không hợp lệ.');
    const luck = lineup.luck === undefined ? Array(count).fill(0) : lineup.luck;
    if (!Array.isArray(luck) || luck.length !== count || luck.some(l => !Number.isInteger(l) || l < 0 || l > 3)) throw new RangeError('Mức may mắn phải là số nguyên 0–3 cho từng vịt.');
    const rule = lineup.rule === undefined ? null : dayRules.find(r => r.id === lineup.rule);
    if (rule === undefined) throw new RangeError(`Luật của ngày không hợp lệ: ${lineup.rule}`);
    return { skills: read(lineup.skills, rules.skills, 'skill'), traits: read(lineup.traits, rules.traits, 'đặc tính'), luck, rule };
  }
  function createRaceFor(version, rules, names, durationSeconds = 25, seed = newSeed(), lineup = null) {
    const cleanNames = cleanInput(names, durationSeconds, seed);
    const count = cleanNames.length, duration = durationSeconds;
    const ids = Array.from({ length: count }, (_, id) => id);
    // chaos-v3 deals skills and traits (or takes the lineup shown before the picks); chaos-v2 keeps its deck.
    const dealt = rules.traits ? cleanLineup(rules, count, lineup || dealLineup(rules, count, seed)) : null;
    // The day rule (if any) tweaks this race's rules; every random stream stays the same.
    const R = dealt?.rule ? { ...rules, ...RULE_TWEAKS[dealt.rule.id] } : rules;
    const motionRng = randomFor(seed, 0x4d4f5432);
    const skillRng = randomFor(seed, 0x534b4932);
    const scheduleRng = randomFor(seed, 0x53434832);
    const hazardRng = randomFor(seed, 0x48415a32);
    const weather = rules.weather ? weighted(weathers, w => (R.noSun && w.id === 'sunny' ? 0 : w.chance), randomFor(seed, 0x57544852)) : null;
    const runeRng = randomFor(seed, 0x52554e32);
    const effectRng = randomFor(seed, 0x45464632);
    const finaleRng = R.finaleChance ? randomFor(seed, 0x46494e33) : null;
    const traitRng = rules.traits ? randomFor(seed, 0x54524e44) : null;
    const pct = value => value / 100 * duration;
    const sprintStart = duration - 5;
    const steps = duration * HZ;
    const segmentCount = Math.min(60, duration);
    const segmentLength = duration / segmentCount;
    const tick = time => Math.min(steps, Math.max(0, Math.round(time * HZ)));
    const tiePriority = [];
    shuffled(ids, motionRng).forEach((id, index) => { tiePriority[id] = index; });
    const compare = (a, b) => b.distance - a.distance || tiePriority[a.id] - tiePriority[b.id];
    const racers = ids.map(id => ({
      id, name: cleanNames[id], skill: null,
      speeds: Array.from({ length: segmentCount }, () => 0.65 + motionRng.unit() * 0.70),
      distance: 0, baseDistance: 0, boost: null, rocketUntil: 0, runeUntil: 0, surges: [],
      impairUntil: 0, impairKind: null, impairFactor: 1, immuneUntil: 0,
      guard: null, mirror: false, flyUntil: 0, swapUntil: 0, ghostUntil: 0, skillUsed: false, trait: null, giantUntil: 0, luck: 0
    }));
    const boostCount = 1 + motionRng.integer(Math.min(count - 1, Math.ceil(count * 0.55)));
    const boosts = shuffled(ids, motionRng).slice(0, boostCount).map(id => {
      const start = sprintStart + motionRng.unit() * 2.6;
      const end = Math.min(duration, start + 1.1 + motionRng.unit() * 2.3);
      const boost = { id, start, end, strength: 0.8 + motionRng.unit() * 3.7 };
      racers[id].boost = boost;
      return boost;
    });
    const deck = dealt ? dealt.skills : shuffled(Array.from({ length: Math.ceil(count / rules.skills.length) }, () => rules.skills).flat(), skillRng);
    racers.forEach((racer, index) => {
      racer.skill = deck[index];
      if (dealt) { racer.trait = dealt.traits[index]; racer.luck = dealt.luck[index] * (R.luckScale || 1); }
      if (racer.skill.id === 'mirror') racer.mirror = true;
      if (racer.skill.id === 'buoy') racer.guard = 'buoy';
    });

    const schedule = planSlots(racers, duration, hazardRng, scheduleRng, weather, R, finaleRng).map((slot, index) => ({ ...slot, index }));
    const runeCount = Math.max(3, Math.ceil(count / 3)) * (R.runeScale || 1);
    for (let i = 0; i < runeCount; i++) {
      // chaos-v3: lucky ducks find runes more often (all weights 1 without luck: the same draw as before).
      const actorId = rules.traits ? weighted(racers, r => 1 + r.luck, runeRng).id : runeRng.integer(count), rune = runeTypes[runeRng.integer(runeTypes.length)];
      const spawnTick = tick(duration * (0.20 + 0.55 * ((i + 0.2 + runeRng.unit() * 0.6) / runeCount)));
      const pickupTick = Math.min(steps - HZ, spawnTick + 15);
      const runeData = { actorId, rune, runeId: `rune-${i + 1}`, pickupTick, good: runeRng.unit() < 0.5, index: schedule.length + i };
      schedule.push({ ...runeData, tick: spawnTick, kind: 'rune-spawn' }, { ...runeData, tick: pickupTick, kind: 'rune-pickup' });
    }
    const priority = { 'rune-spawn': 0, hazard: 1, skill: 2, 'rune-pickup': 3 };
    schedule.sort((a, b) => a.tick - b.tick || !!a.finale - !!b.finale || priority[a.kind] - priority[b.kind] || a.index - b.index);

    const events = [];
    let eventId = 0, currentStep = 0, now = 0;
    const emit = event => { const result = { id: `event-${++eventId}`, time: now, ...event }; events.push(result); return result; };
    const distances = new Float64Array((steps + 1) * count);
    const flags = new Uint16Array((steps + 1) * count);
    // chaos-v3 extra marks: 1 asleep, 2 hexed into a frog, 4 giant, 8 holds the bomb, 16 mirror ready.
    const marks = rules.traits ? new Uint8Array((steps + 1) * count) : null;
    const bombs = [];
    const jumps = new Map();
    const ranked = () => [...racers].sort(compare);
    const ranksNow = () => { const ranks = []; ranked().forEach((r, index) => { ranks[r.id] = index + 1; }); return ranks; };
    const atRank = rank => ranked()[rank - 1];
    const snapshot = list => Object.fromEntries(list.map(r => [r.id, r.distance]));
    // chaos-v3 (smartTargets): stun-only attacks skip ducks already stunned or immune, so no hit is wasted.
    const open = r => now >= r.impairUntil && now >= r.immuneUntil;
    const topRivals = (actor, n) => {
      const order = ranked().filter(r => r !== actor);
      return (rules.smartTargets ? [...order.filter(open), ...order.filter(r => !open(r))] : order).slice(0, n);
    };

    function jump(racer, distance) {
      if (!jumps.has(currentStep)) jumps.set(currentStep, new Map());
      const before = jumps.get(currentStep);
      if (!before.has(racer.id)) before.set(racer.id, racer.distance);
      racer.distance = Math.max(0, distance);
    }
    function impair(racer, kind, seconds, factor = 0) {
      if (now < racer.impairUntil || now < racer.immuneUntil) return 'immune';
      const T = tuning.trait, trait = racer.trait?.id;
      racer.impairKind = kind;
      racer.impairFactor = factor;
      racer.impairUntil = tick(now + seconds * (trait === 'tough' ? T.tough : 1)) / HZ;
      racer.immuneUntil = tick(racer.impairUntil + tuning.stunImmunity) / HZ;
      // Revenge: once the duck recovers it charges ahead.
      if (trait === 'revenge') racer.surges.push({ from: racer.impairUntil, until: tick(racer.impairUntil + T.revengeTime) / HZ, rate: pct(T.revengePush) / T.revengeTime });
      return 'hit';
    }
    function surge(racer, amount, seconds) {
      racer.surges.push({ until: tick(now + seconds) / HZ, rate: amount / seconds });
    }

    // Defensive reactions (mirror, buoy) are their own activation events, emitted
    // right after the attack that triggered them.
    let reactions = [];
    const flush = () => { const pending = reactions; reactions = []; pending.forEach(emit); };
    const LABEL = {
      hit: 'LẬT THUYỀN!', immune: 'ĐANG MIỄN NHIỄM!', reflected: 'BỊ GƯƠNG DỘI NGƯỢC!',
      blocked: guard => guard === 'buoy' ? 'PHAO CHẶN ĐÒN!' : guard === 'ghost' ? 'TÀNG HÌNH, ĐÒN XUYÊN QUA!' : guard === 'dodge' ? 'NÉ ĐƯỢC ĐÒN!' : guard === 'lucky' ? 'TỐT SỐ, THOÁT NẠN!' : 'BONG BÓNG CHẶN ĐÒN!'
    };
    // Landing spot just ahead of the duck at `rank`, never past the duck above it.
    function landAhead(rank, lead) {
      const passed = atRank(rank), above = rank > 1 ? atRank(rank - 1) : null;
      const spot = passed.distance + pct(lead);
      return above ? Math.max(passed.distance, Math.min(spot, (passed.distance + above.distance) / 2)) : spot;
    }
    function bounce(holder, most = rules.epic ? tuning.epic.buoyPass : 1) {
      const ranks = ranksNow(), before = snapshot([holder]), rank = ranks[holder.id], pass = Math.min(most, rank - 1);
      jump(holder, rank > 1 ? landAhead(rank - pass, tuning.buoy.lead) : holder.distance + pct(tuning.buoy.leaderHop));
      return { ranksBefore: ranks, before, after: snapshot([holder]) };
    }
    function reflect(holder, attacker, effect) {
      holder.skillUsed = true;
      // chaos-v3: the mirror holder also springs ahead past two ducks.
      reactions.push({ type: 'skill', actorId: holder.id, skill: 'mirror', icon: '🪞', targetId: attacker.id, outcome: 'reflected', effect, label: 'GƯƠNG DỘI NGƯỢC!', activation: true, ...(rules.epic ? bounce(holder) : {}) });
    }
    // Returns { outcome: 'blocked' | 'reflected', guard? } or null when the hit lands.
    // Only skill attacks from another duck can be reflected.
    // A guarded or ghosted duck sits out area effects (tornado, rewind, freeze, black hole).
    const shielded = r => !!r.guard || now < r.ghostUntil;
    function defend(victim, attacker, reflectable) {
      if (now < victim.ghostUntil) return { outcome: 'blocked', guard: 'ghost' };
      // Traits (chaos-v3): a dodgy duck slips some skill attacks, a lucky one some river events.
      const trait = victim.trait?.id, T = tuning.trait;
      if (trait === 'dodgy' && attacker && attacker !== victim && traitRng.unit() < T.dodge) return { outcome: 'blocked', guard: 'dodge' };
      if (trait === 'lucky' && !attacker && traitRng.unit() < T.lucky) return { outcome: 'blocked', guard: 'lucky' };
      // The cap only binds on a "comeback" day (doubled luck), so rule-less races rebuild exactly as before.
      if (victim.luck && !attacker && traitRng.unit() < Math.min(R.luckScale ? tuning.luck.maxDodge : Infinity, tuning.luck.dodge * victim.luck)) return { outcome: 'blocked', guard: 'lucky' };
      if (victim.guard) {
        const guard = victim.guard;
        victim.guard = null;
        if (guard === 'buoy') {
          victim.skillUsed = true;
          reactions.push({ type: 'skill', actorId: victim.id, skill: 'buoy', icon: '🛟', targetId: attacker?.id, outcome: 'blocked', label: 'PHAO CHẶN ĐÒN, BẬT LÊN!', activation: true, ...bounce(victim) });
        }
        return { outcome: 'blocked', guard };
      }
      if (reflectable && victim.mirror && attacker && attacker !== victim) {
        victim.mirror = false;
        return { outcome: 'reflected' };
      }
      return null;
    }
    // Shared shape of single-target attacks: defend, reflect harm to attacker, or land.
    function strike(actor, target, land, reflectHarm) {
      const defense = defend(target, actor, true);
      if (!defense) return land();
      if (defense.outcome === 'blocked') return { outcome: 'blocked', guard: defense.guard, label: LABEL.blocked(defense.guard) };
      reflect(target, actor, reflectHarm());
      return { outcome: 'reflected', label: LABEL.reflected };
    }
    const traps = [];
    function slip(trap) {
      const { owner, victim } = trap;
      const result = strike(owner, victim,
        () => { const outcome = impair(victim, 'spinning', tuning.banana.stun); return { outcome, label: outcome === 'hit' ? 'TRƯỢT VỎ CHUỐI!' : LABEL.immune }; },
        () => impair(owner, 'spinning', tuning.banana.stun));
      emit({ type: 'skill', skill: 'banana', icon: '🍌', actorId: owner.id, targetId: victim.id, ...result });
      flush();
    }

    const skillEffects = {
      wings(actor, ranks) {
        const W = tuning.wings, rank = ranks[actor.id], before = snapshot([actor]);
        if (rank === 1) jump(actor, actor.distance + pct(W.leaderHop));
        else {
          const pass = Math.min(W.passMin + effectRng.integer(W.passMax - W.passMin + 1), rank - 1);
          jump(actor, landAhead(rank - pass, W.lead));
        }
        actor.flyUntil = tick(now + W.flyTime) / HZ;
        return { outcome: 'fly', label: rank === 1 ? 'BAY CAO HƠN!' : 'BAY LÊN!', before, after: snapshot([actor]) };
      },
      torpedo(actor) {
        const [target] = topRivals(actor, 1);
        const stun = tuning.torpedo.stun;
        return { targetId: target.id, ...strike(actor, target,
          () => { const outcome = impair(target, 'capsized', stun); return { outcome, label: outcome === 'hit' ? LABEL.hit : LABEL.immune }; },
          () => impair(actor, 'capsized', stun)) };
      },
      wave(actor, ranks) {
        const V = tuning.wave, top = ranked().filter(r => r !== actor).slice(0, 3);
        const before = snapshot([actor, ...top]), outcomes = {};
        top.forEach((target, i) => {
          const defense = defend(target, actor, true);
          if (defense?.outcome === 'reflected') reflect(target, actor, 'hit');
          else if (!defense) jump(target, rules.epic ? Math.min(target.distance - pct(tuning.epic.wavePush), actor.distance - pct(tuning.epic.waveGap) * (i + 1)) : target.distance - pct(V.push));
          outcomes[target.id] = defense ? defense.outcome : 'hit';
        });
        const reflected = Object.values(outcomes).includes('reflected');
        if (reflected) jump(actor, actor.distance - pct(V.push));
        else if (!rules.epic) surge(actor, pct(V.surge), V.surgeTime); // the epic sweep is boost enough
        return { affectedIds: top.map(r => r.id), outcomes, outcome: reflected ? 'reflected' : 'hit', label: 'SÓNG THẦN!', before, after: snapshot([actor, ...top]) };
      },
      swap(actor, ranks) {
        const S = tuning.swap, rank = ranks[actor.id];
        const lo = rank === 1 ? rank + S.reachMin : Math.max(1, rank - S.reachMax);
        const hi = rank === 1 ? Math.min(count, rank + S.reachMax) : rank - S.reachMin;
        // Smart: the farther up (and the leader most of all), the likelier the target.
        const reach = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
        const target = atRank(rules.smartTargets && rank !== 1 ? weighted(reach, r => rank - r + (r === 1 ? 2 : 0), effectRng) : lo + effectRng.integer(hi - lo + 1));
        const harmed = rank === 1 ? actor : target, before = snapshot([actor, target]);
        const defense = defend(harmed, actor, harmed !== actor);
        let result;
        if (defense?.outcome === 'blocked') result = { outcome: 'blocked', guard: defense.guard, label: LABEL.blocked(defense.guard) };
        else if (defense) { reflect(target, actor, impair(actor, 'capsized', tuning.mirror.reflectStun)); result = { outcome: 'reflected', label: LABEL.reflected }; }
        else {
          const [a, b] = [actor.distance, target.distance];
          jump(actor, b); jump(target, a);
          actor.swapUntil = target.swapUntil = tick(now + 0.7) / HZ;
          result = { outcome: 'swapped', label: 'ĐỔI ĐỜI!' };
        }
        return { targetId: target.id, ...result, before, after: snapshot([actor, target]) };
      },
      rocket(actor) {
        const R = tuning.rocket;
        if (effectRng.unit() < R.success) {
          actor.rocketUntil = tick(now + R.time) / HZ;
          return { outcome: 'boost', label: 'TÊN LỬA PHÓNG!' };
        }
        const defense = defend(actor, actor, false);
        if (defense) return { outcome: 'blocked', guard: defense.guard, label: LABEL.blocked(defense.guard) };
        const outcome = impair(actor, 'capsized', R.stun);
        return { outcome: outcome === 'hit' ? 'exploded' : 'immune', label: 'NỔ MÁY, TỰ LẬT!' };
      },
      mirror(actor, ranks) {
        const M = tuning.mirror, rank = ranks[actor.id];
        actor.mirror = false;
        if (rules.epic) {
          // chaos-v3 glare: blinds the top two rivals still able to be slowed, then springs ahead.
          const V = tuning.mirrorV3, top = topRivals(actor, V.glareTargets), outcomes = {};
          for (const target of top) {
            const defense = defend(target, actor, true);
            if (defense?.outcome === 'reflected') { reflect(target, actor, impair(actor, 'slow', V.glareTime, V.glareSlow)); outcomes[target.id] = 'reflected'; }
            else outcomes[target.id] = defense ? defense.outcome : impair(target, 'slow', V.glareTime, V.glareSlow);
          }
          return { targetId: top[0].id, affectedIds: top.map(r => r.id), outcomes, outcome: 'fallback', label: 'GƯƠNG CHIẾU CHÓI TỐP ĐẦU!', ...bounce(actor, 1) };
        }
        const target = rules.smartTargets ? topRivals(actor, 1)[0] : atRank(rank === 1 ? 2 : rank - 1);
        const result = strike(actor, target,
          () => ({ outcome: 'fallback', effect: impair(target, 'slow', M.glareTime, M.glareSlow), label: 'GƯƠNG CHIẾU CHÓI!' }),
          () => impair(actor, 'slow', M.glareTime, M.glareSlow));
        return { targetId: target.id, effect: result.effect ?? result.outcome, ...result };
      },
      hook(actor, ranks) {
        const H = tuning.hook, rank = ranks[actor.id], before = snapshot([actor]);
        if (rank === 1) {
          jump(actor, actor.distance + pct(H.selfPull));
          return { outcome: 'fallback', label: 'MÓC BỜ KÉO LÊN!', before, after: snapshot([actor]) };
        }
        if (rules.epic) {
          const leader = atRank(1);
          Object.assign(before, snapshot([leader]));
          const result = strike(actor, leader,
            () => { jump(leader, Math.min(leader.distance - pct(tuning.epic.hookPull), actor.distance - pct(tuning.epic.hookGap))); return { outcome: 'hit', label: 'CẦN CÂU GIẬT CON DẪN ĐẦU!' }; },
            () => impair(actor, 'capsized', tuning.mirror.reflectStun));
          return { targetId: leader.id, ...result, before, after: snapshot([actor, leader]) };
        }
        const target = atRank(rank - 1), spot = landAhead(rank - 1, H.lead);
        Object.assign(before, snapshot([target]));
        const result = strike(actor, target,
          () => { const old = actor.distance; jump(target, old); jump(actor, spot); return { outcome: 'hit', label: 'MÓC CÂU KÉO LÙI!' }; },
          () => impair(actor, 'capsized', tuning.mirror.reflectStun));
        return { targetId: target.id, ...result, before, after: snapshot([actor, target]) };
      },
      tornado(actor, ranks) {
        if (rules.epic) {
          // chaos-v3: the twister sweeps up the top 3 (never the caster) and flings each one into the
          // back part of the pack, spinning. Guarded and ghosted ducks are left out.
          const T = tuning.tornado, order = ranked(), victims = order.filter(r => r !== actor).slice(0, 3);
          const tail = order[count - 1].distance - pct(T.behind), before = snapshot([actor, ...victims]), hit = victims.filter(r => !shielded(r));
          for (const r of hit) { jump(r, tail + (r.distance - tail) * T.keep * effectRng.unit()); impair(r, 'spinning', T.spin); }
          return { affectedIds: victims.map(r => r.id), protectedIds: victims.filter(shielded).map(r => r.id),
            outcome: hit.length ? 'shuffled' : 'none', label: 'LỐC XOÁY CUỐN BAY TỐP ĐẦU!', before, after: snapshot([actor, ...victims]) };
        }
        // Smart: weight (count - rank + 1)^2 makes the leaders the likeliest to be swept up.
        const pickTop = () => { const pool = [...racers], out = [];
          while (out.length < Math.min(3, count)) { const pick = weighted(pool, r => (count - ranks[r.id] + 1) ** 2, effectRng); out.push(pick); pool.splice(pool.indexOf(pick), 1); }
          return out; };
        const picked = rules.smartTargets ? pickTop() : shuffled(ids, effectRng).slice(0, 3).map(id => racers[id]);
        const movers = picked.filter(r => !shielded(r)), before = snapshot(picked);
        if (movers.length >= 2) {
          const values = movers.map(r => r.distance), shift = movers.length === 2 ? 1 : 1 + effectRng.integer(2);
          movers.forEach((r, i) => { jump(r, values[(i + shift) % movers.length]); r.swapUntil = tick(now + 0.7) / HZ; });
        }
        return { affectedIds: picked.map(r => r.id), protectedIds: picked.filter(shielded).map(r => r.id),
          outcome: movers.length >= 2 ? 'shuffled' : 'none', label: 'LỐC XOÁY XÁO TRỘN!', before, after: snapshot(picked) };
      },
      banana(actor, ranks) {
        const rank = ranks[actor.id], last = rank === count;
        const victim = atRank(last ? rank - 1 : rank + 1);
        traps.push({ owner: actor, victim, at: last ? victim.distance : actor.distance });
        return { targetId: victim.id, outcome: 'dropped', label: last ? 'NÉM VỎ CHUỐI!' : 'THẢ VỎ CHUỐI!' };
      },
      magnet(actor, ranks) {
        const G = tuning.magnet, rank = ranks[actor.id], before = snapshot([actor]);
        jump(actor, rank === 1 ? actor.distance + pct(G.leaderHop) : rank === 2 ? atRank(1).distance + pct(G.lead) : landAhead(2, G.lead));
        return { outcome: 'pull', label: rank <= 2 ? 'NAM CHÂM HÚT LÊN DẪN ĐẦU!' : 'NAM CHÂM HÚT LÊN!', before, after: snapshot([actor]) };
      },
      lightning(actor) {
        const stun = tuning.lightning.stun, top = topRivals(actor, 2), outcomes = {};
        for (const target of top) {
          const defense = defend(target, actor, true);
          if (defense?.outcome === 'reflected') { reflect(target, actor, impair(actor, 'capsized', stun)); outcomes[target.id] = 'reflected'; }
          else outcomes[target.id] = defense ? defense.outcome : impair(target, 'capsized', stun);
        }
        const results = Object.values(outcomes);
        return { affectedIds: top.map(r => r.id), outcomes, label: 'SÉT ĐÁNH!',
          outcome: results.includes('hit') ? 'hit' : results.includes('reflected') ? 'reflected' : results[0] ?? 'none' };
      },
      flip(actor) {
        const order = ranked(), top = order[0] === actor ? order[1] : order[0], last = order[count - 1], before = snapshot([top, last]);
        let result;
        if (top === last) result = { outcome: 'none', label: 'LỘN ĐẦU ĐUÔI!' };
        else {
          const defense = defend(top, actor, true);
          if (defense?.outcome === 'blocked') result = { outcome: 'blocked', guard: defense.guard, label: LABEL.blocked(defense.guard) };
          else if (defense) { reflect(top, actor, impair(actor, 'capsized', tuning.mirror.reflectStun)); result = { outcome: 'reflected', label: LABEL.reflected }; }
          else {
            const [a, b] = [top.distance, last.distance];
            jump(top, b); jump(last, a);
            top.swapUntil = last.swapUntil = tick(now + 0.7) / HZ;
            result = { outcome: 'swapped', label: 'LỘN ĐẦU ĐUÔI!' };
          }
        }
        return { affectedIds: [top.id, last.id], ...result, before, after: snapshot([top, last]) };
      },
      reverse(actor) {
        const R = tuning.reverse, top = topRivals(actor, 2), outcomes = {};
        for (const target of top) {
          const defense = defend(target, actor, true);
          if (defense?.outcome === 'reflected') { reflect(target, actor, impair(actor, 'reversed', R.time, R.factor)); outcomes[target.id] = 'reflected'; }
          else outcomes[target.id] = defense ? defense.outcome : impair(target, 'reversed', R.time, R.factor);
        }
        const results = Object.values(outcomes);
        return { affectedIds: top.map(r => r.id), outcomes, label: 'BƠI NGƯỢC CHIỀU!',
          outcome: results.includes('hit') ? 'hit' : results.includes('reflected') ? 'reflected' : results[0] ?? 'none' };
      },
      freeze(actor) {
        // Area effect: guarded ducks are left out (guard kept), like tornado and rewind.
        const others = racers.filter(r => r !== actor), outcomes = {};
        for (const r of others) outcomes[r.id] = shielded(r) ? 'protected' : impair(r, 'frozen', tuning.freeze.time);
        return { affectedIds: others.map(r => r.id), protectedIds: others.filter(shielded).map(r => r.id), outcomes,
          outcome: Object.values(outcomes).includes('hit') ? 'frozen' : 'none', label: 'ĐÓNG BĂNG CẢ SÔNG!' };
      },
      rewind(actor) {
        // Unguarded rivals jump back to where they were tuning.rewind.seconds ago (never forward).
        const back = Math.max(0, currentStep - Math.round(tuning.rewind.seconds * HZ));
        const others = racers.filter(r => r !== actor), before = snapshot([actor, ...others]);
        for (const r of others) if (!shielded(r)) jump(r, Math.min(r.distance, distances[back * count + r.id]));
        return { affectedIds: others.map(r => r.id), protectedIds: others.filter(shielded).map(r => r.id),
          outcome: 'rewound', label: 'TUA NGƯỢC THỜI GIAN!', before, after: snapshot([actor, ...others]) };
      },
      missile(actor, ranks) {
        const M = tuning.missile, target = ranks[actor.id] === 1 ? atRank(2) : atRank(1), before = snapshot([actor, target]);
        // effect: whether the stun landed (a duck still in its immunity window only gets knocked back)
        const blast = duck => { jump(duck, duck.distance - pct(M.knock)); return impair(duck, 'capsized', M.stun); };
        const result = strike(actor, target, () => ({ outcome: 'hit', effect: blast(target), label: 'TÊN LỬA TẦM NHIỆT TRÚNG ĐÍCH!' }), () => blast(actor));
        return { targetId: target.id, ...result, before, after: snapshot([actor, target]) };
      },
      bees(actor) {
        const B = tuning.bees, top = topRivals(actor, 2), outcomes = {};
        for (const target of top) {
          const defense = defend(target, actor, true);
          if (defense?.outcome === 'reflected') { reflect(target, actor, impair(actor, 'slow', B.time, B.slow)); outcomes[target.id] = 'reflected'; }
          else outcomes[target.id] = defense ? defense.outcome : impair(target, 'slow', B.time, B.slow);
        }
        const results = Object.values(outcomes);
        return { affectedIds: top.map(r => r.id), outcomes, label: 'ĐÀN ONG TẤN CÔNG!',
          outcome: results.includes('hit') ? 'hit' : results.includes('reflected') ? 'reflected' : results[0] ?? 'none' };
      },
      blackhole(actor) {
        // A black hole opens on the top rival, swallows it and spits it out behind the last duck.
        const target = ranked().find(r => r !== actor), before = snapshot([actor, target]);
        const swallow = duck => { const tail = ranked().filter(r => r !== duck).at(-1); jump(duck, Math.min(duck.distance, tail.distance - pct(tuning.blackhole.behind))); return 'hit'; };
        const result = strike(actor, target, () => ({ outcome: swallow(target), label: 'HỐ ĐEN NUỐT CHỬNG!' }), () => swallow(actor));
        return { targetId: target.id, ...result, before, after: snapshot([actor, target]) };
      },
      ghost(actor, ranks) {
        // Turns into a ghost: glides through the (up to) 2 ducks ahead, spooking each one, then stays untouchable.
        // The leader hops ahead and spooks the duck right behind it.
        const G = tuning.ghost, rank = ranks[actor.id], before = snapshot([actor]);
        const pass = Math.min(G.pass, rank - 1), spooked = pass ? Array.from({ length: pass }, (_, i) => atRank(rank - 1 - i)) : [atRank(2)];
        jump(actor, pass ? landAhead(rank - pass, G.lead) : actor.distance + pct(G.leaderHop));
        const outcomes = {};
        for (const r of spooked) { const defense = defend(r, actor, false); outcomes[r.id] = defense ? defense.outcome : impair(r, 'slow', G.spookTime, G.spookSlow); }
        actor.ghostUntil = tick(now + G.time) / HZ;
        return { affectedIds: spooked.map(r => r.id), outcomes, outcome: 'ghost', label: 'BÓNG MA LƯỚT XUYÊN QUA!', before, after: snapshot([actor]) };
      },
      balloon(actor) {
        const [target] = topRivals(actor, 1), time = tuning.balloon.time;
        return { targetId: target.id, ...strike(actor, target,
          () => { const outcome = impair(target, 'lifted', time); return { outcome, label: outcome === 'hit' ? 'BÓNG BAY NHẤC BỔNG!' : LABEL.immune }; },
          () => impair(actor, 'lifted', time)) };
      },
      bomb(actor) {
        // Hot potato: the bomb sits on whoever leads (see the main loop) and blows up when the fuse runs out.
        const target = ranked().find(r => r !== actor);
        // A short fuse near the end: it always goes off before the line.
        const until = tick(Math.max(now + 0.5, Math.min(now + tuning.bomb.fuse, duration - 0.3))) / HZ;
        bombs.push({ owner: actor, holder: target, until });
        return { targetId: target.id, outcome: 'armed', fuse: +(until - now).toFixed(2), label: 'GẮN BOM HẸN GIỜ!' };
      },
      copycat(actor, ranks) {
        // Copies the latest active skill another duck used (or a random one before anyone has) and casts it now.
        const last = [...events].reverse().find(e => e.type === 'skill' && e.scheduled && e.actorId !== actor.id && !PASSIVE.has(e.copied || e.skill));
        const pool = rules.skills.filter(sk => !PASSIVE.has(sk.id) && sk.id !== 'copycat');
        const copied = last ? (last.copied || last.skill) : pool[effectRng.integer(pool.length)].id;
        const skill = rules.skills.find(sk => sk.id === copied), effect = skillEffects[copied](actor, ranks);
        return { ...effect, copied, copiedName: skill.name, copiedIcon: skill.icon, label: `HỌC LỎM ${skill.name.toUpperCase()}: ${effect.label}` };
      },
      dice(actor, ranks) {
        const D = tuning.dice, roll = 1 + effectRng.integer(6), rank = ranks[actor.id], before = snapshot([actor]);
        if (roll === 1) return { roll, outcome: 'bust', effect: impair(actor, 'capsized', D.bustStun), label: 'XÚC XẮC RA 1: TỰ LẬT THUYỀN!', before, after: snapshot([actor]) };
        if (rank === 1) jump(actor, actor.distance + pct(D.leaderHop * roll));
        else if (roll === 6 || roll - 1 >= rank - 1) jump(actor, atRank(1).distance + pct(D.leadBy));
        else jump(actor, landAhead(rank - (roll - 1), D.leadBy));
        return { roll, outcome: 'roll', label: roll === 6 ? 'XÚC XẮC RA 6: VỌT LÊN DẪN ĐẦU!' : `XÚC XẮC RA ${roll}!`, before, after: snapshot([actor]) };
      },
      lullaby(actor) {
        const L = tuning.lullaby, gap = r => Math.abs(r.distance - actor.distance);
        const near = racers.filter(r => r !== actor).sort((a, b) => gap(a) - gap(b) || a.id - b.id), inRange = near.filter(r => gap(r) <= pct(L.range));
        const targets = inRange.length >= L.min ? inRange : near.slice(0, L.min), outcomes = {};
        for (const r of targets) outcomes[r.id] = shielded(r) ? 'protected' : impair(r, 'asleep', L.time);
        return { affectedIds: targets.map(r => r.id), protectedIds: targets.filter(shielded).map(r => r.id), outcomes,
          outcome: Object.values(outcomes).includes('hit') ? 'asleep' : 'none', label: 'RU NGỦ CẢ ĐÁM!' };
      },
      hex(actor) {
        const H = tuning.hex, [target] = topRivals(actor, 1);
        return { targetId: target.id, ...strike(actor, target,
          () => { const outcome = impair(target, 'hex', H.time, H.slow); return { outcome, label: outcome === 'hit' ? 'BIẾN THÀNH ẾCH!' : LABEL.immune }; },
          () => impair(actor, 'hex', H.time, H.slow)) };
      },
      giant(actor) {
        const G = tuning.giant;
        actor.giantUntil = tick(now + G.time) / HZ;
        const ahead = racers.filter(r => r !== actor && r.distance > actor.distance && r.distance - actor.distance <= pct(G.range))
          .sort((a, b) => a.distance - b.distance || a.id - b.id).slice(0, G.max), before = snapshot([actor, ...ahead]), outcomes = {};
        for (const r of ahead) {
          if (shielded(r)) { outcomes[r.id] = 'protected'; continue; }
          jump(r, r.distance - pct(G.knock)); impair(r, 'spinning', G.spin); outcomes[r.id] = 'hit';
        }
        return { affectedIds: ahead.map(r => r.id), protectedIds: ahead.filter(shielded).map(r => r.id), outcomes, outcome: 'giant', label: 'NẤM KHỔNG LỒ GIẪM NÁT!', before, after: snapshot([actor, ...ahead]) };
      },
      buoy(actor) {
        if (actor.guard === 'buoy') actor.guard = null;
        return { outcome: 'fallback', label: rules.epic ? 'PHAO NẢY TƯNG TƯNG!' : 'PHAO BƠM HƠI BẬT LÊN!', ...(rules.epic ? bounce(actor, tuning.buoyV3.fallbackPass) : bounce(actor)) };
      }
    };
    function applySkill(actor) {
      if (actor.skillUsed && PASSIVE.has(actor.skill.id)) return; // a passive skill already reacted earlier (active ones may fire twice on a "double" day)
      const ranks = ranksNow();
      const effect = skillEffects[actor.skill.id](actor, ranks);
      actor.skillUsed = true;
      emit({ type: 'skill', actorId: actor.id, skill: actor.skill.id, icon: actor.skill.icon, ranksBefore: ranks, activation: true, scheduled: true, ...effect });
      flush();
    }
    // Each hazard picks its victim; harmful ones return `harm`, helpful ones `surge`.
    const HZD = tuning.hazard;
    const randomDuck = () => atRank(1 + hazardRng.integer(count));
    // A back-half duck for a helpful river event; chaos-v3 weights lucky ducks up (equal weights: the same draw).
    const helpedDuck = () => { const half = Math.ceil(count / 2), back = ranked().slice(half);
      return rules.traits ? weighted(back, r => 1 + r.luck * tuning.luck.help, hazardRng) : back[hazardRng.integer(back.length)]; };
    const hazardEffects = {
      rock() {
        const [victim] = topRivals(null, 1);
        return { victim, label: !rules.finaleChance && now >= duration - HZD.rockLateWindow ? 'VẤP ĐÁ SÁT ĐÍCH!' : 'VẤP ĐÁ!', harm: () => impair(victim, 'capsized', HZD.rockStun) };
      },
      croc() {
        const victim = randomDuck();
        return { victim, label: 'CÁ SẤU ĐỚP, KÉO LÙI!', harm: () => { jump(victim, victim.distance - pct(HZD.crocPull)); return 'hit'; } };
      },
      wind: () => ({ victim: atRank(count), label: 'GIÓ THUẬN ĐẨY LÊN!', surge: pct(HZD.windPush) }),
      whirlpool() {
        const victim = randomDuck();
        return { victim, label: 'XOÁY NƯỚC QUAY TRÒN!', harm: () => impair(victim, 'spinning', HZD.whirlStun) };
      },
      hippo() {
        const victim = atRank(1 + hazardRng.integer(Math.ceil(count / 2)));
        const plan = { victim, label: 'HÀ MÃ TRỒI LÊN, HẤT VĂNG!', harm: () => { jump(victim, victim.distance - pct(HZD.hippoKnock)); plan.effect = impair(victim, 'capsized', HZD.hippoStun); return 'hit'; } };
        return plan;
      },
      log() {
        const [victim] = topRivals(null, 1);
        return { victim, label: 'KHÚC GỖ CHẮN ĐƯỜNG!', harm: () => impair(victim, 'slow', HZD.logTime, HZD.logSlow) };
      },
      frog() {
        return { victim: helpedDuck(), label: 'ẾCH CÕNG NHẢY CÓC!', hop: pct(HZD.frogHop) };
      },
      dolphin() {
        return { victim: helpedDuck(), label: 'CÁ HEO CÕNG LÊN!', surge: pct(HZD.dolphinPush) };
      }
    };
    // Finale: unblockable; the leader falls behind 2nd place and stays capsized to the end.
    function applyFinale(hazard) {
      const ranks = ranksNow(), victim = atRank(1), before = snapshot([victim]);
      jump(victim, Math.min(victim.distance, atRank(2).distance - pct(HZD.finaleKnock)));
      Object.assign(victim, { impairKind: 'capsized', impairFactor: 0, impairUntil: duration + 1, immuneUntil: duration + 1 });
      // Nobody may drift back past the fallen leader after this: end any backwards swimming.
      for (const r of racers) if (r !== victim && r.impairKind === 'reversed' && now < r.impairUntil) r.impairUntil = now;
      bombs.length = 0; // a late bomb would knock 2nd back past the fallen leader
      emit({ type: 'hazard', hazard: hazard.id, actorId: victim.id, icon: hazard.icon, label: 'VẤP ĐÁ SÁT ĐÍCH!', ranksBefore: ranks, scheduled: true, finale: true, outcome: 'hit', before, after: snapshot([victim]) });
    }
    function applyHazard(hazard) {
      const ranks = ranksNow(), plan = hazardEffects[hazard.id](), victim = plan.victim, before = snapshot([victim]);
      let result;
      if (plan.surge) {
        surge(victim, plan.surge, HZD.surgeTime);
        result = { outcome: 'boost', surge: plan.surge };
      } else if (plan.hop) {
        jump(victim, victim.distance + plan.hop);
        result = { outcome: 'boost', hop: plan.hop };
      } else {
        const defense = defend(victim, null, false);
        if (defense) result = { outcome: 'blocked', guard: defense.guard, label: LABEL.blocked(defense.guard) };
        else result = plan.harm() === 'hit' ? { outcome: 'hit' } : { outcome: 'immune', label: LABEL.immune };
      }
      emit({ type: 'hazard', hazard: hazard.id, actorId: victim.id, icon: hazard.icon, label: plan.label, ranksBefore: ranks, scheduled: true, before, after: snapshot([victim]), ...result,
        ...(plan.effect ? { effect: plan.effect } : {}) });
      flush();
    }
    function runeEffect(actor, item) {
      const U = tuning.rune;
      if (item.rune.id === 'bubble') {
        if (actor.guard !== 'buoy') actor.guard = 'bubble';
        return { outcome: 'shield', label: 'Nhặt bong bóng bảo vệ' };
      }
      if (item.rune.id === 'speed' || item.good) {
        actor.runeUntil = Math.max(actor.runeUntil, tick(now + U.time) / HZ);
        return { outcome: 'boost', label: 'Nhặt rune tăng tốc 40%' };
      }
      const defense = defend(actor, null, false);
      if (defense) return { outcome: 'blocked', guard: defense.guard, label: `Hộp hên xui: ${LABEL.blocked(defense.guard)}` };
      const outcome = impair(actor, 'slow', U.time, U.slow);
      return { outcome, label: outcome === 'hit' ? 'Hộp hên xui: trúng xỉn!' : `Hộp hên xui: ${LABEL.immune}` };
    }
    function applyRune(item) {
      const actor = racers[item.actorId];
      if (item.kind === 'rune-spawn') {
        emit({ type: 'rune-spawn', actorId: actor.id, runeId: item.runeId, rune: item.rune.id, icon: item.rune.icon, label: `${item.rune.name} xuất hiện`, pickupTime: item.pickupTick / HZ });
        return;
      }
      emit({ type: 'rune-pickup', actorId: actor.id, runeId: item.runeId, rune: item.rune.id, icon: item.rune.icon, ...runeEffect(actor, item) });
      flush();
    }
    // The bomb always sits on the current leader; when the fuse runs out it blows up there.
    function tickBombs() {
      for (const bomb of [...bombs]) {
        bomb.holder = ranked()[0];
        if (now < bomb.until) continue;
        bombs.splice(bombs.indexOf(bomb), 1);
        const B = tuning.bomb, victim = bomb.holder, ranks = ranksNow(), before = snapshot([victim]);
        const defense = defend(victim, victim === bomb.owner ? null : bomb.owner, false);
        let result;
        if (defense) result = { outcome: 'blocked', guard: defense.guard, label: LABEL.blocked(defense.guard) };
        else { jump(victim, victim.distance - pct(B.knock)); result = { outcome: 'hit', effect: impair(victim, 'capsized', B.stun), label: 'BOM NỔ TUNG!' }; }
        emit({ type: 'skill', skill: 'bomb', icon: '💥', actorId: bomb.owner.id, targetId: victim.id, ranksBefore: ranks, before, after: snapshot([victim]), ...result });
        flush();
      }
    }
    function apply(item) {
      if (item.kind === 'skill') applySkill(racers[item.actorId]);
      else if (item.kind === 'hazard') (item.finale ? applyFinale : applyHazard)(item.hazard);
      else applyRune(item);
    }

    function record(step) {
      const time = step / HZ;
      for (const r of racers) {
        const index = step * count + r.id;
        const impaired = time < r.impairUntil;
        const boosting = time < r.rocketUntil || time < r.runeUntil || r.surges.some(s => time >= (s.from || 0) && time < s.until) || time < r.giantUntil
          || (r.boost && time >= r.boost.start && time < r.boost.end);
        distances[index] = r.distance;
        flags[index] = (boosting ? 1 : 0) | (impaired && r.impairKind === 'slow' ? 2 : 0) | (r.guard ? 4 : 0)
          | (time < r.swapUntil ? 8 : 0) | (r.skillUsed ? 16 : 0) | (impaired && r.impairKind === 'capsized' ? 32 : 0)
          | (impaired && r.impairKind === 'spinning' ? 64 : 0) | (time < r.flyUntil ? 128 : 0)
          | (impaired && r.impairKind === 'reversed' ? 256 : 0) | (impaired && r.impairKind === 'frozen' ? 512 : 0)
          | (time < r.ghostUntil ? 1024 : 0) | (impaired && r.impairKind === 'lifted' ? 2048 : 0);
        if (marks) marks[index] = (impaired && r.impairKind === 'asleep' ? 1 : 0) | (impaired && r.impairKind === 'hex' ? 2 : 0)
          | (time < r.giantUntil ? 4 : 0) | (bombs.some(b => b.holder === r) ? 8 : 0) | (r.mirror ? 16 : 0);
      }
    }
    // Trait speed bonus (chaos-v3); `behind` holds the ids in the back half this tick.
    let behind = null;
    function traitBoost(racer, start) {
      const T = tuning.trait;
      switch (racer.trait?.id) {
        case 'steady': return T.steady;
        case 'early': return start < duration * T.earlyUntil ? T.early : 0;
        case 'late': return start >= duration * T.lateFrom ? T.late : 0;
        case 'catchup': return behind?.has(racer.id) ? T.catchup : 0;
        default: return 0;
      }
    }
    function move(racer, start, end, segment) {
      const base = racer.speeds[segment];
      const extra = (start < racer.rocketUntil ? tuning.rocket.boost : 0) + (start < racer.runeUntil ? tuning.rune.boost : 0)
        + (racer.trait ? traitBoost(racer, start) + (start < racer.giantUntil ? tuning.giant.boost : 0) + racer.luck * tuning.luck.speed : 0);
      const pulse = pulseIntegral(racer.boost, end) - pulseIntegral(racer.boost, start);
      let movement = base / HZ * (1 + extra) + pulse;
      for (const s of racer.surges) if (start >= (s.from || 0) && start < s.until) movement += s.rate / HZ;
      if (start < racer.impairUntil) movement *= racer.impairFactor;
      racer.distance = Math.max(0, racer.distance + movement); // reversed ducks swim backwards
      racer.baseDistance += base / HZ;
    }

    let cursor = 0;
    record(0);
    for (let step = 1; step <= steps; step++) {
      const start = (step - 1) / HZ, end = step / HZ;
      const segment = Math.min(segmentCount - 1, Math.floor((start + end) / 2 / segmentLength));
      if (racers.some(r => r.trait?.id === 'catchup')) behind = new Set(ranked().slice(Math.ceil(count / 2)).map(r => r.id));
      for (const racer of racers) move(racer, start, end, segment);
      currentStep = step; now = end;
      for (const trap of [...traps]) if (trap.victim.distance >= trap.at) { traps.splice(traps.indexOf(trap), 1); slip(trap); }
      if (bombs.length) tickBombs();
      while (cursor < schedule.length && schedule[cursor].tick === step) apply(schedule[cursor++]);
      record(step);
    }
    const finalOrder = ranked();
    const finalRanks = [];
    finalOrder.forEach((r, index) => { finalRanks[r.id] = index + 1; });
    const finishDistance = finalOrder[0].distance;
    events.forEach(event => {
      if (event.type === 'rune-spawn') event.progress = distances[tick(event.pickupTime) * count + event.actorId] / finishDistance;
    });
    const publicRacer = racer => ({ id: racer.id, name: racer.name, skill: racer.skill, ...(racer.trait ? { trait: racer.trait } : {}), ...(racer.luck ? { luck: racer.luck } : {}) });
    const publicRacers = freeze(racers.map(publicRacer));
    const results = freeze(finalOrder.map(racer => ({ ...publicRacer(racer), rank: finalRanks[racer.id], baseDistance: racer.baseDistance, finalDistance: racer.distance })));
    return Object.freeze({
      version, seed, duration, sprintStart, ...(weather ? { weather } : {}), ...(dealt?.rule ? { rule: dealt.rule } : {}),
      racers: publicRacers, results, boosts: freeze(boosts.map(b => ({ ...b }))), events: freeze(events),
      sample(elapsedSeconds) {
        if (!Number.isFinite(elapsedSeconds)) throw new TypeError('Thời gian đã chạy phải hữu hạn.');
        const time = Math.max(0, Math.min(duration, elapsedSeconds));
        const preciseStep = time * HZ;
        const left = Math.min(steps, Math.floor(preciseStep + 1e-9));
        const right = Math.min(steps, left + 1);
        const fraction = Math.max(0, preciseStep - left);
        const jump = jumps.get(right);
        const positions = racers.map(racer => {
          const first = distances[left * count + racer.id];
          // Jumps are instantaneous at their tick, never a glide toward them.
          const second = jump?.has(racer.id) ? jump.get(racer.id) : distances[right * count + racer.id];
          return { id: racer.id, distance: first + (second - first) * fraction };
        });
        const currentRanks = [];
        [...positions].sort(compare).forEach((racer, index) => { currentRanks[racer.id] = index + 1; });
        return racers.map(racer => {
          const state = flags[left * count + racer.id];
          let progress = positions[racer.id].distance / finishDistance;
          if (time < duration || finalRanks[racer.id] !== 1) progress = Math.min(progress, 1 - Number.EPSILON * finalRanks[racer.id]);
          const capsized = !!(state & 32), spinning = !!(state & 64), frozen = !!(state & 512), lifted = !!(state & 2048);
          const mark = marks ? marks[left * count + racer.id] : 0, asleep = !!(mark & 1);
          return { ...publicRacers[racer.id], rank: finalRanks[racer.id], currentRank: currentRanks[racer.id], progress,
            boosting: !!(state & 1), slowed: !!(state & 2), shielded: !!(state & 4), swapping: !!(state & 8), skillUsed: !!(state & 16),
            // Key order is part of the chaos-v2 golden hash: keep stunned, pose, flying.
            stunned: capsized || spinning || frozen || lifted || asleep,
            pose: capsized ? 'capsized' : spinning ? 'spinning' : state & 256 ? 'reversed' : frozen ? 'frozen' : lifted ? 'lifted'
              : asleep ? 'asleep' : mark & 2 ? 'hex' : state & 1024 ? 'ghost' : mark & 4 ? 'giant' : null,
            flying: !!(state & 128),
            // chaos-v3 only (absent in chaos-v2, whose sample shape is pinned): who holds a bomb, whose mirror is up.
            ...(marks ? { bomb: !!(mark & 8), mirror: !!(mark & 16) } : {}) };
        });
      }
    });
  }

  const v3 = Object.freeze({ version: 'chaos-v3', skills: V3_RULES.skills, hazards: V3_RULES.hazards, traits, runeTypes, tuning, weathers, dayRules,
    // lineup: { skills: [id per duck], traits: [id per duck] } as shown before the picks; omitted = dealt from the seed.
    createRace: (names, duration, seed, lineup) => createRaceFor('chaos-v3', V3_RULES, names, duration, seed, lineup),
    deal: (count, seed = newSeed()) => {
      if (!Number.isInteger(count) || count < 2 || count > 100) throw new RangeError('Mỗi cuộc đua cần từ 2 đến 100 con vịt.');
      return dealLineup(V3_RULES, count, seed);
    } });
  const api = Object.freeze({ version: VERSION, skills, hazards, runeTypes, tuning, v3,
    createRace: (names, duration, seed) => createRaceFor(VERSION, V2_RULES, names, duration, seed) });
  root.DuckChaosEngineV2 = api;
  root.DuckChaosEngineV3 = v3;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
