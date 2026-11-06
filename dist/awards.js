(function (root) {
  'use strict';
  // End-of-day titles from replayed chaos-v2/v3 races. Pure: rounds in, titles out.
  // rounds: [{ race, ownerOf: { duckId: playerId } }]
  const TITLES = [
    { id: 'comeback', icon: '👑', title: 'Vua lật kèo', detail: v => `vượt ${v} bậc trong 3 giây cuối` },
    { id: 'hitman', icon: '💣', title: 'Sát thủ', detail: v => `ra đòn trúng ${v} lần` },
    { id: 'dodger', icon: '🛡️', title: 'Thánh né đòn', detail: v => `né ${v} đòn` },
    { id: 'unlucky', icon: '😭', title: 'Kẻ xui nhất', detail: v => `dính ${v} đòn` }
  ];
  const SINGLE_HITS = new Set(['torpedo', 'hook', 'banana', 'missile', 'balloon', 'blackhole', 'bomb', 'hex']);
  const DODGES = ['bubble', 'ghost', 'dodge', 'lucky'];
  const HAZARD_HITS = new Set(['rock', 'croc', 'whirlpool', 'hippo', 'log']);
  const movedBack = e => Object.keys(e.before || {}).map(Number).filter(id => e.after?.[id] < e.before[id]);

  // Who suffered, who struck, who dodged in one event (duck ids).
  function tally(e, buoyReactions) {
    const out = { victims: [], strikes: 0, dodgers: [] };
    if (e.type === 'hazard') {
      if (e.outcome === 'hit' && HAZARD_HITS.has(e.hazard)) out.victims.push(e.actorId);
      if (e.outcome === 'blocked' && DODGES.includes(e.guard)) out.dodgers.push(e.actorId);
      return out;
    }
    if (e.type !== 'skill') return out;
    const skill = e.copied || e.skill; // a copycat scores like the move it copied
    if (e.activation && e.skill === 'buoy' && e.outcome === 'blocked') out.dodgers.push(e.actorId);
    if (e.activation && e.skill === 'mirror' && e.outcome === 'reflected') {
      out.dodgers.push(e.actorId);
      if (e.effect === 'hit') { out.victims.push(e.targetId); out.strikes++; }
      return out;
    }
    if (e.outcome === 'blocked' && DODGES.includes(e.guard)) out.dodgers.push(e.targetId ?? e.actorId);
    if (SINGLE_HITS.has(skill) && e.outcome === 'hit') { out.victims.push(e.targetId); if (e.targetId !== e.actorId) out.strikes++; }
    if (skill === 'dice' && e.outcome === 'bust') out.victims.push(e.actorId);
    if (skill === 'mirror' && e.outcome === 'fallback' && e.effect === 'hit') { out.victims.push(e.targetId); out.strikes++; }
    if (skill === 'rocket' && e.outcome === 'exploded') out.victims.push(e.actorId);
    if (e.outcomes) { // wave, lightning, reverse, freeze, bees, ghost: per-duck results
      for (const [id, result] of Object.entries(e.outcomes)) {
        if (result === 'hit') { out.victims.push(Number(id)); out.strikes++; }
        if (result === 'blocked' && !buoyReactions.has(`${e.time}|${id}`)) out.dodgers.push(Number(id));
      }
    }
    if ((['swap', 'flip'].includes(skill) && e.outcome === 'swapped') || (skill === 'tornado' && e.outcome === 'shuffled') || skill === 'rewind') {
      out.victims.push(...movedBack(e));
      if (skill === 'swap' && e.after?.[e.actorId] > e.before?.[e.actorId]) out.strikes++;
    }
    return out;
  }

  function compute(rounds) {
    const score = Object.fromEntries(TITLES.map(t => [t.id, new Map()]));
    const add = (title, player, n = 1) => { if (player !== undefined && n > 0) score[title].set(player, (score[title].get(player) || 0) + n); };
    for (const { race, ownerOf } of rounds) {
      const owner = id => ownerOf[id];
      const late = race.sample(race.duration - 3);
      for (const r of race.results) add('comeback', owner(r.id), late.find(d => d.id === r.id).currentRank - r.rank);
      const buoyReactions = new Set(race.events.filter(e => e.skill === 'buoy' && e.activation && e.outcome === 'blocked').map(e => `${e.time}|${e.actorId}`));
      for (const e of race.events) {
        const t = tally(e, buoyReactions);
        t.victims.forEach(id => add('unlucky', owner(id)));
        t.dodgers.forEach(id => add('dodger', owner(id)));
        add('hitman', owner(e.actorId), t.strikes);
      }
    }
    return TITLES.flatMap(t => {
      const best = Math.max(0, ...score[t.id].values());
      if (!best) return [];
      const playerIds = [...score[t.id]].filter(([, v]) => v === best).map(([p]) => p).sort();
      return [{ id: t.id, icon: t.icon, title: t.title, playerIds, value: best, detail: t.detail(best) }];
    });
  }
  const api = Object.freeze({ compute });
  root.DuckAwards = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
