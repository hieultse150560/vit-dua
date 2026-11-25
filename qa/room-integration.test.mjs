import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadGame } from './harness.mjs';

// Two pages talk through Node's BroadcastChannel, the same transport room.js uses between tabs.
const KEY = 'vit-dua-seasons-v3';
// unref(): an open channel must not keep the test process alive.
class Channel extends globalThis.BroadcastChannel { constructor(name) { super(name); this.unref(); } }
const withChannel = { beforeScripts(window) { window.BroadcastChannel = Channel; } };
const settle = () => new Promise(resolve => setTimeout(resolve, 30)); // real time: channel messages hop the event loop
const state = game => JSON.parse(game.storage()[KEY]);
const current = game => { const store = state(game); return store.sessions.find(entry => entry.session.id === store.currentId); };
const submit = (game, id) => game.$(id).dispatchEvent(new game.window.Event('submit', { bubbles: true, cancelable: true }));
const duck = (game, id) => game.window.document.querySelector(`#duck-grid [data-duck-id="${id}"]`);
// Every duck deals the heat-seeking missile: an active skill that aims, so the cast tests never depend on the deal.
const engine = readFileSync(new URL('../dist/chaos-engine-v2.js', import.meta.url), 'utf8');
const missileDeal = 'return dealLineup(V10_RULES, count, seed);';
if (!engine.includes(missileDeal)) throw Error('the engine changed: update missileDeal');
const dealing = skill => ({ ...withChannel, scripts: { 'chaos-engine-v2.js': engine.replace(missileDeal, `return { ...dealLineup(V10_RULES, count, seed), skills: Array(count).fill('${skill}') };`) } });
const missiles = dealing('missile');
const key = (game, code, name = code) => game.window.document.body.dispatchEvent(new game.window.KeyboardEvent('keydown', { code, key: name, bubbles: true }));
const order = game => [...game.window.document.querySelectorAll('#result-content tbody tr')].map(r => r.children[1].textContent);
async function sync(host, viewer, ms = 200) { host.advance(ms, 50); viewer?.advance(ms, 50); await settle(); host.advance(50, 50); viewer?.advance(50, 50); await settle(); }

test('a race room: each player picks on their own turn from their own page and watches the race there', async () => {
  const host = loadGame({}, withChannel); let viewer;
  try {
    host.fill('setup-season-name', 'Mùa phòng'); host.fill('setup-names', 'Phú\nAn\nBình'); host.fill('setup-date', '2026-11-04'); host.fill('setup-rounds', '2'); host.fill('setup-duration', '55');
    submit(host, 'setup-form'); await settle();
    assert.equal(host.$('room-dialog').open, true, 'a new day opens the room with everyone\'s link');
    const code = host.storage()['vit-dua-room'];
    assert.match(code, /^[A-Z0-9]{6}$/);
    assert.match(host.$('room-open').textContent, new RegExp(code));
    assert.ok(host.$('room-content').textContent.includes(`phong=${code}&ten=An`), 'the host lists a link per player');
    host.click('room-close');
    assert.equal(host.$('skills-dialog').open, true, 'then the skill table'); host.click('skills-close');

    viewer = loadGame({}, { ...withChannel, url: `http://localhost/?phong=${code}&ten=an` });
    await sync(host, viewer);
    assert.ok(viewer.window.document.body.classList.contains('viewer'));
    assert.match(viewer.$('viewer-pill').textContent, /Bạn là An/);
    assert.equal(viewer.$('setup-dialog').open, false, 'a player never sees the tournament setup');

    // Phú picks first (on the host); An cannot jump the queue.
    duck(viewer, 2).click(); await sync(host, viewer);
    assert.deepEqual(current(host).picks, {});
    assert.equal(viewer.$('star-toggle').hidden, true, "nobody can spend another player's star");
    duck(host, 0).click(); await sync(host, viewer);
    assert.match(viewer.$('viewer-pill').textContent, /ĐẾN LƯỢT BẠN/);
    assert.equal(duck(viewer, 1).disabled, false);
    assert.equal(viewer.$('star-toggle').hidden, false, 'on their turn a player can use their own hope star');
    viewer.click('star-toggle'); duck(viewer, 1).click(); await sync(host, viewer);
    assert.deepEqual(current(host).picks, { p0: 0, p1: 1 }, "An's pick reached the host through the queue");
    assert.deepEqual(current(host).stars, ['p1'], 'with their star');
    duck(host, 2).click(); await sync(host, viewer);

    host.click('start'); await sync(host, viewer, 100);
    assert.equal(viewer.$('track').hidden, false, "the race plays on the player's page");
    assert.ok(viewer.window.document.querySelector('.racer.mine'), 'their own duck glows');
    for (let i = 0; i < 30; i++) { host.advance(4000, 50); viewer.advance(4000, 50); await settle(); }
    assert.equal(current(host).session.rounds.length, 1, 'the host scored the round');
    assert.equal(current(host).session.rounds[0].entries.find(e => e.playerId === 'p1').star, true, "An's points were doubled");
    assert.equal(viewer.$('result-dialog').open, true, 'the player sees the result');
    assert.equal(viewer.storage()[KEY], undefined, "a player's page never writes the tournament");
    assert.deepEqual(host.errors.map(String), []); assert.deepEqual(viewer.errors.map(String), []);
  } finally { await host.close(); await viewer?.close(); }
});

test('with a room open, a player who does not pick within 10 s gets a random duck', async () => {
  const host = loadGame({}, withChannel); let viewer;
  try {
    host.fill('setup-season-name', 'Mùa phòng'); host.fill('setup-names', 'Phú\nAn\nBình'); host.fill('setup-date', '2026-11-04'); host.fill('setup-rounds', '2'); host.fill('setup-duration', '55');
    submit(host, 'setup-form'); await settle();
    const code = host.storage()['vit-dua-room'];
    viewer = loadGame({}, { ...withChannel, url: `http://localhost/?phong=${code}&ten=An` });
    await sync(host, viewer);
    host.advance(6000, 100); viewer.advance(6000, 100); await settle(); // both pages share one wall clock
    assert.equal(Object.keys(current(host).picks).length, 0, 'no clock while the host still shares the links');
    assert.equal(host.$('pick-clock').hidden, true);
    host.click('room-close'); host.click('skills-close'); await sync(host, viewer);
    assert.equal(host.$('pick-clock').hidden, false);
    assert.match(viewer.$('pick-clock').textContent, /⏱ (10|9|8)s/, 'the player sees the countdown too');
    host.advance(10200, 100); await settle();
    assert.equal(Object.keys(current(host).picks).length, 1, "Phú's turn ran out: a random duck");
    assert.ok(current(host).picks.p0 !== undefined);
    host.advance(10200, 100); await settle();
    assert.equal(Object.keys(current(host).picks).length, 2, "then An's");
    assert.deepEqual(host.errors.map(String), []); assert.deepEqual(viewer.errors.map(String), []);
  } finally { await host.close(); await viewer?.close(); }
});

test("a player's page follows the host: a paused race's totals, the next pick round, the day summary", async () => {
  const host = loadGame({}, withChannel); let viewer;
  const pickAll = async () => { for (let i = 0; i < 5 && host.$('start').disabled; i++) host.click('random-picks'); await sync(host, viewer); };
  const race = async () => { for (let i = 0; i < 30 && !host.$('result-dialog').open; i++) { host.advance(4000, 50); viewer.advance(4000, 50); await settle(); } await sync(host, viewer); };
  try {
    host.fill('setup-season-name', 'Mùa phòng'); host.fill('setup-names', 'Phú\nAn\nBình'); host.fill('setup-date', '2026-11-04'); host.fill('setup-rounds', '2'); host.fill('setup-duration', '55');
    submit(host, 'setup-form'); await settle();
    const code = host.storage()['vit-dua-room'];
    host.click('room-close'); host.click('skills-close');
    viewer = loadGame({}, { ...withChannel, url: `http://localhost/?phong=${code}&ten=An` });
    await sync(host, viewer);

    await pickAll();
    host.click('start'); await sync(host, viewer);
    for (let i = 0; i < 3; i++) { host.advance(4000, 50); viewer.advance(4000, 50); await settle(); }
    host.click('pause'); await sync(host, viewer); host.click('pause'); await sync(host, viewer); // the pause snapshot reaches the player mid-race
    await race();
    assert.equal(viewer.$('result-dialog').open, true);
    const totals = game => [...game.window.document.querySelectorAll('#result-content tbody tr')].map(r => r.lastElementChild.textContent);
    assert.deepEqual(totals(viewer), totals(host), "the player's totals match the host's after a paused race");
    assert.ok(viewer.$('result-content').querySelector('.race-recap'), 'the player gets the recap too');
    const cheer = game => game.$('result-content').querySelector('.cheer-card')?.textContent;
    assert.equal(cheer(host) ?? cheer(viewer), undefined, 'no poem after a round: it waits for the day summary');

    host.click('result-next'); await sync(host, viewer);
    assert.equal(viewer.$('result-dialog').open, false, "the host's next pick round closes the player's result, so they can pick");

    while (current(host).stage !== 'complete') {
      await pickAll(); host.click('start'); await sync(host, viewer);
      await race(); host.click('result-next'); await sync(host, viewer);
    }
    assert.equal(viewer.$('result-dialog').open, true, 'the player sees the day summary');
    assert.match(viewer.$('result-label').textContent, /TỔNG KẾT NGÀY/);
    assert.match(host.$('result-label').textContent, /TỔNG KẾT NGÀY/);
    assert.ok(cheer(host) && cheer(host) === cheer(viewer), 'host and player get the same poem in the day summary');
    const payers = [...host.$('result-content').querySelectorAll('.final-coffee strong')].map(s => s.textContent.split(' · ')[0]);
    assert.ok(payers.length && payers.every(name => cheer(host).includes(name)), `it names whoever pays: ${payers} / ${cheer(host)}`);
    assert.deepEqual(host.errors.map(String), []); assert.deepEqual(viewer.errors.map(String), []);
  } finally { await host.close(); await viewer?.close(); }
});

test('in a room each player casts their own skill from their page, aimed at any rival; the host casts for others; a skill nobody cast casts itself', async () => {
  const host = loadGame({}, missiles); let viewer;
  try {
    host.fill('setup-season-name', 'Mùa phòng'); host.fill('setup-names', 'Phú\nAn\nBình'); host.fill('setup-date', '2026-11-04'); host.fill('setup-rounds', '2'); host.fill('setup-duration', '55');
    submit(host, 'setup-form'); await settle();
    const code = host.storage()['vit-dua-room'];
    host.click('room-close'); host.click('skills-close');
    viewer = loadGame({}, { ...missiles, url: `http://localhost/?phong=${code}&ten=An` });
    await sync(host, viewer);
    const [phuDuck, anDuck] = [0, 1];
    duck(host, phuDuck).click(); await sync(host, viewer);
    duck(viewer, anDuck).click(); await sync(host, viewer);
    host.click('random-picks'); await sync(host, viewer);
    const binhDuck = current(host).picks.p2;
    assert.equal(binhDuck, 2);

    host.click('slow-fx'); await sync(host, viewer); // the host switches to fast effects
    assert.equal(viewer.$('slow-fx').getAttribute('aria-pressed'), 'false', "players play at the host's effect speed, so their race clocks stay together");
    host.click('start'); await sync(host, viewer);
    assert.deepEqual(current(host).active.lineup.casts, [null, null, null], 'a race started with the room open waits for every cast');
    assert.equal(viewer.$('cast').hidden, false, 'the player sees their skill button');
    assert.equal(viewer.$('cast').disabled, true);
    assert.match(viewer.$('cast').textContent, /mở sau/, 'locked for the first seconds');
    assert.equal(viewer.$('cast-targets').hidden, true, 'no aiming while it is locked');
    assert.match(viewer.$('skill-mode').textContent, /Chủ vịt tự bấm/); assert.match(host.$('skill-mode').textContent, /bấm ô để tung hộ/);

    for (let i = 0; i < 40 && viewer.$('cast').disabled; i++) await sync(host, viewer, 500);
    assert.match(viewer.$('cast').textContent, /TUNG .* → .* còn \d+s/, 'the button names the duck it aims at');
    assert.equal(viewer.$('cast-targets').hidden, false, 'a skill that aims lists the rivals');
    const targets = () => [...viewer.window.document.querySelectorAll('#cast-targets .cast-target')];
    const aimed = () => targets().filter(b => b.getAttribute('aria-checked') === 'true').map(b => Number(b.dataset.duckId));
    assert.equal(targets().length, 2, 'any rival can be aimed at');
    assert.equal(aimed().length, 1);
    assert.match(targets().find(b => b.classList.contains('on')).textContent, /🥇|🥈/, 'the top rival is suggested');
    // An clicks the other rival, the arrows move the aim around, and Space casts.
    const button = targets().find(b => !b.classList.contains('on')), other = Number(button.dataset.duckId);
    button.click(); assert.deepEqual(aimed(), [other]);
    key(viewer, 'ArrowRight'); assert.notDeepEqual(aimed(), [other], 'an arrow moves the aim');
    key(viewer, 'ArrowLeft'); assert.deepEqual(aimed(), [other]);
    const at = current(host).active.elapsed;
    key(viewer, 'Space', ' '); await sync(host, viewer);
    const cast = current(host).active.lineup.casts[anDuck];
    assert.ok(Number.isFinite(cast) && cast >= at && cast <= at + 5, `An's cast lands ahead of the race clock, within a wind-up and 3 s of the press (the host's saved clock lags up to .5 s, An's page may run ahead) (${cast} vs ${at})`);
    assert.deepEqual(Array.from(current(host).active.lineup.targets[anDuck]), [other], 'aimed where An chose');
    await sync(host, viewer); // the host's snapshot hops back to the player
    assert.match(viewer.$('cast').textContent, /Đang gồng|Đã tung/, "the player's page follows");
    assert.equal(viewer.$('cast-targets').hidden, true);
    assert.equal(viewer.window.document.querySelector(`#skill-reveal [data-duck-id="${anDuck}"]`).dataset.cast, 'charging');

    // The host casts Phú's skill by clicking its chip (Phú plays on the host's screen). Nobody casts Bình's.
    host.click(`#skill-reveal [data-duck-id="${phuDuck}"]`); await sync(host, viewer);
    assert.ok(Number.isFinite(current(host).active.lineup.casts[phuDuck]), "the host cast Phú's skill");
    for (let i = 0; i < 40 && !host.$('result-dialog').open; i++) { host.advance(4000, 50); viewer.advance(4000, 50); await settle(); }
    await sync(host, viewer);

    const replay = current(host).raceReplays.at(-1), skills = replay.lineup.skills;
    assert.equal(replay.lineup.casts[binhDuck], null, "Bình's skill was never cast by hand");
    const race = host.window.DuckChaosEngineV10.createRace(skills.map((_, i) => host.window.DuckArt.name(i)), 55, replay.seed, replay.lineup);
    const fired = id => race.events.filter(e => e.type === 'skill' && e.activation && e.actorId === id);
    assert.ok(Math.abs(fired(anDuck)[0].time - cast) < 0.06, "the replay fires An's skill when An cast it");
    assert.equal(fired(anDuck)[0].targetId, other, 'at the rival An aimed at');
    assert.equal(fired(binhDuck).length, 1, "Bình's skill cast itself after the deadline");
    assert.ok(Math.abs(fired(binhDuck)[0].time - race.castWindow.auto[binhDuck]) < 0.06 && fired(binhDuck)[0].time > 55 * 0.45);
    assert.deepEqual(current(host).session.rounds[0].entries.map(e => e.duckId), Array.from(race.results, r => r.id), 'the replay rebuilds the scored race');
    assert.deepEqual(order(viewer), order(host), 'the player saw the same race');
    assert.deepEqual(host.errors.map(String), []); assert.deepEqual(viewer.errors.map(String), []);
  } finally { await host.close(); await viewer?.close(); }
});

test('when nobody casts, every skill casts itself after the deadline, spread out and before the calm finish', async () => {
  const host = loadGame({}, withChannel);
  try {
    host.fill('setup-season-name', 'Mùa phòng'); host.fill('setup-names', 'A\nB\nC\nD\nE\nF\nG\nH'); host.fill('setup-date', '2026-11-04'); host.fill('setup-rounds', '2'); host.fill('setup-duration', '55');
    submit(host, 'setup-form'); await settle();
    host.click('room-close'); host.click('skills-close');
    for (let i = 0; i < 8; i++) host.click('random-picks');
    host.click('start');
    for (let i = 0; i < 40 && !host.$('result-dialog').open; i++) host.advance(4000, 50);
    const replay = current(host).raceReplays.at(-1), skills = replay.lineup.skills;
    assert.ok(replay.lineup.casts.every(c => c === null), 'nobody cast by hand');
    const race = host.window.DuckChaosEngineV10.createRace(skills.map((_, i) => host.window.DuckArt.name(i)), 55, replay.seed, replay.lineup);
    const active = skills.map((s, i) => i).filter(i => !['mirror', 'buoy'].includes(skills[i]));
    const fired = race.events.filter(e => e.type === 'skill' && e.activation && e.scheduled && active.includes(e.actorId));
    const robbed = race.events.filter(e => e.stolen).map(e => e.victimId); // chaos-v9: a pickpocket's victim casts nothing
    assert.deepEqual(Array.from(fired, e => e.actorId).sort(), active.filter(i => !robbed.includes(i)), 'every active skill fired, once');
    const twists = race.events.filter(e => e.scheduled).map(e => e.time);
    // The calm finish: after the casts and the plot twist nothing happens until the line, but for the finale rock (some races).
    assert.ok(race.events.filter(e => e.scheduled && e.time > 55 * 0.85 + 1e-6).every(e => e.finale), 'only the finale rock after the calm starts');
    assert.ok(race.events.some(e => e.scheduled && e.type === 'hazard' && !e.finale && e.time >= 55 * 0.7 - 1e-6 && e.time <= 55 * 0.85 + 1e-6), 'a late plot twist on the river');
    for (const e of fired) {
      assert.ok(e.time >= 55 * 0.47 + 1 - 1e-6, `after its owner's own deadline (${e.time})`);
      assert.ok(e.time <= 55 * 0.85 + 1e-6, `before the calm finish (${e.time})`);
      assert.equal(twists.filter(x => Math.abs(x - e.time) < 0.25).length, 1, `no twist on top of the cast at ${e.time}`);
    }
    assert.deepEqual(host.errors.map(String), []);
  } finally { await host.close(); }
});

test('every page reads its race clock off the room: a tab back from the background lands on the same moment, and all pages score one result', async () => {
  const host = loadGame({}, withChannel); let viewer;
  const same = what => assert.equal(viewer.$('timer').textContent, host.$('timer').textContent, `the same race second on both pages ${what}`);
  try {
    host.fill('setup-season-name', 'Mùa phòng'); host.fill('setup-names', 'Phú\nAn\nBình'); host.fill('setup-date', '2026-11-04'); host.fill('setup-rounds', '2'); host.fill('setup-duration', '55');
    submit(host, 'setup-form'); await settle();
    const code = host.storage()['vit-dua-room'];
    host.click('room-close'); host.click('skills-close');
    viewer = loadGame({}, { ...withChannel, url: `http://localhost/?phong=${code}&ten=An`, now: host.now() }); // tabs share the wall clock
    await sync(host, viewer);
    duck(host, 0).click(); await sync(host, viewer);
    duck(viewer, 1).click(); await sync(host, viewer);
    host.click('random-picks'); await sync(host, viewer);
    host.click('start'); await sync(host, viewer);
    for (let i = 0; i < 20; i++) { host.advance(500, 50); viewer.advance(500, 50); await settle(); }
    same('on screen');
    // The player's tab sits in the background for 15 s (time passes, no frames), while the host's plays the twists' slow motion.
    for (let i = 0; i < 30; i++) { host.advance(500, 50); viewer.advance(500, 50, false); await settle(); }
    host.advance(50, 50); viewer.advance(50, 50); await settle();
    same('after the player comes back');
    // Then the host's tab.
    for (let i = 0; i < 20; i++) { host.advance(500, 50, false); viewer.advance(500, 50); await settle(); }
    host.advance(50, 50); viewer.advance(50, 50); await settle();
    same('after the host comes back');
    for (let i = 0; i < 80 && !(host.$('result-dialog').open && viewer.$('result-dialog').open); i++) { host.advance(1000, 50); viewer.advance(1000, 50); await settle(); }
    await sync(host, viewer);
    assert.deepEqual(order(viewer), order(host), 'one result on every page');
    assert.deepEqual(host.errors.map(String), []); assert.deepEqual(viewer.errors.map(String), []);
  } finally { await host.close(); await viewer?.close(); }
});

test("with the host's tab in the background (its race clock stopped), a player's cast still lands where they pressed and every skill still fires on their page", async () => {
  const host = loadGame({}, missiles); let viewer;
  try {
    host.fill('setup-season-name', 'Mùa phòng'); host.fill('setup-names', 'Phú\nAn\nBình'); host.fill('setup-date', '2026-11-04'); host.fill('setup-rounds', '2'); host.fill('setup-duration', '55');
    submit(host, 'setup-form'); await settle();
    const code = host.storage()['vit-dua-room'];
    host.click('room-close'); host.click('skills-close');
    viewer = loadGame({}, { ...missiles, url: `http://localhost/?phong=${code}&ten=An` });
    await sync(host, viewer);
    duck(host, 0).click(); await sync(host, viewer);
    duck(viewer, 1).click(); await sync(host, viewer);
    host.click('random-picks'); await sync(host, viewer);
    host.click('start'); await sync(host, viewer);
    // From here only the player's page runs frames: the browser runs none in a background tab.
    for (let i = 0; i < 40 && viewer.$('cast').disabled; i++) { viewer.advance(500, 50); await settle(); }
    viewer.click('cast'); await settle(); await settle(); viewer.advance(100, 50); // the request hops to the host, its answer hops back
    const cast = current(host).active.lineup.casts[1];
    assert.ok(Number.isFinite(cast) && cast >= 55 * 0.12 + 1 - 1e-9 && cast <= 55 * 0.12 + 5, `placed from the player's own race time (${cast})`);
    assert.match(viewer.$('cast').textContent, /Đang gồng/, "the player's page has it before the wind-up ends");
    let missilesFired = 0; // the race log, read until the result clears it
    for (let i = 0; i < 120 && !viewer.$('result-dialog').open; i++) {
      missilesFired = [...viewer.window.document.querySelectorAll('#event-history > *')].filter(e => e.textContent.includes('🎯')).length;
      viewer.advance(1000, 50); await settle();
    }
    assert.equal(viewer.$('result-dialog').open, true);
    assert.equal(missilesFired, 3, "An's cast and both skills nobody cast all fired on An's page");
    // The host's tab comes back: it plays the rest of the race and scores the same result.
    for (let i = 0; i < 30 && !host.$('result-dialog').open; i++) { host.advance(4000, 50); await settle(); }
    assert.deepEqual(order(viewer), order(host));
    assert.deepEqual(host.errors.map(String), []); assert.deepEqual(viewer.errors.map(String), []);
  } finally { await host.close(); await viewer?.close(); }
});

test('a multi-target skill lets its owner pick that many rivals: the top ones are suggested, a click picks or drops one', async () => {
  const bees = dealing('bees'), host = loadGame({}, bees); let viewer;
  try {
    host.fill('setup-season-name', 'Mùa phòng'); host.fill('setup-names', 'Phú\nAn\nBình\nChi'); host.fill('setup-date', '2026-11-04'); host.fill('setup-rounds', '2'); host.fill('setup-duration', '55');
    submit(host, 'setup-form'); await settle();
    const code = host.storage()['vit-dua-room'];
    host.click('room-close'); host.click('skills-close');
    viewer = loadGame({}, { ...bees, url: `http://localhost/?phong=${code}&ten=An` });
    await sync(host, viewer);
    duck(host, 0).click(); await sync(host, viewer);
    duck(viewer, 1).click(); await sync(host, viewer);
    host.click('random-picks'); await sync(host, viewer); host.click('random-picks'); await sync(host, viewer);
    host.click('start'); await sync(host, viewer);
    for (let i = 0; i < 40 && viewer.$('cast').disabled; i++) await sync(host, viewer, 500);
    const targets = () => [...viewer.window.document.querySelectorAll('#cast-targets .cast-target')];
    const aimed = () => targets().filter(b => b.getAttribute('aria-checked') === 'true').map(b => Number(b.dataset.duckId));
    const at = id => targets().find(b => Number(b.dataset.duckId) === id);
    assert.equal(targets().length, 3);
    assert.match(viewer.$('cast-targets').textContent, /Nhắm 2 con/);
    const rankOf = id => { const t = at(id).textContent; return ['🥇', '🥈', '🥉'].indexOf([...t][0]) + 1 || Number(t.match(/#(\d+)/)[1]); };
    const top = aimed().sort((p, q) => rankOf(p) - rankOf(q)); // the buttons sit in lane order; the pick goes by rank
    assert.equal(top.length, 2, 'the bees strike two: the top two rivals are suggested');
    const other = targets().map(b => Number(b.dataset.duckId)).find(id => !top.includes(id));
    at(other).click(); assert.deepEqual(aimed().sort(), [top[0], other].sort(), 'a third pick keeps the leader and drops the other suggestion');
    at(top[0]).click(); assert.deepEqual(aimed().sort(), [top[0], other].sort(), 'always two lit: what is lit is what gets struck');
    at(top[1]).click(); assert.deepEqual(aimed().sort(), [top[0], top[1]].sort(), 'the leader was clicked last, so the older pick drops');
    const name = id => at(id).textContent.replace(/^\S+ /, '');
    assert.ok(viewer.$('cast').textContent.includes(`→ ${name(top[0])}, ${name(top[1])}!`), 'the button names both, leaders first');
    key(viewer, 'Space', ' '); await sync(host, viewer);
    assert.deepEqual(Array.from(current(host).active.lineup.targets[1]), [top[0], top[1]], 'both rivals reach the host, in the order picked');
    assert.deepEqual(host.errors.map(String), []); assert.deepEqual(viewer.errors.map(String), []);
  } finally { await host.close(); await viewer?.close(); }
});

test('lane obstacles and runes: in sight from the start; a player steers their own duck with ↑ ↓ from their page; the host gets the key', async () => {
  const host = loadGame({}, withChannel); let viewer;
  try {
    host.fill('setup-season-name', 'Mùa phòng'); host.fill('setup-names', 'Phú\nAn\nBình'); host.fill('setup-date', '2026-11-04'); host.fill('setup-rounds', '2'); host.fill('setup-duration', '55');
    submit(host, 'setup-form'); await settle();
    const code = host.storage()['vit-dua-room'];
    host.click('room-close'); host.click('skills-close');
    viewer = loadGame({}, { ...withChannel, url: `http://localhost/?phong=${code}&ten=An` });
    await sync(host, viewer);
    duck(host, 0).click(); await sync(host, viewer);
    duck(viewer, 1).click(); await sync(host, viewer);
    host.click('random-picks'); await sync(host, viewer);
    host.click('start'); await sync(host, viewer);
    const lineup = () => current(host).active.lineup, pad = viewer.$('dodge-pad');
    assert.equal(current(host).active.engine, 'chaos-v10');
    assert.deepEqual(lineup().pilots, [false, true, false], 'only the player who picked on their own page steers');
    assert.equal(pad.hidden, false, 'the player gets the pad');
    assert.equal(host.$('dodge-pad').hidden, true, 'the host does not');
    await sync(host, viewer, 150);
    assert.equal(viewer.window.document.querySelectorAll('.obstacle-marker').length, 0, 'nothing in sight at the start: the first things lie 15% down the course');
    for (let i = 0; i < 160 && pad.dataset.state !== 'reveal'; i++) await sync(host, viewer, 150);
    assert.equal(pad.dataset.state, 'reveal', viewer.$('dodge-status').textContent);
    const shown = [...viewer.window.document.querySelectorAll('.obstacle-marker[data-state="shown"]')];
    assert.ok(new Set(shown.map(m => m.parentElement)).size === shown.length, 'one thing per lane at a time');
    const mine = shown.find(m => m.classList.contains('mine'));
    assert.ok(mine, "the player's own next thing is in sight");
    assert.ok(mine.querySelector('svg.thing-art') && mine.textContent.trim() === '', 'drawn as the real thing, not an icon');
    const up = /nhảy/.test(viewer.$('dodge-status').textContent), name = up ? 'ArrowUp' : 'ArrowDown';
    assert.ok((up ? ['low', 'spark'] : ['high', 'pearl']).some(tier => mine.classList.contains(tier)), `its height matches the key (${mine.className})`);
    assert.ok(host.window.document.querySelectorAll('.obstacle-marker').length > 0, 'the host shows them too');
    // A change of mind: the wrong key, then at once the right one, before the host echoes either. The latest counts.
    const wrong = up ? 'ArrowDown' : 'ArrowUp';
    key(viewer, wrong, wrong); viewer.advance(60, 30); key(viewer, name, name); await sync(host, viewer, 50);
    assert.equal(pad.dataset.state, 'pressed', viewer.$('dodge-status').textContent);
    assert.equal(lineup().dodges[1]?.length, 2, 'the host has both keys');
    assert.equal(lineup().dodges[1].at(-1)[1], up ? 'up' : 'down');
    for (let i = 0; i < 40 && !['pass', 'hit'].includes(pad.dataset.state); i++) await sync(host, viewer, 100);
    assert.equal(pad.dataset.state, 'pass', viewer.$('dodge-status').textContent);
    assert.ok(![...viewer.$('event-history').children].some(li => /chướng ngại|NÉ ĐẸP|RUNE/i.test(li.textContent)), 'lane moments stay out of the race log');
  } finally { await host.close(); await viewer?.close(); }
});

// The commentator takes turns: a line is read to the end, then a short rest, then the next (skills first; a waiting line
// goes stale). Only the opening line may be cut short. Lane moments are read per person: a player's page reads their own
// duck's trips and runes, the host's page none.
test("commentator lines take turns, and each player hears their own duck's lane moments", async () => {
  const host = loadGame({}, withChannel); let viewer;
  try {
    host.fill('setup-season-name', 'Mùa phòng'); host.fill('setup-names', 'Phú\nAn\nBình'); host.fill('setup-date', '2026-11-04'); host.fill('setup-rounds', '2'); host.fill('setup-duration', '55');
    submit(host, 'setup-form'); await settle();
    const code = host.storage()['vit-dua-room'];
    host.click('room-close'); host.click('skills-close');
    viewer = loadGame({}, { ...withChannel, url: `http://localhost/?phong=${code}&ten=An` });
    await sync(host, viewer);
    duck(host, 0).click(); await sync(host, viewer);
    duck(viewer, 1).click(); await sync(host, viewer);
    host.click('random-picks'); await sync(host, viewer);
    host.click('start'); await sync(host, viewer);
    const heard = { host: [], viewer: [] }, clock = { t: 0 };
    const listen = (game, list) => { const text = game.$('commentary').textContent.replace(/^🎙️\s*/, ''); if (text && text !== list.at(-1)?.text) list.push({ t: clock.t, text }); };
    for (; clock.t < 150000 && !viewer.$('result-dialog').open; clock.t += 250) { await sync(host, viewer, 200); listen(host, heard.host); listen(viewer, heard.viewer); }
    for (const [page, said] of Object.entries(heard)) {
      const inRace = said.slice(1, -2); // past the opening line, short of the photo-finish call and the winner's line
      assert.ok(inRace.length >= 3, `${page}: the commentator talks through the race (${said.map(s => s.text).join(' | ')})`);
      for (let i = 1; i < inRace.length; i++) {
        const prev = inRace[i - 1], need = (1 + prev.text.length * 0.065) * 1000 + 1200;
        assert.ok(inRace[i].t - prev.t >= need - 300, `${page}: "${inRace[i].text}" came ${inRace[i].t - prev.t} ms after "${prev.text}" (needs ${Math.round(need)})`);
      }
    }
    // Lines only An's page read are An's own lane moments (the host's page reads none).
    const own = heard.viewer.slice(1, -2).filter(s => !heard.host.some(h => h.text === s.text));
    assert.ok(own.length >= 1 && own.every(s => s.text.includes('An')), `An hears their own duck's lane moments (${own.map(s => s.text).join(' | ')})`);
    assert.deepEqual([...host.errors, ...viewer.errors].map(String), []);
  } finally { await host.close(); await viewer?.close(); }
});

// chaos-v8: each player gets one quiz on their own page (5 s, keys 1–3); the answer goes to the host like a dodge key,
// the host's page (the shared screen) shows the open question and then how it went.
test("a player answers their own quiz from their page; the host gets the answer and shows the outcome", async () => {
  const host = loadGame({}, withChannel); let viewer;
  try {
    host.fill('setup-season-name', 'Mùa phòng'); host.fill('setup-names', 'Phú\nAn\nBình'); host.fill('setup-date', '2026-11-23'); host.fill('setup-rounds', '2'); host.fill('setup-duration', '55');
    submit(host, 'setup-form'); await settle();
    const code = host.storage()['vit-dua-room'];
    host.click('room-close'); host.click('skills-close');
    viewer = loadGame({}, { ...withChannel, url: `http://localhost/?phong=${code}&ten=An` });
    await sync(host, viewer);
    duck(host, 0).click(); await sync(host, viewer);
    duck(viewer, 1).click(); await sync(host, viewer);
    host.click('random-picks'); await sync(host, viewer);
    host.click('start'); await sync(host, viewer);
    assert.equal(current(host).active.engine, 'chaos-v10');
    const card = () => viewer.$('quiz-card'), board = () => host.$('quiz-board');
    let sawBoard = false;
    for (let i = 0; i < 260 && card()?.hidden !== false; i++) { await sync(host, viewer, 150); if (board()?.hidden === false && /An đang giải đố/.test(board().textContent)) sawBoard = true; }
    assert.equal(card()?.hidden, false, 'the question opens on the player page');
    assert.equal(card().querySelectorAll('.quiz-answer').length, 3);
    assert.match(viewer.$('dodge-status').textContent, /giải đố/, 'the pad says so');
    key(viewer, 'Digit2', '2'); await sync(host, viewer, 100);
    const sent = current(host).active.lineup.answers[1];
    assert.ok(Array.isArray(sent) && sent[1] === 1, `the host has the answer (${JSON.stringify(sent)})`);
    assert.ok(card().querySelectorAll('.quiz-answer:disabled').length === 3 && card().querySelector('.quiz-verdict').textContent.length > 0, 'answered: right or wrong at once');
    for (let i = 0; i < 60 && !/An:/.test(board()?.textContent || ''); i++) { await sync(host, viewer, 150); if (/An đang giải đố/.test(board()?.textContent || '')) sawBoard = true; }
    assert.ok(sawBoard, 'the host showed An\'s open question');
    assert.match(board().textContent, /An: (TRẢ LỜI ĐÚNG|TRỜI PHẠT)/, 'then how it went');
    assert.ok(![...viewer.$('event-history').children].some(li => /TRỜI PHẠT|TRẢ LỜI ĐÚNG/.test(li.textContent)), 'quizzes stay out of the race log');
    assert.deepEqual([...host.errors, ...viewer.errors].map(String), []);
  } finally { await host.close(); await viewer?.close(); }
});

// Keys on their way: a player page drops what the host never took, and follows every change of the host's race.
// `lost` makes the page's channel lose what it sends (requests) or what it gets (the host's snapshots).
const lossy = { beforeScripts(window) {
  window.BroadcastChannel = class extends Channel {
    postMessage(data) { if (window.lost?.requests && data?.kind === 'request') return; super.postMessage(data); }
    set onmessage(fn) { super.onmessage = fn && (event => { if (window.lost?.states && event.data?.kind === 'state') return; fn(event); }); }
    get onmessage() { return super.onmessage; }
  };
} };
async function roomRace(viewerOptions, deal = withChannel) {
  const host = loadGame({}, deal);
  host.fill('setup-season-name', 'Mùa phòng'); host.fill('setup-names', 'Phú\nAn\nBình'); host.fill('setup-date', '2026-11-23'); host.fill('setup-rounds', '2'); host.fill('setup-duration', '55');
  submit(host, 'setup-form'); await settle();
  const code = host.storage()['vit-dua-room'];
  host.click('room-close'); host.click('skills-close');
  const viewer = loadGame({}, { ...viewerOptions, ...(deal.scripts ? { scripts: deal.scripts } : {}), url: `http://localhost/?phong=${code}&ten=An` });
  await sync(host, viewer);
  duck(host, 0).click(); await sync(host, viewer);
  duck(viewer, 1).click(); await sync(host, viewer);
  host.click('random-picks'); await sync(host, viewer);
  host.click('start'); await sync(host, viewer);
  return { host, viewer };
}

test("a player's page keeps the host's race: a key the host echoed stays, a key that never got there leaves after its wait", async () => {
  const { host, viewer } = await roomRace(lossy);
  try {
    const shown = () => JSON.parse(viewer.$('river').dataset.lineup)[2][1], hostKeys = () => current(host).active.lineup.dodges[1];
    for (let i = 0; i < 20; i++) await sync(host, viewer, 200);
    key(viewer, 'ArrowUp'); await sync(host, viewer, 100);
    assert.equal(hostKeys()?.length, 1, 'the host has the first key');
    for (let i = 0; i < 30; i++) await sync(host, viewer, 200); // longer than a key waits for the host
    viewer.window.lost = { requests: true };
    key(viewer, 'ArrowDown'); await sync(host, viewer, 100);
    assert.equal(hostKeys().length, 1, 'the second key never got to the host');
    assert.deepEqual(shown().map(p => p[1]), ['up', 'down'], "the player's race keeps the key the host echoed and adds the one on its way");
    for (let i = 0; i < 30; i++) await sync(host, viewer, 200);
    assert.deepEqual(shown(), hostKeys(), "once its wait is over the lost key leaves: the page shows exactly the host's race");
    assert.deepEqual([...host.errors, ...viewer.errors].map(String), []);
  } finally { await host.close(); await viewer.close(); }
});

test("the host's result decides: a player page that missed the host's casts shows the host's order, even when the host's record came first", async () => {
  // Rooms until one where the casts the page missed change the order (blackholes: a leader drops to the back).
  let decisive = false;
  for (let attempt = 0; attempt < 10 && !decisive; attempt++) {
    const { host, viewer } = await roomRace(lossy, dealing('blackhole'));
    try {
      viewer.window.lost = { states: true }; // from here the page hears nothing from the host until the end
      for (let i = 0; i < 40 && host.window.document.querySelector('#skill-reveal [data-duck-id="0"]')?.dataset.cast !== 'ready'; i++) await sync(host, viewer, 500);
      host.click('#skill-reveal [data-duck-id="0"]'); host.click('#skill-reveal [data-duck-id="2"]'); await sync(host, viewer);
      const a = current(host).active, E = host.window.DuckChaosEngineV10, run = lineup => E.createRace(['a', 'b', 'c'], 55, a.seed, lineup).results.map(r => r.id).join();
      assert.ok([0, 2].every(d => Number.isFinite(a.lineup.casts[d])), 'the host cast for Phú and Bình');
      decisive = run(a.lineup) !== run({ ...a.lineup, casts: a.lineup.casts.map(() => null) });
      if (!decisive) continue;
      for (let i = 0; i < 30; i++) await sync(host, viewer, 1000);
      viewer.window.lost = null;
      for (let i = 0; i < 60 && !host.$('result-dialog').open; i++) { host.advance(2000, 50); await settle(); } // the host ends first
      assert.equal(host.$('result-dialog').open, true, 'the host ended');
      for (let i = 0; i < 60 && !viewer.$('result-dialog').open; i++) { viewer.advance(2000, 50); await settle(); }
      await sync(host, viewer);
      assert.equal(viewer.$('result-dialog').open, true, 'the player page ended');
      assert.deepEqual(order(viewer), order(host), "the player sees the host's order");
      assert.deepEqual([...host.errors, ...viewer.errors].map(String), []);
    } finally { await host.close(); await viewer.close(); }
  }
  assert.ok(decisive, 'found a room where the missed casts change the order');
});

test('every page of a room runs one build: index.html stamps it on each file; a player page on an older build reloads once', async () => {
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8'), app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  const build = /const BUILD='([^']+)'/.exec(app)[1];
  const files = [...html.matchAll(/(?:src|href)="([a-z0-9.-]+\.(?:js|css))(\?v=[^"]*)?"/g)];
  assert.ok(files.length >= 16, `${files.length} files`);
  for (const [, file, stamp] of files) assert.equal(stamp, `?v=${build}`, file);
  const old = app.replace(`const BUILD='${build}'`, "const BUILD='20000101-01'");
  const page = { beforeScripts(window) { withChannel.beforeScripts(window); window.location.replace = url => { window.reloadedTo = url; }; }, scripts: { 'app.js': old } };
  const { host, viewer } = await roomRace(page).catch(e => { throw e; });
  try {
    const to = new URL(viewer.window.reloadedTo);
    assert.equal(to.searchParams.get('v'), build, 'it reloads at a new address, so the browser fetches the new files');
    assert.equal(to.searchParams.get('ten'), 'An', 'back into the same room');
    assert.equal(viewer.window.sessionStorage.getItem('vit-dua-reload'), build, 'once: a page still on the old build after that says so instead');
  } finally { await host.close(); await viewer.close(); }
});

// ---- chaos-v9/v10 skills in a room: Phú (the host's duck 0) uses them on An (the player's duck 1) ----
const dealingList = skills => ({ ...withChannel, scripts: { 'chaos-engine-v2.js': engine.replace(missileDeal, `return { ...dealLineup(V10_RULES, count, seed), skills: ${JSON.stringify(skills)}.slice(0, count) };`) } });
const chipOf = (game, id) => game.window.document.querySelector(`#skill-reveal [data-duck-id="${id}"]`);
const raceTime = host => current(host).active?.elapsed ?? 0;

test('chaos-v10: a riddle one player aims at another opens on that page; the answer reaches the host and how it went shows on both', async () => {
  // Bình (a second player page) throws the riddle at An.
  const deal = dealingList(['pho', 'pho', 'riddle']), host = loadGame({}, deal); const pages = [];
  try {
    host.fill('setup-season-name', 'Mùa phòng'); host.fill('setup-names', 'Phú\nAn\nBình'); host.fill('setup-date', '2026-11-23'); host.fill('setup-rounds', '2'); host.fill('setup-duration', '55');
    submit(host, 'setup-form'); await settle();
    const code = host.storage()['vit-dua-room'];
    host.click('room-close'); host.click('skills-close');
    for (const name of ['An', 'Bình']) pages.push(loadGame({}, { ...deal, url: `http://localhost/?phong=${code}&ten=${name}` }));
    const [an, binh] = pages, sync3 = async (ms = 200) => { for (const g of [host, ...pages]) g.advance(ms, 50); await settle(); for (const g of [host, ...pages]) g.advance(50, 50); await settle(); };
    await sync3();
    for (let i = 0; i < 6 && host.$('start').disabled; i++) {
      const next = current(host).session.players.find(p => current(host).picks?.[p.id] === undefined);
      if (next?.name === 'An') duck(an, 1).click(); else if (next?.name === 'Bình') duck(binh, 2).click(); else duck(host, 0).click();
      await sync3();
    }
    host.click('start'); await sync3();
    assert.equal(current(host).active.engine, 'chaos-v10');
    assert.deepEqual(current(host).active.lineup.pilots, [false, true, true]);
    for (let i = 0; i < 40 && binh.$('cast').disabled; i++) await sync3(500);
    // Bình throws it while An is clear of their own quiz (a duck about to answer one is skipped).
    const a = current(host).active, quizAt = host.window.DuckChaosEngineV10.createRace(['a', 'b', 'c'], 55, a.seed, a.lineup).quizzes[1].at;
    if (quizAt <= 20) for (let i = 0; i < 80 && raceTime(host) < quizAt + 6; i++) await sync3(250);
    [...binh.window.document.querySelectorAll('#cast-targets .cast-target')].find(b => Number(b.dataset.duckId) === 1).click();
    binh.click('cast'); await sync3();
    const card = () => an.$('quiz-card');
    for (let i = 0; i < 60 && !card()?.classList.contains('riddle'); i++) await sync3(150);
    assert.ok(card().classList.contains('riddle') && card().hidden === false, 'the riddle opens on An\'s page');
    assert.match(card().textContent, /Đố mẹo của Bình/);
    assert.match(an.$('dodge-status').textContent, /giải đố/);
    assert.notEqual(binh.$('quiz-card')?.hidden, false, 'not on the thrower\'s page');
    key(an, 'Digit2', '2'); await sync3(100);
    const sent = current(host).active.lineup.riddles[1];
    assert.ok(Array.isArray(sent) && sent.length === 1 && sent[0][1] === 1, `the host has the answer (${JSON.stringify(sent)})`);
    for (let i = 0; i < 60 && !/An:/.test(host.$('quiz-board')?.textContent || ''); i++) await sync3(150);
    assert.match(host.$('quiz-board').textContent, /An: (TRẢ LỜI ĐÚNG|TRỜI PHẠT)/, 'the shared screen shows how it went');
    assert.equal(card().querySelectorAll('.quiz-answer:disabled').length, 3);
    assert.deepEqual([...host.errors, ...an.errors, ...binh.errors].map(String), []);
  } finally { await host.close(); for (const g of pages) await g.close(); }
});

test('chaos-v10: a pickpocket leaves its victim with nothing', async () => {
  const { host, viewer } = await roomRace(withChannel, dealingList(['pickpocket', 'missile', 'mirror']));
  try {
    for (let i = 0; i < 40 && chipOf(host, 0)?.dataset.cast !== 'ready'; i++) await sync(host, viewer, 500);
    host.click('#skill-reveal [data-duck-id="0"]');
    for (let i = 0; i < 40 && !/móc mất/.test(viewer.$('cast').textContent); i++) await sync(host, viewer, 200);
    assert.match(viewer.$('cast').textContent, /bị móc mất rồi/, "An's missile is gone");
    assert.equal(viewer.$('cast').disabled, true);
    assert.equal(chipOf(host, 1).dataset.cast, 'stolen');
    assert.deepEqual([...host.errors, ...viewer.errors].map(String), []);
  } finally { await host.close(); await viewer.close(); }
});

test('chaos-v10: a toll gate stands across every lane while it is open, and the upside-down world turns the ducks over', async () => {
  const { host, viewer } = await roomRace(withChannel, dealingList(['toll', 'pho', 'upside']));
  try {
    for (let i = 0; i < 40 && chipOf(host, 0)?.dataset.cast !== 'ready'; i++) await sync(host, viewer, 500);
    host.click('#skill-reveal [data-duck-id="0"]');
    for (let i = 0; i < 40 && !viewer.window.document.querySelector('.toll-gate'); i++) await sync(host, viewer, 200);
    assert.equal(viewer.window.document.querySelectorAll('.toll-gate').length, 3, 'one bar per lane');
    assert.equal(host.window.document.querySelectorAll('.toll-gate').length, 3);
    for (let i = 0; i < 60 && host.window.document.querySelector('.toll-gate'); i++) await sync(host, viewer, 200);
    assert.equal(host.window.document.querySelectorAll('.toll-gate').length, 0, 'gone when it closes');
    host.click('#skill-reveal [data-duck-id="2"]');
    for (let i = 0; i < 40 && !viewer.$('river').classList.contains('upside'); i++) await sync(host, viewer, 200);
    assert.ok(viewer.$('river').classList.contains('upside') && host.$('river').classList.contains('upside'));
    for (let i = 0; i < 40 && viewer.$('river').classList.contains('upside'); i++) await sync(host, viewer, 200);
    assert.ok(!viewer.$('river').classList.contains('upside'), 'for 4 s');
    assert.deepEqual([...host.errors, ...viewer.errors].map(String), []);
  } finally { await host.close(); await viewer.close(); }
});

// ---- A slow network: every page ends every round on exactly the host's race and result ----
// Each message hops with 40–260 ms of real delay, in order per page (like Firebase): with pages stepping 100 ms of race
// time per 25 ms of real time, that is about 0.2–1 s of race time on the way. The players press keys, answer their
// quizzes and riddles and cast their skills; the host casts for its own duck.
const slowNet = rnd => ({ beforeScripts(window) {
  let last = 0;
  window.BroadcastChannel = class extends Channel {
    postMessage(data) {
      const due = Math.max(last, Date.now() + 40 + Math.floor(rnd() * 220)); last = due;
      setTimeout(() => { try { super.postMessage(data); } catch {} }, due - Date.now());
    }
  };
} });
const tableOf = game => [...game.window.document.querySelectorAll('#result-content tbody tr')].map(r => r.textContent.replace(/\s+/g, ' ').trim());
const sigOf = l => JSON.stringify([l?.casts, l?.targets, l?.dodges, l?.answers, l?.riddles]);

test('over a slow network, with players pressing (and mashing), answering and casting, every page ends every round on the host\'s race and result', async () => {
  let seed = 20261124; const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32; };
  const host = loadGame({}, slowNet(rnd)), pages = [];
  try {
    host.fill('setup-season-name', 'Mùa mạng chậm'); host.fill('setup-names', 'Phú\nAn\nBình'); host.fill('setup-date', '2026-11-24'); host.fill('setup-rounds', '3'); host.fill('setup-duration', '55');
    submit(host, 'setup-form'); await settle();
    const code = host.storage()['vit-dua-room'];
    host.click('room-close'); host.click('skills-close');
    for (const name of ['An', 'Bình']) pages.push(loadGame({}, { ...slowNet(rnd), url: `http://localhost/?phong=${code}&ten=${name}` }));
    const all = [host, ...pages], wait = ms => new Promise(r => setTimeout(r, ms));
    const step = async (ms = 100) => { for (const g of all) g.advance(ms, 50); await wait(25); };
    for (let i = 0; i < 20; i++) await step();
    for (let round = 0; round < 3; round++) {
      // picks in turn: An and Bình on their own pages, Phú (and anyone left) on the host
      for (let i = 0; i < 40 && host.$('start').disabled; i++) {
        const next = current(host).session.players.find(p => current(host).picks?.[p.id] === undefined);
        const page = pages.find((g, k) => next?.name === ['An', 'Bình'][k]);
        const free = g => [...g.window.document.querySelectorAll('#duck-grid [data-duck-id]')].find(b => !b.disabled);
        if (page) free(page)?.click(); else if (next) free(host)?.click();
        for (let k = 0; k < 6; k++) await step();
      }
      host.click('start');
      const id = current(host).active.id;
      assert.equal(current(host).active.engine, 'chaos-v10');
      for (let i = 0; i < 1400 && !all.every(g => g.$('result-dialog').open); i++) {
        for (const g of pages) {
          const doc = g.window.document, pad = doc.getElementById('dodge-pad');
          if (rnd() < .3) key(g, rnd() < .5 ? 'ArrowUp' : 'ArrowDown'); // some players mash the keys (past the 60 a race the host keeps)
          if (pad?.dataset.state === 'reveal' && rnd() < .5) { const k = rnd() < .8 ? (/nhảy/.test(doc.getElementById('dodge-status').textContent) ? 'ArrowUp' : 'ArrowDown') : 'ArrowUp'; key(g, k); }
          if (doc.getElementById('quiz-card')?.hidden === false && !doc.querySelector('#quiz-card .quiz-answer:disabled') && rnd() < .3) { const d = String(1 + Math.floor(rnd() * 3)); key(g, 'Digit' + d, d); }
          const cast = doc.getElementById('cast');
          if (cast && !cast.hidden && !cast.disabled && rnd() < .04) cast.click();
        }
        const chip = host.window.document.querySelector('#skill-reveal [data-duck-id][data-cast="ready"]');
        if (chip && rnd() < .02) chip.click();
        await step();
      }
      for (let i = 0; i < 40; i++) await step(); // the host's record reaches every page
      assert.ok(all.every(g => g.$('result-dialog').open), `round ${round + 1}: every page shows the result`);
      const replay = current(host).raceReplays.find(r => r.id === id), table = tableOf(host);
      assert.ok(table.length === 3, table.join(' / '));
      pages.forEach((g, k) => {
        assert.deepEqual(tableOf(g), table, `round ${round + 1}: ${['An', 'Bình'][k]} sees the host's ranks and points`);
        assert.equal(g.$('river').dataset.ended, sigOf(replay.lineup), `round ${round + 1}: ${['An', 'Bình'][k]}'s race ended on the host's inputs`);
      });
      const inputs = replay.lineup.dodges.filter(Boolean).flat().length + replay.lineup.answers.filter(Boolean).length + replay.lineup.casts.filter(c => c !== null).length;
      assert.ok(inputs > 0, `round ${round + 1}: the players did something (${inputs} inputs)`);
      if (round < 2) { host.click('result-next'); for (let i = 0; i < 10; i++) await step(); }
    }
    assert.deepEqual([...host.errors, ...pages.flatMap(g => g.errors)].map(String), []);
  } finally { await host.close(); for (const g of pages) await g.close(); }
});
