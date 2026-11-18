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
const missileDeal = 'return dealLineup(V5_RULES, count, seed);';
if (!engine.includes(missileDeal)) throw Error('the engine changed: update missileDeal');
const dealing = skill => ({ ...withChannel, scripts: { 'chaos-engine-v2.js': engine.replace(missileDeal, `return { ...dealLineup(V5_RULES, count, seed), skills: Array(count).fill('${skill}') };`) } });
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
    const race = host.window.DuckChaosEngineV5.createRace(skills.map((_, i) => host.window.DuckArt.name(i)), 55, replay.seed, replay.lineup);
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
    const race = host.window.DuckChaosEngineV5.createRace(skills.map((_, i) => host.window.DuckArt.name(i)), 55, replay.seed, replay.lineup);
    const active = skills.map((s, i) => i).filter(i => !['mirror', 'buoy'].includes(skills[i]));
    const fired = race.events.filter(e => e.type === 'skill' && e.activation && e.scheduled && active.includes(e.actorId));
    assert.deepEqual(Array.from(fired, e => e.actorId).sort(), Array.from(active), 'every active skill fired, once');
    const twists = race.events.filter(e => e.scheduled).map(e => e.time);
    assert.ok(!race.events.some(e => e.finale), 'no finale rock');
    for (const e of fired) {
      assert.ok(e.time >= 55 * 0.45, `after the deadline (${e.time})`);
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
    assert.equal(current(host).active.engine, 'chaos-v5');
    assert.deepEqual(lineup().pilots, [false, true, false], 'only the player who picked on their own page steers');
    assert.equal(pad.hidden, false, 'the player gets the pad');
    assert.equal(host.$('dodge-pad').hidden, true, 'the host does not');
    await sync(host, viewer, 150);
    const atStart = [...viewer.window.document.querySelectorAll('.obstacle-marker')], runes = lineup().rule === 'runes' ? 4 : 2; // rune rain doubles them
    assert.equal(atStart.length, 3 * (4 + runes), 'every lane shows its 4 obstacles and its runes from the start');
    assert.ok(atStart.every(m => m.dataset.state === 'shown' && !m.textContent.includes('❓')), 'no mystery boxes: each shows what it is');
    assert.equal(atStart.filter(m => m.classList.contains('rune-item')).length, 3 * runes);
    for (let i = 0; i < 160 && pad.dataset.state !== 'reveal'; i++) await sync(host, viewer, 150);
    assert.equal(pad.dataset.state, 'reveal', viewer.$('dodge-status').textContent);
    const markers = [...viewer.window.document.querySelectorAll('.obstacle-marker')];
    assert.ok(markers.length >= 3 * 3 - 3, `the river shows each lane's obstacles (${markers.length})`);
    assert.ok(markers.some(m => m.classList.contains('mine') && m.dataset.state === 'shown'), "the player's own obstacle is revealed");
    assert.ok(host.window.document.querySelectorAll('.obstacle-marker').length > 0, 'the host shows them too');
    const up = /nhảy/.test(viewer.$('dodge-status').textContent), name = up ? 'ArrowUp' : 'ArrowDown';
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
