import test from 'node:test';
import assert from 'node:assert/strict';
import { Poker } from '../engine.js';
import { seededRandom } from '../poker-math.js';
import { readObservation } from '../strategy.js';
import { chooseBotDecision } from '../ai.js';

function facingShove(cards, shoves = 0, dealt = 0) {
  const g = new Poker(); g.start(seededRandom(5));
  g.players[0].shoves = shoves; g.players[0].dealt = dealt;
  while (g.turn !== 0 && !g.done) g.act('fold');
  g.act('allin');
  g.players[g.turn].cards = cards;
  // Remove the hero's cards from the deck view by swapping in distinct ones.
  return g;
}
test('bots call an all-in with premium pairs at every difficulty', () => {
  for (const level of ['medium', 'hard', 'gto', 'neural']) {
    const g = facingShove([{ r: 14, s: 0 }, { r: 14, s: 1 }]);
    const obs = readObservation(g); obs.seat = g.turn;
    const d = chooseBotDecision(obs, level, seededRandom(11));
    assert.notEqual(d.action, 'fold', level);
  }
});
test('a habitual shover is read with a wider range than a first-time shover', () => {
  const first = readObservation(facingShove([{ r: 9, s: 0 }, { r: 9, s: 1 }], 0, 1)).opponentRanges;
  const habitual = readObservation(facingShove([{ r: 9, s: 0 }, { r: 9, s: 1 }], 8, 10)).opponentRanges;
  assert.ok(first.includes('standard'));
  assert.ok(habitual.includes('random'));
});
