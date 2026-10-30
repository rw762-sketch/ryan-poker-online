import { evaluate } from './engine.js?v=1c7d05e7291b';
import { describeHand, compareHandsText } from './hand-description.js?v=1c7d05e7291b';
const possessiveHand = score => describeHand(score).replace(/^a /, '');

// Generate this on the authority for a single viewer; folded cards never enter it.
export function playerOutcome(game, seat = 0) {
  if (!game.done || !game.hand) return null;
  const me = game.players[seat];
  if (!me?.cards.length) return {kind:'watch',title:'HAND COMPLETE',detail:'You sat out this hand.'};
  const award = (game.awards || []).find(a => a.seat === seat);
  const profit = award?.profit ?? -me.total;
  if (me.folded) return {kind:'fold',title:'YOU FOLDED',detail:'You folded before the result. Your cards stay private.'};
  if (game.stage !== 4) {
    return award && profit > 0
      ? {kind:award.allIn?'all-in-win':'win',title:award.allIn?'ALL-IN VICTORY':'YOU WIN',detail:`Everyone else folded. You won ${award.amount} chips (+${profit} net).`}
      : {kind:'watch',title:'HAND COMPLETE',detail:'The hand ended without a showdown.'};
  }
  // Old saved hands predate pot details; never guess a winner for those snapshots.
  if (!game.pots?.length) return {kind:'watch',title:'HAND COMPLETE',detail:game.result || 'Showdown complete.'};
  const own = evaluate([...me.cards, ...game.board]);
  const pots = game.pots.filter(p => !p.refund && p.eligible.includes(seat));
  const won = pots.filter(p => p.winners.includes(seat));
  const splitOnly = won.length && won.every(p => p.winners.length > 1);
  const kind = splitOnly ? 'split' : won.length && profit > 0 ? (award?.allIn?'all-in-win':'win') : won.length ? 'partial' : 'loss';
  const title = {split:'SPLIT POT',partial:'SIDE POT RESULT',loss:'YOU LOST',win:'YOU WIN','all-in-win':'ALL-IN VICTORY'}[kind];
  const lines = pots.map((pot, i) => {
    const prefix = pots.length > 1 ? `${i === 0 ? 'Main pot' : 'Side pot '+i}: ` : '';
    if (pot.winners.includes(seat)) {
      if (pot.winners.length > 1) {
        const names = pot.winners.filter(s => s !== seat).map(s => game.players[s].name).join(' and ');
        return `${prefix}You split with ${names}: the same best five-card hand, ${describeHand(own)}.`;
      }
      const rivals = pot.eligible.filter(s => s !== seat && !game.players[s].folded);
      if (!rivals.length) return `${prefix}You won; everyone else in this pot folded.`;
      return prefix + rivals.map(s => {
        const other = game.players[s], score = evaluate([...other.cards, ...game.board]);
        const tieBreak = compareHandsText(own, score).split(' — ')[1];
        return `Your ${possessiveHand(own)} beat ${other.name}’s ${possessiveHand(score)}${tieBreak ? ' — '+tieBreak : ''}.`;
      }).join(' ');
    }
    return prefix + pot.winners.map(s => {
      const other = game.players[s], score = evaluate([...other.cards, ...game.board]);
      const tieBreak = compareHandsText(score, own).split(' — ')[1];
      return `Your ${possessiveHand(own)} lost to ${other.name}’s ${possessiveHand(score)}${tieBreak ? ' — '+tieBreak : ''}.`;
    }).join(' ');
  });
  return {kind,title,detail:lines.join(' ') + ` Net: ${profit > 0 ? '+' : ''}${profit} chips.`};
}
