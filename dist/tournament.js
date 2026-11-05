(function (root) {
  'use strict';

  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const fail = message => { throw new Error(message); };
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

  function identifier(value, label) {
    if (typeof value !== 'string' || !value.trim() || value.length > 128) fail(`${label} không hợp lệ.`);
    return value;
  }

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Ngày thi đấu không hợp lệ.');
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail('Ngày thi đấu không hợp lệ.');
    return value;
  }

  function timestamp(value) {
    if (typeof value !== 'string' || value.length > 64 || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
      fail('Thời điểm hoàn tất không hợp lệ.');
    }
    validDate(value.slice(0, 10));
    return value;
  }

  function newId() {
    let crypto = root.crypto;
    if (!crypto && typeof require === 'function') crypto = require('node:crypto').webcrypto;
    if (crypto?.randomUUID) return crypto.randomUUID();
    if (crypto?.getRandomValues) return Array.from(crypto.getRandomValues(new Uint32Array(4)), x => x.toString(16).padStart(8, '0')).join('');
    fail('Trình duyệt cần hỗ trợ Web Crypto để tạo giải đua.');
  }

  function createSession({ names, date, duration = 25, roundLimit = 10, version = 4 } = {}) {
    if (![2, 3, 4].includes(version)) fail('Phiên bản luật thi đấu không hợp lệ.');
    if (!Array.isArray(names) || names.length < 3 || names.length > 100) fail('Ngày đua cần từ 3 đến 100 người chơi.');
    const normalized = names.map(name => {
      if (typeof name !== 'string' || !name.trim()) fail('Tên người chơi không được để trống.');
      const clean = name.trim().normalize('NFC');
      if (Array.from(clean).length > 40) fail('Mỗi tên tối đa 40 ký tự.');
      return clean;
    });
    if (new Set(normalized.map(name => name.toLocaleLowerCase('vi-VN'))).size !== normalized.length) {
      fail('Tên người chơi không được trùng nhau. Thêm biệt danh để phân biệt.');
    }
    if (!Number.isInteger(duration) || duration < 10 || duration > 600) fail('Thời gian mỗi lượt phải từ 10 đến 600 giây.');
    if (!Number.isInteger(roundLimit) || roundLimit < 1 || roundLimit > 100) fail('Số lượt đua phải từ 1 đến 100.');
    return {
      version,
      id: newId(),
      date: validDate(date),
      players: normalized.map((name, index) => ({ id: `p${index}`, name })),
      duration,
      roundLimit,
      rounds: [],
      tiebreaks: []
    };
  }

  function validatePicks(players, picks) {
    if (!Array.isArray(players) || players.length < 2 || players.length > 100 || new Set(players.map(player => player.id)).size !== players.length) {
      fail('Danh sách người chọn vịt không hợp lệ.');
    }
    if (!object(picks) || Object.keys(picks).length !== players.length) fail('Mỗi người phải chọn đúng một con vịt.');
    const selected = new Set();
    for (const player of players) {
      if (!has(picks, player.id) || !Number.isInteger(picks[player.id]) || picks[player.id] < 0 || picks[player.id] >= players.length) {
        fail('Mỗi người phải chọn đúng một con vịt trong lượt này.');
      }
      if (selected.has(picks[player.id])) fail('Một con vịt chỉ được một người chọn.');
      selected.add(picks[player.id]);
    }
    return true;
  }

  function validateOrder(order, count) {
    if (!Array.isArray(order) || order.length !== count || new Set(order).size !== count || Array.from(order).some(id => !Number.isInteger(id) || id < 0 || id >= count)) {
      fail('Thứ hạng phải chứa đủ các con vịt, mỗi con một lần.');
    }
  }

  function standings(session) {
    const table = session.players.map(player => {
      const pointsByRound = session.rounds.map(round => {
        const entry = round.entries.find(result => result.playerId === player.id);
        if (!entry) fail('Kết quả lượt đua thiếu người chơi.');
        return entry.points;
      });
      return { playerId: player.id, name: player.name, total: pointsByRound.reduce((sum, points) => sum + points, 0), pointsByRound, rank: 0 };
    }).sort((a, b) => b.total - a.total);
    table.forEach((row, index) => { row.rank = index && table[index - 1].total === row.total ? table[index - 1].rank : index + 1; });
    return table;
  }

  // Hope star (version 4): top half doubles the round's points; never subtracts.
  function roundPoints(count, rank, star) {
    return (count - rank + 1) * (star && rank <= Math.floor(count / 2) ? 2 : 1);
  }

  function starAvailable(session, playerId) {
    return session.version === 4 && !session.rounds.some(round => round.entries.some(entry => entry.playerId === playerId && entry.star === true));
  }

  function validateStars(session, stars) {
    if (!Array.isArray(stars) || new Set(stars).size !== stars.length) fail('Danh sách ngôi sao hy vọng không hợp lệ.');
    if (stars.length && session.version !== 4) fail('Ngày đua này không dùng ngôi sao hy vọng.');
    for (const id of stars) {
      if (!session.players.some(player => player.id === id)) fail('Ngôi sao hy vọng phải thuộc một người chơi.');
      if (!starAvailable(session, id)) fail('Mỗi người chỉ được dùng một ngôi sao hy vọng mỗi ngày.');
    }
    return new Set(stars);
  }

  function resultEntries(players, picks, order, awardPoints, stars = new Set()) {
    validatePicks(players, picks);
    validateOrder(order, players.length);
    const owners = new Map(players.map(player => [picks[player.id], player.id]));
    return order.map((duckId, index) => {
      const playerId = owners.get(duckId), star = stars.has(playerId);
      return {
        playerId,
        duckId,
        rank: index + 1,
        ...(awardPoints ? { points: roundPoints(players.length, index + 1, star) } : {}),
        ...(star ? { star: true } : {})
      };
    });
  }

  function recordRound(session, { id, picks, order, completedAt, stars = [] } = {}) {
    identifier(id, 'Mã lượt đua');
    if (session.rounds.some(round => round.id === id)) return session;
    if (session.tiebreaks.some(round => round.id === id)) fail('Mã lượt đua đã được sử dụng.');
    if (session.rounds.length >= session.roundLimit) fail('Đã hoàn tất số lượt của giải đua.');
    const entries = resultEntries(session.players, picks, order, true, validateStars(session, stars));
    const round = { id, number: session.rounds.length + 1, entries, completedAt: timestamp(completedAt) };
    return { ...session, rounds: [...session.rounds, round] };
  }

  function legacyCoffeeStatus(session) {
    if (session.rounds.length < session.roundLimit) return { status: 'pending', coffeeIds: [], tiedIds: [], slots: 2 };
    const ascending = standings(session).sort((a, b) => a.total - b.total);
    const cutoff = ascending[1].total;
    const fixed = ascending.filter(player => player.total < cutoff).map(player => player.playerId);
    const tied = ascending.filter(player => player.total === cutoff).map(player => player.playerId);
    const slots = 2 - fixed.length;
    if (tied.length === slots) return { status: 'resolved', coffeeIds: [...fixed, ...tied], tiedIds: [], slots: 0 };
    if (session.tiebreaks.length) {
      const entries = session.tiebreaks[session.tiebreaks.length - 1].entries;
      const selected = [...entries].sort((a, b) => b.rank - a.rank).slice(0, slots).map(entry => entry.playerId);
      return { status: 'resolved', coffeeIds: [...fixed, ...selected], tiedIds: [], slots: 0 };
    }
    return { status: 'tie', coffeeIds: fixed, tiedIds: tied, slots };
  }

  function coffeeStatus(session) {
    // Preserve the old equal-coffee rule for saved version-2 games. Do not
    // retroactively assign cash amounts or require another tiebreak there.
    if (session.version === 2) return legacyCoffeeStatus(session);
    const result = (status, coffeeIds, tiedIds = [], slots = 0) => ({
      status, coffeeIds, tiedIds, slots,
      contributions: coffeeIds.map((playerId, index) => ({
        playerId,
        amount: index === 0 ? 60000 : 40000,
        position: index === 0 ? 'last' : 'penultimate'
      }))
    });
    if (session.rounds.length < session.roundLimit) return result('pending', [], [], 2);
    const ascending = standings(session).sort((a, b) => a.total - b.total);
    const bottomGroup = ascending.filter(row => row.total === ascending[0].total).map(row => row.playerId);
    // Tied last two still need a race: their contributions now differ.
    const fixed = bottomGroup.length === 1 ? bottomGroup : [];
    const tied = fixed.length
      ? ascending.filter(row => row.total === ascending[1].total).map(row => row.playerId)
      : bottomGroup;
    const slots = 2 - fixed.length;
    if (fixed.length && tied.length === 1) return result('resolved', [...fixed, ...tied]);
    if (session.tiebreaks.length) {
      const finalEntries = session.tiebreaks[session.tiebreaks.length - 1].entries;
      const selected = [...finalEntries].sort((a, b) => b.rank - a.rank).slice(0, slots).map(row => row.playerId);
      return result('resolved', [...fixed, ...selected]);
    }
    return result('tie', fixed, tied, slots);
  }

  function selectionOrder(session, type = 'regular') {
    if (!['regular', 'tie'].includes(type)) fail('Loại lượt chọn vịt không hợp lệ.');
    const previous = session.rounds[session.rounds.length - 1];
    const order = previous
      ? [...previous.entries].sort((a, b) => b.rank - a.rank).map(row => row.playerId)
      : session.players.map(player => player.id);
    if (type === 'regular') return order;
    const status = coffeeStatus(session);
    const ids = status.status === 'tie'
      ? status.tiedIds
      : (session.tiebreaks[session.tiebreaks.length - 1]?.entries.map(row => row.playerId) || []);
    if (ids.length < 2) fail('Không có nhóm đồng điểm cần chọn vịt.');
    return order.filter(id => ids.includes(id));
  }

  function selectionState(session, type = 'regular', picks = {}) {
    if (!object(picks)) fail('Lựa chọn vịt không hợp lệ.');
    const order = selectionOrder(session, type), keys = Object.keys(picks), ids = new Set(order), ducks = new Set();
    for (const id of keys) {
      const duck = picks[id];
      if (!ids.has(id) || !Number.isInteger(duck) || duck < 0 || duck >= order.length || ducks.has(duck)) {
        fail('Mỗi người chỉ được chọn một vịt còn trống trong lượt này.');
      }
      ducks.add(duck);
    }
    if (session.version !== 2 && order.slice(0, keys.length).some(id => !has(picks, id))) {
      fail('Phải chọn theo thứ tự: vị trí thấp ở vòng trước chọn trước.');
    }
    return { order, nextPlayerId: order.find(id => !has(picks, id)) || null, chosenCount: keys.length };
  }

  function recordTiebreak(session, { id, picks, order, completedAt } = {}) {
    identifier(id, 'Mã lượt phân định');
    if (session.tiebreaks.some(round => round.id === id)) return session;
    if (session.rounds.some(round => round.id === id)) fail('Mã lượt phân định đã được sử dụng.');
    const status = coffeeStatus(session);
    if (status.status !== 'tie') fail('Giải đua không cần lượt phân định.');
    const players = session.players.filter(player => status.tiedIds.includes(player.id));
    const entries = resultEntries(players, picks, order, false);
    const round = { id, number: session.tiebreaks.length + 1, entries, completedAt: timestamp(completedAt) };
    return { ...session, tiebreaks: [...session.tiebreaks, round] };
  }

  function decodeRecord(record, players, awardPoints, expectedNumber, version) {
    if (!object(record) || record.number !== expectedNumber || !Array.isArray(record.entries) || record.entries.length !== players.length) {
      fail('Dữ liệu lượt đua đã lưu không hợp lệ.');
    }
    const playerIds = new Set(players.map(player => player.id));
    const seen = new Set();
    const picks = Object.create(null), order = new Array(players.length);
    for (const entry of record.entries) {
      if (!object(entry) || !playerIds.has(entry.playerId) || seen.has(entry.playerId) || !Number.isInteger(entry.rank) || entry.rank < 1 || entry.rank > players.length || has(order, entry.rank - 1)) {
        fail('Dữ liệu thứ hạng đã lưu không hợp lệ.');
      }
      if (has(entry, 'star') && (entry.star !== true || !awardPoints || version !== 4)) fail('Dữ liệu ngôi sao hy vọng đã lưu không hợp lệ.');
      if (awardPoints ? entry.points !== roundPoints(players.length, entry.rank, entry.star === true) : has(entry, 'points')) fail('Dữ liệu điểm đã lưu không khớp thứ hạng.');
      seen.add(entry.playerId);
      picks[entry.playerId] = entry.duckId;
      order[entry.rank - 1] = entry.duckId;
    }
    const stars = record.entries.filter(entry => entry.star === true).map(entry => entry.playerId);
    return { id: identifier(record.id, 'Mã lượt đua'), picks, order, completedAt: timestamp(record.completedAt), stars };
  }

  function validateSession(data) {
    if (!object(data) || ![2, 3, 4].includes(data.version) || !Array.isArray(data.players) || data.players.length < 3 || data.players.length > 100 || !Array.isArray(data.rounds) || !Array.isArray(data.tiebreaks) || !has(data, 'duration') || !has(data, 'roundLimit')) {
      fail('Dữ liệu giải đua đã lưu không hợp lệ.');
    }
    if (data.players.some((player, index) => !object(player) || player.id !== `p${index}`)) fail('Danh sách người chơi đã lưu không hợp lệ.');
    let rebuilt = createSession({ names: data.players.map(player => player.name), date: data.date, duration: data.duration, roundLimit: data.roundLimit, version: data.version });
    rebuilt.id = identifier(data.id, 'Mã giải đua');
    if (data.players.some((player, index) => player.name !== rebuilt.players[index].name)) fail('Tên người chơi đã lưu không hợp lệ.');
    if (data.rounds.length > rebuilt.roundLimit || data.tiebreaks.length > 1) fail('Số lượt đã lưu không hợp lệ.');
    const ids = new Set();
    for (let index = 0; index < data.rounds.length; index++) {
      const input = decodeRecord(data.rounds[index], rebuilt.players, true, index + 1, data.version);
      if (ids.has(input.id)) fail('Dữ liệu đã lưu bị trùng lượt đua.');
      ids.add(input.id);
      rebuilt = recordRound(rebuilt, input);
    }
    for (let index = 0; index < data.tiebreaks.length; index++) {
      const status = coffeeStatus(rebuilt);
      if (status.status !== 'tie') fail('Dữ liệu phân định đã lưu không hợp lệ.');
      const players = rebuilt.players.filter(player => status.tiedIds.includes(player.id));
      const { stars, ...input } = decodeRecord(data.tiebreaks[index], players, false, index + 1, data.version);
      if (ids.has(input.id)) fail('Dữ liệu đã lưu bị trùng lượt đua.');
      ids.add(input.id);
      rebuilt = recordTiebreak(rebuilt, input);
    }
    return rebuilt;
  }

  const api = Object.freeze({ createSession, validatePicks, standings, recordRound, coffeeStatus, recordTiebreak, validateSession, selectionOrder, selectionState, starAvailable });
  root.DuckTournament = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
