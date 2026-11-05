(function (root) {
  'use strict';

  // Versioned replay contract. Do not retune this implementation in place:
  // persisted active races must retain the same timeline after a reload.
  const VERSION = 'chaos-v1';
  const UINT32 = 0x100000000;
  const HZ = 20;
  const freeze = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };
  const talents = freeze([
    { id: 'steady', name: 'Đều chân', icon: '👟', description: '+2% tốc độ cơ bản cả trận.' },
    { id: 'rune', name: 'Hợp rune', icon: '💎', description: '+1,5% tốc độ cơ bản. Rune tăng tốc kéo dài thêm 30%; xỉn từ rune ngắn hơn 30%.' },
    { id: 'catch', name: 'Không bỏ cuộc', icon: '🔥', description: '+5% tốc độ cơ bản khi thuộc nhóm cuối (3 vị trí cuối nếu có 7 vịt).' },
    { id: 'anchor', name: 'Mỏ neo', icon: '⚓', description: '+1,5% tốc độ cơ bản. 50% cơ hội kháng swap khiến mình tụt lại, kể cả tự swap.' },
    { id: 'early', name: 'Đề-pa', icon: '🏁', description: '+10% tốc độ cơ bản trong 5 giây đầu.' },
    { id: 'tough', name: 'Lì đòn', icon: '🦺', description: '+1,5% tốc độ cơ bản. Giảm 40% thời gian bị làm chậm.' },
    { id: 'late', name: 'Nước rút', icon: '⚡', description: '+10% tốc độ cơ bản trong 5 giây cuối.' }
  ]);
  const skills = freeze([
    { id: 'turbo', name: 'Chân vịt phản lực', icon: '🚀', description: '+70% tốc độ cơ bản trong 1,5 giây.' },
    { id: 'bomb', name: 'Bom xỉn', icon: '💣', description: 'Ném một đối thủ ngẫu nhiên, làm chậm 40% trong 1,5 giây.' },
    { id: 'shield', name: 'Phao hộ mệnh', icon: '🛟', description: 'Chặn một lần trúng đòn hoặc swap khiến mình tụt lại.' },
    { id: 'swap', name: 'Đổi đời', icon: '🔄', description: 'Còn 2 giây: đổi vị trí với một đối thủ ngẫu nhiên. Có thể tự đổi xuống chót!' }
  ]);
  const runeTypes = freeze([
    { id: 'speed', icon: '⚡', name: 'Nước tăng lực' },
    { id: 'bubble', icon: '🫧', name: 'Bong bóng bảo vệ' },
    { id: 'mystery', icon: '🎁', name: 'Hộp hên xui' }
  ]);

  function talentFor(id) {
    if (!Number.isInteger(id) || id < 0) throw new RangeError('Mã vịt phải là số nguyên không âm.');
    return talents[id % talents.length];
  }
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

  function createRace(names, durationSeconds = 25, seed = newSeed()) {
    if (!Array.isArray(names) || names.length < 2 || names.length > 100) throw new RangeError('Mỗi cuộc đua cần từ 2 đến 100 con vịt.');
    if (!Number.isInteger(durationSeconds) || durationSeconds < 10 || durationSeconds > 600) throw new RangeError('Thời gian đua phải từ 10 đến 600 giây nguyên.');
    if (!Number.isInteger(seed) || seed < 0 || seed >= UINT32) throw new RangeError('Seed phải là số nguyên uint32.');
    const cleanNames = Array.from(names, name => {
      if (typeof name !== 'string' || !name.trim()) throw new TypeError('Tên vịt không được để trống.');
      if (Array.from(name.trim()).length > 40) throw new RangeError('Tên vịt tối đa 40 ký tự.');
      return name.trim();
    });
    const count = cleanNames.length;
    const ids = Array.from({ length: count }, (_, id) => id);
    const motionRng = randomFor(seed, 0x4d4f544e);
    const skillRng = randomFor(seed, 0x534b494c);
    const runeRng = randomFor(seed, 0x52554e45);
    const defenseRng = randomFor(seed, 0x4445464e);
    const sprintStart = durationSeconds - 5;
    const steps = durationSeconds * HZ;
    const segmentCount = Math.min(60, durationSeconds);
    const segmentLength = durationSeconds / segmentCount;
    const bottomCount = Math.max(1, Math.ceil(count * 3 / 7));
    const tick = time => Math.min(steps, Math.max(0, Math.round(time * HZ)));
    const tiePriority = [];
    shuffled(ids, motionRng).forEach((id, index) => { tiePriority[id] = index; });
    const compare = (a, b) => b.distance - a.distance || tiePriority[a.id] - tiePriority[b.id];
    const racers = ids.map(id => ({
      id, name: cleanNames[id], talent: talentFor(id), skill: null,
      speeds: Array.from({ length: segmentCount }, () => 0.65 + motionRng.unit() * 0.70),
      distance: 0, baseDistance: 0, boost: null, turboUntil: 0, runeUntil: 0,
      slowUntil: 0, immuneUntil: 0, shield: false, swapUntil: 0, skillUsed: false
    }));
    const boostCount = 1 + motionRng.integer(Math.min(count - 1, Math.ceil(count * 0.55)));
    const boosts = shuffled(ids, motionRng).slice(0, boostCount).map(id => {
      const start = sprintStart + motionRng.unit() * 2.6;
      const end = Math.min(durationSeconds, start + 1.1 + motionRng.unit() * 2.3);
      const boost = { id, start, end, strength: 0.8 + motionRng.unit() * 3.7 };
      racers[id].boost = boost;
      return boost;
    });
    const schedule = [];
    const events = [];
    let eventId = 0;
    const emit = event => { const result = { id: `event-${++eventId}`, ...event }; events.push(result); return result; };
    const other = (id, rng) => { const n = rng.integer(count - 1); return n >= id ? n + 1 : n; };
    const skillOrder = shuffled(ids, skillRng);
    const swapId = skillRng.unit() < 0.25 ? skillRng.integer(count) : -1;
    skillOrder.forEach((id, index) => {
      const skill = id === swapId ? skills[3] : skills[skillRng.integer(3)];
      racers[id].skill = skill;
      const fraction = (index + 0.15 + skillRng.unit() * 0.7) / count;
      const at = skill.id === 'swap' ? durationSeconds - 2 : 3 + fraction * (durationSeconds - 6);
      schedule.push({ tick: tick(at), kind: 'skill', actorId: id, targetId: other(id, skillRng), resistRoll: defenseRng.unit() });
    });
    // Rune ownership is independent of current rank; a leader never automatically
    // collects every item. The future pickup position is attached after simulation.
    const runeCount = Math.max(3, Math.ceil(count / 3));
    for (let i = 0; i < runeCount; i++) {
      const actorId = runeRng.integer(count), rune = runeTypes[runeRng.integer(runeTypes.length)];
      const spawnTick = tick(durationSeconds * (0.20 + 0.55 * ((i + 0.2 + runeRng.unit() * 0.6) / runeCount)));
      const pickupTick = Math.min(steps - HZ, spawnTick + 15);
      const runeId = `rune-${i + 1}`;
      const runeData = { actorId, rune, runeId, pickupTick, good: runeRng.unit() < 0.5 };
      schedule.push({ ...runeData, tick: spawnTick, kind: 'rune-spawn' });
      schedule.push({ ...runeData, tick: pickupTick, kind: 'rune-pickup' });
    }
    const priority = { 'rune-spawn': 0, skill: 1, 'rune-pickup': 2 };
    schedule.sort((a, b) => a.tick - b.tick || priority[a.kind] - priority[b.kind] || a.actorId - b.actorId);

    const distances = new Float64Array((steps + 1) * count);
    const flags = new Uint8Array((steps + 1) * count);
    const beforeSwaps = new Map();
    const ranks = new Uint16Array(count);
    const setRanks = () => [...racers].sort(compare).forEach((r, index) => { ranks[r.id] = index + 1; });
    function record(step) {
      const time = step / HZ;
      racers.forEach(r => {
        const index = step * count + r.id;
        distances[index] = r.distance;
        flags[index] = (time < r.turboUntil || time < r.runeUntil || (r.boost && time >= r.boost.start && time < r.boost.end) ? 1 : 0)
          | (time < r.slowUntil ? 2 : 0) | (r.shield ? 4 : 0) | (time < r.swapUntil ? 8 : 0) | (r.skillUsed ? 16 : 0);
      });
    }
    function slow(racer, time, source) {
      if (time < racer.slowUntil || time < racer.immuneUntil) return { outcome: 'immune', label: 'Đang được bảo vệ khỏi chậm chồng', icon: '🦺' };
      if (racer.shield) { racer.shield = false; return { outcome: 'shielded', label: 'Phao hộ mệnh chặn đòn', icon: '🛟' }; }
      let duration = 1.5;
      if (racer.talent.id === 'tough') duration *= 0.6;
      if (source === 'rune' && racer.talent.id === 'rune') duration *= 0.7;
      // Effects expire on the same fixed clock used to integrate their velocity.
      racer.slowUntil = tick(time + duration) / HZ;
      racer.immuneUntil = tick(racer.slowUntil + 1) / HZ;
      return { outcome: 'slowed', label: 'Xỉn rồi! Chậm 40%', icon: '💫', duration: racer.slowUntil - time };
    }
    function apply(item) {
      const time = item.tick / HZ;
      const actor = racers[item.actorId];
      if (item.kind === 'rune-spawn') {
        emit({ time, type: 'rune-spawn', actorId: actor.id, runeId: item.runeId, rune: item.rune.id, icon: item.rune.icon, label: `${item.rune.name} xuất hiện`, pickupTime: item.pickupTick / HZ });
        return;
      }
      if (item.kind === 'rune-pickup') {
        let effect;
        if (item.rune.id === 'bubble') {
          actor.shield = true;
          effect = { outcome: 'shield', icon: '🫧', label: 'Nhặt bong bóng bảo vệ' };
        } else if (item.rune.id === 'speed' || item.good) {
          const duration = actor.talent.id === 'rune' ? 1.95 : 1.5;
          actor.runeUntil = Math.max(actor.runeUntil, tick(time + duration) / HZ);
          effect = { outcome: 'boost', icon: '⚡', label: 'Nhặt rune tăng tốc 40%', duration };
        } else {
          effect = slow(actor, time, 'rune');
          effect.label = effect.outcome === 'slowed' ? 'Hộp hên xui: trúng xỉn!' : `Hộp hên xui: ${effect.label}`;
        }
        emit({ time, type: 'rune-pickup', actorId: actor.id, runeId: item.runeId, rune: item.rune.id, ...effect });
        return;
      }
      actor.skillUsed = true;
      const skill = actor.skill;
      if (skill.id === 'turbo') {
        actor.turboUntil = tick(time + 1.5) / HZ;
        emit({ time, type: 'skill', actorId: actor.id, skill: skill.id, label: 'Chân vịt phản lực! +70% trong 1,5 giây', icon: skill.icon, outcome: 'boost', duration: 1.5 });
      } else if (skill.id === 'shield') {
        actor.shield = true;
        emit({ time, type: 'skill', actorId: actor.id, skill: skill.id, label: 'Phao hộ mệnh sẵn sàng', icon: skill.icon, outcome: 'shield' });
      } else if (skill.id === 'bomb') {
        const effect = slow(racers[item.targetId], time, 'skill');
        emit({ time, type: 'skill', actorId: actor.id, targetId: item.targetId, skill: skill.id, ...effect, label: `Bom xỉn: ${effect.label}` });
      } else {
        const target = racers[item.targetId];
        const harmed = actor.distance > target.distance ? actor : target.distance > actor.distance ? target : null;
        let outcome = 'swapped', label = 'ĐỔI ĐỜI! Hai vịt đổi vị trí';
        if (harmed && harmed.shield) {
          harmed.shield = false; outcome = 'shielded'; label = 'Phao hộ mệnh chặn swap';
        } else if (harmed && harmed.talent.id === 'anchor' && item.resistRoll < 0.5) {
          outcome = 'resisted'; label = 'Mỏ neo kháng swap! Cả hai giữ vị trí';
        }
        const before = [actor.distance, target.distance];
        if (outcome === 'swapped') {
          beforeSwaps.set(item.tick, new Map([[actor.id, actor.distance], [target.id, target.distance]]));
          [actor.distance, target.distance] = [target.distance, actor.distance];
          actor.swapUntil = target.swapUntil = tick(time + 0.7) / HZ;
        }
        emit({ time, type: 'skill', actorId: actor.id, targetId: target.id, skill: skill.id, outcome, label, icon: outcome === 'resisted' ? '⚓' : outcome === 'shielded' ? '🛟' : skill.icon, harmedId: harmed?.id ?? null, before, after: [actor.distance, target.distance] });
      }
    }
    let cursor = 0;
    setRanks(); record(0);
    for (let step = 1; step <= steps; step++) {
      const start = (step - 1) / HZ, end = step / HZ;
      const segment = Math.min(segmentCount - 1, Math.floor((start + end) / 2 / segmentLength));
      for (const racer of racers) {
        const base = racer.speeds[segment];
        let talentBonus = 0;
        switch (racer.talent.id) {
          case 'steady': talentBonus = 0.02; break;
          case 'rune': case 'tough': talentBonus = 0.015; break;
          case 'anchor': talentBonus = 0.015; break;
          case 'catch': talentBonus = ranks[racer.id] > count - bottomCount ? 0.05 : 0; break;
          case 'early': talentBonus = start < 5 ? 0.10 : 0; break;
          case 'late': talentBonus = start >= sprintStart ? 0.10 : 0; break;
        }
        const extra = (start < racer.turboUntil ? 0.7 : 0) + (start < racer.runeUntil ? 0.4 : 0);
        const pulse = pulseIntegral(racer.boost, end) - pulseIntegral(racer.boost, start);
        const movement = base / HZ * (1 + talentBonus + extra) + pulse;
        racer.distance += movement * (start < racer.slowUntil ? 0.6 : 1);
        racer.baseDistance += base / HZ;
      }
      while (cursor < schedule.length && schedule[cursor].tick === step) apply(schedule[cursor++]);
      setRanks(); record(step);
    }
    const finalOrder = [...racers].sort(compare);
    const finalRanks = [];
    finalOrder.forEach((r, index) => { finalRanks[r.id] = index + 1; });
    const finishDistance = finalOrder[0].distance;
    events.forEach(event => {
      if (event.type === 'rune-spawn') event.progress = distances[tick(event.pickupTime) * count + event.actorId] / finishDistance;
    });
    const publicRacer = racer => ({ id: racer.id, name: racer.name, talent: racer.talent, skill: racer.skill });
    const publicRacers = freeze(racers.map(publicRacer));
    const results = freeze(finalOrder.map(racer => ({ ...publicRacer(racer), rank: finalRanks[racer.id], baseDistance: racer.baseDistance, finalDistance: racer.distance })));
    return Object.freeze({
      version: VERSION, seed, duration: durationSeconds, sprintStart,
      racers: publicRacers, results, boosts: freeze(boosts.map(b => ({ ...b }))), events: freeze(events),
      sample(elapsedSeconds) {
        if (!Number.isFinite(elapsedSeconds)) throw new TypeError('Thời gian đã chạy phải hữu hạn.');
        const time = Math.max(0, Math.min(durationSeconds, elapsedSeconds));
        const preciseStep = time * HZ;
        const left = Math.min(steps, Math.floor(preciseStep + 1e-9));
        const right = Math.min(steps, left + 1);
        const fraction = Math.max(0, preciseStep - left);
        const jump = beforeSwaps.get(right);
        const positions = racers.map(racer => {
          const first = distances[left * count + racer.id];
          // A swap is instantaneous at its event time, not a backwards glide
          // beginning one frame before the visible event notification.
          const second = jump?.has(racer.id) ? jump.get(racer.id) : distances[right * count + racer.id];
          return { id: racer.id, distance: first + (second - first) * fraction };
        });
        const currentRanks = [];
        [...positions].sort(compare).forEach((racer, index) => { currentRanks[racer.id] = index + 1; });
        return racers.map(racer => {
          const state = flags[left * count + racer.id];
          let progress = positions[racer.id].distance / finishDistance;
          if (time < durationSeconds || finalRanks[racer.id] !== 1) progress = Math.min(progress, 1 - Number.EPSILON * finalRanks[racer.id]);
          return { ...publicRacers[racer.id], rank: finalRanks[racer.id], currentRank: currentRanks[racer.id], progress,
            boosting: !!(state & 1), slowed: !!(state & 2), shielded: !!(state & 4), swapping: !!(state & 8), skillUsed: !!(state & 16) };
        });
      }
    });
  }
  const api = Object.freeze({ version: VERSION, talents, skills, runeTypes, talentFor, createRace });
  root.DuckChaosEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
