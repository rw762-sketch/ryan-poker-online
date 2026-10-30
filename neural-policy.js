// Neural action-value bot. A small network, trained offline on simulated hands
// (scripts/neural-data.mjs + scripts/neural-train.py), estimates how many big
// blinds each move is worth from public information and the bot's own cards.
// Personalities change how the bot chooses among those estimates, not what it sees.
import { preflopStrength, simulateEquity } from './poker-math.js?v=ac6e3e31258c';
import { boardTexture, strategicAction, DEFAULT_POLICY } from './strategy.js?v=ac6e3e31258c';
import { TRAINED_POLICY } from './trained-policy.js?v=ac6e3e31258c';
import { NEURAL_WEIGHTS } from './neural-weights.js?v=ac6e3e31258c';

export const NEURAL_ACTIONS = ['fold', 'call', 'half', 'pot', 'allin'];
const BB = 20;

export function actionAmount(obs, index) {
  const o = obs.options;
  if (index === 4) return o.max;
  const fraction = index === 2 ? 0.5 : 1;
  const raw = obs.current + Math.round(Math.max(obs.bigBlind || BB, (obs.pot + o.call) * fraction) / 10) * 10;
  return Math.min(o.max, Math.max(o.min, raw));
}

export function legalMask(obs) {
  const o = obs.options;
  return [o.owed > 0, true, !!o.canRaise, !!o.canRaise, !!o.canRaise];
}

export function toDecision(obs, index) {
  if (index === 0) return { action: 'fold' };
  if (index === 1) return { action: 'call' };
  return { action: 'raise', amount: actionAmount(obs, index) };
}

const clip = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function neuralFeatures(obs, equity) {
  const o = obs.options, stage = obs.board.length === 0 ? 0 : obs.board.length - 2;
  const texture = boardTexture(obs.cards, obs.board);
  const pot = Math.max(1, obs.pot);
  // Chip amounts are measured against a 50-big-blind stack (1,000 at 10/20).
  const unit = 50 * (obs.bigBlind || BB);
  const ranges = obs.opponentRanges || [];
  const share = name => ranges.length ? ranges.filter(r => r === name).length / ranges.length : 0;
  const spr = (obs.effectiveStack ?? obs.stack) / pot;
  const pair = obs.cards[0].r === obs.cards[1].r ? 1 : 0;
  const suited = obs.cards[0].s === obs.cards[1].s ? 1 : 0;
  return [
    stage === 0 ? 1 : 0, stage === 1 ? 1 : 0, stage === 2 ? 1 : 0, stage === 3 ? 1 : 0,
    equity,
    equity * (obs.opponents || 1) / 5,
    preflopStrength(obs.cards),
    pair, suited,
    obs.board.length ? texture.category / 8 : 0,
    texture.wet ? 1 : 0, texture.draw ? 1 : 0,
    o.call / (pot + o.call),
    clip(o.call / Math.max(1, obs.stack), 0, 1),
    clip(Math.log1p(spr) / 3, 0, 2),
    (obs.opponents || 1) / 5,
    obs.position === 'early' ? 1 : 0, obs.position === 'middle' ? 1 : 0, obs.position === 'late' ? 1 : 0,
    obs.unopened ? 1 : 0, obs.limped ? 1 : 0,
    clip(obs.current / pot, 0, 3),
    o.canRaise ? 1 : 0,
    clip(obs.stack / unit, 0, 4),
    clip(pot / unit, 0, 4),
    share('tight'), share('loose'), share('random'),
  ];
}

export function forward(weights, x) {
  let h = x;
  for (let l = 0; l < weights.layers.length; l++) {
    const { W, b } = weights.layers[l];
    const out = new Array(b.length);
    for (let j = 0; j < b.length; j++) {
      let s = b[j];
      const row = W[j];
      for (let i = 0; i < h.length; i++) s += row[i] * h[i];
      out[j] = l < weights.layers.length - 1 ? (s > 0 ? s : 0.01 * s) : s;
    }
    h = out;
  }
  return h;
}

export function normalize(weights, features) {
  return features.map((v, i) => (v - weights.mean[i]) / weights.std[i]);
}

export function actionValues(obs, { trials = 260, random = Math.random, weights = NEURAL_WEIGHTS, equity } = {}) {
  const eq = equity ?? simulateEquity(obs, trials, random).equity;
  const features = neuralFeatures(obs, eq);
  const raw = forward(weights, normalize(weights, features));
  const mask = legalMask(obs);
  const values = raw.map((v, i) => mask[i] ? v * weights.scale : null);
  // Folding is exactly zero from here; checking is never worse than folding.
  if (mask[0]) values[0] = 0;
  // Facing an all-in there is no more betting: calling is worth exactly
  // equity * (pot + call) - call. Use that instead of the network's guess.
  const o = obs.options;
  if (o.owed > 0 && (o.call >= obs.stack || !o.canRaise || obs.allInFacing)) {
    values[1] = (eq * (obs.pot + o.call) - o.call) / (obs.bigBlind || BB);
  }
  return { values, equity: eq, mask };
}

// Personalities follow KL-regularized search (Jacob et al., "Modeling Strong and
// Human-Like Gameplay with KL-Regularized Search", ICML 2022): each bot keeps a
// human-like anchor style and the network moves it only where the estimated gain
// is worth it. lambda = how strongly the anchor holds; temperature = how much the
// value estimates matter (in big blinds). Bots see only their own cards.
export const PERSONAS = {
  shark:   { name: 'Shark',   lambda: 1.3, temperature: 1.0, slip: .02, sizing: .08, anchor: TRAINED_POLICY },
  rock:    { name: 'Rock',    lambda: 2.2, temperature: 1.6, slip: .03, sizing: .1,
             anchor: { ...TRAINED_POLICY, openEarly: .72, openLate: .52, value: .66, aggression: .6, bluff: 0 } },
  maniac:  { name: 'Maniac',  lambda: 1.6, temperature: 1.4, slip: .08, sizing: .3,
             anchor: { ...DEFAULT_POLICY, openEarly: .46, openLate: .26, value: .5, aggression: .95, bluff: .14, size: .9 } },
  calling: { name: 'Station', lambda: 2.0, temperature: 1.8, slip: .06, sizing: .18,
             anchor: { ...DEFAULT_POLICY, openEarly: .7, openLate: .55, defend: -.05, aggression: .35, bluff: .02, size: .5 } },
  tricky:  { name: 'Tricky',  lambda: 1.3, temperature: 1.2, slip: .05, sizing: .22,
             anchor: { ...DEFAULT_POLICY, openLate: .36, aggression: .8, bluff: .12, size: .7 } },
};
export const SEAT_PERSONAS = [null, 'tricky', 'rock', 'maniac', 'shark', 'calling'];

// Endless personalities: instead of five fixed characters, every bot draws its
// own point in a continuous style space (tight<->loose, passive<->aggressive,
// sticky<->foldy, how disciplined it is, how sloppy its sizing is), and that
// point drifts a little from hand to hand, more after a painful loss.
const lerp = (a, b, t) => a + (b - a) * t;
const unit = random => Math.min(1, Math.max(0, (random() + random() + random()) / 3 + (random() - .5) * .35));
// The trained network stays neutral: it only estimates what each move is worth.
// A personality is a point in this trait space, and only changes how the bot
// chooses among those estimates (risk appetite, habits, patience, nerves).
export const TRAITS = Object.freeze({
  tight: 'how many hands they play', aggressive: 'bets and raises over calls', sticky: 'hard to shake off a hand',
  skill: 'how closely they follow the value estimates', sloppy: 'bet-size wobble',
  risk: 'risk appetite: low is risk-averse, high is a gambler', trap: 'likes to slow-play monsters',
  bluffy: 'loves a bluff and a float', stubborn: 'hates folding once invested', scare: 'flinches at big bets',
  patience: 'how long they take to act', swing: 'how fast their mood and habits move', image: 'tightens up after being caught',
});
export function randomStyle(random = Math.random) {
  return { tight: unit(random), aggressive: unit(random), sticky: unit(random), skill: .25 + .75 * unit(random),
    sloppy: random() * .35, tilt: 0,
    risk: unit(random), trap: random() * random(), bluffy: random() * random(), stubborn: unit(random) * .8,
    scare: random() * random(), patience: unit(random), swing: .4 + random() * 1.2, image: random() };
}
// Risk appetite as a utility curve over big blinds (CARA): a cautious bot values
// a sure thing over a coin flip of the same mean; a gambler does the reverse.
export function riskUtility(valueBB, risk = .5) {
  const k = (.5 - risk) * .5;
  if (Math.abs(k) < 1e-4) return valueBB;
  return (1 - Math.exp(-k * valueBB)) / k;
}
export function styleLabel(style) {
  const t = style.tight > .6 ? 'tight' : style.tight < .4 ? 'loose' : 'balanced';
  const a = style.aggressive > .6 ? 'aggressive' : style.aggressive < .4 ? 'passive' : 'steady';
  return `${t}, ${a}${style.tilt > .3 ? ', on tilt' : ''}`;
}
export function stylePersona(style) {
  const tight = Math.min(1, Math.max(0, style.tight - style.tilt * .25));
  const aggressive = Math.min(1, style.aggressive + style.tilt * .35);
  return {
    name: styleLabel(style),
    lambda: lerp(2.3, .9, style.skill),
    temperature: lerp(1.9, 1, style.skill) * (1 + style.tilt * .5),
    slip: lerp(.09, .015, style.skill) + style.tilt * .06,
    sizing: style.sloppy,
    traits: style,
    anchor: { ...DEFAULT_POLICY,
      openEarly: lerp(.46, .74, tight), openLate: lerp(.24, .54, tight), value: lerp(.5, .66, tight),
      defend: lerp(.07, -.06, style.sticky), aggression: lerp(.35, .95, aggressive),
      bluff: Math.min(.2, lerp(0, .14, aggressive) * (1 - tight * .5) + (style.bluffy || 0) * .08), size: lerp(.5, .92, aggressive) },
  };
}
// Call once per finished hand. profit is this bot's net chips for the hand.
export function driftStyle(style, profit = 0, random = Math.random) {
  const swing = style.swing || 1;
  const step = () => (random() - .5) * .06 * swing;
  const clamp = v => Math.min(1, Math.max(0, v));
  const tilt = clamp(style.tilt * (.75 - swing * .05) + (profit < -400 ? .5 : profit < -150 ? .2 : 0) * swing);
  // Caught bluffing (lost a big pot) and image-conscious: tighten up for a while.
  const tighten = profit < -300 && style.image > .5 ? .08 * style.image : 0;
  return { ...style, tight: clamp(style.tight + step() + tighten), aggressive: clamp(style.aggressive + step() - tighten * .5),
    sticky: clamp(style.sticky + step()), risk: clamp((style.risk ?? .5) + step() * .5 + (profit > 400 ? .04 : 0)), tilt };
}

function anchorIndex(obs, decision) {
  if (decision.action === 'fold') return 0;
  if (decision.action === 'call') return 1;
  const sizes = [2, 3, 4].map(i => [i, Math.abs(actionAmount(obs, i) - decision.amount)]);
  return sizes.sort((a, b) => a[1] - b[1])[0][0];
}

export function chooseNeuralDecision(obs, { persona = 'shark', random = Math.random, trials = 260 } = {}) {
  const style = typeof persona === 'object' && persona ? (persona.anchor ? persona : stylePersona(persona)) : PERSONAS[persona] || PERSONAS.shark;
  const { values, equity, mask } = actionValues(obs, { trials, random });
  // Anchor: what this personality's hand-written style would do here.
  const anchorMove = strategicAction(obs, style.anchor, random, 60, equity);
  const anchor = anchorIndex(obs, anchorMove);
  const legalCount = mask.filter(Boolean).length;
  const prior = mask.map((ok, i) => !ok ? 0 : i === anchor ? 0.72 : 0.28 / Math.max(1, legalCount - 1));
  const t = style.traits || {};
  const o = obs.options;
  // Each personality bends the neutral estimates in its own way:
  // risk appetite (utility curve), traps, floats, stubbornness and nerves.
  const shaped = values.map((v, i) => {
    if (v === null) return null;
    let u = riskUtility(v, t.risk ?? .5);
    if (i === 1 && t.trap && equity > .82 && o.canRaise) u += t.trap * 1.2;            // slow-play a monster
    if (i === 2 && t.bluffy && equity < .4 && (obs.opponents || 1) <= 2 && o.canRaise) u += t.bluffy * .9; // a cheeky float
    if (i === 0 && t.stubborn && obs.bet > 0) u -= t.stubborn * Math.min(1.5, (obs.bet + 1) / Math.max(1, obs.pot) * 3); // hates folding invested
    if (i === 0 && t.scare && o.call > obs.pot * .5) u += t.scare * 1.1;              // flinches at big bets
    if (i === 4 && t.scare) u -= t.scare * .8;
    if (i === 4 && (t.risk ?? .5) > .75 && equity > .55) u += (t.risk - .75) * 2;    // gamblers love a shove
    return u;
  });
  const logits = shaped.map((v, i) => v === null || !prior[i] ? -Infinity : style.lambda * Math.log(prior[i]) + v / style.temperature);
  // Human noise: now and then a bot plays on feel and the values barely matter.
  const slipped = random() < (style.slip ?? 0);
  if (slipped) for (let i = 0; i < logits.length; i++) if (Number.isFinite(logits[i])) logits[i] = style.lambda * Math.log(prior[i] || 1e-9) * .3 + shaped[i] / (style.temperature * 6);
  const top = Math.max(...logits);
  const weights = logits.map(l => Number.isFinite(l) ? Math.exp(l - top) : 0);
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = random() * total, index = logits.indexOf(top);
  for (let i = 0; i < weights.length; i++) { roll -= weights[i]; if (roll <= 0 && weights[i] > 0) { index = i; break; } }
  const decision = toDecision(obs, index);
  // People rarely bet exactly half or exactly the pot; wobble the size a little.
  if (decision.action === 'raise' && index !== 4 && style.sizing) {
    const o = obs.options, wobble = 1 + (random() * 2 - 1) * style.sizing;
    const step = decision.amount > 200 ? 25 : 5;
    const added = Math.max(0, decision.amount - obs.current) * wobble;
    decision.amount = Math.min(o.max, Math.max(o.min, Math.round((obs.current + added) / step) * step));
  }
  const ranked = values.map((v, i) => [NEURAL_ACTIONS[i], v === null ? null : Math.round(v * 10) / 10]).filter(([, v]) => v !== null);
  return { ...decision, analysis: { model: 'neural', persona: style.name, equity, values: Object.fromEntries(ranked),
    anchor: NEURAL_ACTIONS[anchor], choice: NEURAL_ACTIONS[index], slipped, risk: t.risk ?? .5 } };
}

// How long this bot sits with a decision, in ms. Patient players tank more.
export function styleThinkTime(style = {}, { facing = false, pot = 0, random = Math.random } = {}) {
  const patience = style.patience ?? .5;
  const base = 400 + patience * 700 + random() * (500 + patience * 700);
  const tank = random() < .04 + patience * .08 ? 1200 + random() * (1500 + patience * 2500) : 0;
  return base + (facing ? 250 + patience * 300 : 0) + Math.min(700, pot / 3) + tank;
}
