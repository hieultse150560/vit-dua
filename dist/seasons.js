(function (root) {
  'use strict';

  const T = root.DuckTournament || (typeof require === 'function' ? require('./tournament.js') : null);
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const fail = message => { throw new Error(message); };

  function identifier(value, label) {
    if (typeof value !== 'string' || !value.trim() || value.length > 128) fail(`${label} không hợp lệ.`);
    return value;
  }

  function seasonName(value, date) {
    if (value === undefined || value === null || value === '') return `Mùa giải ${date.split('-').reverse().join('/')}`;
    if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > 80) fail('Tên mùa giải cần từ 1 đến 80 ký tự.');
    return value.trim().normalize('NFC');
  }

  function timestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
      fail('Thời điểm chốt mùa không hợp lệ.');
    }
    // Date.parse normalizes invalid calendar dates; reject those explicitly.
    const date = value.slice(0, 10);
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) fail('Thời điểm chốt mùa không hợp lệ.');
    return value;
  }

  function createSeason({ name, names, date } = {}) {
    const setup = T.createSession({ names, date, version: 3 });
    return {
      version: 1,
      id: setup.id,
      name: seasonName(name, setup.date),
      startedOn: setup.date,
      closedAt: null,
      players: setup.players.map(player => ({ ...player })),
      receipts: {}
    };
  }

  function baseSeason(raw) {
    if (!isObject(raw) || raw.version !== 1 || !Array.isArray(raw.players) || !isObject(raw.receipts)) fail('Dữ liệu mùa giải không hợp lệ.');
    if (raw.players.some((player, index) => !isObject(player) || player.id !== `p${index}`)) fail('Danh sách người chơi của mùa không hợp lệ.');
    const clean = createSeason({ name: raw.name, names: raw.players.map(player => player.name), date: raw.startedOn });
    clean.id = identifier(raw.id, 'Mã mùa giải');
    if (raw.name !== clean.name || raw.players.some((player, index) => player.name !== clean.players[index].name)) fail('Tên trong mùa giải đã lưu không hợp lệ.');
    if (raw.closedAt !== null) clean.closedAt = timestamp(raw.closedAt);
    return clean;
  }

  function prepare(raw, sessions) {
    const season = baseSeason(raw);
    if (!Array.isArray(sessions)) fail('Danh sách ngày thi đấu không hợp lệ.');
    const dates = new Set(), ids = new Set();
    const days = sessions.map(value => {
      if (!isObject(value) || ![3, 4].includes(value.version)) fail('Mùa giải chỉ nhận ngày thi đấu theo luật quỹ mùa giải.');
      const session = T.validateSession(value);
      if (ids.has(session.id) || dates.has(session.date)) fail('Một ngày thi đấu chỉ được ghi một lần trong mùa giải.');
      ids.add(session.id); dates.add(session.date);
      if (session.date < season.startedOn) fail('Ngày thi đấu không thể trước ngày bắt đầu mùa.');
      if (session.players.length !== season.players.length || session.players.some((player, index) => player.id !== season.players[index].id || player.name !== season.players[index].name)) {
        fail('Danh sách người chơi phải giữ nguyên trong một mùa giải.');
      }
      return { session, outcome: T.coffeeStatus(session) };
    }).sort((a, b) => a.session.date.localeCompare(b.session.date));

    const incomplete = days.filter(day => day.outcome.status !== 'resolved');
    if (incomplete.length > 1 || incomplete.length && incomplete[0] !== days[days.length - 1]) fail('Hãy hoàn tất ngày đang chơi trước khi tạo ngày tiếp theo.');
    if (season.closedAt && (!days.length || incomplete.length)) fail('Mùa đã chốt không được có ngày chưa hoàn tất.');

    const items = [];
    for (const { session, outcome } of days) {
      if (outcome.status !== 'resolved') continue;
      const entries = outcome.contributions;
      if (!Array.isArray(entries) || entries.length !== 2 || new Set(entries.map(entry => entry.playerId)).size !== 2 || new Set(entries.map(entry => entry.position)).size !== 2) {
        fail('Kết quả đóng quỹ của ngày không hợp lệ.');
      }
      for (const entry of [...entries].sort((a, b) => (a.position === 'last' ? 0 : 1) - (b.position === 'last' ? 0 : 1))) {
        const player = season.players.find(person => person.id === entry.playerId);
        const expected = entry.position === 'last' ? 60000 : entry.position === 'penultimate' ? 40000 : null;
        if (!player || expected === null || entry.amount !== expected) fail('Mức đóng quỹ của ngày không khớp luật 60.000đ / 40.000đ.');
        items.push({ key: `${session.id}:${player.id}`, sessionId: session.id, date: session.date, playerId: player.id, name: player.name, position: entry.position, amount: entry.amount, paid: false });
      }
    }
    const keys = new Set(items.map(item => item.key));
    const receipts = [];
    for (const [key, paid] of Object.entries(raw.receipts)) {
      if (paid !== true || !keys.has(key)) fail('Khoản đã thu không khớp kết quả ngày thi đấu.');
      receipts.push([key, true]);
    }
    season.receipts = Object.fromEntries(receipts);
    items.forEach(item => { item.paid = season.receipts[item.key] === true; });
    return { season, days, items };
  }

  function validateSeason(raw, sessions = []) {
    return prepare(raw, sessions).season;
  }

  function summary(raw, sessions = []) {
    const { season, days, items } = prepare(raw, sessions);
    const daysComplete = days.filter(day => day.outcome.status === 'resolved').length;
    const rows = season.players.map(player => {
      const contributions = items.filter(item => item.playerId === player.id);
      const assessed = contributions.reduce((total, item) => total + item.amount, 0);
      const paid = contributions.reduce((total, item) => total + (item.paid ? item.amount : 0), 0);
      return {
        playerId: player.id, name: player.name, daysPlayed: daysComplete,
        lastCount: contributions.filter(item => item.position === 'last').length,
        penultimateCount: contributions.filter(item => item.position === 'penultimate').length,
        assessed, paid, outstanding: assessed - paid
      };
    });
    const assessed = rows.reduce((total, row) => total + row.assessed, 0);
    const paid = rows.reduce((total, row) => total + row.paid, 0);
    return { rows, assessed, paid, outstanding: assessed - paid, daysComplete, items };
  }

  function markPaid(raw, sessions, key, paid) {
    if (typeof paid !== 'boolean') fail('Trạng thái đã thu phải là đúng hoặc sai.');
    const { season, items } = prepare(raw, sessions);
    if (typeof key !== 'string' || !items.some(item => item.key === key)) fail('Không tìm thấy khoản đóng quỹ cần cập nhật.');
    const receipts = { ...season.receipts };
    if (paid) receipts[key] = true; else delete receipts[key];
    return { ...season, receipts };
  }

  function closeSeason(raw, sessions, closedAt = new Date().toISOString()) {
    const { season, days } = prepare(raw, sessions);
    if (season.closedAt) return season;
    if (!days.length || days.some(day => day.outcome.status !== 'resolved')) fail('Cần hoàn tất các ngày thi đấu trước khi chốt mùa.');
    return { ...season, closedAt: timestamp(closedAt) };
  }

  const api = Object.freeze({ createSeason, validateSeason, summary, markPaid, closeSeason });
  root.DuckSeasons = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
