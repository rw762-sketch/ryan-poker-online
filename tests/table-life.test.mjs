import test from 'node:test';
import assert from 'node:assert/strict';
import { Poker } from '../engine.js';
import { seededRandom } from '../poker-math.js';
import { readObservation } from '../strategy.js';
import { randomStyle, stylePersona, chooseNeuralDecision, riskUtility, driftStyle, styleThinkTime } from '../neural-policy.js';
import { cleanTableConfig, betPresets, blindsOf, stackDepth } from '../table-config.js';
import { dealerEvent, makeDealer } from '../dealer.js';
import { blinkDelay, nextGaze, tasteOf, canBlink } from '../faces.js';
import { drinkLine } from '../table-talk.js';

test('tables can be set up with other blinds and stacks', () => {
  const g = new Poker({ stack: 5000, smallBlind: 25, bigBlind: 50 });
  g.start(seededRandom(3));
  assert.equal(g.pot, 75);
  assert.equal(g.current, 50);
  assert.equal(g.players.reduce((n, p) => n + p.stack, 0) + g.pot, 30000);
  const o = g.options();
  assert.equal(o.min, 100);
  const obs = readObservation(g);
  assert.equal(obs.bigBlind, 50);
  assert.equal(obs.unopened, true);
});

test('table settings are cleaned and summarised', () => {
  assert.deepEqual(cleanTableConfig({ seats: '9', blinds: 'x', stack: 123 }), { seats: 6, blinds: '10/20', stack: 1000 });
  assert.deepEqual(cleanTableConfig({ seats: 2, blinds: '50/100', stack: '2000' }), { seats: 2, blinds: '50/100', stack: 2000 });
  assert.deepEqual(blindsOf({ blinds: '25/50' }), [25, 50]);
  assert.equal(stackDepth({ blinds: '50/100', stack: 500 }), 5);
});

test('bet presets are legal, distinct and snap to the small blind', () => {
  const presets = betPresets({ pot: 90, current: 60, call: 60, min: 120, max: 1000, smallBlind: 10 });
  const amounts = presets.map(p => p.amount);
  assert.deepEqual(presets.map(p => p.label), ['Min', '½ pot', '¾ pot', 'Pot']);
  for (const a of amounts) { assert.ok(a >= 120 && a <= 1000); }
  assert.equal(new Set(amounts).size, amounts.length);
  assert.ok(amounts.slice(1).every(a => a % 10 === 0));
  assert.equal(presets.at(-1).amount, 60 + 150);
  // Short stack: everything collapses onto the max.
  assert.deepEqual(betPresets({ pot: 2000, current: 500, call: 500, min: 600, max: 600, smallBlind: 10 }), [{ label: 'Min', amount: 600 }]);
});

test('every random personality still makes legal moves and risk appetite bends values the right way', () => {
  const rng = seededRandom(21);
  for (let n = 0; n < 40; n++) {
    const style = randomStyle(rng);
    const g = new Poker(); g.start(rng);
    while (!g.done && g.turn !== 2) g.act('call');
    const obs = readObservation(g); obs.seat = 2;
    const d = chooseNeuralDecision(obs, { persona: style, random: rng, trials: 40 });
    const o = g.options();
    assert.ok(['fold', 'call', 'raise'].includes(d.action));
    if (d.action === 'raise') assert.ok(d.amount >= o.min && d.amount <= o.max);
    assert.ok(Number.isFinite(d.analysis.risk));
  }
  assert.ok(riskUtility(10, .1) < riskUtility(10, .9), 'a gambler values an upside more');
  assert.ok(riskUtility(-10, .1) < riskUtility(-10, .9), 'a cautious bot fears a downside more');
  assert.equal(riskUtility(3, .5), 3);
  const p = stylePersona({ ...randomStyle(rng), bluffy: 1 });
  assert.ok(p.anchor.bluff <= .2);
});

test('moods drift faster for swingy players and patient players take longer', () => {
  const rng = seededRandom(4);
  const calm = { ...randomStyle(rng), swing: .4, tilt: 0, image: 0 }, swingy = { ...calm, swing: 1.6 };
  assert.ok(driftStyle(swingy, -500, rng).tilt > driftStyle(calm, -500, rng).tilt);
  const fixed = () => .5;
  assert.ok(styleThinkTime({ patience: 1 }, { random: fixed }) > styleThinkTime({ patience: 0 }, { random: fixed }));
});

test('the dealer announces the right moments', () => {
  const g = new Poker(); g.start(seededRandom(9));
  const snap = x => ({ hand: x.hand, done: x.done, pot: x.pot, boardCount: x.board.length, awards: x.awards, players: x.players.map(p => ({ name: p.name, allIn: !!p.allIn, folded: p.folded })) });
  const a = snap(g);
  assert.equal(dealerEvent(null, a, { rng: () => .1 }).key, 'shuffle');
  while (!g.done && g.board.length === 0) g.act('call');
  const b = snap(g);
  const e = dealerEvent(a, b, { rng: () => .1 });
  assert.equal(e.key, 'flop'); assert.equal(e.mood, 'deal');
  g.act('allin');
  const c = snap(g);
  assert.equal(dealerEvent(b, c, { rng: () => .1 }).key, 'allin');
  assert.equal(dealerEvent(c, c), null);
  const d = makeDealer(seededRandom(1));
  assert.ok(d.name && d.hue >= 0 && d.hue < 360);
});

test('faces blink on their own rhythm and drinks have a taste', () => {
  const fixed = () => .5;
  assert.ok(blinkDelay('sweat', fixed) < blinkDelay('idle', fixed));
  assert.ok(!canBlink('sleep') && canBlink('idle'));
  const g = nextGaze('think', fixed);
  assert.ok(Math.abs(g.x) <= 3 && Math.abs(g.y) <= 4 && g.hold > 0);
  assert.equal(tasteOf('lemonade'), 'sour');
  assert.equal(tasteOf('coffee'), 'wired');
  assert.equal(tasteOf('nothing'), 'cheers');
  const line = drinkLine('sour', { style: { sticky: .9 }, from: 'Ryan' }, () => .9);
  assert.ok(line.length > 0 && line.length <= 80);
});

test('five cocktails make a seat drunk, zero-proof sobers, talk slurs, play loosens', async () => {
  const { drinkEffect, drunkLevel, slur, drunkStyle, soberUp, mumble, DRUNK_AT } = await import('../table-talk.js');
  let d = 0;
  for (let i = 0; i < DRUNK_AT; i++) d = drinkEffect(d, 'martini', 'Cocktails');
  assert.equal(drunkLevel(d), 1);
  assert.ok(drunkLevel(drinkEffect(d, 'tea', 'Zero-proof')) < 1);
  assert.ok(soberUp(d) < d);
  assert.equal(slur('Nice hand', 0), 'Nice hand');
  const slurred = slur('Nice hand, sir.', 1, seededRandom(2));
  assert.notEqual(slurred, 'Nice hand, sir.');
  assert.ok(slurred.length <= 80);
  const sober = { tight: .7, aggressive: .3, sticky: .4, skill: .9, sloppy: .1, risk: .5 };
  const drunk = drunkStyle(sober, 1);
  assert.ok(drunk.tight < sober.tight && drunk.aggressive > sober.aggressive && drunk.skill < sober.skill && drunk.sloppy > sober.sloppy);
  assert.ok(mumble(seededRandom(3)).length > 0);
});
