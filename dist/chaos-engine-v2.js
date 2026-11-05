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
    rune: { boost: 0.4, time: 1.5, slow: 0.6 },
    hazard: { countMin: 2, countMax: 4, rockStun: 1.5, rockLateWindow: 3, rockLateChance: 0.7, crocPull: 5, windPush: 6, whirlStun: 1.5, dolphinPush: 5, surgeTime: 1 }
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
  // chaos-v3 = chaos-v2 + one weather per race. Weather adds hazards and reweights them.
  // chaos-v2 never touches this table, so its replays stay identical.
  const weathers = freeze([
    { id: 'sunny', name: 'Nắng đẹp', icon: '☀️', chance: 40, extra: 0, weights: {} },
    { id: 'rain', name: 'Mưa rào', icon: '🌧️', chance: 25, extra: 1, weights: { whirlpool: 2, croc: 2 } },
    { id: 'wind', name: 'Gió lớn', icon: '💨', chance: 20, extra: 1, weights: { wind: 5 } },
    { id: 'storm', name: 'Bão sông', icon: '⛈️', chance: 15, extra: 2, weights: { rock: 2, whirlpool: 2 } }
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
  function planSlots(racers, duration, hazardRng, scheduleRng, weather) {
    const H = tuning.hazard, count = racers.length;
    const slots = racers.map(r => ({ kind: 'skill', actorId: r.id, passive: PASSIVE.has(r.skill.id) }));
    const hazardCount = (H.countMin + hazardRng.integer(H.countMax - H.countMin + 1) + (weather?.extra || 0)) * Math.ceil(count / 7);
    const pickHazard = weather ? () => weighted(hazards, h => weather.weights[h.id] || 1, hazardRng) : () => hazards[hazardRng.integer(hazards.length)];
    for (let i = 0; i < hazardCount; i++) slots.push({ kind: 'hazard', hazard: pickHazard() });
    const first = tuning.firstPhase, last = duration - 0.2;
    for (const slot of slots) {
      const lateRock = slot.hazard?.id === 'rock' && scheduleRng.unit() < H.rockLateChance;
      slot.time = lateRock
        ? duration - H.rockLateWindow + scheduleRng.unit() * (H.rockLateWindow - 0.3)
        : first + (duration - first) * scheduleRng.unit() ** TIME_EXPONENT;
    }
    const visible = slot => slot.kind === 'hazard' || !slot.passive;
    const byTime = () => slots.sort((a, b) => a.time - b.time);
    byTime();
    // Late guarantee first: it may pull an early slot, which the early guarantee then refills.
    if (!slots.some(s => visible(s) && s.time >= duration - 2)) {
      const late = [...slots].reverse();
      const pick = late.find(s => s.hazard?.id === 'rock') || late.find(s => s.kind === 'hazard') || late.find(visible);
      pick.time = duration - 2 + scheduleRng.unit() * 1.7;
      byTime();
    }
    // Spacing can push a slot later by one gap per earlier (passive) slot, so the
    // early guarantee keeps that much margin before the first third ends.
    const earlyEnd = Math.max(first, duration / 3 - (slots.filter(s => !visible(s)).length + 1) * tuning.minGap - 0.05);
    if (!slots.some(s => visible(s) && s.time < earlyEnd)) {
      slots.find(visible).time = first + scheduleRng.unit() * (earlyEnd - first);
      byTime();
    }
    // Whole-tick spacing keeps the gap exact after quantization.
    const firstTick = Math.round(first * HZ), lastTick = Math.round(last * HZ);
    const gap = Math.max(0, Math.min(Math.round(tuning.minGap * HZ), Math.floor((lastTick - firstTick) / slots.length)));
    slots.forEach(s => { s.tick = Math.min(lastTick, Math.max(firstTick, Math.round(s.time * HZ))); });
    for (let i = 1; i < slots.length; i++) slots[i].tick = Math.max(slots[i].tick, slots[i - 1].tick + gap);
    slots[slots.length - 1].tick = Math.min(slots[slots.length - 1].tick, lastTick);
    for (let i = slots.length - 2; i >= 0; i--) slots[i].tick = Math.min(slots[i].tick, slots[i + 1].tick - gap);
    return slots;
  }

  function createRaceFor(version, hasWeather, names, durationSeconds = 25, seed = newSeed()) {
    const cleanNames = cleanInput(names, durationSeconds, seed);
    const count = cleanNames.length, duration = durationSeconds;
    const ids = Array.from({ length: count }, (_, id) => id);
    const motionRng = randomFor(seed, 0x4d4f5432);
    const skillRng = randomFor(seed, 0x534b4932);
    const scheduleRng = randomFor(seed, 0x53434832);
    const hazardRng = randomFor(seed, 0x48415a32);
    const weather = hasWeather ? weighted(weathers, w => w.chance, randomFor(seed, 0x57544852)) : null;
    const runeRng = randomFor(seed, 0x52554e32);
    const effectRng = randomFor(seed, 0x45464632);
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
      guard: null, mirror: false, flyUntil: 0, swapUntil: 0, skillUsed: false
    }));
    const boostCount = 1 + motionRng.integer(Math.min(count - 1, Math.ceil(count * 0.55)));
    const boosts = shuffled(ids, motionRng).slice(0, boostCount).map(id => {
      const start = sprintStart + motionRng.unit() * 2.6;
      const end = Math.min(duration, start + 1.1 + motionRng.unit() * 2.3);
      const boost = { id, start, end, strength: 0.8 + motionRng.unit() * 3.7 };
      racers[id].boost = boost;
      return boost;
    });
    const deck = shuffled(Array.from({ length: Math.ceil(count / skills.length) }, () => skills).flat(), skillRng);
    racers.forEach((racer, index) => {
      racer.skill = deck[index];
      if (racer.skill.id === 'mirror') racer.mirror = true;
      if (racer.skill.id === 'buoy') racer.guard = 'buoy';
    });

    const schedule = planSlots(racers, duration, hazardRng, scheduleRng, weather).map((slot, index) => ({ ...slot, index }));
    const runeCount = Math.max(3, Math.ceil(count / 3));
    for (let i = 0; i < runeCount; i++) {
      const actorId = runeRng.integer(count), rune = runeTypes[runeRng.integer(runeTypes.length)];
      const spawnTick = tick(duration * (0.20 + 0.55 * ((i + 0.2 + runeRng.unit() * 0.6) / runeCount)));
      const pickupTick = Math.min(steps - HZ, spawnTick + 15);
      const runeData = { actorId, rune, runeId: `rune-${i + 1}`, pickupTick, good: runeRng.unit() < 0.5, index: schedule.length + i };
      schedule.push({ ...runeData, tick: spawnTick, kind: 'rune-spawn' }, { ...runeData, tick: pickupTick, kind: 'rune-pickup' });
    }
    const priority = { 'rune-spawn': 0, hazard: 1, skill: 2, 'rune-pickup': 3 };
    schedule.sort((a, b) => a.tick - b.tick || priority[a.kind] - priority[b.kind] || a.index - b.index);

    const events = [];
    let eventId = 0, currentStep = 0, now = 0;
    const emit = event => { const result = { id: `event-${++eventId}`, time: now, ...event }; events.push(result); return result; };
    const distances = new Float64Array((steps + 1) * count);
    const flags = new Uint8Array((steps + 1) * count);
    const jumps = new Map();
    const ranked = () => [...racers].sort(compare);
    const ranksNow = () => { const ranks = []; ranked().forEach((r, index) => { ranks[r.id] = index + 1; }); return ranks; };
    const atRank = rank => ranked()[rank - 1];
    const snapshot = list => Object.fromEntries(list.map(r => [r.id, r.distance]));

    function jump(racer, distance) {
      if (!jumps.has(currentStep)) jumps.set(currentStep, new Map());
      const before = jumps.get(currentStep);
      if (!before.has(racer.id)) before.set(racer.id, racer.distance);
      racer.distance = Math.max(0, distance);
    }
    function impair(racer, kind, seconds, factor = 0) {
      if (now < racer.impairUntil || now < racer.immuneUntil) return 'immune';
      racer.impairKind = kind;
      racer.impairFactor = factor;
      racer.impairUntil = tick(now + seconds) / HZ;
      racer.immuneUntil = tick(racer.impairUntil + tuning.stunImmunity) / HZ;
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
      blocked: guard => guard === 'buoy' ? 'PHAO CHẶN ĐÒN!' : 'BONG BÓNG CHẶN ĐÒN!'
    };
    // Landing spot just ahead of the duck at `rank`, never past the duck above it.
    function landAhead(rank, lead) {
      const passed = atRank(rank), above = rank > 1 ? atRank(rank - 1) : null;
      const spot = passed.distance + pct(lead);
      return above ? Math.max(passed.distance, Math.min(spot, (passed.distance + above.distance) / 2)) : spot;
    }
    function bounce(holder) {
      const ranks = ranksNow(), before = snapshot([holder]), rank = ranks[holder.id];
      jump(holder, rank > 1 ? landAhead(rank - 1, tuning.buoy.lead) : holder.distance + pct(tuning.buoy.leaderHop));
      return { ranksBefore: ranks, before, after: snapshot([holder]) };
    }
    function reflect(holder, attacker, effect) {
      holder.skillUsed = true;
      reactions.push({ type: 'skill', actorId: holder.id, skill: 'mirror', icon: '🪞', targetId: attacker.id, outcome: 'reflected', effect, label: 'GƯƠNG DỘI NGƯỢC!', activation: true });
    }
    // Returns { outcome: 'blocked' | 'reflected', guard? } or null when the hit lands.
    // Only skill attacks from another duck can be reflected.
    function defend(victim, attacker, reflectable) {
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
      torpedo(actor, ranks) {
        const target = ranks[actor.id] === 1 ? atRank(2) : atRank(1);
        const stun = tuning.torpedo.stun;
        return { targetId: target.id, ...strike(actor, target,
          () => { const outcome = impair(target, 'capsized', stun); return { outcome, label: outcome === 'hit' ? LABEL.hit : LABEL.immune }; },
          () => impair(actor, 'capsized', stun)) };
      },
      wave(actor, ranks) {
        const V = tuning.wave, top = ranked().filter(r => r !== actor).slice(0, 3);
        const before = snapshot([actor, ...top]), outcomes = {};
        for (const target of top) {
          const defense = defend(target, actor, true);
          if (defense?.outcome === 'reflected') reflect(target, actor, 'hit');
          else if (!defense) jump(target, target.distance - pct(V.push));
          outcomes[target.id] = defense ? defense.outcome : 'hit';
        }
        const reflected = Object.values(outcomes).includes('reflected');
        if (reflected) jump(actor, actor.distance - pct(V.push));
        else surge(actor, pct(V.surge), V.surgeTime);
        return { affectedIds: top.map(r => r.id), outcomes, outcome: reflected ? 'reflected' : 'hit', label: 'SÓNG THẦN!', before, after: snapshot([actor, ...top]) };
      },
      swap(actor, ranks) {
        const S = tuning.swap, rank = ranks[actor.id];
        const lo = rank === 1 ? rank + S.reachMin : Math.max(1, rank - S.reachMax);
        const hi = rank === 1 ? Math.min(count, rank + S.reachMax) : rank - S.reachMin;
        const target = atRank(lo + effectRng.integer(hi - lo + 1));
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
        const target = rank === 1 ? atRank(2) : atRank(rank - 1);
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
        const target = atRank(rank - 1), spot = landAhead(rank - 1, H.lead);
        Object.assign(before, snapshot([target]));
        const result = strike(actor, target,
          () => { const old = actor.distance; jump(target, old); jump(actor, spot); return { outcome: 'hit', label: 'MÓC CÂU KÉO LÙI!' }; },
          () => impair(actor, 'capsized', tuning.mirror.reflectStun));
        return { targetId: target.id, ...result, before, after: snapshot([actor, target]) };
      },
      tornado() {
        const picked = shuffled(ids, effectRng).slice(0, 3).map(id => racers[id]);
        const movers = picked.filter(r => !r.guard), before = snapshot(picked);
        if (movers.length >= 2) {
          const values = movers.map(r => r.distance), shift = movers.length === 2 ? 1 : 1 + effectRng.integer(2);
          movers.forEach((r, i) => { jump(r, values[(i + shift) % movers.length]); r.swapUntil = tick(now + 0.7) / HZ; });
        }
        return { affectedIds: picked.map(r => r.id), protectedIds: picked.filter(r => r.guard).map(r => r.id),
          outcome: movers.length >= 2 ? 'shuffled' : 'none', label: 'LỐC XOÁY XÁO TRỘN!', before, after: snapshot(picked) };
      },
      banana(actor, ranks) {
        const rank = ranks[actor.id], last = rank === count;
        const victim = atRank(last ? rank - 1 : rank + 1);
        traps.push({ owner: actor, victim, at: last ? victim.distance : actor.distance });
        return { targetId: victim.id, outcome: 'dropped', label: last ? 'NÉM VỎ CHUỐI!' : 'THẢ VỎ CHUỐI!' };
      },
      buoy(actor) {
        if (actor.guard === 'buoy') actor.guard = null;
        return { outcome: 'fallback', label: 'PHAO BƠM HƠI BẬT LÊN!', ...bounce(actor) };
      }
    };
    function applySkill(actor) {
      if (actor.skillUsed) return; // a passive skill already reacted earlier
      const ranks = ranksNow();
      const effect = skillEffects[actor.skill.id](actor, ranks);
      actor.skillUsed = true;
      emit({ type: 'skill', actorId: actor.id, skill: actor.skill.id, icon: actor.skill.icon, ranksBefore: ranks, activation: true, scheduled: true, ...effect });
      flush();
    }
    // Each hazard picks its victim; harmful ones return `harm`, helpful ones `surge`.
    const HZD = tuning.hazard;
    const randomDuck = () => atRank(1 + hazardRng.integer(count));
    const hazardEffects = {
      rock() {
        const victim = atRank(1);
        return { victim, label: now >= duration - HZD.rockLateWindow ? 'VẤP ĐÁ SÁT ĐÍCH!' : 'VẤP ĐÁ!', harm: () => impair(victim, 'capsized', HZD.rockStun) };
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
      dolphin() {
        const half = Math.ceil(count / 2);
        return { victim: atRank(half + 1 + hazardRng.integer(count - half)), label: 'CÁ HEO CÕNG LÊN!', surge: pct(HZD.dolphinPush) };
      }
    };
    function applyHazard(hazard) {
      const ranks = ranksNow(), plan = hazardEffects[hazard.id](), victim = plan.victim, before = snapshot([victim]);
      let result;
      if (plan.surge) {
        surge(victim, plan.surge, HZD.surgeTime);
        result = { outcome: 'boost', surge: plan.surge };
      } else {
        const defense = defend(victim, null, false);
        if (defense) result = { outcome: 'blocked', guard: defense.guard, label: LABEL.blocked(defense.guard) };
        else result = plan.harm() === 'hit' ? { outcome: 'hit' } : { outcome: 'immune', label: LABEL.immune };
      }
      emit({ type: 'hazard', hazard: hazard.id, actorId: victim.id, icon: hazard.icon, label: plan.label, ranksBefore: ranks, scheduled: true, before, after: snapshot([victim]), ...result });
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
    function apply(item) {
      if (item.kind === 'skill') applySkill(racers[item.actorId]);
      else if (item.kind === 'hazard') applyHazard(item.hazard);
      else applyRune(item);
    }

    function record(step) {
      const time = step / HZ;
      for (const r of racers) {
        const index = step * count + r.id;
        const impaired = time < r.impairUntil;
        const boosting = time < r.rocketUntil || time < r.runeUntil || r.surges.some(s => time < s.until)
          || (r.boost && time >= r.boost.start && time < r.boost.end);
        distances[index] = r.distance;
        flags[index] = (boosting ? 1 : 0) | (impaired && r.impairKind === 'slow' ? 2 : 0) | (r.guard ? 4 : 0)
          | (time < r.swapUntil ? 8 : 0) | (r.skillUsed ? 16 : 0) | (impaired && r.impairKind === 'capsized' ? 32 : 0)
          | (impaired && r.impairKind === 'spinning' ? 64 : 0) | (time < r.flyUntil ? 128 : 0);
      }
    }
    function move(racer, start, end, segment) {
      const base = racer.speeds[segment];
      const extra = (start < racer.rocketUntil ? tuning.rocket.boost : 0) + (start < racer.runeUntil ? tuning.rune.boost : 0);
      const pulse = pulseIntegral(racer.boost, end) - pulseIntegral(racer.boost, start);
      let movement = base / HZ * (1 + extra) + pulse;
      for (const s of racer.surges) if (start < s.until) movement += s.rate / HZ;
      if (start < racer.impairUntil) movement *= racer.impairFactor;
      racer.distance += movement;
      racer.baseDistance += base / HZ;
    }

    let cursor = 0;
    record(0);
    for (let step = 1; step <= steps; step++) {
      const start = (step - 1) / HZ, end = step / HZ;
      const segment = Math.min(segmentCount - 1, Math.floor((start + end) / 2 / segmentLength));
      for (const racer of racers) move(racer, start, end, segment);
      currentStep = step; now = end;
      for (const trap of [...traps]) if (trap.victim.distance >= trap.at) { traps.splice(traps.indexOf(trap), 1); slip(trap); }
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
    const publicRacer = racer => ({ id: racer.id, name: racer.name, skill: racer.skill });
    const publicRacers = freeze(racers.map(publicRacer));
    const results = freeze(finalOrder.map(racer => ({ ...publicRacer(racer), rank: finalRanks[racer.id], baseDistance: racer.baseDistance, finalDistance: racer.distance })));
    return Object.freeze({
      version, seed, duration, sprintStart, ...(weather ? { weather } : {}),
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
          const capsized = !!(state & 32), spinning = !!(state & 64);
          return { ...publicRacers[racer.id], rank: finalRanks[racer.id], currentRank: currentRanks[racer.id], progress,
            boosting: !!(state & 1), slowed: !!(state & 2), shielded: !!(state & 4), swapping: !!(state & 8), skillUsed: !!(state & 16),
            stunned: capsized || spinning, pose: capsized ? 'capsized' : spinning ? 'spinning' : null, flying: !!(state & 128) };
        });
      }
    });
  }

  const v3 = Object.freeze({ version: 'chaos-v3', skills, hazards, runeTypes, tuning, weathers,
    createRace: (names, duration, seed) => createRaceFor('chaos-v3', true, names, duration, seed) });
  const api = Object.freeze({ version: VERSION, skills, hazards, runeTypes, tuning, v3,
    createRace: (names, duration, seed) => createRaceFor(VERSION, false, names, duration, seed) });
  root.DuckChaosEngineV2 = api;
  root.DuckChaosEngineV3 = v3;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
