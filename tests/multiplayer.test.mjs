import test from 'node:test';
import assert from 'node:assert/strict';
import { HostTable, TURN_MS, OFFLINE_MS } from '../room-state.js';
const token = () => crypto.randomUUID();
function table(count = 6) {
  const room = new HostTable('Host', 1000);
  const tokens = [];
  for (let i = 1; i < count; i++) { tokens.push(token()); room.join(`Guest ${i}`, tokens.at(-1), 1000); }
  return { room, tokens };
}

test('2–6 players start with exactly two cards each and private views', () => {
  for (const count of [2, 3, 4, 5, 6]) {
    const { room } = table(count);
    room.start(0, room.version, 1000);
    for (let seat = 0; seat < count; seat++) {
      const view = room.view(seat);
      assert.equal(view.players[seat].cards.filter(Boolean).length, 2);
      assert.equal(view.players.flatMap((p, i) => i === seat ? [] : p.cards).filter(Boolean).length, 0);
      assert.equal('deck' in view, false);
      assert.equal('members' in view, false);
      assert.equal(JSON.stringify(view).includes('token'), false);
      assert.equal(view.options !== null, view.turn === seat);
    }
    assert.equal(room.game.players.filter(p => !p.folded).length, count);
    assert.equal(room.game.players.reduce((n, p) => n + p.stack, 0) + room.game.pot, count * 1000);
  }
});
test('only host starts; alone, mid-hand, or stale starts are rejected', () => {
  const solo = new HostTable('Host');
  assert.throws(() => solo.start(0, solo.version), /two connected/);
  const { room } = table();
  assert.throws(() => room.start(1, room.version), /Only the host/);
  assert.throws(() => room.start(0, -1), /changed/);
  room.start(0, room.version);
  assert.throws(() => room.start(0, room.version), /Finish/);
});
test('out-of-turn, invalid raise, and replayed actions cannot mutate chips', () => {
  const { room } = table(); room.start(0, room.version);
  const seat = room.game.turn;
  const view = JSON.stringify(room.view(seat));
  assert.throws(() => room.act((seat + 1) % 6, { action:'call', version:room.version }), /not your turn/);
  assert.throws(() => room.act(seat, { action:'raise', amount:NaN, version:room.version }), /not allowed/);
  assert.throws(() => room.act(seat, { action:'raise', amount:999999, version:room.version }), /not allowed/);
  assert.equal(JSON.stringify(room.view(seat)), view);
  const version = room.version;
  room.act(seat, { action:'call', version });
  assert.throws(() => room.act(room.game.turn, { action:'call', version }), /changed/);
});
test('six-seat capacity, room lock, reconnect identity and token privacy', () => {
  const { room, tokens } = table();
  assert.throws(() => room.join('Overflow', token()), /full/);
  assert.throws(() => room.join('Bad', 'short'), /Invalid session/);
  room.start(0, room.version);
  room.disconnect(1, 1000);
  assert.equal(room.join('Different name', tokens[0], 2000), 1);
  assert.equal(room.members[1].name, 'Guest 1');
  assert.equal(room.members[1].online, true);
  assert.throws(() => room.join('Late', token()), /started/);
  for (let seat = 0; seat < 6; seat++) for (const t of tokens) assert.ok(!JSON.stringify(room.view(seat)).includes(t));
});
test('leaving the lobby releases a seat; disconnected players sit out new hands', () => {
  const { room } = table(3);
  room.disconnect(2, 1000, true);
  assert.equal(room.members[2], null);
  assert.equal(room.join('Replacement', token()), 2);
  room.disconnect(2, 1000);
  room.start(0, room.version, 1000);
  assert.equal(room.game.players[2].folded, true);
  assert.equal(room.game.players[2].stack, 1000);
});
test('45-second timeout folds when facing a bet, checks otherwise', () => {
  const { room } = table(); room.start(0, room.version, 1000);
  room.members.forEach(m => m.seen = 1000 + TURN_MS);
  const actor = room.game.turn;
  assert.equal(room.tick(1000 + TURN_MS - 1), false);
  assert.equal(room.tick(1000 + TURN_MS), true);
  assert.equal(room.game.players[actor].folded, true);
  while (!room.game.done && room.game.stage === 0) room.act(room.game.turn, { action:'call', version:room.version }, 50000);
  const next = room.game.turn;
  room.members.forEach(m => m.seen = 100000);
  room.tick(50000 + TURN_MS);
  assert.equal(room.game.players[next].folded, false);
  assert.equal(room.game.players[next].action, 'Check');
});
test('disconnect grants reconnection grace, then skips the missing player', () => {
  const { room } = table(); room.start(0, room.version, 1000);
  const seat = room.game.turn; assert.notEqual(seat, 0);
  room.disconnect(seat, 1000);
  room.members.forEach(m => { if (m.online) m.seen = 100000; });
  room.tick(1000 + OFFLINE_MS - 1);
  assert.equal(room.game.turn, seat);
  room.tick(1000 + OFFLINE_MS);
  assert.notEqual(room.game.turn, seat);
});
test('showdown shares only non-folded cards; fold wins do not expose cards', () => {
  const { room } = table(); room.start(0, room.version);
  room.act(room.game.turn, { action:'fold', version:room.version });
  let moves = 0;
  while (!room.game.done && moves++ < 100) room.act(room.game.turn, { action:'call', version:room.version });
  assert.equal(room.game.done, true);
  for (const p of room.view(0).players) if (!p.folded) assert.equal(p.cards.filter(Boolean).length, 2);
  const folded = room.view(0).players[3]; assert.deepEqual(folded.cards, [null, null]);
  const { room:r } = table(); r.start(0,r.version);
  while (!r.game.done) r.act(r.game.turn, { action:'fold', version:r.version });
  assert.equal(r.view(1).players.flatMap((p,i) => i === 1 ? [] : p.cards).filter(Boolean).length, 0);
});
test('random multiplayer hands conserve chips and finish for 2, 3, 4 seats', () => {
  for (const count of [2,3,4]) for (let iteration = 0; iteration < 50; iteration++) {
    const { room } = table(count);
    for (let hand = 0; hand < 12; hand++) {
      if (room.game.players.filter(p => p.stack > 0).length < 2) break;
      room.start(0, room.version);
      let moves = 0;
      while (!room.game.done && moves++ < 400) {
        const o = room.game.options(), random = Math.random();
        room.act(room.game.turn, { version:room.version, action:random < .12 ? 'fold' : random > .75 && o.canRaise ? 'raise' : 'call', amount:random > .95 ? o.max : o.min });
        assert.equal(room.game.players.reduce((n,p) => n + p.stack, 0) + (room.game.done ? 0 : room.game.pot), count * 1000);
      }
      assert.ok(room.game.done);
    }
  }
});

// Exercise the actual room transport/controller with asynchronous paired channels.
// This verifies the protocol; it does not simulate real-world NAT/firewall behavior.
import { EventEmitter } from 'node:events';
import { OnlineRoom } from '../multiplayer.js';
const peers = new Map();
class Channel extends EventEmitter {
  constructor() { super(); this.open = false; }
  send(message) {
    if (!this.open) throw Error('closed');
    const copy = structuredClone(message);
    queueMicrotask(() => { if (this.partner.open) this.partner.emit('data', copy); });
  }
  close() {
    if (!this.open) return;
    this.open = this.partner.open = false;
    this.emit('close'); this.partner.emit('close');
  }
}
class FakePeer extends EventEmitter {
  constructor(id) {
    super(); this.id = id || token(); this.channels = []; peers.set(this.id, this);
    queueMicrotask(() => this.emit('open', this.id));
  }
  connect(id) {
    const a = new Channel(), b = new Channel(); a.partner = b; b.partner = a;
    this.channels.push(a); peers.get(id).channels.push(b);
    queueMicrotask(() => { peers.get(id).emit('connection', b); a.open = b.open = true; a.emit('open'); b.emit('open'); });
    return a;
  }
  destroy() { this.destroyed = true; this.channels.forEach(c => c.close()); peers.delete(this.id); }
}
globalThis.window = { Peer:FakePeer };
globalThis.sessionStorage = { getItem:() => null, setItem() {} };
const settle = () => new Promise(resolve => setImmediate(resolve));
const client = () => new OnlineRoom({ onState() {}, onStatus() {}, onError() {} });
test('host plus three guests receive private state, actions, and resumed seats', async () => {
  const host = client(), guests = [client(), client(), client()];
  try {
    await host.create('Host');
    for (let i = 0; i < guests.length; i++) await guests[i].join(`Guest ${i}`, host.code);
    await settle();
    assert.equal(host.view.players.filter(p => p.occupied).length, 4);
    host.deal(); await settle();
    for (const guest of guests) {
      assert.equal(guest.view.players[guest.me].cards.filter(Boolean).length, 2);
      assert.equal(guest.view.players.flatMap((p,i) => i === guest.me ? [] : p.cards).filter(Boolean).length, 0);
    }
    const actor = guests.find(g => g.me === host.view.turn);
    actor.action('call'); await settle();
    assert.equal(actor.view.version, host.view.version);
    const returning = guests[0], seat = returning.me;
    returning.connection.close(); await settle();
    assert.equal(host.view.players[seat].online, false);
    await returning.reconnect(); await settle();
    assert.equal(returning.me, seat);
    assert.equal(host.view.players[seat].online, true);
    assert.equal(host.connections.size, 3);
    const before = host.view.version;
    const wrong = guests.find(g => g.me !== host.view.turn);
    wrong.action('raise', 999999); await settle();
    assert.equal(host.view.version, before);
    host.close(); await settle();
    assert.ok(guests.every(g => !g.connected));
  } finally { host.close(); guests.forEach(g => g.close()); }
});
test('guest gifts broadcast once to every player with host-assigned sender and no poker mutation', async () => {
  const host = client(), guest = client(), observer = client();
  const received = [[],[],[]];
  [host,guest,observer].forEach((r,i)=>r.onGift=g=>received[i].push(g));
  try {
    await host.create('Host'); await guest.join('Guest',host.code); await observer.join('Observer',host.code); await settle();
    host.deal(); await settle();
    const before = JSON.stringify(host.table);
    guest.buyDrink(observer.me,'tea'); await settle();
    received.forEach(events=>assert.deepEqual(events,[{from:guest.me,to:observer.me,drink:'tea'}]));
    assert.equal(JSON.stringify(host.table),before);
    host.buyDrink(guest.me,'coffee'); await settle();
    received.forEach(events=>assert.equal(events.length,2));
    assert.equal(JSON.stringify(host.table),before);
  } finally { host.close(); guest.close(); observer.close(); }
});
