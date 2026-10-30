import { peerConfiguration } from './network-config.js?v=690beaffbb51';
import { SEATS } from './engine.js?v=690beaffbb51';
import { TableGifts, createChat, validChat } from './table-gifts.js?v=690beaffbb51';
import { HostTable } from './room-state.js?v=690beaffbb51';
const PREFIX = 'river-room-v1-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let loading;
function loadPeer() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (!loading) loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./vendor/peerjs-1.5.5.min.js?v=690beaffbb51', import.meta.url).href;
    script.onload = () => window.Peer ? resolve(window.Peer) : reject(Error('Multiplayer could not load.'));
    script.onerror = () => { loading = null; script.remove(); reject(Error('Multiplayer could not load. Check your connection and try again.')); };
    document.head.append(script);
  });
  return loading;
}
function code() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), n => ALPHABET[n % 32]).join('');
}
function sessionToken(room) {
  const key = `river-room-session:${room}`;
  try {
    let token = sessionStorage.getItem(key);
    if (!token) { token = crypto.randomUUID(); sessionStorage.setItem(key, token); }
    return token;
  } catch { return crypto.randomUUID(); }
}
export function networkMessage(error) {
  if (error?.type === 'peer-unavailable') return 'Room not found. Check the code and make sure the host has the game open.';
  if (error?.type === 'unavailable-id') return 'That room code is busy. Create a room again.';
  if (error?.type === 'webrtc') return 'The browser connection to the host failed. Keep both tabs open and try the same Wi-Fi or a mobile hotspot. This network may need a relay.';
  return 'Room discovery is unavailable. Check your internet connection and try again.';
}

export class OnlineRoom {
  constructor({ onState, onStatus, onError, onGift = () => {}, onChat = () => {} }) {
    this.onChat = onChat;
    this.onState = onState;
    this.onGift = onGift;
    this.gifts = new TableGifts();
    this.onStatus = onStatus;
    this.onError = onError;
    this.connections = new Map();
    this.pending = new Set();
    this.closed = false;
    this.connected = false;
    this.me = -1;
    this.view = null;
    this.code = '';
    this.host = false;
    this.lastResponse = Date.now();
  }
  async openPeer(id) {
    const Peer = await loadPeer();
    if (this.closed) throw Error('Room closed.');
    const config = await peerConfiguration();
    if (this.closed) throw Error('Room closed.');
    this.peer = new Peer(id, { debug: 0, secure: true, config });
    this.peer.on('disconnected', () => {
      if (this.closed) return;
      this.onStatus('Room discovery disconnected. Existing players can keep playing.');
      try { this.peer.reconnect(); } catch {}
    });
    this.peer.on('error', error => {
      if (!this.closed) this.onError(networkMessage(error));
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Could not reach multiplayer. Try again on another network.')), 15000);
      this.peer.on('open', () => { clearTimeout(timeout); resolve(); });
      this.peer.on('error', error => { clearTimeout(timeout); reject(Error(networkMessage(error))); });
    });
    if (this.closed) throw Error('Room closed.');
  }
  async create(name) {
    this.host = true;
    this.code = code();
    this.table = new HostTable(name);
    await this.openPeer(PREFIX + this.code);
    this.me = 0;
    this.connected = true;
    this.peer.on('connection', connection => this.accept(connection));
    this.tickTimer = setInterval(() => {
      if (this.table.tick()) this.broadcast();
    }, 1000);
    this.pingTimer = setInterval(() => {
      for (const connection of this.connections.values()) this.send(connection, { type: 'ping' });
    }, 3000);
    this.broadcast();
  }
  async join(name, room) {
    this.host = false;
    this.code = room.trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(this.code)) throw Error('Enter the 8-character room code.');
    this.name = name;
    this.token = sessionToken(this.code);
    await this.openPeer(undefined);
    // Guests never accept other peers as a dealer.
    this.peer.on('connection', connection => connection.close());
    await this.connectToHost();
    this.healthTimer = setInterval(() => {
      if (this.connected && Date.now() - this.lastResponse > 15000) {
        this.connected = false;
        this.onStatus('Connection lost. Reconnect to reclaim your seat.');
      }
    }, 3000);
  }
  async connectToHost() {
    const previous = this.connection;
    this.connection = null;
    previous?.close();
    const connection = this.peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
    this.connection = connection;
    await new Promise((resolve, reject) => {
      const peerError = error => {
        if (admitted || this.connection !== connection) return;
        cleanup();
        reject(Error(networkMessage(error)));
        connection.close();
      };
      const cleanup = () => { clearTimeout(timeout); this.peer.off('error', peerError); };
      const timeout = setTimeout(() => {
        cleanup();
        reject(Error('The host did not respond. Keep its tab open and check the room code. If both tabs are open, try the same Wi-Fi or a mobile hotspot.'));
        connection.close();
      }, 30000);
      let admitted = false;
      this.peer.on('error', peerError);
      connection.on('open', () => this.send(connection, { type: 'join', name: this.name, token: this.token }));
      connection.on('data', message => {
        if (this.closed || this.connection !== connection || !message || typeof message !== 'object') return;
        this.lastResponse = Date.now();
        if (message.type === 'ping') {
          this.send(connection, { type: 'pong' });
          if (admitted && !this.connected) { this.connected = true; this.onStatus('Connected to your friends.'); }
        } else if (message.type === 'state') {
          if (!validState(message.state)) return;
          admitted = true;
          this.connected = true;
          this.me = message.state.me;
          cleanup();
          this.apply(message.state);
          resolve();
        } else if (message.type === 'gift' && admitted) {
          this.onGift(message.gift);
        } else if (message.type === 'chat' && admitted && validChat(message.chat)) {
          this.onChat(message.chat);
        } else if (message.type === 'error') {
          const error = typeof message.message === 'string' ? message.message.slice(0, 200) : 'Action rejected.';
          if (!admitted) { cleanup(); reject(Error(error)); }
          else this.onError(error);
        }
      });
      connection.on('close', () => {
        cleanup();
        if (this.closed || this.connection !== connection) return;
        this.connected = false;
        this.onStatus('The host disconnected. Reconnect if the room is still open.');
        if (!admitted) reject(Error('The room closed before you joined.'));
      });
      connection.on('error', error => {
        cleanup();
        if (!admitted) reject(Error(networkMessage({ type:'webrtc', ...error })));
        else { this.connected = false; this.onStatus('Connection lost. Reconnect to reclaim your seat.'); }
      });
    });
  }
  async reconnect() {
    if (this.closed || this.host || !this.peer || this.peer.destroyed) throw Error('Rejoin using the room code.');
    await this.connectToHost();
  }
  accept(connection) {
    if (this.closed || this.pending.size >= 8) { connection.close(); return; }
    this.pending.add(connection);
    let seat = -1;
    let lastAction = 0;
    const timeout = setTimeout(() => connection.close(), 10000);
    connection.on('data', message => {
      if (this.closed || !message || typeof message !== 'object') return;
      try {
        if (seat < 0) {
          if (message.type !== 'join') throw Error('Join the room first.');
          seat = this.table.join(message.name, message.token);
          clearTimeout(timeout);
          this.pending.delete(connection);
          const old = this.connections.get(seat);
          this.connections.set(seat, connection);
          old?.close();
          this.broadcast();
          return;
        }
        if (this.connections.get(seat) !== connection) return;
        if (message.type === 'pong') {
          if (this.table.touch(seat)) this.broadcast();
          return;
        }
        if (message.type === 'leave') {
          this.table.disconnect(seat, Date.now(), true);
          this.connections.delete(seat);
          connection.close();
          this.broadcast();
          return;
        }
        if (Date.now() - lastAction < 120) return;
        lastAction = Date.now();
        if (message.type === 'gift') { this.shareGift(seat, message.to, message.drink); return; }
        if (message.type === 'chat') { this.shareChat(seat, message.text); return; }
        if (message.type !== 'action') throw Error('Only the host can deal.');
        this.table.act(seat, message);
        this.broadcast();
      } catch (error) {
        this.send(connection, { type: 'error', message: error.message });
        if (seat >= 0) this.send(connection, { type: 'state', state: this.table.view(seat) });
      }
    });
    const disconnected = () => {
      clearTimeout(timeout);
      this.pending.delete(connection);
      if (this.closed || seat < 0 || this.connections.get(seat) !== connection) return;
      this.connections.delete(seat);
      this.table.disconnect(seat);
      this.broadcast();
    };
    connection.on('close', disconnected);
    connection.on('error', disconnected);
  }
  send(connection, message) {
    if (!connection?.open) return;
    try { connection.send(message); } catch {}
  }
  apply(state) {
    this.view = state;
    this.onState(state);
  }
  broadcast() {
    if (this.closed) return;
    this.apply(this.table.view(0));
    for (const [seat, connection] of this.connections) {
      this.send(connection, { type: 'state', state: this.table.view(seat) });
    }
  }
  action(action, amount) {
    if (!this.connected || !this.view) throw Error('Reconnect before playing.');
    const message = { type: 'action', action, amount, version: this.view.version };
    if (this.host) { this.table.act(0, message); this.broadcast(); }
    else this.send(this.connection, message);
  }
  shareGift(from, to, drink) {
    const gift = this.gifts.create(from, to, drink, this.table.members);
    this.onGift(gift);
    for (const connection of this.connections.values()) this.send(connection, { type: 'gift', gift });
  }
  shareChat(from, text) {
    const chat = createChat(this.gifts, from, text, this.table.members);
    this.onChat(chat);
    for (const connection of this.connections.values()) this.send(connection, { type: 'chat', chat });
  }
  chat(text) {
    if (!this.connected || !this.view) throw Error('Reconnect before chatting.');
    if (this.host) this.shareChat(0, text);
    else this.send(this.connection, { type: 'chat', text });
  }
  buyDrink(to, drink) {
    if (!this.connected || !this.view) throw Error('Reconnect before sending a drink.');
    if (this.host) this.shareGift(0, to, drink);
    else this.send(this.connection, { type: 'gift', to, drink });
  }
  manageAI(operation, seat) {
    if (!this.host) throw Error('Only the host can manage AI seats.');
    this.table.manageAI(0, operation, seat, this.view.version);
    this.broadcast();
  }
  deal() {
    if (!this.host) throw Error('Only the host can deal.');
    this.table.start(0, this.view.version);
    this.broadcast();
  }
  close() {
    if (!this.host) this.send(this.connection, { type: 'leave' });
    this.closed = true;
    clearInterval(this.tickTimer);
    clearInterval(this.pingTimer);
    clearInterval(this.healthTimer);
    this.peer?.destroy();
    this.connections.clear();
    this.pending.clear();
  }
}

function validState(state) {
  return state && Number.isInteger(state.version) && Number.isInteger(state.me) && state.me >= 0 && state.me < SEATS &&
    Array.isArray(state.players) && state.players.length === SEATS &&
    state.players.every(p => p && typeof p.name === 'string' && p.name.length <= 18 && Array.isArray(p.cards) && p.cards.length <= 2 && p.cards.every(validCard)) &&
    Array.isArray(state.board) && state.board.length <= 5 && state.board.every(validCard) &&
    Array.isArray(state.logs) && state.logs.length <= 70 && state.logs.every(l => typeof l === 'string' && l.length < 500);
}
function validCard(card) {
  return card === null || (Number.isInteger(card?.r) && card.r >= 2 && card.r <= 14 && Number.isInteger(card.s) && card.s >= 0 && card.s < 4);
}
