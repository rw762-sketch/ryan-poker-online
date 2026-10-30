import { PlayerMemory } from './player-memory.js?v=1c7d05e7291b';
import { playerOutcome } from './player-outcome.js?v=1c7d05e7291b';
import { Poker, SEATS, SEAT_NAMES } from './engine.js?v=1c7d05e7291b';

import { botObservation, chooseBotAction } from './ai.js?v=1c7d05e7291b';
import { randomStyle, driftStyle } from './neural-policy.js?v=1c7d05e7291b';

export const MAX_PLAYERS = SEATS;
export const TURN_MS = 45000;
export const OFFLINE_MS = 15000;
export function cleanName(value) {
  if (typeof value !== 'string') throw Error('Enter a name.');
  const name = value.trim().replace(/[\u0000-\u001f\u007f<>]/g, '').slice(0, 18);
  if (!name) throw Error('Enter a name.');
  return name;
}

// The host owns the deck and validates actions. Never serialize this object.
export class HostTable {
  constructor(name, now = Date.now()) {
    this.game = new Poker();
    this.memory = new PlayerMemory();
    this.game.players.forEach(p => Object.assign(p, { name: 'Open seat', stack: 0, folded: true }));
    this.members = Array(SEATS).fill(null);
    this.members[0] = { name: cleanName(name), online: true, seen: now, token: null };
    Object.assign(this.game.players[0], { name: this.members[0].name, stack: 1000 });
    this.version = 0;
    this.started = false;
    this.deadline = null;
  }
  changed(now = Date.now()) {
    this.version++;
    this.deadline = this.game.done ? null : now + TURN_MS;
  }
  join(name, token, now = Date.now()) {
    if (typeof token !== 'string' || !/^[a-zA-Z0-9-]{24,80}$/.test(token)) throw Error('Invalid session. Try joining again.');
    let seat = this.members.findIndex((m, i) => i > 0 && m?.token === token);
    if (seat < 0) {
      if (this.started) throw Error('This table has started. Ask the host to create a new room.');
      seat = this.members.findIndex(m => !m);
      if (seat < 0) throw Error('This room is full.');
      this.members[seat] = { name: cleanName(name), token, online: true, seen: now };
      Object.assign(this.game.players[seat], { name: this.members[seat].name, stack: 1000 });
    } else Object.assign(this.members[seat], { online: true, seen: now });
    this.version++;
    return seat;
  }
  manageAI(seat, operation, target, version, now = Date.now()) {
    if (seat !== 0) throw Error('Only the host can manage AI seats.');
    if (version !== this.version) throw Error('The table changed. Try again.');
    if (this.started) throw Error('Set up AI seats before the first hand.');
    if (operation === 'add' || operation === 'fill') {
      const empty = this.members.flatMap((m, i) => !m ? [i] : []);
      if (!empty.length) throw Error('This room is full.');
      for (const i of operation === 'fill' ? empty : empty.slice(0, 1)) {
        const name = `${SEAT_NAMES[i]} AI`;
        this.members[i] = { name, bot: true, online: true, seen: now, token: null, style: randomStyle() };
        Object.assign(this.game.players[i], { name, stack: 1000 });
      }
    } else if (operation === 'remove') {
      if (!Number.isInteger(target) || !this.members[target]?.bot) throw Error('Choose an AI seat.');
      this.members[target] = null;
      Object.assign(this.game.players[target], { name: 'Open seat', stack: 0, folded: true });
    } else throw Error('Unknown AI seat option.');
    this.version++;
  }
  touch(seat, now = Date.now()) {
    const member = this.members[seat];
    if (!member) return false;
    const changed = !member.online;
    member.online = true;
    member.seen = now;
    if (changed) this.version++;
    return changed;
  }
  disconnect(seat, now = Date.now(), leave = false) {
    if (seat < 1 || !this.members[seat]) return;
    this.members[seat].online = false;
    this.members[seat].seen = now - (leave ? OFFLINE_MS : 0);
    if (!this.started && leave) {
      this.members[seat] = null;
      Object.assign(this.game.players[seat], { name: 'Open seat', stack: 0, folded: true });
    }
    this.version++;
  }
  start(seat, version, now = Date.now()) {
    if (seat !== 0) throw Error('Only the host can deal.');
    if (version !== this.version) throw Error('The table changed. Try again.');
    if (!this.game.done) throw Error('Finish this hand first.');
    const ready = this.members.map((m, i) => !!m?.online && this.game.players[i].stack > 0);
    if (ready.filter(Boolean).length < 2) throw Error('You need two connected players with chips.');
    const stacks = this.game.players.map(p => p.stack);
    this.game.players.forEach((p, i) => { if (!ready[i]) p.stack = 0; });
    this.game.start();
    this.memory.begin(this.game);
    if (this.game.done) this.memory.finish();
    this.game.players.forEach((p, i) => { if (!ready[i]) p.stack = stacks[i]; });
    this.started = true;
    this.changed(now);
  }
  act(seat, message, now = Date.now()) {
    if (this.game.done || seat !== this.game.turn || !this.members[seat]?.online) throw Error('It is not your turn.');
    if (message.version !== this.version) throw Error('The table changed. Try your action again.');
    const observed = this.memory.capture(this.game, message.action, message.amount);
    if (!this.game.act(message.action, message.amount)) throw Error('That bet is not allowed.');
    this.memory.record(observed);
    if (this.game.done) {
      this.memory.finish(); this.memory.history = this.memory.history.slice(-24);
      this.members.forEach((m, i) => { if (m?.bot && m.style) { const award = (this.game.awards || []).find(a => a.seat === i); m.style = driftStyle(m.style, award ? award.profit : -this.game.players[i].total); } });
    }
    this.changed(now);
  }
  tick(now = Date.now(), offlineMs = OFFLINE_MS, includeHost = false) {
    let changed = false;
    this.members.forEach((m, i) => {
      if ((i > 0 || includeHost) && !m?.bot && m?.online && now - m.seen > offlineMs) {
        m.online = false;
        this.version++;
        changed = true;
      }
    });
    if (!this.game.done) {
      const member = this.members[this.game.turn];
      if (member?.bot) {
        // Hosted API bots get a bounded window; a lost request cannot stall play.
        if (this.apiBots && this.apiSkipDeadline !== this.deadline &&
            now < this.deadline - TURN_MS + 9000) return changed;
        if (now >= this.deadline - TURN_MS + 1200) {
          const obs = botObservation(this.game, this.memory);
          obs.style = member.style || randomStyle();
          const decision = chooseBotAction(obs, 'neural');
          this.act(this.game.turn, { ...decision, version: this.version }, now);
          return true;
        }
        return changed;
      }
      if (now >= this.deadline || (!member?.online && now - (member?.seen || 0) >= offlineMs)) {
        const player = this.game.players[this.game.turn];
        this.game.log(`${player.name} timed out.`);
        this.game.act(this.game.options().owed ? 'fold' : 'call');
        // A disconnected player's automatic move is not a betting preference.
        if (this.game.done) { this.memory.finish(); this.memory.history = this.memory.history.slice(-24); }
        this.changed(now);
        changed = true;
      }
    }
    return changed;
  }
  view(seat) {
    const g = this.game;
    // Whitelist fields. No deck, session tokens, or opponents' private cards.
    return {
      version: this.version, me: seat, host: seat === 0,
      started: this.started, deadline: this.deadline,
      hand: g.hand, board: g.board.map(c => ({ ...c })), done: g.done,
      stage: g.stage ?? 0, pot: g.pot, turn: g.turn ?? -1,
      outcome: playerOutcome(g, seat),
      awards: (g.awards || []).map(a => ({ ...a })),
      dealer: g.dealer, result: g.result || '', logs: [...g.logs],
      options: !g.done && seat === g.turn ? { ...g.options() } : null,
      players: g.players.map((p, i) => ({
        name: this.members[i]?.name || 'Open seat',
        bot: !!this.members[i]?.bot, allIn: !!p.allIn,
        occupied: !!this.members[i], online: !!this.members[i]?.online,
        stack: p.stack, bet: p.bet, total: p.total, folded: p.folded, action: p.action,
        cards: p.cards.map(c => i === seat || (g.done && g.stage === 4 && !p.folded) ? { ...c } : null),
      })),
    };
  }
}
