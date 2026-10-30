import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMove, describeSpot } from '../llm-player.js';

const obs = { cards: [{ r: 14, s: 0 }, { r: 13, s: 1 }], board: [], pot: 30, stack: 980, bet: 20, current: 20,
  position: 'late', opponents: 2, options: { call: 0, owed: 0, min: 40, max: 1000, canRaise: true } };

test('LLM replies are parsed into legal moves, whatever shape they come in', () => {
  assert.deepEqual(parseMove('{"action":"raise","amount":5000,"why":"strong"}', obs), { action: 'raise', amount: 1000, say: '', why: 'strong' });
  assert.equal(parseMove('Sure! {"action":"check"}', obs).action, 'call');
  assert.equal(parseMove('{"action":"fold"}', obs).action, 'call', 'never fold when checking is free');
  assert.equal(parseMove('ACTION: raise 120', obs).amount, 120);
  assert.equal(parseMove('ACTION: bet 7', obs).amount, 40, 'clamped to the minimum raise');
  assert.equal(parseMove('I think I will go all-in here', obs).action, 'allin');
  assert.equal(parseMove('no idea', obs), null);
  assert.equal(parseMove('{"action":"call","say":"<script>hi</script>"}', obs).say.includes('<'), false);
});
test('the prompt shows only the bot’s own cards and public state', () => {
  const spot = describeSpot(obs, { recent: ['Jules: Raise to 60.'] });
  assert.equal(spot.yourCards, 'A♠ K♥');
  assert.equal(JSON.stringify(spot).includes('deck'), false);
});
