// Generates training data for the neural bot.
// Self-play hands with a mix of existing bot styles; at sampled decisions every
// legal move is played out several times (fresh shuffles of unseen cards, the
// same seat styles afterwards) and the average chip result becomes its target.
// Usage: node scripts/neural-data.mjs <out.jsonl> <hands> <seedStart> [workers]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Poker } from '../engine.js';
import { seededRandom, simulateEquity } from '../poker-math.js';
import { readObservation, strategicAction, DEFAULT_POLICY } from '../strategy.js';
import { TRAINED_POLICY } from '../trained-policy.js';
import { chooseBotDecision } from '../ai.js';
import { neuralFeatures, legalMask, toDecision, chooseNeuralDecision } from '../neural-policy.js';

const STYLES = ['hard', 'medium', 'loose', 'gto', 'nit', 'aggro', 'station', 'neural', 'neural'];
const STATION = { ...DEFAULT_POLICY, openEarly: .7, openLate: .55, defend: -.05, aggression: .35, bluff: .02, size: .5 };
const PERSONA_KEYS = ['shark', 'rock', 'maniac', 'calling', 'tricky'];
const NIT = { ...TRAINED_POLICY, openEarly: .72, openLate: .52, value: .66, aggression: .6, bluff: 0 };
const AGGRO = { ...DEFAULT_POLICY, openEarly: .5, openLate: .28, value: .5, aggression: .95, bluff: .12, size: .85 };

export function styleAction(style, obs, rng, trials = 36) {
  switch (style) {
    case 'hard': return strategicAction(obs, TRAINED_POLICY, rng, trials);
    case 'medium': return strategicAction(obs, DEFAULT_POLICY, rng, trials);
    case 'nit': return strategicAction(obs, NIT, rng, trials);
    case 'aggro': return strategicAction(obs, AGGRO, rng, trials);
    case 'station': return strategicAction(obs, STATION, rng, trials);
    case 'gto': return chooseBotDecision(obs, 'gto', rng);
    case 'neural': return chooseNeuralDecision(obs, { persona: PERSONA_KEYS[Math.floor(rng() * PERSONA_KEYS.length)], random: rng, trials: Math.max(48, trials) });
    default: return chooseBotDecision(obs, 'easy', rng);
  }
}
const legal = (g, d) => d.action !== 'raise' || (Number.isInteger(d.amount) && d.amount >= g.options().min && d.amount <= g.options().max);

function cloneGame(g) {
  const c = Object.create(Poker.prototype);
  for (const [k, v] of Object.entries(g)) c[k] = k === 'logs' ? [] : structuredClone(v);
  return c;
}
function shuffle(a, rng) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function finish(g, styles, rng) {
  let steps = 0;
  while (!g.done && steps++ < 300) {
    const obs = readObservation(g);
    let d = styleAction(styles[g.turn], obs, rng);
    if (!legal(g, d)) d = { action: 'call' };
    if (!g.act(d.action, d.amount)) g.act('call');
  }
  if (!g.done) throw Error('Rollout did not finish');
}

function labelState(g, styles, rng, rollouts) {
  const seat = g.turn, obs = readObservation(g), mask = legalMask(obs);
  const start = g.players[seat].stack;
  const q = [0, null, null, null, null];
  for (let a = 1; a < 5; a++) {
    if (!mask[a]) continue;
    // Skip duplicate raise sizes (e.g. half-pot already clamped to all-in).
    const d = toDecision(obs, a);
    let total = 0;
    for (let k = 0; k < rollouts; k++) {
      const c = cloneGame(g);
      shuffle(c.deck, rng);
      if (!c.act(d.action, d.amount)) { total = null; break; }
      finish(c, styles.map((s, i) => i === seat ? 'hard' : s), rng);
      total += c.players[seat].stack - start;
    }
    if (total !== null) q[a] = total / rollouts / 20;
  }
  const equity = simulateEquity(obs, 260, rng).equity;
  return { x: neuralFeatures(obs, equity), mask, q };
}

function runHands({ start, count, sampleRate, rollouts, heroStyle }) {
  const rows = [];
  for (let h = start; h < start + count; h++) {
    const rng = seededRandom((h * 2654435761) >>> 0 || 1);
    const g = new Poker();
    // Varied stacks give the model short- and deep-stack spots.
    const deep = rng() < .6;
    g.players.forEach(p => { p.stack = deep ? 1000 : 200 + Math.floor(rng() * 1600 / 10) * 10; });
    const seats = g.players.length;
    if (rng() < .3) g.players.forEach((p, i) => { if (i >= 2 + Math.floor(rng() * (seats - 1))) p.stack = 0; });
    g.dealer = Math.floor(rng() * seats) - 1;
    if (!g.start(rng)) continue;
    const styles = g.players.map(() => STYLES[Math.floor(rng() * STYLES.length)]);
    if (heroStyle) styles[0] = heroStyle;
    let steps = 0;
    while (!g.done && steps++ < 300) {
      if (rng() < sampleRate) rows.push(labelState(g, styles, rng, rollouts));
      const obs = readObservation(g);
      let d = styleAction(styles[g.turn], obs, rng);
      if (!legal(g, d)) d = { action: 'call' };
      if (!g.act(d.action, d.amount)) g.act('call');
    }
  }
  return rows;
}

if (isMainThread && process.argv[1] === fileURLToPath(import.meta.url)) {
  const [out, handsArg, seedArg, workersArg, rolloutsArg] = process.argv.slice(2);
  const hands = +handsArg || 200, seed = +seedArg || 1, workers = +workersArg || 2, rollouts = +rolloutsArg || 6;
  const stream = createWriteStream(out, { flags: 'a' });
  const per = Math.ceil(hands / workers);
  const t0 = Date.now();
  let done = 0, rowsOut = 0;
  for (let w = 0; w < workers; w++) {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { start: seed + w * per, count: per, sampleRate: .45, rollouts } });
    worker.on('message', rows => { for (const r of rows) stream.write(JSON.stringify(r) + '\n'); rowsOut += rows.length; });
    worker.on('exit', () => { if (++done === workers) { stream.end(); console.log(`${rowsOut} rows from ${hands} hands in ${((Date.now() - t0) / 1000).toFixed(1)}s`); } });
    worker.on('error', e => { console.error(e); process.exitCode = 1; });
  }
} else if (!isMainThread) {
  const { start, count, sampleRate, rollouts } = workerData;
  // Stream in chunks so a long run writes progress.
  for (let s = start; s < start + count; s += 20) {
    parentPort.postMessage(runHands({ start: s, count: Math.min(20, start + count - s), sampleRate, rollouts }));
  }
}
