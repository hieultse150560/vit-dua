import test from 'node:test';
import assert from 'node:assert/strict';
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
async function sync(host, viewer, ms = 200) { host.advance(ms, 50); viewer?.advance(ms, 50); await settle(); host.advance(50, 50); viewer?.advance(50, 50); await settle(); }

test('a race room: each player picks on their own turn from their own page and watches the race there', async () => {
  const host = loadGame({}, withChannel); let viewer;
  try {
    host.fill('setup-season-name', 'Mùa phòng'); host.fill('setup-names', 'Phú\nAn\nBình'); host.fill('setup-date', '2026-11-04'); host.fill('setup-rounds', '2'); host.fill('setup-duration', '40');
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
    host.fill('setup-season-name', 'Mùa phòng'); host.fill('setup-names', 'Phú\nAn\nBình'); host.fill('setup-date', '2026-11-04'); host.fill('setup-rounds', '2'); host.fill('setup-duration', '40');
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
    host.fill('setup-season-name', 'Mùa phòng'); host.fill('setup-names', 'Phú\nAn\nBình'); host.fill('setup-date', '2026-11-04'); host.fill('setup-rounds', '2'); host.fill('setup-duration', '40');
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

    host.click('result-next'); await sync(host, viewer);
    assert.equal(viewer.$('result-dialog').open, false, "the host's next pick round closes the player's result, so they can pick");

    while (current(host).stage !== 'complete') {
      await pickAll(); host.click('start'); await sync(host, viewer);
      await race(); host.click('result-next'); await sync(host, viewer);
    }
    assert.equal(viewer.$('result-dialog').open, true, 'the player sees the day summary');
    assert.match(viewer.$('result-label').textContent, /TỔNG KẾT NGÀY/);
    assert.deepEqual(host.errors.map(String), []); assert.deepEqual(viewer.errors.map(String), []);
  } finally { await host.close(); await viewer?.close(); }
});

test('in a room each player casts their own skill from their page; the host casts for others, then for whoever waits too long', async () => {
  const host = loadGame({}, withChannel); let viewer;
  const PASSIVE = ['mirror', 'buoy'];
  try {
    host.fill('setup-season-name', 'Mùa phòng'); host.fill('setup-names', 'Phú\nAn\nBình'); host.fill('setup-date', '2026-11-04'); host.fill('setup-rounds', '2'); host.fill('setup-duration', '40');
    submit(host, 'setup-form'); await settle();
    const code = host.storage()['vit-dua-room'];
    host.click('room-close'); host.click('skills-close');
    viewer = loadGame({}, { ...withChannel, url: `http://localhost/?phong=${code}&ten=An` });
    await sync(host, viewer);

    // An takes a duck with an active skill, Phú (picked on the host) another one, Bình the last.
    const skills = current(host).lineup.skills, active = skills.map((s, i) => i).filter(i => !PASSIVE.includes(skills[i]));
    const anDuck = active[0], phuDuck = active.length > 1 ? active[1] : [0, 1, 2].find(i => i !== anDuck);
    duck(host, phuDuck).click(); await sync(host, viewer);
    duck(viewer, anDuck).click(); await sync(host, viewer);
    host.click('random-picks'); await sync(host, viewer);
    assert.equal(current(host).picks.p1, anDuck);

    host.click('slow-fx'); await sync(host, viewer); // the host switches to fast effects
    assert.equal(viewer.$('slow-fx').getAttribute('aria-pressed'), 'false', "players play at the host's effect speed, so their race clocks stay together");
    host.click('start'); await sync(host, viewer);
    assert.deepEqual(current(host).active.lineup.casts, [null, null, null], 'a race started with the room open waits for every cast');
    assert.equal(viewer.$('cast').hidden, false, 'the player sees their skill button');
    assert.equal(viewer.$('cast').disabled, true);
    assert.match(viewer.$('cast').textContent, /mở sau/, 'locked for the first seconds');
    assert.match(viewer.$('skill-mode').textContent, /Chủ vịt tự bấm/); assert.match(host.$('skill-mode').textContent, /bấm ô để tung hộ/);

    for (let i = 0; i < 40 && viewer.$('cast').disabled; i++) await sync(host, viewer, 500);
    assert.match(viewer.$('cast').textContent, /TUNG .* còn \d+s/);
    viewer.click('cast'); await sync(host, viewer);
    const cast = current(host).active.lineup.casts[anDuck], at = current(host).active.elapsed;
    assert.ok(Number.isFinite(cast) && cast >= at, `An's cast lands ahead of the race clock (${cast} vs ${at})`);
    await sync(host, viewer); // the host's snapshot hops back to the player
    assert.match(viewer.$('cast').textContent, /Đang gồng|Đã tung/, "the player's page follows");
    assert.equal(viewer.window.document.querySelector(`#skill-reveal [data-duck-id="${anDuck}"]`).dataset.cast, 'charging');

    // The host casts Phú's skill by clicking its chip (Phú plays on the host's screen).
    if (!PASSIVE.includes(skills[phuDuck])) {
      host.click(`#skill-reveal [data-duck-id="${phuDuck}"]`); await sync(host, viewer);
      assert.ok(Number.isFinite(current(host).active.lineup.casts[phuDuck]), "the host cast Phú's skill");
    }
    for (let i = 0; i < 40 && !host.$('result-dialog').open; i++) { host.advance(4000, 50); viewer.advance(4000, 50); await settle(); }
    await sync(host, viewer);

    const replay = current(host).raceReplays.at(-1), casts = replay.lineup.casts;
    for (const [i, s] of skills.entries()) assert.equal(PASSIVE.includes(s) ? casts[i] === null : Number.isFinite(casts[i]), true, `duck ${i} (${s}): ${casts[i]}`);
    const race = host.window.DuckChaosEngineV3.createRace(skills.map((_, i) => host.window.DuckArt.name(i)), 40, replay.seed, replay.lineup);
    const fired = race.events.find(e => e.type === 'skill' && e.activation && e.actorId === anDuck);
    assert.ok(fired && Math.abs(fired.time - cast) < 0.06, "the replay fires An's skill when An cast it");
    assert.deepEqual(current(host).session.rounds[0].entries.map(e => e.duckId), Array.from(race.results, r => r.id), 'the replay rebuilds the scored race');
    const order = game => [...game.window.document.querySelectorAll('#result-content tbody tr')].map(r => r.children[1].textContent);
    assert.deepEqual(order(viewer), order(host), 'the player saw the same race');
    assert.deepEqual(host.errors.map(String), []); assert.deepEqual(viewer.errors.map(String), []);
  } finally { await host.close(); await viewer?.close(); }
});

test('when nobody casts, the host casts every skill after the deadline, spread out and before the finale rock', async () => {
  const host = loadGame({}, withChannel);
  try {
    host.fill('setup-season-name', 'Mùa phòng'); host.fill('setup-names', 'A\nB\nC\nD\nE\nF\nG\nH'); host.fill('setup-date', '2026-11-04'); host.fill('setup-rounds', '2'); host.fill('setup-duration', '40');
    submit(host, 'setup-form'); await settle();
    host.click('room-close'); host.click('skills-close');
    for (let i = 0; i < 8; i++) host.click('random-picks');
    host.click('start');
    for (let i = 0; i < 40 && !host.$('result-dialog').open; i++) host.advance(4000, 50);
    const replay = current(host).raceReplays.at(-1), skills = replay.lineup.skills, casts = replay.lineup.casts;
    for (const [i, s] of skills.entries()) assert.equal(['mirror', 'buoy'].includes(s) ? casts[i] === null : casts[i] >= 40 * 0.55, true, `duck ${i} (${s}) cast at ${casts[i]}`);
    const race = host.window.DuckChaosEngineV3.createRace(skills.map((_, i) => host.window.DuckArt.name(i)), 40, replay.seed, replay.lineup);
    const finale = race.events.find(e => e.finale), times = casts.filter(c => c !== null);
    if (finale) assert.ok(times.every(c => c < finale.time), `every cast lands before the finale rock (${finale.time})`);
    const twists = race.events.filter(e => e.scheduled).map(e => e.time);
    for (const c of times) assert.ok(twists.filter(x => Math.abs(x - c) < 0.25).length === 1, `no twist on top of the cast at ${c}`);
    assert.deepEqual(host.errors.map(String), []);
  } finally { await host.close(); }
});
