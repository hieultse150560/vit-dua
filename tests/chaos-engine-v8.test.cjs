'use strict';
// chaos-v8: chaos-v7 with one quiz per duck in race rooms. lineup.answers[duck] = [race time, choice 0–2]: counted when
// given while the question is open; right (or lucky, for a duck nobody steers) = a speed rune, wrong or late = one of
// three punishments from the sky.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../dist/chaos-engine-v2.js');
const Bank = require('../dist/quiz-bank.js');
const V7 = E.v7, V8 = E.v8;
const names = count => Array.from({ length: count }, (_, i) => `V${i}`);
const D = 55;
const room = (n, seed, extra = {}) => ({ ...V8.deal(n, seed), casts: Array(n).fill(null), pilots: Array(n).fill(true), dodges: Array(n).fill(null), answers: Array(n).fill(null), ...extra });
const quizEvents = race => race.events.filter(e => e.type === 'quiz');

test('chaos-v8 keeps chaos-v7 and adds the quiz tuning; quizzes only in race rooms', () => {
  assert.equal(V8.version, 'chaos-v8');
  assert.deepEqual(V8.skills, V7.skills);
  const { quiz, ...rest } = V8.tuning;
  assert.deepEqual(rest, V7.tuning);
  assert.equal(quiz.time, 5);
  assert.equal(V8.createRace(names(4), D, 3, V8.deal(4, 3)).quizzes, undefined, 'no quiz without a room');
  assert.equal(V7.createRace(names(4), D, 3, { ...V7.deal(4, 3), casts: Array(4).fill(null), pilots: Array(4).fill(true), dodges: Array(4).fill(null) }).quizzes, undefined);
});

test('every duck gets one quiz, spread through the middle of the race, settled once when its time is up', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const n = 3 + seed % 6, race = V8.createRace(names(n), D, seed, room(n, seed)), qs = race.quizzes;
    assert.equal(qs.length, n);
    assert.deepEqual(qs.map(q => q.duck), [...Array(n).keys()]);
    const times = qs.map(q => q.at).sort((a, b) => a - b);
    assert.ok(times[0] >= D * 0.22 - 0.01 && times.at(-1) <= D * 0.66 + 0.01, `seed ${seed}: ${times}`);
    // one per stretch of the window, jittered within its middle 60%: at least 0.4 of a stretch apart
    for (let i = 1; i < n; i++) assert.ok(times[i] - times[i - 1] > 0.4 * D * 0.44 / n - 0.05, `seed ${seed}: quizzes open one after another`);
    const settled = quizEvents(race);
    assert.deepEqual(settled.map(e => e.actorId).sort(), [...Array(n).keys()], 'each settled once');
    for (const e of settled) assert.ok(Math.abs(e.time - (qs[e.actorId].at + race.quizTime)) < 0.06, 'at the end of its 5 s');
    for (const q of qs) assert.ok([0, 1, 2].includes(q.right) && Number.isInteger(q.pick) && q.pick >= 0);
  }
});

test('right = a speed rune; wrong or late = lightning, a rain cloud or a wave; a lucky guess for a duck nobody steers', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const base = V8.createRace(names(4), D, seed, room(4, seed)), qs = base.quizzes;
    const answers = qs.map(q => [Math.round((q.at + 1) * 100) / 100, q.duck % 2 ? q.right : (q.right + 1) % 3]);
    const race = V8.createRace(names(4), D, seed, room(4, seed, { answers }));
    for (const e of quizEvents(race)) {
      if (e.actorId % 2) { assert.equal(e.outcome, 'right'); assert.equal(e.penalty, null); }
      else { assert.equal(e.outcome, 'wrong'); assert.ok(['lightning', 'cloud', 'wave'].includes(e.penalty)); seen.add(e.penalty); }
      assert.equal(e.choice, answers[e.actorId][1]);
    }
    for (const e of quizEvents(base)) assert.equal(e.outcome, 'late', 'a steered duck with no answer is late');
  }
  assert.deepEqual([...seen].sort(), ['cloud', 'lightning', 'wave'], 'all three punishments come up');
  let lucky = 0, total = 0;
  for (let seed = 1; seed <= 60; seed++) for (const e of quizEvents(V8.createRace(names(6), D, seed, room(6, seed, { pilots: Array(6).fill(false) })))) { total++; if (e.outcome === 'lucky') lucky++; }
  assert.ok(lucky / total > 0.45 && lucky / total < 0.75, `about 60% lucky (${lucky}/${total})`);
});

test('an answer outside the open question does not count; a right answer gives a speed rune, a wave pushes back', () => {
  const seed = 11, base = V8.createRace(names(4), D, seed, room(4, seed)), q = base.quizzes[0];
  const early = V8.createRace(names(4), D, seed, room(4, seed, { answers: [[q.at - 0.5, q.right], null, null, null] }));
  assert.equal(quizEvents(early).find(e => e.actorId === 0).outcome, 'late');
  const tooLate = V8.createRace(names(4), D, seed, room(4, seed, { answers: [[q.at + 5.2, q.right], null, null, null] }));
  assert.equal(quizEvents(tooLate).find(e => e.actorId === 0).outcome, 'late');
  const right = V8.createRace(names(4), D, seed, room(4, seed, { answers: [[q.at + 2, q.right], null, null, null] }));
  const t = quizEvents(right).find(x => x.actorId === 0).time;
  assert.ok(right.sample(t + 0.5).find(x => x.id === 0).boosting, 'the rune makes it swim faster for a moment');
  assert.ok(!base.sample(t + 0.5).find(x => x.id === 0).boosting);
});

test('an answer only changes the race from its quiz settling on; the lane keeps quiet around a quiz', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const base = V8.createRace(names(5), D, seed, room(5, seed)), q = base.quizzes[2];
    const answers = Array(5).fill(null); answers[2] = [Math.round((q.at + 2) * 100) / 100, q.right];
    const answered = V8.createRace(names(5), D, seed, room(5, seed, { answers }));
    // (progress is where the page draws a lane thing; the display scale moves with every input, so it is left out)
    const upTo = r => r.events.filter(e => e.time < q.at + 5 - 1e-9).map(({ progress, ...e }) => e);
    assert.deepEqual(upTo(answered), upTo(base), `seed ${seed}`);
    for (const e of base.events.filter(x => x.type === 'obstacle')) {
      const z = base.quizzes[e.actorId];
      assert.ok(e.time < z.at - 1 - 1e-6 || e.time > z.at + 5.5 + 1e-6, `seed ${seed}: no lane moment while answering`);
    }
  }
});

test('answers are validated', () => {
  for (const answers of [[], Array(3).fill(null), [[1, 3], null, null, null], [[-1, 0], null, null, null], [['1', 0], null, null, null], [[1], null, null, null]])
    assert.throws(() => V8.createRace(names(4), D, 1, room(4, 1, { answers })), /đố vui/);
});

test('the quiz bank: 90 short questions, 30 per topic, three distinct answers each (the first is right)', () => {
  const bank = Bank.bank;
  assert.equal(bank.length, 90);
  for (const topic of ['chinh-ta', 'thanh-ngu', 'kien-thuc']) assert.equal(bank.filter(x => x.topic === topic).length, 30);
  for (const x of bank) {
    assert.ok(x.q.length > 0 && x.q.length <= 60, x.q);
    assert.equal(x.a.length, 3);
    assert.equal(new Set(x.a).size, 3, x.q);
    assert.ok(x.a.every(a => a.length > 0 && a.length <= 22), x.q);
  }
});
