// Paired benchmark: the same deals and opponent styles, once with the hero seat
// played by a baseline style and once by the candidate. Reports big blinds per
// hand and a 95% interval on the paired difference.
// Usage: node scripts/neural-eval.mjs <hands> <seedStart> <candidate> <baseline> [workers]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { Poker } from '../engine.js';
import { seededRandom } from '../poker-math.js';
import { readObservation } from '../strategy.js';
import { styleAction } from './neural-data.mjs';

const OPPONENTS = ['hard', 'medium', 'loose', 'gto', 'nit', 'aggro'];

function playHand(seed, heroStyle) {
  const rng = seededRandom((seed * 2246822519) >>> 0 || 1);
  const g = new Poker();
  const seats = g.players.length;
  const hero = seed % seats;
  g.dealer = Math.floor(seed / seats) % seats - 1;
  if (!g.start(seededRandom((seed * 3266489917) >>> 0 || 1))) return 0;
  const styles = g.players.map((_, i) => i === hero ? heroStyle : OPPONENTS[Math.floor(rng() * OPPONENTS.length)]);
  // Each seat gets its own random stream so the hero's choices do not reshuffle opponents' dice.
  const streams = g.players.map((_, i) => seededRandom(((seed * 31 + i * 997) * 2654435761) >>> 0 || 1));
  let steps = 0;
  while (!g.done && steps++ < 300) {
    const obs = readObservation(g);
    let d = styleAction(styles[g.turn], obs, streams[g.turn], 120);
    const o = g.options();
    if (d.action === 'raise' && !(Number.isInteger(d.amount) && d.amount >= o.min && d.amount <= o.max)) d = { action: 'call' };
    if (!g.act(d.action, d.amount)) g.act('call');
  }
  if (g.players.reduce((n, p) => n + p.stack, 0) !== seats * 1000) throw Error('Chip conservation failure');
  return (g.players[hero].stack - 1000) / 20;
}

if (isMainThread) {
  const [handsArg, seedArg, candidate = 'neural', baseline = 'hard', workersArg] = process.argv.slice(2);
  const hands = +handsArg || 600, seed = +seedArg || 7000000, workers = +workersArg || 2;
  const per = Math.ceil(hands / workers);
  const results = [];
  let done = 0;
  const t0 = Date.now();
  for (let w = 0; w < workers; w++) {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { start: seed + w * per, count: per, candidate, baseline } });
    worker.on('message', r => results.push(...r));
    worker.on('error', e => { console.error(e); process.exitCode = 1; });
    worker.on('exit', () => {
      if (++done < workers) return;
      const n = results.length;
      const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
      const diffs = results.map(r => r.c - r.b);
      const m = mean(diffs), sd = Math.sqrt(diffs.reduce((s, d) => s + (d - m) ** 2, 0) / (n - 1));
      console.log(JSON.stringify({ hands: n, candidate, baseline,
        candidateBBPerHand: +mean(results.map(r => r.c)).toFixed(3),
        baselineBBPerHand: +mean(results.map(r => r.b)).toFixed(3),
        pairedDelta: +m.toFixed(3), ci95: [+(m - 1.96 * sd / Math.sqrt(n)).toFixed(3), +(m + 1.96 * sd / Math.sqrt(n)).toFixed(3)],
        seconds: Math.round((Date.now() - t0) / 1000) }));
    });
  }
} else {
  const { start, count, candidate, baseline } = workerData, out = [];
  for (let s = start; s < start + count; s++) out.push({ c: playHand(s, candidate), b: playHand(s, baseline) });
  parentPort.postMessage(out);
}
