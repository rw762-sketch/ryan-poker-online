import { preflopStrength, simulateEquity, rankHand } from './poker-math.js?v=690beaffbb51';

export const DEFAULT_POLICY = { openEarly:.64, openLate:.42, defend:.035, value:.61, aggression:.72, bluff:.055, size:.65 };
export function positionOf(game, seat) {
  const active = game.players.map((p, i) => !p.folded ? i : -1).filter(i => i >= 0);
  if (seat === game.dealer) return 'late';
  const order = [];
  const seats = game.players.length;
  for (let n = 1; n <= seats; n++) { const i = (game.dealer + n) % seats; if (active.includes(i)) order.push(i); }
  return order[0] === seat ? 'early' : order.at(-1) === seat ? 'late' : 'middle';
}
export function boardTexture(cards, board) {
  if (board.length < 3) return { wet:false, draw:false, category:0 };
  const counts = [0, 0, 0, 0]; board.forEach(c => counts[c.s]++);
  const ranks = [...new Set(board.map(c => c.r))].sort((a, b) => a - b);
  const connected = ranks.some((r, i) => ranks[i + 2] && ranks[i + 2] - r <= 4);
  const all = [...cards, ...board], suits = [0, 0, 0, 0]; all.forEach(c => suits[c.s]++);
  const set = new Set(all.map(c => c.r)); if (set.has(14)) set.add(1);
  let straightDraw = false;
  for (let h = 5; h <= 14; h++) if (Array.from({ length:5 }, (_, i) => h - i).filter(r => set.has(r)).length === 4) straightDraw = true;
  return { wet:Math.max(...counts) >= (board.length >= 4 ? 3 : 2) || connected,
    draw:board.length < 5 && (suits.some((n, s) => n === 4 && cards.some(c => c.s === s)) || straightDraw),
    category:Math.floor(rankHand(all) / 15 ** 5) };
}
export function readObservation(game) {
  const me = game.players[game.turn];
  const others = game.players.filter((p, i) => i !== game.turn && !p.folded);
  const opponents = others.length;
  const raised = game.current > (game.board.length ? 0 : 20);
  const pressure = game.options().call / Math.max(20, game.pot);
  // Range profiles are model assumptions inferred from public betting, not hidden hands.
  const opponentRanges = others.map(p => {
    // An all-in shove is only as strong as that player's shoving habit: people
    // who shove often are shoving wide. Counts are public (everyone saw them).
    if (/^Raise/.test(p.action) && p.allIn) {
      const rate = (p.shoves || 0) / ((p.dealt || 0) + 6);
      return rate > .3 ? 'random' : rate > .15 ? 'loose' : 'standard';
    }
    if (/^Raise/.test(p.action)) return pressure > .5 || (game.current >= 160 && pressure >= .25) ? 'tight' : 'standard';
    if (raised && p.bet === game.current) return 'standard';
    return game.board.length || p.total > 20 ? 'loose' : 'random';
  });
  return {
    cards:me.cards.map(c => ({ ...c })), board:game.board.map(c => ({ ...c })),
    pot:game.pot, stack:me.stack, bet:me.bet, current:game.current,
    opponents, opponentRanges, position:positionOf(game, game.turn),
    bigBlind:20, unopened:!game.board.length && game.current <= 20,
    limped:!game.board.length && others.some(p=>/^Call/.test(p.action)),
    effectiveStack:Math.min(me.stack, Math.max(...others.map(p => p.stack))),
    options:{ ...game.options() },
  };
}
export function strategicAction(obs, parameters = DEFAULT_POLICY, random = Math.random, trials = 160, cachedEquity, trace) {
  const p = { ...DEFAULT_POLICY, ...parameters };
  const o = obs.options, roll = random();
  const explain = reason => { if(trace)trace.reason=reason; };
  if(trace){trace.equity=null;trace.price=o.call/Math.max(1,obs.pot+o.call);trace.ranges=[...obs.opponentRanges||[]];}
  const call = { action:'call' }, fold = { action:'fold' };
  const inPosition = obs.position === 'late';
  const size = fraction => ({ action:'raise', amount:Math.min(o.max, Math.max(o.min,
    obs.current + Math.round(Math.max(obs.bigBlind || 20, (obs.pot + o.call) * fraction) / 10) * 10)) });
  const strength = preflopStrength(obs.cards);
  if (!obs.board.length && obs.unopened && !obs.limped && o.call < obs.stack) {
    const cutoff = inPosition ? p.openLate : obs.position === 'middle' ? (p.openEarly + p.openLate) / 2 : p.openEarly;
    if (strength >= cutoff && o.canRaise) {
      explain('This hand meets the position-based opening threshold. Open for value and initiative.');
      return { action:'raise', amount:Math.min(o.max, Math.max(o.min, (obs.bigBlind || 20) * (inPosition ? 2.5 : 3))) };
    }
    if (o.owed && strength < cutoff - .08) { explain('The hand is below the opening threshold for this position.'); return fold; }
    explain(o.owed?'Continue with a marginal starting hand at the current price.':'Check the available free option.'); return call;
  }
  const simulation = cachedEquity === undefined ? simulateEquity(obs, trials, random) : null;
  const equity = cachedEquity ?? simulation.equity;
  if(trace){trace.equity=equity;trace.trials=simulation?.trials||0;}
  const price = o.call / Math.max(1, obs.pot + o.call);
  const texture = boardTexture(obs.cards, obs.board);
  // No future betting cost on the river or when the call commits the full stack.
  const noFutureBetting = obs.board.length === 5 || o.call >= obs.stack || obs.effectiveStack === 0;
  const realization = noFutureBetting ? 1 : inPosition ? .98 : obs.opponents > 1 ? .82 : .9;
  const adjusted = equity * realization;
  // Price the uncertainty margin proportionally: a tiny call should not require
  // an extra eight percentage points of equity, and an all-in needs no future margin.
  const margin = noFutureBetting ? 0 : Math.min(.03, Math.max(0,p.defend)) * Math.min(1,price/.33);
  if(trace){trace.adjustedEquity=adjusted;trace.callMargin=margin;}
  if (o.owed && adjusted < price + margin && equity < .93) { explain('Estimated usable equity is below the call price plus a price-scaled uncertainty margin.'); return fold; }
  if (!o.canRaise) { explain('The call is acceptable, and raising is not available.'); return call; }
  const valuable = equity > Math.max(p.value, 1 / (obs.opponents + 1) + (p.valueMargin ?? .24));
  // Bluff less into multiple players; prefer draws while there are cards to come.
  const bluff = obs.opponents === 1 && (inPosition || texture.draw) &&
    (texture.draw || (!texture.wet && obs.board.length === 5)) &&
    equity > .12 && equity < .48 && roll < p.bluff && o.call <= obs.pot * .15;
  if ((valuable && roll < p.aggression) || bluff) {
    const fraction = equity > .85 ? Math.max(.8, p.size) : texture.wet ? p.size : Math.max(.33, p.size - .15);
    if (obs.stack <= (obs.pot + o.call) * 1.2 && equity > .78) { explain('Strong estimated equity and a short stack favor moving all in.'); return { action:'raise', amount:o.max }; }
    explain(valuable?'Bet for value using estimated equity, board texture, and the learned sizing policy.':'Make a selective bluff using position, board texture, and the learned fold tendency.');
    return size(fraction);
  }
  explain(o.owed?'The estimated equity supports continuing without a raise.':'Check: this hand did not meet the value-bet or selective-bluff conditions.');
  return call;
}

export function analyzeDecision(input, simulation) {
  const { pot, toCall, stack, ownBet = 0, bigBlind = 20, lastRaise = bigBlind,
    position = 'late', board = [], cards, opponents = 1 } = input;
  for (const [name, value] of Object.entries({pot,toCall,stack,ownBet,bigBlind,lastRaise})) {
    if (!Number.isFinite(value) || value < 0 || value > 10000000) throw Error(`${name} must be a non-negative number below 10,000,000.`);
  }
  if (!stack || !bigBlind || !lastRaise) throw Error('Stack, big blind, and minimum raise increment must be positive.');
  if (toCall > stack) throw Error('Enter the amount you can actually call, capped at your remaining stack.');
  if (toCall > pot) throw Error('The current pot must include the opponent’s bet.');
  const call = toCall;
  const price = call / Math.max(1, pot + call);
  const equity = simulation.equity;
  const callEV = equity * (pot + call) - call;
  const realization = board.length === 5 ? 1 : ['late','button'].includes(position) ? .98 : opponents > 1 ? .82 : .9;
  const adjusted = equity * realization;
  const threshold = board.length ? .035 : .05;
  let action = call ? 'Call' : 'Check';
  let amount = call;
  const texture = boardTexture(cards, board);
  const minTotal = ownBet + call + Math.max(bigBlind, lastRaise);
  const maxTotal = ownBet + stack;
  const canRaise = stack > call;
  const isLate = ['late','button'].includes(position);
  const preflopScore = preflopStrength(cards);
  const opening = !board.length && ownBet + call <= bigBlind;
  const cutoff = isLate ? .42 : position === 'middle' ? .53 : .64;
  const reasons = [];
  if (opening && call && preflopScore < cutoff - .08) {
    action = 'Fold'; amount = 0;
    reasons.push('This starting hand falls outside the suggested opening range for your position.');
  } else if (call && adjusted < price + threshold && equity < .94) {
    action = 'Fold'; amount = 0;
    reasons.push('The estimated share of the pot does not leave enough margin over the price of calling.');
  } else if (canRaise && ((opening && preflopScore >= cutoff) || equity > Math.max(.64, 1 / (opponents + 1) + .26))) {
    action = ownBet + call ? 'Raise to' : 'Bet';
    amount = Math.min(maxTotal, Math.max(minTotal, opening ? bigBlind * (isLate ? 2.5 : 3) : ownBet + call + (pot + call) * (equity > .85 ? .8 : texture.wet ? .65 : .45)));
    amount = Math.min(maxTotal, Math.max(Math.min(minTotal,maxTotal), Math.round(amount)));
    reasons.push(opening ? 'Open with a position-aware size rather than limping a strong starting hand.' : 'Your estimated equity supports a value bet; the sizing considers board texture and the available stack.');
  } else {
    reasons.push(call ? 'Calling keeps weaker hands in while avoiding an unnecessary raise.' : 'Checking keeps the pot controlled when the value of betting is uncertain.');
  }
  reasons.push(isLate ? 'Acting later gives you more information and usually makes it easier to realize equity.' : 'Acting earlier means more uncertainty and a tighter recommended range.');
  if (board.length < 5) reasons.push('The estimate assumes all remaining community cards are dealt. Future bets can make a draw more expensive.');
  if (simulation.margin95 > .02) reasons.push('This estimate still has sampling noise. Run more simulations for a steadier answer.');
  return { action, amount, additional:action === 'Raise to' ? Math.max(0, amount - ownBet) : amount,
    allIn:amount === maxTotal && ['Bet','Raise to'].includes(action),
    price, callEV, realization, reasons, minTotal, maxTotal };
}
