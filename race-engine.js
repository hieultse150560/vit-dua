(function (root) {
  'use strict';

  const UINT32_RANGE = 0x100000000;

  function newSeed() {
    let crypto = root.crypto;
    if (!crypto && typeof require === 'function') crypto = require('node:crypto').webcrypto;
    if (!crypto || !crypto.getRandomValues) throw new Error('Trình duyệt cần hỗ trợ Web Crypto để tạo cuộc đua.');
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }

  // A persisted seed replays the same motion after a reload. It does not select
  // a winning rank: rank is calculated from the integrated speeds and boosts.
  function seededRandom(seed) {
    let state = seed;
    const uint32 = () => {
      state = (state + 0x6D2B79F5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return (value ^ (value >>> 14)) >>> 0;
    };
    return {
      unit: () => uint32() / UINT32_RANGE,
      integer(limit) {
        const ceiling = UINT32_RANGE - UINT32_RANGE % limit;
        let value;
        do { value = uint32(); } while (value >= ceiling);
        return value % limit;
      }
    };
  }

  function shuffle(values, random) {
    for (let i = values.length - 1; i > 0; i--) {
      const j = random.integer(i + 1);
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
  }

  // Integral of a positive, smooth sin² speed pulse. A burst adds real distance
  // and can change the winner, without teleporting or moving a duck backwards.
  function boostDistance(boost, time) {
    if (!boost || time <= boost.start) return 0;
    const span = boost.end - boost.start;
    const elapsed = Math.min(time - boost.start, span);
    return boost.strength * (elapsed / 2 - span * Math.sin(2 * Math.PI * elapsed / span) / (4 * Math.PI));
  }

  function createRace(names, durationSeconds = 25, seed = newSeed()) {
    if (!Array.isArray(names) || names.length < 2 || names.length > 100) {
      throw new RangeError('Mỗi cuộc đua cần từ 2 đến 100 con vịt.');
    }
    if (!Number.isInteger(durationSeconds) || durationSeconds < 10 || durationSeconds > 600) {
      throw new RangeError('Thời gian đua phải là số nguyên từ 10 đến 600 giây.');
    }
    if (!Number.isInteger(seed) || seed < 0 || seed >= UINT32_RANGE) throw new RangeError('Seed phải là số nguyên uint32.');
    const cleanNames = Array.from(names, name => {
      if (typeof name !== 'string' || !name.trim()) throw new TypeError('Tên vịt không được để trống.');
      const clean = name.trim();
      if (Array.from(clean).length > 40) throw new RangeError('Mỗi tên tối đa 40 ký tự.');
      return clean;
    });

    const random = seededRandom(seed);
    const count = cleanNames.length;
    const sprintStart = durationSeconds - 5;
    const segmentCount = Math.min(60, durationSeconds);
    const segmentLength = durationSeconds / segmentCount;
    const tiePriority = [];
    shuffle(Array.from({ length: count }, (_, id) => id), random).forEach((id, position) => { tiePriority[id] = position; });

    const internal = cleanNames.map((name, id) => {
      const speeds = Array.from({ length: segmentCount }, () => 0.65 + random.unit() * 0.70);
      const distances = [0];
      speeds.forEach(speed => distances.push(distances[distances.length - 1] + speed * segmentLength));
      return { id, name, speeds, distances, boost: null, rank: 0 };
    });

    // Every duck has the same chance of receiving a pulse. At least one pulse
    // occurs, and at least one duck stays unboosted, so the sprint is legible.
    const boostCount = 1 + random.integer(Math.min(count - 1, Math.ceil(count * 0.55)));
    const boostedIds = shuffle(Array.from({ length: count }, (_, id) => id), random).slice(0, boostCount);
    const boosts = boostedIds.map(id => {
      const start = sprintStart + random.unit() * 2.6;
      const end = Math.min(durationSeconds, start + 1.1 + random.unit() * 2.3);
      const boost = { id, start, end, strength: 0.8 + random.unit() * 3.7 };
      internal[id].boost = boost;
      return boost;
    });

    const baseDistance = (racer, time) => {
      if (time >= durationSeconds) return racer.distances[segmentCount];
      const index = Math.min(segmentCount - 1, Math.floor(time / segmentLength));
      return racer.distances[index] + racer.speeds[index] * (time - index * segmentLength);
    };
    const distance = (racer, time) => baseDistance(racer, time) + boostDistance(racer.boost, time);
    const compare = (a, b) => b.distance - a.distance || tiePriority[a.id] - tiePriority[b.id];
    const finalOrder = internal.map(racer => ({ id: racer.id, distance: distance(racer, durationSeconds) })).sort(compare);
    finalOrder.forEach((racer, index) => { internal[racer.id].rank = index + 1; });
    const finishDistance = finalOrder[0].distance;
    const publicRacer = racer => ({ id: racer.id, name: racer.name });

    return {
      seed,
      duration: durationSeconds,
      sprintStart,
      racers: internal.map(publicRacer),
      boosts: boosts.map(boost => ({ ...boost })),
      results: finalOrder.map(item => {
        const racer = internal[item.id];
        return { ...publicRacer(racer), rank: racer.rank, baseDistance: baseDistance(racer, durationSeconds), finalDistance: item.distance };
      }),
      sample(elapsedSeconds) {
        if (!Number.isFinite(elapsedSeconds)) throw new TypeError('Thời gian đã chạy phải hữu hạn.');
        const time = Math.max(0, Math.min(durationSeconds, elapsedSeconds));
        const positions = internal.map(racer => ({ id: racer.id, distance: distance(racer, time) }));
        const currentRanks = [];
        [...positions].sort(compare).forEach((racer, index) => { currentRanks[racer.id] = index + 1; });
        return internal.map(racer => {
          let progress = positions[racer.id].distance / finishDistance;
          // Protect the finish boundary from floating-point rounding. A seeded
          // tie-break priority determines a unique winner if distances tie.
          if (time < durationSeconds || racer.rank !== 1) progress = Math.min(progress, 1 - Number.EPSILON * racer.rank);
          return {
            ...publicRacer(racer),
            rank: racer.rank,
            currentRank: currentRanks[racer.id],
            progress,
            boosting: !!racer.boost && time >= racer.boost.start && time < racer.boost.end
          };
        });
      }
    };
  }

  const api = Object.freeze({ createRace });
  root.DuckRaceEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
