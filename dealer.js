// The house dealer: a character who runs the table, deals the cards from its
// own hands, calls the streets and chirps at big moments. Pure presentation:
// it reads public table state only and never touches the game.

const pick = (list, rng) => list[Math.floor(rng() * list.length)];

// The house has one dealer: Lokwey. New table, new outfit, same Lokwey.
export const DEALER_NAME = 'Lokwey';

export function makeDealer(rng = Math.random) {
  // Dealers are a different species from the players: a croupier droid with a
  // visor, a vest, a hat and its own name. Each table gets a new one.
  return { name: DEALER_NAME, hue: Math.floor(rng() * 360), bow: pick(['pink', 'cyan', 'lime', 'gold'], rng),
    hat: pick(['cap', 'visor', 'headset', 'antenna'], rng), chatty: .35 + rng() * .4 };
}

const LINES = {
  shuffle: ['Shuffling up.', 'New hand, new luck.', 'Cards in the air!', 'Here we go.', 'Let’s run it.', 'Shuffle, shuffle.', 'Good luck, everyone.', 'Dealing!'],
  flop: ['Flop.', 'Here’s the flop.', 'Three on the table.', 'And the flop…', 'Flop’s out.', 'Let’s see a flop.'],
  turn: ['Turn.', 'Fourth street.', 'The turn.', 'One more.', 'Turn card.'],
  river: ['River.', 'Last card.', 'And the river…', 'Fifth street.', 'River, coming down.'],
  allin: ['All in! Hold on.', 'Oh, we have a shove.', 'Everything in the middle.', 'All of it.', 'Big moment.', 'Buckle up.'],
  call: ['Called!', 'We have a call.', 'Showdown time.', 'Cards up.'],
  bigpot: ['That is a big pot.', 'Look at that pot.', 'Someone’s going home happy.', 'Whoa, pot’s getting heavy.'],
  win: ['Ship it to {name}.', 'Pot to {name}.', '{name} takes it down.', 'That one goes to {name}.', 'Push it to {name}.'],
  fold: ['Everyone folds.', 'No contest.', 'Uncontested.', 'Take it down.'],
  badbeat: ['Oof. Sorry.', 'That’s a rough one.', 'Poker, folks.', 'Ouch.'],
  tip: ['Thank you kindly!', 'Aw, for me?', 'Cheers!', 'You’re the best.', 'Lokwey remembers tippers.', 'Much obliged.'],
  tipLots: ['You’re spoiling me.', 'Okay, okay, I like you.', 'My favourite seat.', 'Big tipper at the table!'],
  idle: ['Anyone need a drink?', 'Taking your time, I see.', 'No rush.', 'The cards can wait.', 'Nice night for it.', '*hums*', 'Who’s hungry?'],
};
const BIG_POT_BB = 40;

// Decide what the dealer says and feels between one table snapshot and the next.
// Returns null when there's nothing to say. bigBlind scales "big".
export function dealerEvent(before, after, { rng = Math.random, chatty = .6, bigBlind = 20 } = {}) {
  const say = (key, extra = {}, always = false) => (always || rng() < chatty) ? { line: fill(pick(LINES[key], rng), extra), key } : { line: '', key };
  const newHand = !before || before.hand !== after.hand;
  if (newHand) return { mood: 'deal', ...say('shuffle', {}, true) };
  if (after.done && !before.done) {
    const award = (after.awards || []).sort((a, b) => b.amount - a.amount)[0];
    const name = award ? after.players[award.seat]?.name : '';
    const stillIn = after.players.filter(p => !p.folded).length;
    if (stillIn <= 1) return { mood: 'calm', ...say('fold', {}, rng() < .5) };
    const suckout = award && award.profit > 0 && before.players.some((p, i) => i !== award.seat && !p.folded && p.allIn);
    if (suckout && rng() < .5) return { mood: 'wince', ...say('badbeat', {}, true) };
    return { mood: 'happy', ...say('win', { name }, true) };
  }
  if (after.boardCount > before.boardCount) {
    const key = after.boardCount === 3 ? 'flop' : after.boardCount === 4 ? 'turn' : 'river';
    const pot = after.pot >= BIG_POT_BB * bigBlind && before.pot < BIG_POT_BB * bigBlind;
    if (pot) return { mood: 'wow', ...say('bigpot', {}, true) };
    return { mood: 'deal', ...say(key, {}, after.boardCount === 3 || rng() < .7) };
  }
  const shoved = after.players.some((p, i) => p.allIn && !before.players[i].allIn);
  if (shoved) return { mood: 'wow', ...say('allin', {}, true) };
  return null;
}

export function dealerIdle(rng = Math.random) {
  return rng() < .5 ? pick(LINES.idle, rng) : '';
}
export const dealerTip = (rng = Math.random, count = 1) => pick(count >= 3 ? LINES.tipLots : LINES.tip, rng);

function fill(line, extra) { return line.replace('{name}', extra.name || 'the winner'); }
