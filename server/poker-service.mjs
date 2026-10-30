const randomUUID = () => globalThis.crypto.randomUUID();
const randomBytes = size => globalThis.crypto.getRandomValues(new Uint8Array(size));
import { HostTable, cleanName } from '../room-state.js';
import { TableGifts, createChat } from '../table-gifts.js';

export const PRESENCE_MS = 30000;
const RETAIN_MS = 30 * 60 * 1000;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };

// One authoritative process. Only view(seat), never a table or session, leaves it.
export class PokerService {
  constructor(now = Date.now) { this.now = now; this.sessions = new Map(); this.rooms = new Map(); }
  sweep() {
    const now = this.now();
    for (const [code, room] of this.rooms) {
      if (now - room.seen > RETAIN_MS) { this.endRoom(code); continue; }
      room.table.tick(now, PRESENCE_MS, true);
    }
    for (const [token, session] of this.sessions) if (now - session.seen > RETAIN_MS) this.sessions.delete(token);
  }
  endRoom(code) {
    this.rooms.delete(code);
    for (const s of this.sessions.values()) if (s.room === code) { s.room = null; s.seat = null; }
  }
  session(token) {
    const session = this.sessions.get(token);
    if (!session) fail('Your lobby session expired. Enter the lobby again.', 401);
    session.seen = this.now();
    const room = this.rooms.get(session.room);
    if (room) { room.seen = this.now(); room.table.touch(session.seat, this.now()); }
    return session;
  }
  lobby(me) {
    const now = this.now();
    return {
      players: [...this.sessions.values()].filter(s => now - s.seen <= PRESENCE_MS).map(s => ({
        id: s.id, name: s.name, me: s === me, room: s.room,
        status: s.room ? (this.rooms.get(s.room)?.table.started ? 'Playing' : 'At a table') : 'In lobby',
      })),
      rooms: [...this.rooms.entries()].filter(([, r]) => r.table.members[0]?.online).map(([code, r]) => ({
        code, host: r.table.members[0].name, players: r.table.members.filter(Boolean).length,
        joinable: !r.table.started && r.table.members.some(m => !m), started: r.table.started,
      })),
    };
  }
  snapshot(session) {
    const room = this.rooms.get(session.room);
    return { room: session.room, state: room ? room.table.view(session.seat) : null,
      gifts: room ? room.events.filter(e => e.id > (session.giftAfter || 0)) : [] };
  }
  handle(path, token, body = {}) {
    this.sweep();
    if (path === '/health') return { ok: true, protocol: 1 };
    if (path === '/session') {
      const name = cleanName(body.name);
      let session = this.sessions.get(token);
      if (!session) {
        if (this.sessions.size >= 1000) fail('The lobby is busy. Try again shortly.', 503);
        token = randomUUID();
        session = { id: randomUUID(), name, seen: this.now(), room: null, seat: null, requests: new Map() };
        this.sessions.set(token, session);
      }
      if (!session.room) session.name = name;
      this.session(token);
      return { token, ...this.snapshot(session), ...this.lobby(session) };
    }
    const session = this.session(token);
    if (path === '/lobby') return { ...this.snapshot(session), ...this.lobby(session) };
    if (path === '/poll') return this.snapshot(session);
    const id = body.requestId;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{24,80}$/.test(id)) fail('Invalid request ID.');
    if (session.requests.has(id)) return { ...this.snapshot(session), ...session.requests.get(id) };
    if (session.lastWrite != null && this.now() - session.lastWrite < 100) fail('Please wait a moment.', 429);
    session.lastWrite = this.now();
    if (path === '/create') {
      if (session.room) fail('Leave your current room first.');
      if (this.rooms.size >= 200) fail('All tables are busy. Try again shortly.', 503);
      let code;
      do { code = [...randomBytes(8)].map(n => alphabet[n % 32]).join(''); } while (this.rooms.has(code));
      const table = new HostTable(session.name, this.now());
      this.rooms.set(code, { table, seen: this.now(), gifts: new TableGifts(), events: [], nextEvent: 1 });
      session.room = code; session.seat = 0; session.giftAfter = 0;
    } else if (path === '/join') {
      const code = String(body.code || '').trim().toUpperCase();
      const room = this.rooms.get(code);
      if (!room) fail('Room not found. Check the code with your friend.', 404);
      if (session.room && session.room !== code) fail('Leave your current room first.');
      if (session.room !== code) {
        session.seat = room.table.join(session.name, token, this.now());
        session.room = code; session.giftAfter = room.nextEvent - 1;
      }
      room.seen = this.now();
    } else {
      const room = this.rooms.get(session.room);
      if (!room) fail('This room has closed. Return to the lobby.', 410);
      if (path === '/action') room.table.act(session.seat, body, this.now());
      else if (path === '/bots') room.table.manageAI(session.seat, body.operation, body.seat, body.version, this.now());
      else if (path === '/deal') room.table.start(session.seat, body.version, this.now());
      else if (path === '/gift') {
        const gift = room.gifts.create(session.seat, body.to, body.drink, room.table.members, this.now());
        room.events.push({ ...gift, id: room.nextEvent++ });
        room.events = room.events.slice(-40);
      } else if (path === '/chat') {
        const chat = createChat(room.gifts, session.seat, body.text, room.table.members, this.now());
        room.events.push({ ...chat, id: room.nextEvent++ });
        room.events = room.events.slice(-40);
      } else if (path === '/leave') {
        if (session.seat === 0) this.endRoom(session.room);
        else { room.table.disconnect(session.seat, this.now(), true); session.room = null; session.seat = null; }
      } else fail('Unknown endpoint.', 404);
    }
    session.requests.set(id, {});
    if (session.requests.size > 128) session.requests.delete(session.requests.keys().next().value);
    return this.snapshot(session);
  }
}
