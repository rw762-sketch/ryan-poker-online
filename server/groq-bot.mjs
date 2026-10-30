import { readObservation } from '../strategy.js';
import { botObservation, chooseBotAction } from '../ai.js';
import { updateStored } from './cloud-state.mjs';

export const GROQ_MODEL = 'openai/gpt-oss-20b';
const DAILY_LIMIT = 100;

// Called inside the snapshot transaction. Reserve quota and this turn before
// any network I/O, so concurrent polls cannot spend twice on the same decision.
export function claimBotJob(service, response) {
  const table = service.rooms.get(response.room)?.table;
  const now = service.now();
  if (!table?.apiBots || table.game.done || !table.members[table.game.turn]?.bot ||
      now < table.deadline - 45000 + 1200 || table.apiSkipDeadline === table.deadline) return null;
  if (table.apiPending?.deadline === table.deadline) return null;
  const day = Math.floor(now / 86400000);
  const budget = service.aiBudget ||= { day, count: 0, nextAt: 0 };
  if (budget.day !== day) { budget.day = day; budget.count = 0; }
  if (budget.count >= DAILY_LIMIT || now < budget.nextAt) {
    table.apiSkipDeadline = table.deadline;
    return null;
  }
  budget.count++;
  budget.nextAt = now + 10000;
  const job = { id: crypto.randomUUID(), room: response.room, hand: table.game.hand,
    seat: table.game.turn, deadline: table.deadline, observation: readObservation(table.game) };
  table.apiPending = { id: job.id, deadline: job.deadline };
  return job;
}

export function validDecision(value, observation) {
  if (!value || !['fold', 'call', 'raise', 'allin'].includes(value.action)) return null;
  const o = observation.options;
  if (value.action === 'raise' && (!o.canRaise || !Number.isInteger(value.amount) ||
      value.amount < o.min || value.amount > o.max)) return null;
  if (value.action === 'allin' && o.owed < observation.stack && !o.canRaise) return null;
  return value.action === 'raise' ? { action: value.action, amount: value.amount } : { action: value.action };
}

export async function askGroq(observation, key, fetcher = fetch) {
  if (!key) return null;
  try {
    const response = await fetcher('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(6000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_MODEL, max_completion_tokens: 1024, reasoning_effort: 'low',
        messages: [
          { role: 'system', content: 'Play no-limit Texas Holdem with play chips. Use only the observation. Cards use ranks 2-14 and suit numbers 0-3. Consider pot odds, position, and inferred opponent ranges. call means check when nothing is owed; raise amount is the total street bet, not additional chips. Respect options.min, max and canRaise. Return one legal move; amount must be 0 unless raising.' },
          { role: 'user', content: JSON.stringify(observation) },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'poker_move', strict: true,
          schema: { type: 'object', properties: { action: { type: 'string', enum: ['fold', 'call', 'raise', 'allin'] },
            amount: { type: 'integer' } }, required: ['action', 'amount'], additionalProperties: false } } },
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return validDecision(JSON.parse(data.choices?.[0]?.message?.content), observation);
  } catch { return null; }
}

export async function completeBotJob(database, job, decision, now = Date.now) {
  return updateStored(database, service => {
    const table = service.rooms.get(job.room)?.table;
    if (!table || table.apiPending?.id !== job.id) return false;
    delete table.apiPending;
    if (table.game.done || table.game.hand !== job.hand || table.game.turn !== job.seat ||
        table.deadline !== job.deadline || service.now() >= job.deadline - 45000 + 9000) return false;
    const move = validDecision(decision, readObservation(table.game)) ||
      chooseBotAction(botObservation(table.game, table.memory), 'medium');
    table.act(job.seat, { ...move, version: table.version }, service.now());
    return true;
  }, now);
}

export async function runBotJob(database, job, key, fetcher = fetch) {
  const decision = await askGroq(job.observation, key, fetcher);
  await completeBotJob(database, job, decision);
}

// Solo "Live AI" table: one stateless request per bot decision. The browser
// sends only what that bot may see (its own cards and public state); the model
// returns a legal move and an optional short line of table talk.
const PERSONA_PROMPTS = {
  Jules: 'Jules: tricky, likes well-timed bluffs, teases a little.',
  Morgan: 'Morgan: tight and patient, dry humour, folds a lot.',
  Alex: 'Alex: loose-aggressive, loves pressure, cocky but friendly.',
  Riley: 'Riley: solid and analytical, mentions odds sometimes.',
  Sam: 'Sam: calls too much, cheerful, hates folding.',
};
const talkLimits = { day: 0, count: 0, byClient: new Map() };
export const TALK_DAILY_LIMIT = 600;
export function claimTalk(client, now = Date.now()) {
  const day = Math.floor(now / 86400000);
  if (talkLimits.day !== day) { talkLimits.day = day; talkLimits.count = 0; talkLimits.byClient.clear(); }
  if (talkLimits.count >= TALK_DAILY_LIMIT) return false;
  const last = talkLimits.byClient.get(client) || 0;
  if (now - last < 700) return false;
  talkLimits.byClient.set(client, now);
  if (talkLimits.byClient.size > 5000) talkLimits.byClient.clear();
  talkLimits.count++;
  return true;
}
export function validTalkObservation(o) {
  const card = c => c && Number.isInteger(c.r) && c.r >= 2 && c.r <= 14 && Number.isInteger(c.s) && c.s >= 0 && c.s <= 3;
  return o && typeof o === 'object' && Array.isArray(o.cards) && o.cards.length === 2 && o.cards.every(card) &&
    Array.isArray(o.board) && o.board.length <= 5 && o.board.every(card) &&
    [o.pot, o.stack, o.bet, o.current].every(n => Number.isFinite(n) && n >= 0 && n <= 1e6) &&
    o.options && [o.options.call, o.options.owed, o.options.min, o.options.max].every(n => Number.isFinite(n) && n >= 0 && n <= 1e6);
}
export async function askGroqTalk(observation, name, key, fetcher = fetch) {
  if (!key || !validTalkObservation(observation)) return null;
  const persona = PERSONA_PROMPTS[name] || `${String(name).slice(0, 18)}: a friendly regular.`;
  try {
    const response = await fetcher('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(6500),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_MODEL, max_completion_tokens: 900, reasoning_effort: 'low',
        messages: [
          { role: 'system', content: `You are a player at a friendly six-seat no-limit Texas Holdem table with play chips. ${persona} Use only the observation. Cards use ranks 2-14 (11=J,12=Q,13=K,14=A) and suit numbers 0-3. Think about pot odds, position, your hand and the opponents' likely ranges, then stay in character. call means check when nothing is owed; raise amount is the total street bet; respect options.min, options.max and options.canRaise. "say" is optional table talk under 70 characters, playful, never reveal your exact cards, empty string most of the time.` },
          { role: 'user', content: JSON.stringify(observation) },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'poker_move', strict: true,
          schema: { type: 'object', properties: { action: { type: 'string', enum: ['fold', 'call', 'raise', 'allin'] },
            amount: { type: 'integer' }, say: { type: 'string' } }, required: ['action', 'amount', 'say'], additionalProperties: false } } },
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content);
    const move = validDecision(parsed, observation);
    if (!move) return null;
    const say = typeof parsed.say === 'string' ? parsed.say.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80) : '';
    return { ...move, say };
  } catch { return null; }
}
// A bot answers something the player typed at the solo table. No cards are sent.
export async function askGroqChat(text, name, key, fetcher = fetch) {
  const said = typeof text === 'string' ? text.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 120) : '';
  if (!key || !said) return null;
  const persona = PERSONA_PROMPTS[name] || `${String(name).slice(0, 18)}: a friendly regular.`;
  try {
    const response = await fetcher('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(6000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: GROQ_MODEL, max_completion_tokens: 300, reasoning_effort: 'low',
        messages: [
          { role: 'system', content: `You are ${persona} You sit at a friendly play-chips poker table. Reply to the other player in under 70 characters, casual and in character. Never reveal your cards. Keep it kind; no insults, no real-money talk.` },
          { role: 'user', content: said },
        ] }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const say = String(data.choices?.[0]?.message?.content || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80);
    return say ? { say } : null;
  } catch { return null; }
}
