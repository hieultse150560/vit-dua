import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadGame } from './harness.mjs';

const require = createRequire(import.meta.url);
const T = require('../dist/tournament.js');
const S = require('../dist/seasons.js');
const KEY = 'vit-dua-seasons-v3';
const OLD_KEY = 'vit-dua-club-v2';
const state = game => JSON.parse(game.storage()[KEY]);
const current = game => { const store = state(game); return store.sessions.find(entry => entry.session.id === store.currentId); };
const noErrors = game => assert.deepEqual(game.errors.map(String), []);
const plain = value => JSON.parse(JSON.stringify(value));
const submit = (game, id) => game.$(id).dispatchEvent(new game.window.Event('submit', { bubbles: true, cancelable: true }));

function setup(game, rounds = 10, date = '2026-11-04') {
  assert.equal(game.$('setup-dialog').open, true);
  if (game.$('setup-season-name')) game.fill('setup-season-name', 'Mùa thử nghiệm');
  if (game.$('season-name')) game.fill('season-name', 'Mùa thử nghiệm');
  game.fill('setup-names', 'Phú\nAn\nBình');
  game.fill('setup-date', date);
  game.fill('setup-rounds', String(rounds));
  game.fill('setup-duration', '40');
  submit(game, 'setup-form');
  assert.equal(game.$('setup-error').textContent, '');
  assert.equal(game.$('setup-dialog').open, false);
  assert.equal(state(game).version, 3);
  assert.equal(current(game).session.version, 5);
}

const duck = (game, id) => game.window.document.querySelector(`#duck-grid [data-duck-id="${id}"]`);
const player = (game, id) => game.window.document.querySelector(`#players [data-player-id="${id}"]`);

function chooseAll(game) {
  const envelope = current(game);
  const order = game.window.DuckTournament.selectionOrder(envelope.session, envelope.type);
  for (const id of order) {
    if (current(game).picks[id] !== undefined) continue;
    const selected = game.window.document.querySelector('#players .selected');
    assert.equal(selected?.dataset.playerId, id, 'only the next queued player is active');
    const available = [...game.$('duck-grid').querySelectorAll('button')].find(button => !button.disabled && !button.classList.contains('claimed'));
    assert.ok(available, `an unclaimed duck exists for ${id}`);
    available.click();
    assert.notEqual(current(game).picks[id], undefined);
  }
  assert.equal(game.$('start').disabled, false);
}

function runRound(game) { game.click('start'); game.advance(120000, 50); }
function completeDay(game, rounds) {
  for (let i = 0; i < rounds; i++) {
    chooseAll(game); runRound(game);
    assert.equal(current(game).session.rounds.length, i + 1);
    if (i < rounds - 1) game.click('result-next');
  }
  if (game.window.DuckTournament.coffeeStatus(current(game).session).status === 'tie') {
    game.click('result-next'); chooseAll(game); runRound(game);
  }
  assert.equal(game.window.DuckTournament.coffeeStatus(current(game).session).status, 'resolved');
}

test('selection queue cannot be skipped; random chooses one turn, undo reverses one choice, F5 preserves prefix', async () => {
  const game = loadGame(); let restored;
  try {
    setup(game);
    assert.equal(player(game, 'p0').disabled, false);
    assert.equal(player(game, 'p1').disabled, true);
    assert.equal(player(game, 'p2').disabled, true);
    player(game, 'p2').dispatchEvent(new game.window.MouseEvent('click', { bubbles: true }));
    assert.equal(game.window.document.querySelector('#players .selected')?.dataset.playerId, 'p0');
    duck(game, 0).click();
    assert.deepEqual(current(game).picks, { p0: 0 });
    game.click('random-picks');
    assert.equal(Object.keys(current(game).picks).length, 2, 'random chooses only the current player');
    const undo = game.$('undo-pick') || game.$('undo-last-pick');
    assert.ok(undo && !undo.disabled);
    undo.click();
    assert.deepEqual(current(game).picks, { p0: 0 });
    restored = loadGame(game.storage());
    assert.deepEqual(current(restored).picks, { p0: 0 });
    assert.equal(restored.window.document.querySelector('#players .selected')?.dataset.playerId, 'p1');
    chooseAll(restored); runRound(restored);
    const lastRound = current(restored).session.rounds[0];
    const expected = [...lastRound.entries].sort((a,b) => b.rank - a.rank).map(e => e.playerId);
    restored.click('result-next');
    const rendered = [...restored.$('players').querySelectorAll('[data-player-id]')].map(e => e.dataset.playerId);
    assert.deepEqual(rendered, expected);
    assert.equal(restored.window.document.querySelector('#players .selected')?.dataset.playerId, expected[0]);
    assert.equal(player(restored, expected.at(-1)).disabled, true, 'prior winner must wait until everyone else chooses');
    noErrors(game); noErrors(restored);
  } finally { await game.close(); if (restored) await restored.close(); }
});

test('ten rounds score once, daily contributions total100k, reload retains totals and same in-flight outcome', async () => {
  const game = loadGame(); let restored;
  try {
    setup(game); chooseAll(game); game.click('start'); game.advance(10500, 50);
    const saved = game.storage(); restored = loadGame(saved);
    assert.equal(restored.$('resume-overlay').hidden, false);
    assert.equal(current(restored).active.seed, current(game).active.seed);
    game.advance(100000, 50); restored.click('resume-overlay'); restored.advance(100000, 50);
    assert.deepEqual(current(restored).session.rounds[0].entries, current(game).session.rounds[0].entries);
    restored.click('result-next');
    for (let round = 1; round < 10; round++) {
      chooseAll(restored); runRound(restored);
      assert.equal(current(restored).session.rounds.length, round + 1);
      restored.advance(5000);
      assert.equal(current(restored).session.rounds.length, round + 1);
      if (round < 9) restored.click('result-next');
    }
    if (restored.window.DuckTournament.coffeeStatus(current(restored).session).status === 'tie') {
      restored.click('result-next'); chooseAll(restored); runRound(restored);
    }
    const session = current(restored).session;
    // 10 rounds × 6, plus the last round's forced stars doubling everyone's points.
    assert.equal(restored.window.DuckTournament.standings(session).reduce((sum, r) => sum + r.total, 0), 60 + 6);
    const status = restored.window.DuckTournament.coffeeStatus(session);
    assert.equal(status.status, 'resolved');
    assert.deepEqual(plain(status.contributions.map(c => c.amount).sort((a,b) => a-b)), [40000,60000]);
    const again = loadGame(restored.storage());
    try {
      assert.deepEqual(plain(again.window.DuckTournament.coffeeStatus(current(again).session).contributions), plain(status.contributions));
      noErrors(again);
    } finally { await again.close(); }
    noErrors(game); noErrors(restored);
  } finally { await game.close(); if (restored) await restored.close(); }
});

test('legacy v2 active race migrates without changing seed, awarding money, or overwriting original backup', async () => {
  const session = T.createSession({ version: 2, names: ['Phú','An','Bình'], date: '2026-11-04', duration: 25, roundLimit: 1 });
  assert.equal(session.version, 2);
  const legacy = { version: 2, currentId: session.id, sessions: [{ session, type: 'regular', stage: 'picking', picks: {p0:0,p1:1,p2:2}, active: {id:'legacy-running',seed:24680,elapsed:7,countdownLeft:0} }] };
  const original = JSON.stringify(legacy), game = loadGame({[OLD_KEY]:original});
  try {
    assert.equal(game.storage()[OLD_KEY], original);
    assert.equal(current(game).seasonId, null);
    assert.equal(current(game).active.seed, 24680);
    assert.equal(game.$('resume-overlay').hidden, false);
    game.click('resume-overlay'); game.advance(100000,50);
    assert.equal(current(game).session.rounds.length, 1);
    assert.equal(game.storage()[OLD_KEY], original);
    assert.equal(state(game).seasons.length, 0);
    noErrors(game);
  } finally { await game.close(); }
});

test('exactly two tied last-place players must race to distinguish60k and40k before ledger accrual', async () => {
  const season = S.createSeason({name:'Hai người đồng điểm', names:['Phú','An','Bình'], date:'2026-11-04'});
  let session = T.createSession({names:['Phú','An','Bình'], date:'2026-11-04', duration:25, roundLimit:2});
  const picks = {p0:0,p1:1,p2:2};
  session = T.recordRound(session,{id:'tie-r1',picks,order:[0,1,2],completedAt:'2026-11-04T05:00:00.000Z'});
  session = T.recordRound(session,{id:'tie-r2',picks,order:[0,2,1],completedAt:'2026-11-04T05:01:00.000Z'});
  const fixture = {version:3,currentId:session.id,currentSeasonId:season.id,seasons:[season],sessions:[{seasonId:season.id,session,type:'regular',stage:'result',picks,active:null}]};
  const game = loadGame({[KEY]:JSON.stringify(fixture)});
  try {
    assert.equal(game.window.DuckTournament.coffeeStatus(current(game).session).status,'tie');
    assert.equal(game.window.DuckSeasons.summary(state(game).seasons[0],[current(game).session]).assessed,0);
    game.click('final-summary');
    assert.equal(game.$('players').querySelectorAll('button').length,2);
    chooseAll(game); runRound(game);
    const result = current(game).session;
    assert.equal(result.rounds.length,2);
    assert.equal(result.tiebreaks.length,1);
    assert.deepEqual(T.standings(result).map(row=>row.total),[6,3,3]);
    const contributions = T.coffeeStatus(result).contributions;
    assert.equal(contributions[0].playerId,result.tiebreaks[0].entries.at(-1).playerId);
    assert.equal(contributions[0].amount,60000);
    assert.equal(contributions[1].amount,40000);
    assert.equal(game.window.DuckSeasons.summary(state(game).seasons[0],[result]).assessed,100000);
    noErrors(game);
  } finally {await game.close();}
});

test('two days accumulate a season fund, paid receipts persist, close starts a clean new season and archives remain accessible', async () => {
  let game = loadGame();
  try {
    setup(game, 1);
    assert.equal(game.$('new-day').disabled,true);
    assert.equal(game.$('close-season').disabled,true);
    const firstSeasonId = state(game).seasons[0].id;
    completeDay(game,1); game.click('result-close');
    const firstDayId = current(game).session.id;
    assert.equal(game.$('new-day').disabled,false);
    assert.equal(game.$('close-season').disabled,false);
    assert.equal(game.$('season-assessed').textContent,'100.000đ');
    assert.equal(game.$('season-paid').textContent,'0đ');
    assert.equal(game.$('season-outstanding').textContent,'100.000đ');
    game.click('season-fund');
    let receipt = game.$('fund-content').querySelector('input[data-receipt-key]');
    const receiptKey = receipt.dataset.receiptKey;
    assert.equal(receipt.checked,false);
    const summary = () => {const saved=state(game);return S.summary(saved.seasons.find(s=>s.id===firstSeasonId),saved.sessions.filter(e=>e.seasonId===firstSeasonId).map(e=>e.session));};
    const receiptAmount = summary().items.find(i=>i.key===receiptKey).amount;
    receipt.checked=true;receipt.dispatchEvent(new game.window.Event('change',{bubbles:true}));
    assert.equal(summary().paid,receiptAmount);
    assert.equal(summary().outstanding,100000-receiptAmount);
    receipt=game.$('fund-content').querySelector(`[data-receipt-key="${receiptKey}"]`);
    receipt.checked=false;receipt.dispatchEvent(new game.window.Event('change',{bubbles:true}));
    assert.equal(summary().paid,0);
    receipt=game.$('fund-content').querySelector(`[data-receipt-key="${receiptKey}"]`);
    receipt.checked=true;receipt.dispatchEvent(new game.window.Event('change',{bubbles:true}));
    game.click('fund-close');
    const saved = game.storage(); await game.close(); game=loadGame(saved);
    assert.equal(summary().paid,receiptAmount);
    assert.equal(summary().assessed,100000);
    game.click('new-day');
    assert.equal(game.$('setup-dialog').open,true);
    assert.equal(game.$('setup-names').disabled,true);
    assert.equal(game.$('setup-rounds').value,'10');
    assert.equal(game.$('setup-duration').value,'40');
    game.fill('setup-date','2026-11-04');submit(game,'setup-form');
    assert.match(game.$('setup-error').textContent,/không được trùng|phải sau/);
    assert.equal(state(game).sessions.length,1);
    game.fill('setup-date','2026-11-05');game.fill('setup-rounds','1');submit(game,'setup-form');
    assert.equal(game.$('setup-dialog').open,false);
    assert.equal(game.$('setup-error').textContent,'','corrected submission clears stale validation error');
    assert.equal(current(game).session.date,'2026-11-05');
    assert.equal(current(game).session.rounds.length,0);
    assert.deepEqual(current(game).session.players.map(p=>p.name),['Phú','An','Bình']);
    assert.equal(summary().assessed,100000,'unfinished new day does not accrue money');
    assert.equal(game.$('close-season').disabled,true);
    completeDay(game,1);game.click('result-close');
    assert.equal(summary().assessed,200000);
    assert.equal(summary().daysComplete,2);
    assert.equal(summary().paid,receiptAmount);
    assert.equal(game.$('season-assessed').textContent,'200.000đ');
    game.click('close-season');
    assert.equal(game.$('close-season-dialog').open,true);
    game.click('confirm-close-season');
    assert.ok(state(game).seasons.find(s=>s.id===firstSeasonId).closedAt);
    assert.equal(game.$('setup-dialog').open,true);
    game.fill('setup-season-name','Mùa kế tiếp');game.fill('setup-date','2026-11-06');game.fill('setup-rounds','1');submit(game,'setup-form');
    assert.equal(game.$('setup-error').textContent,'');
    assert.equal(state(game).seasons.length,2);
    assert.equal(state(game).sessions.length,3);
    const nextSeasonId=current(game).seasonId;
    assert.notEqual(nextSeasonId,firstSeasonId);
    assert.equal(game.$('season-assessed').textContent,'0đ');
    assert.equal(game.$('season-paid').textContent,'0đ');
    assert.equal(summary().assessed,200000);
    game.click('saved-games');
    assert.equal(game.$('sessions-list').querySelectorAll('[data-session-id]').length,3);
    game.click(`[data-session-id="${firstDayId}"]`);
    assert.equal(current(game).seasonId,firstSeasonId);
    assert.equal(game.$('new-day').disabled,true);
    assert.equal(game.$('close-season').disabled,true);
    assert.equal(game.$('start').hidden,true);
    assert.equal(game.$('season-assessed').textContent,'200.000đ');
    game.click('season-fund');
    assert.equal(game.$('fund-content').querySelector(`[data-receipt-key="${receiptKey}"]`).checked,true);
    noErrors(game);
  } finally {await game.close();}
});

export { setup, chooseAll, runRound, completeDay, state, current, noErrors, submit };

test('each duck shows its dealt skill and trait before the picks; the race, a reload and the replay keep that lineup', async () => {
  const game = loadGame();
  try {
    setup(game, 2);
    const lineup = current(game).lineup;
    assert.equal(lineup.skills.length, 3); assert.equal(lineup.traits.length, 3);
    const V3 = game.window.DuckChaosEngineV3;
    for (let id = 0; id < 3; id++) {
      const card = duck(game, id), sk = V3.skills.find(s => s.id === lineup.skills[id]), tr = V3.traits.find(t => t.id === lineup.traits[id]);
      assert.ok(card.querySelector('.skill-tag').textContent.includes(sk.name), 'skill on the card');
      assert.ok(card.querySelector('.talent-tag').textContent.includes(tr.name), 'trait on the card');
      assert.equal(card.querySelector('.secret-skill'), null, 'no more secret skills');
    }
    const restored = loadGame(game.storage());
    try { assert.deepEqual(current(restored).lineup, lineup, 'a reload keeps the same lineup while picking'); } finally { await restored.close(); }
    chooseAll(game); game.click('start');
    assert.deepEqual(current(game).active.lineup, lineup, 'the race uses the lineup that was shown');
    const racers = [...game.window.document.querySelectorAll('.racer')];
    racers.forEach((r, id) => assert.ok(r.querySelector('.racer-trait'), `duck ${id} wears its trait`));
    runRound(game);
    const replay = current(game).raceReplays.at(-1);
    assert.deepEqual(replay.lineup, lineup, 'the replay remembers the lineup');
    game.click('result-next');
    assert.notDeepEqual(current(game).lineup, undefined);
    assert.equal(current(game).lineup.skills.length, 3, 'a fresh deal for the next round');
    noErrors(game);
  } finally { await game.close(); }
});

test('after a round, the players trailing the day get comeback luck on their pick, shown in the list and on their duck', async () => {
  const game = loadGame();
  try {
    setup(game, 3);
    chooseAll(game); runRound(game); game.click('result-next');
    const session = current(game).session, levels = game.window.DuckTournament.luckLevels(session);
    assert.ok(Object.values(levels).some(Boolean), 'someone trails after round 1');
    for (const [id, level] of Object.entries(levels)) assert.equal(player(game, id).textContent.includes('🍀'), level > 0, `${id} luck ${level}`);
    chooseAll(game); game.click('start');
    const { picks, active } = current(game);
    for (const [id, duckId] of Object.entries(picks)) assert.equal(active.lineup.luck[duckId], levels[id], `duck of ${id} carries its owner's luck`);
    const lucky = Object.entries(picks).find(([id]) => levels[id] > 0);
    assert.ok(game.window.document.querySelectorAll('.racer')[lucky[1]].querySelector('.racer-luck'), 'the lucky duck wears a clover');
    noErrors(game);
  } finally { await game.close(); }
});
