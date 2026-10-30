import test from 'node:test';
import assert from 'node:assert/strict';
import { replyTo, reactTo } from '../table-talk.js';
import { seededRandom } from '../poker-math.js';

test('table talk answers the topic, varies by mood, and stays short', () => {
  const styles = [{ aggressive: .9 }, { tight: .9 }, { sticky: .9 }, { tilt: .8 }, {}];
  const replies = new Set();
  for (let seed = 1; seed < 80; seed++) for (const style of styles) {
    const line = replyTo('all in next hand, watch', { style, pot: 120, hand: 3 }, seededRandom(seed));
    if (line) { replies.add(line); assert.ok(line.length <= 80); assert.doesNotMatch(line, /\{|\}/); }
  }
  assert.ok(replies.size >= 8, `only ${replies.size} distinct replies`);
  const bluff = replyTo('you are bluffing', { style: { aggressive: .9 } }, seededRandom(3));
  assert.ok(bluff === '' || /find out|Pay to see|bluff/i.test(bluff));
});
test('hand reactions sometimes stay quiet and never leak cards', () => {
  const rng = seededRandom(424242);
  const lines = Array.from({ length: 60 }, () => reactTo('lost-big', { style: { tilt: .9 } }, rng));
  assert.ok(lines.some(l => l === '') && lines.some(l => l));
  assert.ok(lines.every(l => !/\b(ace|king|queen|pair|flush)\b/i.test(l)));
});
