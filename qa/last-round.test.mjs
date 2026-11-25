import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadGame } from './harness.mjs';

// A whole room day over the end of its last round (⭐ forced there), checked the way players see it: each page's race
// ends on the host's inputs (its last frame is the host's river), and its table and day summary are the host's.
const KEY = 'vit-dua-seasons-v3';
class Channel extends globalThis.BroadcastChannel { constructor(name) { super(name); this.unref(); } }
const withChannel = { beforeScripts(window) { window.BroadcastChannel = Channel; } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const submit = (game, id) => game.$(id).dispatchEvent(new game.window.Event('submit', { bubbles: true, cancelable: true }));
const current = game => { const store = JSON.parse(game.storage()[KEY]); return store.sessions.find(entry => entry.session.id === store.currentId); };
const key = (game, code) => game.window.document.body.dispatchEvent(new game.window.KeyboardEvent('keydown', { code, key: code, bubbles: true }));
const tableOf = game => [...game.window.document.querySelectorAll('#result-content tbody tr')].map(r => r.textContent.replace(/\s+/g, ' ').trim());
const sigOf = l => JSON.stringify([l?.casts, l?.targets, l?.dodges, l?.answers, l?.riddles]);

async function playDay({ host: hostOptions = {}, hiddenHost = false, rounds = 2 } = {}) {
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32; };
  const host = loadGame({}, { ...withChannel, ...hostOptions }), pages = [];
  try {
    host.fill('setup-season-name', 'Mùa cuối'); host.fill('setup-names', 'Phú\nAn\nBình'); host.fill('setup-date', '2026-11-25'); host.fill('setup-rounds', String(rounds)); host.fill('setup-duration', '55');
    submit(host, 'setup-form'); await wait(30);
    const code = host.storage()['vit-dua-room'];
    host.click('room-close'); host.click('skills-close');
    for (const name of ['An', 'Bình']) pages.push(loadGame({}, { ...withChannel, url: `http://localhost/?phong=${code}&ten=${name}` }));
    const all = [host, ...pages];
    const step = async (games = all, ms = 100) => { for (const g of games) g.advance(ms, 50); await wait(20); };
    for (let i = 0; i < 10; i++) await step();
    for (let round = 0; round < rounds; round++) {
      const last = round === rounds - 1;
      for (let i = 0; i < 40 && host.$('start').disabled; i++) {
        const next = current(host).session.players.find(p => current(host).picks?.[p.id] === undefined);
        const page = pages[['An', 'Bình'].indexOf(next?.name)];
        const free = g => [...g.window.document.querySelectorAll('#duck-grid [data-duck-id]')].find(b => !b.disabled);
        if (page) { if (round === 0 && next.name === 'An' && !page.$('star-toggle').hidden && !page.$('star-toggle').disabled) page.click('star-toggle'); free(page)?.click(); } // An spends the star early
        else if (next) free(host)?.click();
        for (let j = 0; j < 6; j++) await step();
      }
      host.click('start');
      const id = current(host).active.id;
      for (let i = 0; i < 6; i++) await step();
      // In the last round the host's tab may sit in the background: its clock and timers go on, without frames.
      const racing = hiddenHost && last ? pages : all;
      for (let i = 0; i < 1400 && !pages.every(g => g.$('river').dataset.ended); i++) {
        for (const g of pages) {
          if (rnd() < .3) key(g, rnd() < .5 ? 'ArrowUp' : 'ArrowDown');
          const cast = g.$('cast'); if (cast && !cast.hidden && !cast.disabled && rnd() < .04) cast.click();
        }
        if (racing !== all) host.advance(100, 50, false);
        await step(racing);
      }
      for (let i = 0; i < 100 && !all.every(g => g.$('result-dialog').open); i++) await step(); // the host's tab is back
      for (let i = 0; i < 20; i++) await step();
      const replay = current(host).raceReplays.find(r => r.id === id), table = tableOf(host);
      assert.equal(table.length, 3);
      pages.forEach((g, k) => {
        const who = `round ${round + 1}: ${['An', 'Bình'][k]}`;
        assert.equal(g.$('river').dataset.ended, sigOf(replay.lineup), `${who}'s race ended on the host's inputs`);
        assert.deepEqual(tableOf(g), table, `${who} sees the host's ranks and points`);
      });
      host.click('result-next'); for (let i = 0; i < 10; i++) await step();
    }
    const final = tableOf(host);
    assert.match(host.$('result-label').textContent, /TỔNG KẾT NGÀY/);
    pages.forEach((g, k) => assert.deepEqual(tableOf(g), final, `day summary: ${['An', 'Bình'][k]} sees the host's totals`));
    assert.deepEqual([...host.errors, ...pages.flatMap(g => g.errors)].map(String), []);
  } finally { await host.close(); for (const g of pages) await g.close(); }
}

test("the day's last round (⭐ forced) scores the same on every page, with the host's tab in the background", () => playDay({ hiddenHost: true }));

// A host whose tab still runs yesterday's build races chaos-v9, whose deck has the speed camera that chaos-v10 dropped.
// The players' pages (today's build) must still take every key, cast and answer of that race.
test("a host still on the build before chaos-v10 (its races chaos-v9, a speed camera dealt): the players' pages keep its race", () => {
  const app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8'), engine = readFileSync(new URL('../dist/chaos-engine-v2.js', import.meta.url), 'utf8');
  const oldApp = app.replace('C3=DuckChaosEngineV10', 'C3=DuckChaosEngineV9').replace(/const BUILD='[\w-]+'/, "const BUILD='20261123-02'");
  const deal = 'return dealLineup(V9_RULES, count, seed);', cameras = engine.replace(deal, "{ const l = dealLineup(V9_RULES, count, seed); return { ...l, skills: l.skills.map((s, i) => (i ? s : 'camera')) }; }");
  assert.ok(oldApp !== app && cameras !== engine, 'the files changed: update this test');
  return playDay({ host: { scripts: { 'app.js': oldApp, 'chaos-engine-v2.js': cameras } }, rounds: 1 });
});
