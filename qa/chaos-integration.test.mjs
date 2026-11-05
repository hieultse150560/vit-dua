import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadGame } from './harness.mjs';

const require = createRequire(import.meta.url);
const T = require('../dist/tournament.js');
const S = require('../dist/seasons.js');
const Legacy = require('../dist/race-engine.js');
const A = require('../dist/duck-art.js');
const KEY = 'vit-dua-seasons-v3';
const OLD_KEY = 'vit-dua-club-v2';
const names = ['Phú', 'Hiếu', 'An', 'Bình', 'Chi', 'Dũng', 'Lan'];
const plain = value => JSON.parse(JSON.stringify(value));
const state = game => JSON.parse(game.storage()[KEY]);
const current = game => { const s = state(game); return s.sessions.find(e => e.session.id === s.currentId); };
const noErrors = game => assert.deepEqual(game.errors.map(String), []);

function setup(game, rounds = 10) {
  game.fill('setup-season-name', 'Mùa thiên phú');
  game.fill('setup-names', names.join('\n'));
  game.fill('setup-date', '2026-11-04');
  game.fill('setup-rounds', String(rounds));
  game.fill('setup-duration', '25');
  game.$('setup-form').dispatchEvent(new game.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(game.$('setup-error').textContent, '');
  assert.equal(game.$('setup-dialog').open, false);
}

function chooseAll(game) {
  const e = current(game);
  for (const id of T.selectionOrder(e.session, e.type)) {
    if (current(game).picks[id] !== undefined) continue;
    const selected = game.window.document.querySelector('#players .selected');
    assert.equal(selected?.dataset.playerId, id);
    const card = [...game.$('duck-grid').querySelectorAll('button')].find(b => !b.disabled);
    assert.ok(card);
    card.click();
  }
  assert.equal(game.$('start').disabled, false);
}

// Slow-motion twists stretch a 25 s race in real time; 60 s always covers it.
function runRound(game) { game.click('start'); game.advance(60000, 50); }
function activeFixture({ version = 3, engine, elapsed = 8, seed = 24680, roundLimit = 2 } = {}) {
  const session = T.createSession({ version, names, date: '2026-11-04', duration: 25, roundLimit });
  const season = version === 3 ? S.createSeason({ name: 'Trận đang dở', names, date: session.date }) : null;
  const envelope = {
    seasonId: season?.id ?? null, session, type: 'regular', stage: 'picking',
    picks: Object.fromEntries(session.players.map((p, i) => [p.id, i])),
    active: { id: `active-${version}`, seed, elapsed, countdownLeft: 0, ...(engine ? { engine } : {}) }
  };
  return { version: 3, currentId: session.id, currentSeasonId: season?.id ?? null, seasons: season ? [season] : [], sessions: [envelope] };
}

test('duck cards only promise a secret skill; skill assignments appear only after all choices are locked', async () => {
  const game = loadGame(); let restored;
  try {
    setup(game);
    const cards = [...game.$('duck-grid').querySelectorAll('button')];
    assert.equal(cards.length, 7);
    for (let id = 0; id < cards.length; id++) {
      assert.ok(cards[id].textContent.includes('Skill bí mật'));
      assert.equal(cards[id].querySelector('.talent-tag'), null, 'chaos-v2 has no talents');
      assert.equal(cards[id].querySelector('[data-skill-id]'), null, 'choice card must not expose its future skill');
    }
    assert.equal(game.$('skill-reveal').querySelectorAll('[data-skill-id]').length, 0);
    assert.equal(current(game).active, null);
    cards[0].click(); cards[1].click();
    const secretNotes = [...game.$('duck-grid').querySelectorAll('.secret-skill')].map(n => n.textContent);
    restored = loadGame(game.storage());
    assert.deepEqual(current(restored).picks, { p0: 0, p1: 1 });
    assert.deepEqual([...restored.$('duck-grid').querySelectorAll('.secret-skill')].map(n => n.textContent), secretNotes);
    assert.equal(restored.$('skill-reveal').querySelectorAll('[data-skill-id]').length, 0);
    assert.equal(restored.$('start').disabled, true);
    chooseAll(restored); restored.click('start');
    assert.equal(current(restored).active.engine, 'chaos-v3');
    assert.equal(restored.$('selection').hidden, true);
    assert.equal(restored.$('track').hidden, false);
    const revealed = [...restored.$('skill-reveal').querySelectorAll('[data-skill-id]')];
    assert.equal(revealed.length, 7);
    const active = current(restored).active;
    const race = restored.window.DuckChaosEngineV3.createRace(names.map((_, id) => A.name(id)), 25, active.seed);
    assert.deepEqual(revealed.map(n => n.dataset.skillId), plain(race.racers.map(r => r.skill.id)));
    noErrors(game); noErrors(restored);
  } finally { await game.close(); if (restored) await restored.close(); }
});

test('F5 mid-race preserves revealed skills, event chronology, result and one-time scoring', async () => {
  const game = loadGame(); let restored, after;
  try {
    setup(game); chooseAll(game); game.click('start'); game.advance(11500, 50);
    const saved = game.storage(), original = current(game).active;
    const originalSkills = [...game.$('skill-reveal').querySelectorAll('[data-skill-id]')].map(n => n.dataset.skillId);
    restored = loadGame(saved);
    assert.equal(restored.$('resume-overlay').hidden, false);
    assert.deepEqual(current(restored).active, original);
    assert.deepEqual([...restored.$('skill-reveal').querySelectorAll('[data-skill-id]')].map(n => n.dataset.skillId), originalSkills);
    const visible = [...restored.$('event-history').querySelectorAll('[data-event-time]')];
    assert.ok(visible.every(n => Number(n.dataset.eventTime) <= original.elapsed), 'future events must not be exposed');
    const ids = visible.map(n => n.dataset.eventId);
    assert.equal(new Set(ids).size, ids.length, 'restoration must not duplicate prior events');
    game.advance(45000, 50); restored.click('resume-overlay');
    assert.match(restored.$('arena-label').textContent, /ĐANG ĐUA/, 'resuming an in-flight race restores its running heading');
    assert.doesNotMatch(restored.$('sprint-label').textContent, /TẠM DỪNG/, 'resuming clears the paused race caption');
    assert.equal(restored.$('restore-notice').hidden, true, 'the resume notice disappears once racing resumes');
    restored.advance(45000, 50);
    const round = current(restored).session.rounds[0];
    assert.deepEqual(round.entries, current(game).session.rounds[0].entries);
    assert.deepEqual(round.entries.map(e => e.points), [7, 6, 5, 4, 3, 2, 1]);
    assert.equal(current(restored).raceReplays.length, 1);
    assert.deepEqual(current(restored).raceReplays[0], { id: round.id, seed: original.seed, engine: 'chaos-v3' });
    restored.advance(45000);
    assert.equal(current(restored).session.rounds.length, 1);
    after = loadGame(restored.storage());
    assert.deepEqual(current(after).session.rounds[0].entries, round.entries);
    assert.equal(T.standings(current(after).session).reduce((sum, row) => sum + row.total, 0), 28);
    const expectedQueue = [...round.entries].reverse().map(e => e.playerId);
    restored.click('result-next');
    assert.deepEqual([...restored.$('players').querySelectorAll('[data-player-id]')].map(n => n.dataset.playerId), expectedQueue);
    assert.equal(restored.$('skill-reveal').querySelectorAll('[data-skill-id]').length, 0, 'next picking phase does not retain former skill assignments');
    noErrors(game); noErrors(restored); noErrors(after);
  } finally { await game.close(); if (restored) await restored.close(); if (after) await after.close(); }
});

test('pre-update active season race keeps legacy simulation, then next round opts into new mechanics', async () => {
  const fixture = activeFixture();
  const expected = Legacy.createRace(names.map((_, id) => A.name(id)), 25, fixture.sessions[0].active.seed);
  const game = loadGame({ [KEY]: JSON.stringify(fixture) });
  try {
    assert.equal(current(game).active.engine, undefined);
    assert.equal(game.$('skill-reveal').querySelectorAll('[data-skill-id]').length, 0);
    game.click('resume-overlay'); game.advance(45000, 50);
    assert.deepEqual(current(game).session.rounds[0].entries.map(e => e.duckId), expected.results.map(r => r.id));
    assert.equal(current(game).raceReplays?.length ?? 0, 0);
    game.click('result-next'); chooseAll(game); game.click('start');
    assert.equal(current(game).active.engine, 'chaos-v3');
    noErrors(game);
  } finally { await game.close(); }
});

test('old coffee v2 session retains legacy engine for new rounds and original storage backup', async () => {
  const fixture = activeFixture({ version: 2 });
  const old = { version: 2, currentId: fixture.currentId, sessions: fixture.sessions.map(({ seasonId, ...e }) => e) };
  const encoded = JSON.stringify(old), game = loadGame({ [OLD_KEY]: encoded });
  try {
    game.click('resume-overlay'); game.advance(45000, 50);
    game.click('result-next'); chooseAll(game); game.click('start');
    assert.equal(current(game).active.engine, undefined);
    assert.equal(game.$('skill-reveal').querySelectorAll('[data-skill-id]').length, 0);
    assert.equal(game.storage()[OLD_KEY], encoded);
    assert.equal(state(game).seasons.length, 0);
    noErrors(game);
  } finally { await game.close(); }
});

test('unsupported in-flight engine version is not silently rerolled or overwritten', async () => {
  const fixture = activeFixture({ engine: 'chaos-v999' }), encoded = JSON.stringify(fixture);
  const game = loadGame({ [KEY]: encoded });
  try {
    assert.equal(game.$('storage-warning').hidden, false);
    assert.equal(game.storage()[KEY], encoded);
    assert.equal(game.$('setup-dialog').open, true);
    noErrors(game);
  } finally { await game.close(); }
});

test('ten seven-player chaos rounds retain daily points and only assess60k/40k after resolution', async () => {
  const game = loadGame();
  try {
    setup(game);
    for (let round = 0; round < 10; round++) {
      chooseAll(game); runRound(game);
      assert.equal(current(game).session.rounds.length, round + 1);
      assert.equal(current(game).raceReplays.length, round + 1);
      const s = state(game), summary = S.summary(s.seasons[0], [current(game).session]);
      if (round < 9) {
        assert.equal(summary.assessed, 0);
        game.click('result-next');
      }
    }
    if (T.coffeeStatus(current(game).session).status === 'tie') {
      game.click('result-next'); chooseAll(game); runRound(game);
      assert.equal(current(game).session.tiebreaks.length, 1);
    }
    const e = current(game), s = state(game), status = T.coffeeStatus(e.session);
    assert.equal(status.status, 'resolved');
    assert.equal(T.standings(e.session).reduce((sum, row) => sum + row.total, 0), 280);
    assert.deepEqual(status.contributions.map(c => c.amount), [60000, 40000]);
    const summary = S.summary(s.seasons[0], [e.session]);
    assert.equal(summary.assessed, 100000);
    assert.equal(summary.paid, 0);
    assert.equal(summary.outstanding, 100000);
    const again = loadGame(game.storage());
    try {
      assert.deepEqual(current(again).raceReplays, e.raceReplays);
      assert.equal(S.summary(state(again).seasons[0], [current(again).session]).assessed, 100000);
      noErrors(again);
    } finally { await again.close(); }
    noErrors(game);
  } finally { await game.close(); }
});

test('saved chaos-v1 active race restores with chaos-v1 and keeps its recap', async () => {
  const C1 = require('../dist/chaos-engine.js');
  const fixture = activeFixture({ engine: 'chaos-v1', roundLimit: 3 }), envelope = fixture.sessions[0];
  const ducks = names.map((_, id) => A.name(id));
  const done = C1.createRace(ducks, 25, 1357);
  envelope.session = T.recordRound(envelope.session, { id: 'v1-done', picks: envelope.picks, order: done.results.map(r => r.id), completedAt: '2026-11-04T05:00:00.000Z' });
  envelope.raceReplays = [{ id: 'v1-done', seed: 1357, engine: 'chaos-v1' }];
  const expected = C1.createRace(ducks, 25, envelope.active.seed);
  const game = loadGame({ [KEY]: JSON.stringify(fixture) });
  try {
    assert.equal(current(game).active.engine, 'chaos-v1');
    game.click('resume-overlay'); game.advance(45000, 50);
    const rounds = current(game).session.rounds;
    assert.deepEqual(rounds[1].entries.map(e => e.duckId), expected.results.map(r => r.id));
    assert.deepEqual(current(game).raceReplays.map(r => r.engine), ['chaos-v1', 'chaos-v1']);
    assert.ok(game.$('result-content').querySelector('.race-recap'), 'fresh v1 result keeps its recap');
    game.window.document.querySelector('#round-progress button').click();
    const recap = game.$('result-content').querySelector('.race-recap');
    assert.ok(recap, 'older v1 replay still opens');
    assert.ok(recap.textContent.includes(C1.talentFor(0).name), 'v1 recap still lists talents');
    game.click('result-next'); game.click('next'); chooseAll(game); game.click('start');
    assert.equal(current(game).active.engine, 'chaos-v3');
    noErrors(game);
  } finally { await game.close(); }
});

test('new races carry a weather that the river shows', async () => {
  const game = loadGame();
  try {
    setup(game); chooseAll(game); game.click('start');
    const active = current(game).active;
    assert.equal(active.engine, 'chaos-v3');
    const race = game.window.DuckChaosEngineV3.createRace(names.map((_, id) => A.name(id)), 25, active.seed);
    assert.ok(game.$('weather-label').textContent.includes(race.weather.name));
    assert.ok(game.window.document.querySelector('.race-water').classList.contains(`weather-${race.weather.id}`));
    noErrors(game);
  } finally { await game.close(); }
});

test('the end-of-day summary hands out titles from the day\'s races', async () => {
  const game = loadGame();
  try {
    setup(game, 2);
    for (let round = 0; round < 2; round++) { chooseAll(game); runRound(game); if (round === 0) game.click('result-next'); }
    if (T.coffeeStatus(current(game).session).status === 'tie') { game.click('result-next'); chooseAll(game); runRound(game); }
    game.click('result-next');
    const awards = game.$('result-content').querySelector('.day-awards');
    assert.ok(awards, 'summary has a titles section');
    const cards = [...awards.querySelectorAll('.award-card')];
    assert.ok(cards.length >= 1);
    assert.ok(cards.every(card => names.some(n => card.textContent.includes(n))), 'each title names a player');
    noErrors(game);
  } finally { await game.close(); }
});
