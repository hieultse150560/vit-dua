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
    duck(host, 0).click(); await sync(host, viewer);
    assert.match(viewer.$('viewer-pill').textContent, /ĐẾN LƯỢT BẠN/);
    assert.equal(duck(viewer, 1).disabled, false);
    duck(viewer, 1).click(); await sync(host, viewer);
    assert.deepEqual(current(host).picks, { p0: 0, p1: 1 }, "An's pick reached the host through the queue");
    duck(host, 2).click(); await sync(host, viewer);

    host.click('start'); await sync(host, viewer, 100);
    assert.equal(viewer.$('track').hidden, false, "the race plays on the player's page");
    assert.ok(viewer.window.document.querySelector('.racer.mine'), 'their own duck glows');
    for (let i = 0; i < 30; i++) { host.advance(4000, 50); viewer.advance(4000, 50); await settle(); }
    assert.equal(current(host).session.rounds.length, 1, 'the host scored the round');
    assert.equal(viewer.$('result-dialog').open, true, 'the player sees the result');
    assert.equal(viewer.storage()[KEY], undefined, "a player's page never writes the tournament");
    assert.deepEqual(host.errors.map(String), []); assert.deepEqual(viewer.errors.map(String), []);
  } finally { await host.close(); await viewer?.close(); }
});

test('with a room open, a player who does not pick within 5 s gets a random duck', async () => {
  const host = loadGame({}, withChannel); let viewer;
  try {
    host.fill('setup-season-name', 'Mùa phòng'); host.fill('setup-names', 'Phú\nAn\nBình'); host.fill('setup-date', '2026-11-04'); host.fill('setup-rounds', '2'); host.fill('setup-duration', '40');
    submit(host, 'setup-form'); await settle();
    const code = host.storage()['vit-dua-room'];
    viewer = loadGame({}, { ...withChannel, url: `http://localhost/?phong=${code}&ten=An` });
    await sync(host, viewer);
    assert.equal(host.$('pick-clock').hidden, false);
    assert.match(viewer.$('pick-clock').textContent, /⏱ [345]s/, 'the player sees the countdown too');
    host.advance(5200, 100); await settle();
    assert.equal(Object.keys(current(host).picks).length, 1, "Phú's turn ran out: a random duck");
    assert.ok(current(host).picks.p0 !== undefined);
    host.advance(5200, 100); await settle();
    assert.equal(Object.keys(current(host).picks).length, 2, "then An's");
    assert.deepEqual(host.errors.map(String), []); assert.deepEqual(viewer.errors.map(String), []);
  } finally { await host.close(); await viewer?.close(); }
});
