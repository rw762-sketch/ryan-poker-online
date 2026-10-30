import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { storedRequest, updateStored, decode } from '../server/cloud-state.mjs';
import { askGroq, claimBotJob, completeBotJob } from '../server/groq-bot.mjs';

function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../drizzle/0000_modern_screwball.sql', import.meta.url), 'utf8'));
  return { close: () => sql.close(), prepare(text) {
    let args = [];
    return { bind(...values) { args = values; return this; },
      async first() { return sql.prepare(text).get(...args) || null; },
      async run() { return { meta: { changes: Number(sql.prepare(text).run(...args).changes) } }; } };
  } };
}

async function setup(t) {
  const db = database(); t.after(() => db.close());
  let time = 100000;
  const now = () => time;
  const run = (path, token, body = {}, hooks) => storedRequest(db, path, token, body, now, hooks);
  const host = await run('/session', '', { name: 'PRIVATE HUMAN NAME' });
  const created = await run('/create', host.token, { requestId: crypto.randomUUID() });
  time += 200;
  const filled = await run('/bots', host.token, { operation: 'fill', version: created.state.version, requestId: crypto.randomUUID() });
  time += 200;
  await run('/deal', host.token, { version: filled.state.version, requestId: crypto.randomUUID() });
  await updateStored(db, service => {
    const table = service.rooms.get(created.room).table;
    // Advance naturally to a bot if the initial seat is human.
    if (table.game.turn === 0) table.act(0, { action: 'call', version: table.version }, time);
  }, now);
  time += 1300;
  const poll = () => run('/poll', host.token, {}, { apiEnabled: true,
    afterHandle(service, response) { return { response, job: claimBotJob(service, response) }; } });
  return { db, now, poll, host, room: created.room, advance(ms) { time += ms; } };
}

test('API reservation is atomic across polls; payload excludes human cards and session identity', async t => {
  const s = await setup(t);
  const polls = await Promise.all([s.poll(), s.poll(), s.poll()]);
  const jobs = polls.map(p => p.job).filter(Boolean);
  assert.equal(jobs.length, 1);
  const job = jobs[0];
  const raw = JSON.stringify(job.observation);
  assert.ok(!raw.includes(s.host.token));
  assert.ok(!raw.includes('PRIVATE HUMAN NAME'));
  assert.ok(!raw.includes('deck'));
  assert.equal(job.observation.cards.length, 2);
  assert.equal(job.observation.players, undefined);
  const service = decode((await s.db.prepare('SELECT payload FROM poker_state WHERE id=1').first()).payload, s.now);
  assert.deepEqual(job.observation.cards, service.rooms.get(s.room).table.game.players[job.seat].cards);
  assert.equal(service.aiBudget.count, 1);
  assert.equal(await completeBotJob(s.db, job, { action: 'call' }, s.now), true);
  assert.equal(await completeBotJob(s.db, job, { action: 'allin' }, s.now), false);
  const next = await s.poll();
  assert.equal(next.response.state.version, polls[0].response.state.version + 1);
  assert.equal(JSON.stringify(next.response).includes('apiPending'), false);
  assert.equal(JSON.stringify(next.response).includes('aiBudget'), false);
});

test('timeouts use math, stale responses cannot play, and chips are conserved', async t => {
  const s = await setup(t);
  const { job, response } = await s.poll();
  assert.ok(job);
  s.advance(10000);
  const after = await s.poll();
  assert.equal(after.response.state.version, response.state.version + 1);
  assert.equal(await completeBotJob(s.db, job, { action: 'allin' }, s.now), false);
  const service = decode((await s.db.prepare('SELECT payload FROM poker_state WHERE id=1').first()).payload, s.now);
  const g = service.rooms.get(s.room).table.game;
  assert.equal(g.players.reduce((n, p) => n + p.stack, 0) + g.pot, 6000);
});

test('daily budget skips API and invalid decisions fall back to legal math actions', async t => {
  const s = await setup(t);
  const { job } = await s.poll();
  assert.equal(await completeBotJob(s.db, job, { action: 'raise', amount: -10 }, s.now), true);
  await updateStored(s.db, service => {
    service.aiBudget.count = 100;
    const table = service.rooms.get(s.room).table;
    if (!table.game.done && table.game.turn === 0) table.act(0, { action: 'call', version: table.version }, s.now());
  }, s.now);
  s.advance(1300);
  const result = await s.poll();
  assert.equal(result.job, null);
  const next = await s.poll();
  assert.equal(next.response.state.version, result.response.state.version + 1);
});

test('Groq adapter handles legal output, refusal, invalid moves, missing key and network failures', async () => {
  const obs = { cards: [{ r: 14, s: 0 }, { r: 13, s: 0 }], stack: 1000,
    options: { min: 40, max: 1000, owed: 20, canRaise: true } };
  const answer = content => async () => Response.json({ choices: [{ message: { content } }] });
  assert.deepEqual(await askGroq(obs, 'test-only', answer('{"action":"raise","amount":60}')), { action: 'raise', amount: 60 });
  assert.equal(await askGroq(obs, 'test-only', answer('{"action":"raise","amount":1001}')), null);
  assert.equal(await askGroq(obs, 'test-only', answer('refused')), null);
  assert.equal(await askGroq(obs, 'test-only', async () => new Response('', { status: 429 })), null);
  assert.equal(await askGroq(obs, 'test-only', async () => { throw Error('timeout'); }), null);
  assert.equal(await askGroq(obs, '', async () => { assert.fail('must not call without a key'); }), null);
  await askGroq(obs, 'test-only', async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-only');
    assert.ok(options.signal instanceof AbortSignal);
    const body = JSON.parse(options.body);
    assert.deepEqual(JSON.parse(body.messages[1].content), obs);
    assert.equal(body.response_format.json_schema.strict, true);
    return Response.json({ choices: [{ message: { content: '{"action":"call","amount":0}' } }] });
  });
});
