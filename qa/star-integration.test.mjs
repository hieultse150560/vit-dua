import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadGame } from './harness.mjs';

const require = createRequire(import.meta.url);
const T = require('../dist/tournament.js');
const S = require('../dist/seasons.js');
const KEY = 'vit-dua-seasons-v3';
const names = ['Phú', 'Hiếu', 'An', 'Bình', 'Chi', 'Dũng', 'Lan'];
const state = game => JSON.parse(game.storage()[KEY]);
const current = game => { const s = state(game); return s.sessions.find(e => e.session.id === s.currentId); };
const noErrors = game => assert.deepEqual(game.errors.map(String), []);
const toggle = game => game.$('star-toggle');
const selectedId = game => game.window.document.querySelector('#players .selected')?.dataset.playerId;
const freeCard = game => [...game.$('duck-grid').querySelectorAll('button')].find(b => !b.disabled);

function setup(game) {
  game.fill('setup-season-name', 'Mùa ngôi sao');
  game.fill('setup-names', names.join('\n'));
  game.fill('setup-date', '2026-11-04');
  game.fill('setup-rounds', '10');
  game.fill('setup-duration', '40');
  game.$('setup-form').dispatchEvent(new game.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(game.$('setup-error').textContent, '');
}
function pickNext(game, { star = false } = {}) {
  if (star) { assert.equal(toggle(game).hidden, false, 'star toggle visible'); game.click('star-toggle'); assert.equal(toggle(game).getAttribute('aria-pressed'), 'true'); }
  freeCard(game).click();
}
function pickRest(game, check = () => {}) {
  while (freeCard(game)) { check(selectedId(game)); pickNext(game); }
}
function fixture({ version = 4, type = 'regular', picks = {}, stars, rounds = [], roundLimit = 3 } = {}) {
  let session = T.createSession({ version, names, date: '2026-11-04', duration: 25, roundLimit });
  for (const order of rounds) session = T.recordRound(session, { id: `r${session.rounds.length + 1}`, picks: Object.fromEntries(session.players.map((p, i) => [p.id, i])), order, completedAt: '2026-11-04T05:00:00.000Z' });
  const season = S.createSeason({ name: 'Mùa thử', names, date: session.date });
  const envelope = { seasonId: season.id, session, type, stage: 'picking', picks, active: null, raceReplays: [], ...(stars ? { stars } : {}) };
  return { version: 3, currentId: session.id, currentSeasonId: season.id, seasons: [season], sessions: [envelope] };
}

test('star toggle arms before picking and doubles top-half points', async () => {
  const game = loadGame();
  try {
    setup(game);
    assert.equal(selectedId(game), 'p0');
    pickNext(game, { star: true });
    assert.deepEqual(current(game).stars, ['p0']);
    assert.ok(game.window.document.querySelector('#players [data-player-id="p0"]').textContent.includes('⭐'));
    assert.equal(toggle(game).getAttribute('aria-pressed'), 'false', 'next player starts unarmed');
    pickRest(game);
    game.click('start');
    assert.equal(game.window.document.querySelectorAll('.racer.has-star').length, 1);
    game.advance(120000, 50);
    const round = current(game).session.rounds[0], mine = round.entries.find(e => e.playerId === 'p0');
    assert.equal(mine.star, true);
    assert.equal(mine.points, (7 - mine.rank + 1) * 2, 'a star doubles the round at any rank');
    assert.ok(round.entries.filter(e => e.playerId !== 'p0').every(e => !('star' in e)));
    assert.deepEqual(current(game).stars, []);
    game.click('result-next');
    pickRest(game, id => { if (id === 'p0') assert.equal(toggle(game).hidden, true, 'p0 already used the star'); else assert.equal(toggle(game).hidden, false); });
    noErrors(game);
  } finally { await game.close(); }
});

test('last round: an unused star is forced on and cannot be turned off', async () => {
  const game = loadGame({ [KEY]: JSON.stringify(fixture({ roundLimit: 2, rounds: [[0, 1, 2, 3, 4, 5, 6]] })) });
  try {
    const first = selectedId(game);
    assert.equal(toggle(game).hidden, false);
    assert.equal(toggle(game).disabled, true);
    assert.equal(toggle(game).getAttribute('aria-pressed'), 'true');
    assert.match(toggle(game).textContent, /bắt buộc/);
    freeCard(game).click();
    assert.deepEqual(current(game).stars, [first]);
    game.click('random-picks');
    for (let i = 0; i < 10 && freeCard(game); i++) game.click('random-picks');
    game.click('start');
    assert.deepEqual([...current(game).stars].sort(), names.map((_, i) => `p${i}`).sort(), 'everyone still holding a star uses it');
    assert.equal(game.window.document.querySelectorAll('.racer.has-star').length, 7);
    noErrors(game);
  } finally { await game.close(); }
});

test('undo removes the star with its pick; reload keeps remaining stars', async () => {
  const game = loadGame(); let restored;
  try {
    setup(game);
    pickNext(game, { star: true }); pickNext(game, { star: true });
    assert.deepEqual(current(game).stars, ['p0', 'p1']);
    game.click('undo-last-pick');
    assert.deepEqual(current(game).stars, ['p0']);
    restored = loadGame(game.storage());
    assert.deepEqual(current(restored).stars, ['p0']);
    assert.equal(selectedId(restored), 'p1');
    assert.equal(toggle(restored).hidden, false);
    assert.equal(toggle(restored).getAttribute('aria-pressed'), 'false');
    noErrors(game); noErrors(restored);
  } finally { await game.close(); if (restored) await restored.close(); }
});

test('v3 day in progress: new-engine races, no star toggle', async () => {
  const game = loadGame({ [KEY]: JSON.stringify(fixture({ version: 3 })) });
  try {
    pickRest(game, () => assert.equal(toggle(game).hidden, true));
    game.click('start');
    assert.equal(current(game).active.engine, 'chaos-v3');
    noErrors(game);
  } finally { await game.close(); }
});

test('tiebreak picking hides the star toggle', async () => {
  const source = fixture({ type: 'tie', roundLimit: 2, rounds: [[0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 6, 5]] });
  assert.equal(T.coffeeStatus(source.sessions[0].session).status, 'tie');
  const game = loadGame({ [KEY]: JSON.stringify(source) });
  try {
    assert.equal(game.$('storage-warning').hidden, true, game.$('storage-warning').textContent);
    pickRest(game, () => assert.equal(toggle(game).hidden, true));
    noErrors(game);
  } finally { await game.close(); }
});

test('saved envelope with invalid stars is rejected without overwriting storage', async () => {
  for (const stars of [['p1'], ['p0', 'p0'], 'p0']) {
    const encoded = JSON.stringify(fixture({ picks: { p0: 0 }, stars }));
    const game = loadGame({ [KEY]: encoded });
    try {
      assert.equal(game.$('storage-warning').hidden, false, `stars ${JSON.stringify(stars)} accepted`);
      assert.equal(game.storage()[KEY], encoded);
      noErrors(game);
    } finally { await game.close(); }
  }
});

test('a v4 day must belong to a known season, like v3 days', async () => {
  for (const seasonId of [null, 'unknown-season']) {
    const source = fixture();
    source.sessions[0].seasonId = seasonId;
    const encoded = JSON.stringify(source), game = loadGame({ [KEY]: encoded });
    try {
      assert.equal(game.$('storage-warning').hidden, false, `v4 day with seasonId ${seasonId} was accepted`);
      assert.equal(game.storage()[KEY], encoded);
      noErrors(game);
    } finally { await game.close(); }
  }
});
