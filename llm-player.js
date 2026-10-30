// Bring-your-own LLM for the solo table. Works with any OpenAI-compatible
// /chat/completions endpoint: a model on your own computer (Ollama, LM Studio)
// or a hosted provider (DeepSeek, OpenAI, Groq). Settings and key live only in
// this browser's localStorage and are sent only to the endpoint you choose.

export const PRESETS = {
  ollama:   { label: 'Ollama (on this computer)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1:8b', key: false },
  lmstudio: { label: 'LM Studio (on this computer)', baseUrl: 'http://localhost:1234/v1', model: 'local-model', key: false },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', key: true },
  openai:   { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', key: true },
  groq:     { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', key: true },
  custom:   { label: 'Other OpenAI-compatible', baseUrl: '', model: '', key: true },
};
const STORE = 'poker-llm-settings';

export function loadSettings(storage = globalThis.localStorage) {
  try { const s = JSON.parse(storage?.getItem(STORE) || 'null'); if (s && typeof s === 'object') return s; } catch {}
  return { preset: 'ollama', baseUrl: PRESETS.ollama.baseUrl, model: PRESETS.ollama.model, apiKey: '', enabled: false };
}
export function saveSettings(settings, storage = globalThis.localStorage) {
  try { storage?.setItem(STORE, JSON.stringify(settings)); } catch {}
}
export function configured(settings = loadSettings()) {
  return !!(settings.enabled && /^https?:\/\//.test(settings.baseUrl || '') && settings.model);
}

const RANK = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const SUIT = ['♠', '♥', '♣', '♦'];
export const cardText = c => `${RANK[c.r] || c.r}${SUIT[c.s]}`;

// A readable description of exactly what this bot is allowed to know.
export function describeSpot(obs, extra = {}) {
  const o = obs.options;
  return {
    yourCards: obs.cards.map(cardText).join(' '),
    board: obs.board.length ? obs.board.map(cardText).join(' ') : 'none yet (pre-flop)',
    pot: obs.pot, yourStack: obs.stack, yourBetThisRound: obs.bet, highestBetThisRound: obs.current,
    toCall: o.call, canRaise: !!o.canRaise, minRaiseTo: o.min, maxRaiseTo: o.max,
    position: obs.position, opponentsStillIn: obs.opponents,
    recentActions: (extra.recent || []).slice(0, 8),
    whatYouKnowAboutTheHuman: extra.memory || 'nothing yet',
  };
}

function parseMove(text, obs) {
  let data = null;
  const json = /\{[\s\S]*\}/.exec(text || '')?.[0];
  if (json) { try { data = JSON.parse(json); } catch {} }
  if (!data) {
    // Plain-text fallback, e.g. "ACTION: raise 120".
    const m = /\b(fold|check|call|raise|bet|all[- ]?in)\b\s*(?:to\s*)?(\d+)?/i.exec(text || '');
    if (m) data = { action: m[1].toLowerCase(), amount: m[2] ? Number(m[2]) : 0 };
  }
  if (!data) return null;
  let action = String(data.action || '').toLowerCase().replace(/[^a-z]/g, '');
  if (action === 'check') action = 'call';
  if (action === 'bet') action = 'raise';
  if (action === 'allin') action = 'allin';
  const o = obs.options;
  const say = typeof data.say === 'string' ? data.say.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80) : '';
  const why = typeof data.why === 'string' ? data.why.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 220) : '';
  if (action === 'fold') return o.owed > 0 ? { action, say, why } : { action: 'call', say, why };
  if (action === 'call') return { action, say, why };
  if (action === 'allin') return o.canRaise || o.owed > 0 ? { action, say, why } : { action: 'call', say, why };
  if (action === 'raise') {
    if (!o.canRaise) return { action: 'call', say, why };
    const amount = Math.round(Number(data.amount));
    return { action, amount: Math.min(o.max, Math.max(o.min, Number.isFinite(amount) ? amount : o.min)), say, why };
  }
  return null;
}

async function complete(settings, messages, { json = true, timeout = 15000 } = {}) {
  const url = `${settings.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const headers = { 'Content-Type': 'application/json', ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}) };
  const body = { model: settings.model, messages, temperature: 0.7, max_tokens: 400, ...(json ? { response_format: { type: 'json_object' } } : {}) };
  let response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  // Some local servers reject response_format; ask again without it.
  if (!response.ok && json && response.status === 400) return complete(settings, messages, { json: false, timeout });
  if (!response.ok) throw Error(`The AI endpoint answered ${response.status}.`);
  const data = await response.json();
  return String(data.choices?.[0]?.message?.content || '');
}

export async function llmDecision(obs, { name = 'Bot', persona = '', recent = [], memory = '' } = {}, settings = loadSettings()) {
  const system = `You are ${name}, a player at a friendly six-seat no-limit Texas Hold'em table with play chips. ${persona}
Decide your move using pot odds, position, your hand strength and what the others' betting suggests.
Reply with JSON only: {"action":"fold|call|raise|allin","amount":<total raise-to amount, only for raise>,"say":"<optional table talk under 70 characters, often empty, never reveal your cards>","why":"<one or two short sentences on your reasoning>"}.
"call" also means check when nothing is owed. Raises must be between minRaiseTo and maxRaiseTo.`;
  const text = await complete(settings, [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(describeSpot(obs, { recent, memory })) }]);
  return parseMove(text, obs);
}

export async function llmChat(text, { name = 'Bot', persona = '' } = {}, settings = loadSettings()) {
  const reply = await complete(settings, [
    { role: 'system', content: `You are ${name} at a friendly play-chips poker table. ${persona} Reply to the other player in under 70 characters, casual and in character. Never reveal your cards. Plain text only.` },
    { role: 'user', content: String(text).slice(0, 120) },
  ], { json: false, timeout: 12000 });
  return reply.replace(/[\u0000-\u001f<>"]/g, '').trim().slice(0, 80);
}

export async function testConnection(settings) {
  const reply = await complete(settings, [{ role: 'user', content: 'Reply with the single word: ready' }], { json: false, timeout: 20000 });
  return reply.trim().slice(0, 40) || '(empty reply)';
}

export { parseMove };
