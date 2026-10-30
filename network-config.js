// GitHub Pages uses the verified public service; server-hosted pages use their own API.
export const HOSTED_MULTIPLAYER_API_URL = 'https://river-room-poker-wr.rw762.chatgpt.site/api';
export function defaultMultiplayerApi(hostname = globalThis.location?.hostname || '') {
  // GitHub Pages cannot execute the Node multiplayer backend.
  return hostname.endsWith('.github.io') ? HOSTED_MULTIPLAYER_API_URL : '/api';
}
// Extra copies of the same server (for example one hosted in Hong Kong or
// Singapore, or behind a custom domain) for friends on networks where the main
// address is slow or blocked. Add their https://…/api addresses here.
export const MIRROR_API_URLS = [];
const validServer = url => { try { const u = new URL(url); return u.protocol === 'https:' && /\/api\/?$/.test(u.pathname) ? u.href.replace(/\/$/, '') : ''; } catch { return ''; } };
// Order: an explicit ?server= link, the last server that worked here, this site's default, then mirrors.
export function serverCandidates(search = globalThis.location?.search || '', storage = (() => { try { return globalThis.localStorage; } catch { return null; } })()) {
  const fromLink = validServer(new URLSearchParams(search).get('server') || '');
  if (fromLink) { try { storage?.setItem('poker-server', fromLink); } catch {} }
  let stored = '';
  try { stored = validServer(storage?.getItem('poker-server') || ''); } catch {}
  return [...new Set([fromLink, stored, defaultMultiplayerApi(), ...MIRROR_API_URLS].filter(Boolean))];
}
export const MULTIPLAYER_API_URL = serverCandidates()[0] || defaultMultiplayerApi();
// Ping every candidate at once; the fastest healthy one wins and is remembered.
export async function probeServers(candidates = serverCandidates(), request = globalThis.fetch) {
  return Promise.all(candidates.map(async url => {
    const start = performance.now();
    try {
      const response = await request.call(globalThis, `${url}/health`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      const data = await response.json();
      return { url, ok: response.ok && data?.ok === true, ms: Math.round(performance.now() - start) };
    } catch { return { url, ok: false, ms: null }; }
  }));
}
export async function pickServer(candidates = serverCandidates(), request = globalThis.fetch) {
  if (candidates.length < 2) return candidates[0] || '';
  const results = (await probeServers(candidates, request)).filter(r => r.ok).sort((a, b) => a.ms - b.ms);
  if (results[0]) { try { globalThis.localStorage?.setItem('poker-server', results[0].url); } catch {} }
  return results[0]?.url || candidates[0];
}
// Public browser configuration only. Never put a provider account/API secret here.
// Configure a HTTPS endpoint returning short-lived RTCIceServer[] credentials.
// The endpoint must allow this site's origin (CORS) and return Cache-Control: no-store.
export const TURN_CREDENTIALS_URL = '';
// Several STUN servers on different networks: Google's is blocked in mainland China,
// so Cloudflare's and a China-hosted one are tried too.
export const STUN_SERVERS = [
  { urls:'stun:stun.cloudflare.com:3478' },
  { urls:'stun:stun.miwifi.com:3478' },
  { urls:'stun:stun.l.google.com:19302' },
];
export async function peerConfiguration(fetchCredentials = fetch, endpoint = TURN_CREDENTIALS_URL) {
  if (!endpoint) return { iceServers:STUN_SERVERS.map(server => ({ ...server })) };
  if (!/^https:\/\//.test(endpoint)) throw Error('The multiplayer relay endpoint must use HTTPS.');
  let response;
  try { response = await fetchCredentials(endpoint, { cache:'no-store', signal:AbortSignal.timeout(10000) }); }
  catch { throw Error('The multiplayer relay is unavailable. Try again shortly.'); }
  if (!response.ok) throw Error('The multiplayer relay could not authorize this connection.');
  const servers = await response.json();
  if (!Array.isArray(servers) || !servers.length || servers.length > 12) throw Error('Invalid multiplayer relay configuration.');
  let relay = false;
  for (const server of servers) {
    const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
    if (!urls.length || !urls.every(url => typeof url === 'string' && /^(stun|turn|turns):[^\s]+$/.test(url))) throw Error('Invalid multiplayer relay address.');
    if (urls.some(url => /^turns?:/.test(url))) {
      relay = true;
      if (typeof server.username !== 'string' || !server.username || typeof server.credential !== 'string' || !server.credential) throw Error('Missing multiplayer relay credentials.');
    }
  }
  if (!relay) throw Error('The multiplayer relay service did not provide a relay.');
  return { iceServers:[...STUN_SERVERS.map(server => ({ ...server })), ...servers] };
}
