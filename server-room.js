import { MULTIPLAYER_API_URL } from './network-config.js?v=7710ac3987fa';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export class LobbyClient {
  constructor({ base = MULTIPLAYER_API_URL, storage, request = globalThis.fetch } = {}) {
    if (storage === undefined) { try { storage = globalThis.sessionStorage; } catch {} }
    this.base = base.replace(/\/$/, ''); this.storage = storage; this.fetch = request;
    try { this.token = storage?.getItem('poker-lobby-token') || ''; } catch { this.token = ''; }
  }
  async request(path, body, { retries = 0 } = {}) {
    if (!this.base) throw Object.assign(Error('The shared lobby is not hosted on this address. Choose Direct connection to create or join a room.'), { terminal: true });
    let error;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await this.fetch.call(globalThis, this.base + path, {
          method: body ? 'POST' : 'GET', cache: 'no-store',
          headers: { ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12000),
        });
        if (!response.headers.get('content-type')?.includes('application/json')) throw Object.assign(Error('The online lobby is not available on this address. Use the server game link or choose Direct connection.'), { terminal: true });
        const data = await response.json();
        if (!response.ok) throw Object.assign(Error(data.error || 'The server could not complete this request.'), { status: response.status, terminal: response.status < 500 && response.status !== 429 });
        return data;
      } catch (caught) {
        error = caught;
        if (caught.terminal || attempt === retries) break;
        await sleep(Math.min(4000, 750 * 2 ** attempt));
      }
    }
    if (error.status || error.terminal) throw error;
    throw Error('Cannot reach the game server. It may be offline or unavailable from this network.');
  }
  enter(name) {
    // Opening the dialog and joining can overlap. They must share one identity.
    if (this.entering) return this.entering;
    this.entering = this.request('/session', { name }).then(data => {
      this.token = data.token;
      try { this.storage?.setItem('poker-lobby-token', this.token); this.storage?.setItem('poker-lobby-name', name); } catch {}
      return data;
    }).finally(() => { this.entering = null; });
    return this.entering;
  }
  lobby() { return this.request('/lobby'); }
  write(path, body = {}) { return this.request(path, { ...body, requestId: crypto.randomUUID() }, { retries: 2 }); }
}

export class ServerRoom {
  constructor({ client, onState, onStatus, onError, onGift = () => {} }) {
    Object.assign(this, { client, onState, onStatus, onError, onGift });
    this.server = true; this.closed = false; this.connected = false; this.view = null;
    this.code = ''; this.me = -1; this.host = false; this.giftId = 0; this.failures = 0;
  }
  apply(data) {
    if (this.closed) return;
    if (!data.state) throw Object.assign(Error('This room has closed. Return to the lobby.'), { status: 410 });
    if (this.view && data.state.version < this.view.version) return;
    try { this.client.storage?.setItem('poker-active-server-room', data.room); } catch {}
    this.code = data.room; this.me = data.state.me; this.host = data.state.host;
    const changed = !this.view || this.view.version !== data.state.version || !this.connected;
    this.view = data.state; this.connected = true;
    if (this.failures) this.onStatus('Connection restored.');
    this.failures = 0;
    for (const gift of data.gifts || []) if (gift.id > this.giftId) { this.giftId = gift.id; this.onGift(gift); }
    if (changed) this.onState(this.view);
  }
  async open(name, path, body) {
    const data = await this.client.enter(name);
    if (this.closed) return;
    if (data.state && (path === '/create' || data.room === body.code?.trim().toUpperCase())) this.apply(data);
    else this.apply(await this.client.write(path, body));
    if (!this.closed) this.poll();
  }
  create(name) { return this.open(name, '/create', {}); }
  join(name, code) { return this.open(name, '/join', { code }); }
  async poll() {
    if (this.closed) return;
    try { this.apply(await this.client.request('/poll')); }
    catch (error) {
      if (this.closed) return;
      this.connected = false; this.failures++;
      this.onStatus(error.status === 401 || error.status === 410 ? error.message : 'Connection interrupted. Reconnecting automatically…');
      if (error.status === 401 || error.status === 410) return;
    }
    if (!this.closed) this.timer = setTimeout(() => this.poll(), this.failures ? Math.min(10000, 1000 * 2 ** Math.min(this.failures, 3)) : 1000);
  }
  async reconnect() {
    this.apply(await this.client.request('/poll'));
  }
  command(path, body) {
    if (!this.connected || !this.view) throw Error('Reconnecting. Wait before playing.');
    if (this.busy) throw Error('Your previous move is still being confirmed.');
    this.busy = true;
    this.client.write(path, body).then(data => { this.apply(data); this.onState(this.view); }).catch(error => {
      if (this.closed) return;
      this.onError(error.message);
      // A response can be lost after a successful move. Fetch the authoritative view.
      this.reconnect().catch(() => {});
    }).finally(() => { this.busy = false; });
  }
  action(action, amount) { this.command('/action', { action, amount, version: this.view?.version }); }
  manageAI(operation, seat) { this.command('/bots', { operation, seat, version: this.view?.version }); }
  deal() { this.command('/deal', { version: this.view?.version }); }
  buyDrink(to, drink) { this.command('/gift', { to, drink }); }
  close({ leave = true } = {}) {
    this.closed = true; this.connected = false; clearTimeout(this.timer);
    if (leave) {
      try { this.client.storage?.removeItem('poker-active-server-room'); } catch {}
      if (this.code) this.client.write('/leave').catch(() => {});
    }
  }
}
