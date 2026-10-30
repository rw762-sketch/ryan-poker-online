import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PokerService, PRESENCE_MS } from '../server/poker-service.mjs';
import { makeServer } from '../server/index.mjs';
import { LobbyClient, ServerRoom } from '../server-room.js';

function fixture() {
  let now = 100000;
  const service = new PokerService(() => now);
  return { service, advance(ms) { now += ms; }, enter(name) { return service.handle('/session', '', { name }); },
    write(path, token, body = {}) { now += 101; return service.handle(path, token, { requestId: randomUUID(), ...body }); } };
}

test('shared lobby lists players across tables without credentials or private state', () => {
  const f = fixture(), a = f.enter('Alice'), b = f.enter('<Bob>'), c = f.enter('Carol');
  const room = f.write('/create', a.token);
  f.write('/join', b.token, { code: room.room });
  const other = f.write('/create', c.token);
  const lobby = f.service.handle('/lobby', a.token);
  assert.equal(lobby.players.length, 3); assert.equal(lobby.rooms.length, 2);
  assert.equal(lobby.players.find(p => p.name === 'Bob').status, 'At a table');
  assert.equal(lobby.rooms.find(r => r.code === room.room).players, 2);
  const publicData = JSON.stringify({ players: lobby.players, rooms: lobby.rooms });
  for (const token of [a.token, b.token, c.token]) assert.ok(!publicData.includes(token));
  assert.ok(!publicData.includes('cards'));
  assert.notEqual(other.room, room.room);
  assert.throws(() => f.service.handle('/poll', randomUUID()), /session expired/);
});

test('six server players receive only their own cards; host authority and room limits hold', () => {
  const f = fixture(), players = ['Host', 'B', 'C', 'D', 'E', 'F', 'G'].map(n => f.enter(n));
  const created = f.write('/create', players[0].token);
  for (const p of players.slice(1, 6)) f.write('/join', p.token, { code: created.room });
  assert.throws(() => f.write('/join', players[6].token, { code: created.room }), /full/);
  let host = f.service.handle('/poll', players[0].token);
  assert.throws(() => f.write('/deal', players[1].token, { version: host.state.version }), /Only the host/);
  host = f.write('/deal', players[0].token, { version: host.state.version });
  for (let i = 0; i < 6; i++) {
    const data = f.service.handle('/poll', players[i].token);
    assert.equal(data.state.me, i);
    data.state.players.forEach((p, j) => assert.equal(p.cards.filter(Boolean).length, i === j ? 2 : 0));
    assert.equal(data.state.deck, undefined);
    assert.ok(!JSON.stringify(data).includes(players[i].token));
  }
  const turn = host.state.turn;
  assert.throws(() => f.write('/action', players[(turn + 1) % 6].token, { action: 'fold', version: host.state.version }), /not your turn/);
  const requestId = randomUUID();
  const result = f.write('/action', players[turn].token, { action: 'call', version: host.state.version, requestId });
  const duplicate = f.write('/action', players[turn].token, { action: 'call', version: host.state.version, requestId });
  assert.equal(duplicate.state.version, result.state.version);
  assert.deepEqual(duplicate.state.players, result.state.players);
});

test('offline presence expires, host can reclaim the table, and empty rooms are cleaned up', () => {
  const f = fixture(), a = f.enter('Host'), b = f.enter('Guest');
  const created = f.write('/create', a.token);
  f.write('/join', b.token, { code: created.room });
  f.advance(PRESENCE_MS + 1);
  const lobby = f.service.handle('/lobby', b.token);
  assert.equal(lobby.players.length, 1);
  assert.equal(lobby.rooms.length, 0);
  assert.equal(lobby.state.players[0].online, false);
  const resumed = f.service.handle('/session', a.token, { name: 'Host' });
  assert.equal(resumed.room, created.room); assert.equal(resumed.state.me, 0);
  assert.equal(resumed.rooms.length, 1);
  f.advance(30 * 60 * 1000 + 1); f.service.sweep();
  assert.equal(f.service.rooms.size, 0); assert.equal(f.service.sessions.size, 0);
});

test('host leave closes for everyone, guest leave releases seat and gifts do not change chips', () => {
  const f = fixture(), a = f.enter('Host'), b = f.enter('Guest');
  const room = f.write('/create', a.token);
  f.write('/join', b.token, { code: room.room });
  const before = f.service.handle('/poll', a.token);
  const after = f.write('/gift', b.token, { to: 0, drink: 'tea', from: 0 });
  assert.equal(after.gifts[0].from, 1); assert.equal(after.state.version, before.state.version);
  assert.throws(() => f.write('/gift', b.token, { to: 0, drink: 'tea' }), /every 4 seconds/);
  f.write('/leave', b.token);
  assert.equal(f.service.handle('/poll', a.token).state.players[1].occupied, false);
  f.write('/join', b.token, { code: room.room });
  f.write('/leave', a.token);
  assert.equal(f.service.handle('/poll', b.token).state, null);
});

test('real HTTP clients list each other, resume sessions and retry a lost action response exactly once', async t => {
  const f = fixture();
  const server = makeServer({ service: f.service, allowedOrigins: ['https://game.example'] });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const stores = Array.from({ length: 4 }, () => new Map());
  const clients = stores.map(map => new LobbyClient({ base, storage: { getItem: k => map.get(k), setItem: (k, v) => map.set(k, v) } }));
  for (const [i, client] of clients.entries()) await client.enter(`Player ${i}`);
  assert.equal((await clients[0].lobby()).players.length, 4);
  const room = await clients[0].write('/create');
  for (const client of clients.slice(1)) await client.write('/join', { code: room.room });
  f.advance(101);
  const dealt = await clients[0].write('/deal', { version: (await clients[0].request('/poll')).state.version });
  const turn = clients[dealt.state.turn], before = dealt.state.version;
  let dropped = false;
  turn.fetch = async (...args) => {
    const response = await fetch(...args);
    if (args[0].endsWith('/action') && !dropped) { dropped = true; await response.text(); throw Error('simulated response lost'); }
    return response;
  };
  f.advance(101);
  const moved = await turn.write('/action', { action: 'call', version: before });
  assert.equal(moved.state.version, before + 1);
  const reloaded = new LobbyClient({ base, storage: { getItem: k => stores[0].get(k), setItem() {} } });
  assert.equal((await reloaded.enter('Player 0')).state.me, 0);
  const forbidden = await fetch(base + '/lobby', { headers: { Origin: 'https://untrusted.example' } });
  assert.equal(forbidden.status, 403);
  const preflight = await fetch(base + '/lobby', { method: 'OPTIONS', headers: { Origin: 'https://game.example' } });
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://game.example');
  assert.equal((await fetch(base + '/create')).status, 405);
  assert.equal((await fetch(base.replace('/api', '/') )).status, 200);
});

test('server client ignores stale responses, delivers each gift once, and preserves seat on pagehide', () => {
  let stateCalls = 0, giftCalls = 0, leaves = 0;
  const room = new ServerRoom({ client: { write() { leaves++; return Promise.resolve(); } }, onState() { stateCalls++; }, onStatus() {}, onError() {}, onGift() { giftCalls++; } });
  const data = { room: 'ABCDEFGH', state: { version: 2, me: 0, host: true }, gifts: [{ id: 1 }] };
  room.apply(data); room.apply(data); room.apply({ ...data, state: { ...data.state, version: 1 } });
  assert.equal(stateCalls, 1); assert.equal(giftCalls, 1); assert.equal(room.view.version, 2);
  room.close({ leave: false }); assert.equal(leaves, 0);
});

test('overlapping lobby entry and room entry share a single session identity', async () => {
  let calls = 0, finish;
  const client = new LobbyClient({ storage: null, request: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const lobby = client.enter('Alice'), join = client.enter('Alice');
  assert.equal(calls, 1);
  finish({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ token: 'same-session' }) });
  assert.deepEqual(await lobby, await join); assert.equal(client.token, 'same-session');
});

test('GitHub Pages uses the hosted API and disabled endpoints never send requests', async () => {
  const { defaultMultiplayerApi } = await import('../network-config.js');
  assert.equal(defaultMultiplayerApi('rw762-sketch.github.io'), 'https://river-room-poker-wr.rw762.chatgpt.site/api');
  assert.equal(defaultMultiplayerApi('localhost'), '/api');
  let requests = 0;
  const client = new LobbyClient({ base: '', storage: null, request: () => { requests++; } });
  await assert.rejects(client.enter('Alice'), /not hosted/);
  assert.equal(requests, 0);
});

test('browser fetch receives its global receiver rather than the lobby client', async () => {
  let calls = 0;
  const client = new LobbyClient({ base: 'https://game.example/api', storage: null,
    request: function () {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      calls++;
      return Promise.resolve({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ token: 'browser-session' }) });
    },
  });
  await client.enter('Player');
  assert.equal(calls, 1);
  assert.equal(client.token, 'browser-session');
});
