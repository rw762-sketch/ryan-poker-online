import { playerOutcome } from './player-outcome.js?v=2972c8b36739';
import { celebrateTable } from './celebration.js?v=2972c8b36739';
import { gtoThinkTime } from './gto.js?v=2972c8b36739';
import { DRINKS, TableGifts, validGift, cleanChat, validChat } from './table-gifts.js?v=2972c8b36739';
import { PlayerMemory } from './player-memory.js?v=2972c8b36739';
import { Poker, evaluate, labels, SEATS } from './engine.js?v=2972c8b36739';
import { tableSnapshot, animateTable } from './motion.js?v=2972c8b36739';
import { LobbyClient, ServerRoom } from './server-room.js?v=2972c8b36739';
import { MULTIPLAYER_API_URL, pickServer, probeServers, serverCandidates } from './network-config.js?v=2972c8b36739';
import { bindLobby } from './lobby.js?v=2972c8b36739';
import { OnlineRoom } from './multiplayer.js?v=2972c8b36739';
import { readObservation } from './strategy.js?v=2972c8b36739';
import { randomStyle, driftStyle } from './neural-policy.js?v=2972c8b36739';
import { replyTo, reactTo } from './table-talk.js?v=2972c8b36739';
import { PRESETS, loadSettings, saveSettings, configured, llmDecision, llmChat, testConnection } from './llm-player.js?v=2972c8b36739';
import { styleLabel } from './neural-policy.js?v=2972c8b36739';
import { DIFFICULTIES, normalizeDifficulty, botObservation, chooseBotAction, chooseBotDecision } from './ai.js?v=2972c8b36739';
let selectedDifficulty = 'medium';
// GTO was folded into Hard in the picker: in paired tests Hard's engine beat it by about 1 big blind a hand.
try { selectedDifficulty = normalizeDifficulty(localStorage.getItem('river-room-difficulty')); if (selectedDifficulty === 'gto') selectedDifficulty = 'hard'; } catch {}
let handDifficulty = selectedDifficulty;

const $ = id => document.getElementById(id);
const friendsPage = document.body.classList.contains('friends-page');
const suits = ['♠', '♥', '♣', '♦'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
let game = new Poker();
const MEMORY_KEY='river-room-player-memory-v1';
let playerMemory;
try { playerMemory=new PlayerMemory(JSON.parse(localStorage.getItem(MEMORY_KEY))); } catch { playerMemory=new PlayerMemory(); }
function savePlayerMemory() { try { localStorage.setItem(MEMORY_KEY,JSON.stringify(playerMemory.save())); } catch {} }
// Each bot seat draws its own style; it drifts a little every hand (more after a big loss).
let botStyles = Array.from({ length:SEATS }, () => randomStyle());
function soloAction(action,amount) {
  const observed=playerMemory.capture(game,action,amount);
  if(!game.act(action,amount))return false;
  playerMemory.record(observed);
  if(game.done){playerMemory.finish();savePlayerMemory();reactToHand();
    botStyles=botStyles.map((style,i)=>{ const award=(game.awards||[]).find(a=>a.seat===i); return i?driftStyle(style,award?award.profit:-game.players[i].total):style; });}
  return true;
}
let timer = null;
let room = null;
let lastFrame = null;
let pendingAction = false;
let pendingTimer = null;
let connectionMessage = '';
let soloGifts = new TableGifts();

// Every card lands a little differently, but stays put while the hand re-renders.
let tiltSalt = 1;
let tiltCount = 0;
function tilt(key) {
  let h = Math.imul(key ^ tiltSalt, 2654435761) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  return ((h % 1000) / 1000 - .5) * 5;
}
function card(c, hidden = false) {
  const t = tilt(c ? c.r * 4 + c.s + 7 : 900 + (tiltCount++ % 12));
  if (hidden) return `<div class="card back" style="--tilt:${t.toFixed(2)}deg" aria-label="Face-down card"></div>`;
  if (!c) return '<div class="card empty"></div>';
  const rank = ({ 11:'J', 12:'Q', 13:'K', 14:'A' })[c.r] || c.r;
  return `<div class="card ${c.s % 2 ? 'red' : ''}" style="--tilt:${t.toFixed(2)}deg" aria-label="${rank} ${['spades','hearts','clubs','diamonds'][c.s]}"><span>${rank}</span><span class="suit">${suits[c.s]}</span></div>`;
}
function view() {
  if (!room?.view) return game;
  const v = room.view;
  const n = v.players.length;
  const relative = seat => seat < 0 ? -1 : (seat - v.me + n) % n;
  return { ...v, awards: (v.awards || []).map(a => ({ ...a, seat: relative(a.seat) })), turn: relative(v.turn), dealer: relative(v.dealer), players: Array.from({ length:n }, (_, i) => v.players[(i + v.me) % n]) };
}
function options() { return room ? room.view?.options || {} : game.options(); }
function render() {
  const v = view();
  renderTable(v);
  const nextFrame = tableSnapshot(v);
  nextFrame.outcome = room ? v.outcome : playerOutcome(v, 0);
  animateTable(lastFrame, nextFrame);
  celebrateTable(lastFrame, nextFrame);
  lastFrame = nextFrame;
  renderRoom();
}
// Chips: break an amount into poker denominations and stack them in columns.
const DENOMS = [[500, 'c500'], [100, 'c100'], [25, 'c25'], [5, 'c5'], [1, 'c1']];
// Stacks use smaller chips so their height reads as wealth at a glance.
const STACK_DENOMS = [[100, 'c100'], [25, 'c25'], [5, 'c5']];
function chipPile(amount, maxColumns = 3, denoms = DENOMS) {
  if (!amount) return '';
  const chips = [];
  let left = amount;
  for (const [value, cls] of denoms) { while (left >= value && chips.length < 36) { chips.push(cls); left -= value; } }
  if (!chips.length) chips.push(denoms.at(-1)[1]);
  const columns = [];
  for (const cls of chips) {
    let column = columns.find(c => c.length < 12 && (denoms === STACK_DENOMS || c[0] === cls));
    if (!column) { if (columns.length >= maxColumns) column = columns[columns.length - 1]; else columns.push(column = []); }
    if (column.length < 12) column.push(cls);
  }
  return `<span class="chip-pile" aria-hidden="true">${columns.map((c, x) =>
    `<span class="chip-col" style="--x:${x};--lean:${(tilt(x * 13 + amount) / 2).toFixed(2)}deg">${c.map((cls, y) => `<i class="chip ${cls}" style="--y:${y}"></i>`).join('')}</span>`).join('')}</span>`;
}
function renderTable(v) {
  tiltSalt = (v.hand * 7919 + 13) | 0; tiltCount = 0;
  $('pot').textContent = v.pot.toLocaleString();
  let potPile = document.getElementById('potPile');
  if (!potPile) { potPile = document.createElement('div'); potPile.id = 'potPile'; potPile.className = 'pot-pile'; document.querySelector('.board-area')?.prepend(potPile); }
  // The pot shows chips already collected; this street's bets sit in front of each player.
  const bets = v.players.reduce((n, p) => n + (p.bet || 0), 0);
  potPile.innerHTML = chipPile(Math.max(0, v.pot - (v.done ? 0 : bets)), 4);
  $('handNo').textContent = `HAND ${String(v.hand).padStart(2, '0')}`;
  $('board').innerHTML = Array.from({ length:5 }, (_, i) => card(v.board[i])).join('');
  $('street').textContent = room && !v.started ? 'WAITING FOR FRIENDS' : v.done ? 'HAND COMPLETE' : ['PRE-FLOP','FLOP','TURN','RIVER'][v.stage];
  $('seats').innerHTML = v.players.map((p, i) => {
    const occupied = !room || p.occupied;
    const name = room && i === 0 ? `${p.name} (you)` : p.name;
    const action = !occupied ? 'Invite a friend' : room && !p.online ? 'Disconnected' : p.action;
    // Facial expression for the seat's character, from public table state only.
    const award = v.done ? (v.awards || []).find(a => a.seat === i) : null;
    const owed = Math.max(0, (v.players.reduce((m, q) => Math.max(m, q.bet || 0), 0)) - (p.bet || 0));
    const mood = !occupied ? 'empty'
      : room && !p.online ? 'away'
      : v.done && v.hand && award && award.profit > 0 ? 'win'
      : v.done && v.hand && !p.folded && p.total >= 100 && !award ? 'sad'
      : p.stack === 0 && !p.allIn && v.hand ? 'busted'
      : p.folded && v.hand ? 'sleep'
      : !v.done && v.turn === i ? (owed > Math.max(60, v.pot * .5) ? 'sweat' : 'think')
      : p.allIn ? 'allin'
      : /^Raise/.test(p.action || '') ? 'smug'
      : !room && botStyles[i]?.tilt > .3 ? 'angry'
      : 'idle';
    return `<div class="seat seat-${i} ${p.sittingOut ? 'seat-off' : ''} ${!v.done && v.turn === i ? 'active' : ''} ${p.folded && v.hand ? 'folded' : ''} ${!occupied ? 'empty-seat' : ''}" data-mood="${mood}">
      ${i ? `<div class="avatar" style="--hue:${[0, 330, 190, 268, 150, 28][i]}">${occupied ? `<span class="face" aria-hidden="true"><i></i><i></i><u></u><em></em></span><b>${escape(p.name[0])}</b>` : '+'}</div>` : ''}
      <div class="cards">${p.cards.map(c => card(c, room ? c === null : i !== 0 && !(v.done && v.stage === 4 && !p.folded))).join('')}</div>
      <div class="seat-identity"><div class="nameplate"><div class="player-name">${escape(name)}${v.dealer === i ? '<span class="badge" title="Dealer">D</span>' : ''}</div><div class="stack">${occupied ? p.stack.toLocaleString() : '—'}</div></div>${occupied && p.stack ? `<div class="stack-pile" aria-hidden="true">${chipPile(p.stack, 3, STACK_DENOMS)}</div>` : ''}
      ${i && occupied && (!room || p.online) ? `<button type="button" class="seat-drink" data-gift-seat="${room ? (i + room.me) % v.players.length : i}" aria-label="Buy ${escape(p.name)} a drink" title="Buy ${escape(p.name)} a drink" aria-haspopup="dialog"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16l-8 9L4 4Zm8 9v7m-4 0h8M6 7h12"/></svg></button>` : ''}</div>
      <div class="player-action">${escape(action || ' ')}</div>${!v.done && p.bet ? `<div class="bet-pile" title="${p.bet.toLocaleString()} chips bet">${chipPile(p.bet, 2)}<b>${p.bet.toLocaleString()}</b></div>` : ''}</div>`;
  }).join('');
  $('log').innerHTML = v.logs.map(line => `<li>${escape(line)}</li>`).join('');
  placeTalk(false);
  placeWhy(false);
  const player = v.players[0];
  $('handName').textContent = v.board.length >= 3 && !player.folded && player.cards.length === 2
    ? labels[evaluate([...player.cards, ...v.board])[0]] : 'Your two cards are private.';
  $('actions').innerHTML = '';
  if (room && !room.connected) {
    $('turnTitle').textContent = 'DISCONNECTED';
    $('status').textContent = 'Reconnect to continue at this table.';
    return;
  }
  if (room && !v.started) {
    const count = v.players.filter(p => p.occupied && p.online).length;
    $('turnTitle').textContent = 'YOUR PRIVATE TABLE';
    $('status').textContent = room.host ? `${count} of 4 seats filled. Invite friends, then deal.` : 'You’re in. The host will deal when everyone is ready.';
    $('handName').textContent = '2–6 players · 1,000 chips each · 45 seconds per turn';
    if (room.host) {
      button('Deal first hand', deal, 'primary').disabled = count < 2;
      const manage = (operation, seat) => { try { room.manageAI(operation, seat); } catch (error) { showRoomError(error.message); } };
      if (v.players.some(p => !p.occupied)) {
        button('Add AI', () => manage('add'));
        button('Fill empty seats with AI', () => manage('fill'));
      }
      v.players.forEach((p, i) => { if (p.bot) button(`Remove ${p.name}`, () => manage('remove', (i + room.me) % v.players.length), 'remove-ai'); });
      $('handName').textContent = 'Add or remove AI before dealing · AI adapts to betting habits in this room';
    }
    return;
  }
  if (v.done) {
    const outcome = room ? v.outcome : playerOutcome(v, 0);
    $('turnTitle').textContent = outcome?.title || 'THE RESULT';
    $('status').textContent = outcome?.detail || v.result;
    if (room) {
      const eligible = v.players.filter(p => p.occupied && p.online && p.stack > 0).length;
      if (room.host && eligible >= 2) button('Next hand', deal, 'primary');
      else $('handName').textContent = eligible < 2 ? 'Need two connected players with chips. Create a new room to reset stacks.' : 'Waiting for the host to deal the next hand.';
    } else {
      const canContinue = player.stack > 0 && v.players.filter(p => p.stack > 0).length > 1;
      button(canContinue ? 'Next hand' : 'Play again', () => { if (!canContinue) game = new Poker(); start(); }, 'primary');
    }
  } else if (v.turn === 0) {
    const o = options();
    $('turnTitle').textContent = 'YOUR MOVE';
    $('status').textContent = o.owed ? `${o.call} chips to call. What’s your play?` : 'Check or make your move.';
    button('Fold', () => act('fold'), 'fold');
    button(o.owed ? `Call ${o.call}` : 'Check', () => act('call'));
    if (o.canRaise || o.owed >= player.stack) button(`All in · ${player.stack.toLocaleString()}`, () => act('allin'), 'all-in');
    if (o.canRaise) {
      let amount = o.min;
      const raise = button(`Raise to ${amount}`, () => act('raise', amount), 'primary');
      const label = document.createElement('label');
      label.className = 'raise-control';
      label.textContent = 'Raise to ';
      const input = document.createElement('input');
      Object.assign(input, { type:'range', min:o.min, max:o.max, step:1, value:amount });
      input.setAttribute('aria-label', 'Raise total');
      const output = document.createElement('output');
      output.textContent = amount;
      input.oninput = () => {
        amount = +input.value;
        output.textContent = amount;
        raise.textContent = amount === o.max ? `All in ${amount}` : `Raise to ${amount}`;
      };
      label.append(input, output);
      $('actions').append(label);
    }
  } else {
    $('turnTitle').textContent = player.folded ? 'WATCHING THE HAND' : 'AT THE TABLE';
    $('status').textContent = `${v.players[v.turn].name} ${room ? 'is choosing a move' : 'is thinking'}…`;
  }
  if (pendingAction) $('actions').querySelectorAll('button, input').forEach(el => el.disabled = true);
}
function button(text, handler, className = '') {
  const element = document.createElement('button');
  Object.assign(element, { textContent:text, className, onclick:handler });
  $('actions').append(element);
  return element;
}
function showRoomError(message) {
  pendingAction = false;
  clearTimeout(pendingTimer);
  connectionMessage = message;
  render();
}
function act(action, amount) {
  if (room) {
    if (pendingAction) return;
    pendingAction = true;
    connectionMessage = '';
    try {
      room.action(action, amount);
      // Direct hosts update synchronously; all server players await acknowledgement.
      if (!room.host || room.server) {
        $('actions').querySelectorAll('button, input').forEach(el => el.disabled = true);
        pendingTimer = setTimeout(() => showRoomError('No response yet. Check the connection before trying again.'), 8000);
      }
    } catch (error) { showRoomError(error.message); }
  } else { if (game.turn === 0) noteUserAction(action, amount); if (soloAction(action, amount)) { render(); schedule(); } }
}
function deal() {
  if (!room) { start(); return; }
  try { connectionMessage = ''; room.deal(); } catch (error) { showRoomError(error.message); }
}
function thinkTime() {
  if (handDifficulty === 'gto') return gtoThinkTime({seat:game.turn,options:game.options(),pot:game.pot});
  // Bigger pots and facing bets take a little longer, like a person would.
  const facing = game.options().owed > 0 ? 350 : 0;
  // Mostly quick, sometimes a long tank, the way people actually play.
  const tank = Math.random() < .07 ? 1400 + Math.random() * 2200 : 0;
  return 550 + Math.random() * 900 + facing + Math.min(700, game.pot / 3) + tank;
}
// What the bots have noticed about you this session (public actions only).
const userStats = { hands: 0, entered: 0, raises: 0, calls: 0, folds: 0, shoves: 0, seenHand: 0 };
function noteUserAction(action, amount) {
  if (game.hand !== userStats.seenHand) { userStats.seenHand = game.hand; userStats.hands++; userStats.enteredThisHand = false; }
  if (action === 'fold') userStats.folds++;
  else if (action === 'call') userStats.calls++;
  else { userStats.raises++; if (action === 'allin' || amount === game.options().max) userStats.shoves++; }
  if (!game.board.length && action !== 'fold' && !userStats.enteredThisHand && (game.options().owed > 0 || action !== 'call')) { userStats.entered++; userStats.enteredThisHand = true; }
}
function userMemory() {
  const s = userStats; if (s.hands < 2) return 'nothing yet';
  const acts = Math.max(1, s.raises + s.calls + s.folds);
  return `Over ${s.hands} hands the human played ${Math.round(100 * s.entered / s.hands)}% of hands pre-flop, raised ${Math.round(100 * s.raises / acts)}% of the time, folded ${Math.round(100 * s.folds / acts)}%, and went all in ${s.shoves} times.`;
}
// Last reasoning per seat, shown when you tap a bot's face.
const thoughts = {};
async function liveMove(seat, hand) {
  if (configured(loadSettings())) {
    try {
      const obs = readObservation(game);
      const recent = game.logs.slice(0, 8).filter(line => !/^Hand \d/.test(line));
      const move = await llmDecision(obs, { name: game.players[seat].name, persona: `Your style: ${styleLabel(botStyles[seat] || {})}.`, recent, memory: userMemory() });
      if (game.hand !== hand || game.turn !== seat || game.done) return 'stale';
      if (move) { thoughts[seat] = { by: loadSettings().model, text: move.why || 'No reason given.' }; if (liveOffline) { liveOffline = false; renderDifficulty(); } return move; }
    } catch { liveOffline = true; renderDifficulty(); return null; }
    return null;
  }
  const o = readObservation(game);
  const observation = { cards:o.cards, board:o.board, pot:o.pot, stack:o.stack, bet:o.bet, current:o.current,
    opponents:o.opponents, position:o.position, opponentRanges:o.opponentRanges, options:o.options };
  try {
    const response = await fetch(`${MULTIPLAYER_API_URL}/table-talk`, { method:'POST', headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ name:game.players[seat].name, observation }), signal:AbortSignal.timeout(7500) });
    if (!response.ok) { liveOffline = true; renderDifficulty(); return null; }
    const move = await response.json();
    if (liveOffline) { liveOffline = false; renderDifficulty(); }
    if (game.hand !== hand || game.turn !== seat || game.done) return 'stale';
    const options = game.options();
    if (!['fold','call','raise','allin'].includes(move.action)) return null;
    if (move.action === 'raise' && !(Number.isInteger(move.amount) && options.canRaise && move.amount >= options.min && move.amount <= options.max)) return null;
    return move;
  } catch { liveOffline = true; renderDifficulty(); return null; }
}
let liveOffline = false;
// Table talk survives the table re-rendering while the next bot acts.
let talk = null;
function placeTalk(fresh) {
  if (!talk || Date.now() > talk.until) { talk = null; return; }
  const target = document.querySelector(`.seat-${talk.seat}`);
  if (!target || target.querySelector('.talk-bubble')) return;
  const bubble = document.createElement('div');
  bubble.className = fresh ? 'talk-bubble' : 'talk-bubble settled';
  bubble.textContent = talk.text; bubble.setAttribute('role', 'status');
  bubble.style.setProperty('--left', `${Math.max(0, talk.until - Date.now() - 300)}ms`);
  target.append(bubble);
  target.classList.add('talking');
  setTimeout(() => target.classList.remove('talking'), 1600);
}
// Typed chat. In rooms it goes to everyone; at the solo table the bots may answer.
function botReply(text) {
  const live = game.players.flatMap((p, i) => i && !p.sittingOut && p.stack + p.total > 0 ? [i] : []);
  if (!live.length) return;
  // Someone named in the message answers; otherwise a random player might.
  const named = live.find(i => new RegExp(`\\b${game.players[i].name}\\b`, 'i').test(text));
  const order = named ? [named] : live.sort(() => Math.random() - .5).slice(0, 2);
  let delay = 700 + Math.random() * 1200;
  for (const seat of order) {
    const line = replyTo(text, { style: botStyles[seat], you: game.players[0].name === 'You' ? 'you' : game.players[0].name,
      pot: game.pot, hand: game.hand, userStack: game.players[0].stack }, Math.random);
    if (!line) continue;
    setTimeout(() => showTalk(seat, line), delay);
    delay += 1400 + Math.random() * 1600;
    if (Math.random() < .6) break;
  }
}
// After a hand, a bot sometimes reacts to a big swing.
function reactToHand() {
  if (room || !game.done) return;
  const awards = game.awards || [];
  const big = awards.filter(a => a.profit >= 300).sort((a, b) => b.profit - a.profit)[0];
  const loser = game.players.map((p, i) => [i, p.total]).filter(([i, t]) => i && t >= 300 && !awards.some(a => a.seat === i)).sort((a, b) => b[1] - a[1])[0];
  let seat = null, kind = null;
  if (big && big.seat !== 0) { seat = big.seat; kind = 'won-big'; }
  else if (loser) { seat = loser[0]; kind = big?.seat === 0 && Math.random() < .5 ? 'user-won-big' : 'lost-big'; }
  if (seat === null) return;
  const line = reactTo(kind, { style: botStyles[seat], you: 'you', pot: game.pot, hand: game.hand }, Math.random);
  if (line) setTimeout(() => showTalk(seat, line), 1200 + Math.random() * 900);
}
async function liveChatReply(text) {
  const live = game.players.flatMap((p, i) => i && !p.folded && p.stack > 0 ? [i] : []);
  if (!live.length) return false;
  const seat = live[Math.floor(Math.random() * live.length)];
  try {
    const response = await fetch(`${MULTIPLAYER_API_URL}/table-talk`, { method:'POST', headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ name:game.players[seat].name, chat:text.slice(0, 120), observation:null }), signal:AbortSignal.timeout(7000) });
    if (!response.ok) return false;
    const data = await response.json();
    if (data.say) showTalk(seat, data.say);
    return true;
  } catch { return false; }
}
function receiveChat(chat) {
  if (!validChat(chat)) return;
  const me = room?.me ?? 0, players = room?.view?.players ?? game.players;
  const seat = (chat.from - me + SEATS) % SEATS;
  showTalk(seat, chat.text);
  const log = $('log'), line = document.createElement('li');
  line.textContent = `${players[chat.from]?.name || 'Someone'}: “${chat.text}”`;
  log?.prepend(line);
}
$('chatForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const text = cleanChat($('chatInput').value);
  if (!text) return;
  $('chatInput').value = '';
  if (room) { try { room.chat(text); } catch (error) { showRoomError(error.message); } return; }
  receiveChat({ kind:'chat', from:0, text });
  if (handDifficulty === 'live' && configured(loadSettings())) {
    const live = game.players.flatMap((p, i) => i && !p.sittingOut && p.stack + p.total > 0 ? [i] : []);
    const named = live.find(i => new RegExp(`\\b${game.players[i].name}\\b`, 'i').test(text));
    const seat = named ?? live[Math.floor(Math.random() * live.length)];
    if (seat !== undefined) { try { const reply = await llmChat(text, { name: game.players[seat].name, persona: `Your style: ${styleLabel(botStyles[seat] || {})}.` }); if (reply) { showTalk(seat, reply); return; } } catch {} }
  }
  if (handDifficulty === 'live' && !liveOffline && await liveChatReply(text)) return;
  botReply(text);
});
function explainDecision(decision, obs) {
  const a = decision.analysis || {};
  const pct = x => `${Math.round(x * 100)}%`;
  if (a.model === 'neural') {
    const values = Object.entries(a.values || {}).map(([k, v]) => `${({ fold:'fold', call: obs.options.owed ? 'call' : 'check', half:'½-pot raise', pot:'pot raise', allin:'all in' })[k]} ${v > 0 ? '+' : ''}${v} BB`).join(' · ');
    return { by: `Neural · ${a.persona}`, text: `I gave my hand about ${pct(a.equity)} to win. My guesses per move: ${values}.${a.slipped ? ' Went with my gut this time.' : ''}` };
  }
  if (a.equity !== undefined && a.equity !== null) return { by: 'Hand-built bot', text: `${a.reason || 'Weighed the price against my chances.'} Estimated chance to win: ${pct(a.equity)}.` };
  return { by: 'Bot', text: a.reason || 'Played it by feel.' };
}
let whyOpen = null;
function showWhy(seat) { whyOpen = { seat, until: Date.now() + 7000 }; placeWhy(true); }
function placeWhy(fresh) {
  document.querySelectorAll('.why-pop').forEach(p => p.remove());
  if (!whyOpen || Date.now() > whyOpen.until) { whyOpen = null; return; }
  const seat = whyOpen.seat;
  const target = document.querySelector(`.seat-${seat}`);
  if (!target) return;
  const t = thoughts[seat];
  const pop = document.createElement('div');
  pop.className = 'why-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', `${game.players[seat]?.name} explains`);
  const by = document.createElement('small'); by.textContent = t ? t.by : 'No move yet';
  const text = document.createElement('p'); text.textContent = t ? `“${t.text}”` : 'Ask me again after I act.';
  pop.append(by, text);
  if (!fresh) pop.classList.add('settled');
  target.append(pop);
  if (fresh) setTimeout(() => document.addEventListener('click', () => { whyOpen = null; document.querySelectorAll('.why-pop').forEach(p => p.remove()); }, { once: true }), 0);
}
document.getElementById('seats')?.addEventListener('click', event => {
  const avatar = event.target.closest('.avatar');
  if (!avatar || room) return;
  const seat = Number(avatar.closest('.seat')?.className.match(/seat-(\d)/)?.[1]);
  if (Number.isInteger(seat)) { event.stopPropagation(); showWhy(seat); }
});
// ---- Your own AI settings ----
if (document.getElementById('aiSettings')) {
  const settings = loadSettings();
  const fill = s => { $('aiPreset').value = s.preset || 'custom'; $('aiBaseUrl').value = s.baseUrl || ''; $('aiModel').value = s.model || ''; $('aiKey').value = s.apiKey || ''; $('aiEnabled').checked = !!s.enabled; $('aiLocalTip').hidden = !['ollama','lmstudio'].includes($('aiPreset').value); };
  $('aiPreset').innerHTML = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('');
  fill(settings);
  $('aiPreset').onchange = () => { const p = PRESETS[$('aiPreset').value]; if (p.baseUrl) $('aiBaseUrl').value = p.baseUrl; if (p.model) $('aiModel').value = p.model; $('aiLocalTip').hidden = !['ollama','lmstudio'].includes($('aiPreset').value); };
  const read = () => ({ preset: $('aiPreset').value, baseUrl: $('aiBaseUrl').value.trim(), model: $('aiModel').value.trim(), apiKey: $('aiKey').value.trim(), enabled: $('aiEnabled').checked });
  $('aiSettingsButton').onclick = () => { fill(loadSettings()); $('aiStatus').textContent = ''; $('aiSettings').showModal(); };
  $('closeAiSettings').onclick = () => $('aiSettings').close();
  $('aiTest').onclick = async () => {
    $('aiStatus').textContent = 'Asking the model…';
    try { $('aiStatus').textContent = `Connected. The model said: “${await testConnection(read())}”`; }
    catch (error) { $('aiStatus').textContent = /Failed to fetch|NetworkError|Load failed/.test(error.message) ? 'Could not reach that address. For Ollama or LM Studio, make sure it is running and allows this site (see the tip above).' : error.message; }
  };
  $('aiSettingsForm').onsubmit = event => {
    event.preventDefault();
    const next = read(); saveSettings(next);
    $('aiStatus').textContent = next.enabled ? 'Saved. Pick the Live AI chip to play against it.' : 'Saved. Turned off for now.';
    liveOffline = false; renderDifficulty();
  };
}
function showTalk(seat, text) {
  if (!text) return;
  talk = { seat, text, until: Date.now() + 3800 };
  placeTalk(true);
  setTimeout(() => { if (talk && Date.now() >= talk.until) { talk = null; document.querySelectorAll('.talk-bubble').forEach(b => b.remove()); } }, 3900);
}
function schedule() {
  clearTimeout(timer);
  if (friendsPage || room || game.done || game.turn === 0) return;
  const seat = game.turn, hand = game.hand;
  timer = setTimeout(async () => {
    if (room) return;
    if (handDifficulty === 'live') {
      const move = await liveMove(seat, hand);
      if (move === 'stale' || room || game.done || game.hand !== hand || game.turn !== seat) return;
      if (move) { act(move.action === 'allin' ? 'allin' : move.action, move.amount); showTalk(seat, move.say); return; }
    }
    const obs = botObservation(game, playerMemory);
    obs.style = botStyles[game.turn];
    const decision = chooseBotDecision(obs, handDifficulty);
    thoughts[game.turn] = explainDecision(decision, obs);
    act(decision.action, decision.amount);
  }, handDifficulty === 'live' ? 250 : thinkTime());
}
// Table size: which seats are in play for 2–6 players, spaced evenly around the felt.
const SEAT_LAYOUTS = { 2:[0,3], 3:[0,2,4], 4:[0,1,3,5], 5:[0,1,2,4,5], 6:[0,1,2,3,4,5] };
let tableSize = 6;
try { tableSize = Math.min(6, Math.max(2, Number(localStorage.getItem('river-room-seats')) || 6)); } catch {}
function applyTableSize() {
  const seats = SEAT_LAYOUTS[tableSize] || SEAT_LAYOUTS[6];
  game.players.forEach((p, i) => {
    if (!i) return;
    if (!seats.includes(i)) { if (!p.sittingOut) { p.parkedStack = p.stack; p.sittingOut = true; } p.stack = 0; }
    else if (p.sittingOut) { p.stack = p.parkedStack || 1000; p.sittingOut = false; }
  });
}
document.querySelectorAll('input[name="tableSize"]').forEach(input => {
  input.checked = Number(input.value) === tableSize;
  input.addEventListener('change', () => {
    tableSize = Number(input.value);
    try { localStorage.setItem('river-room-seats', String(tableSize)); } catch {}
    if (!room && game.done) { applyTableSize(); render(); }
    renderDifficulty();
  });
});
function start() { clearTimeout(timer); lastFrame = null; handDifficulty = selectedDifficulty; if (!room) applyTableSize(); game.start(); playerMemory.begin(game); if(game.done){playerMemory.finish();savePlayerMemory();} render(); schedule(); }
function renderDifficulty() {
  $('difficultyPanel').hidden = !!room;
  $('aiMemoryPanel').hidden = !!room || handDifficulty === 'gto';
  document.querySelectorAll('input[name="difficulty"]').forEach(input => { input.checked = input.value === selectedDifficulty; });
  $('difficultyStatus').textContent = selectedDifficulty !== handDifficulty
    ? `${DIFFICULTIES[handDifficulty].name} this hand · ${DIFFICULTIES[selectedDifficulty].name} starts next hand`
    : `${DIFFICULTIES[selectedDifficulty].name} opponents · ${DIFFICULTIES[selectedDifficulty].description}${(SEAT_LAYOUTS[tableSize] || []).length !== game.players.filter((p, i) => !p.sittingOut).length ? ` · ${tableSize} seats from the next hand` : ''}`
      + (selectedDifficulty === 'live' && liveOffline ? ' The Live AI server isn’t answering, so the Neural bots are playing for now.' : '');
}
document.querySelectorAll('input[name="difficulty"]').forEach(input => input.addEventListener('change', () => {
  if (room || !input.checked) return;
  selectedDifficulty = normalizeDifficulty(input.value);
  try { localStorage.setItem('river-room-difficulty', selectedDifficulty); } catch {}
  renderDifficulty();
}));
function renderRoom() {
  renderDifficulty();
  $('roomBar').hidden = !room?.view;
  $('restart').textContent = room ? 'Leave room' : 'New table';
  $('multiplayer').hidden = friendsPage && !room?.view;
  $('multiplayer').textContent = room ? 'Online lobby' : 'Play with friends';
  $('roomCode').textContent = room?.code || '';
  $('roomMessage').textContent = connectionMessage || (room?.server ? 'Connected through the game server.' : room?.host ? 'You’re the host. Keep this tab open.' : 'Connected to your friends.');
  $('reconnect').hidden = !room || (room.host && !room.server) || room.connected;
  $('turnClock').hidden = !room?.view?.deadline || room.view.done;
  updateClock();
}
function updateClock() {
  if (!room?.view?.deadline || room.view.done) return;
  $('turnClock').textContent = `${Math.max(0, Math.ceil((room.view.deadline - Date.now()) / 1000))}s to act`;
}
setInterval(updateClock, 1000);

$('resetAiMemory').onclick = () => {
  playerMemory=new PlayerMemory();
  savePlayerMemory();renderDifficulty();
};
function receiveGift(gift) {
  if (!validGift(gift)) return;
  const me = room?.me ?? 0;
  const players = room?.view?.players ?? game.players;
  if (!players[gift.from] || !players[gift.to]) return;
  const drink = DRINKS[gift.drink];
  $('giftNotice').textContent = `${players[gift.from].name} sent ${players[gift.to].name} ${drink.label.toLowerCase()}. Cheers!`;
  const target = document.querySelector(`.seat-${(gift.to - me + SEATS) % SEATS}`);
  const source = document.querySelector(`.seat-${(gift.from - me + SEATS) % SEATS}`);
  if (!target || !source) return;
  const a = source.getBoundingClientRect(), b = target.getBoundingClientRect();
  const token = document.createElement('span');
  token.className = 'flying-drink'; token.textContent = drink.icon;
  token.setAttribute('aria-hidden', 'true');
  Object.assign(token.style, { left:`${b.left+b.width/2}px`, top:`${b.top}px` });
  document.body.append(token);
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches && token.animate) {
    // Slide the glass along a curved arc across the felt, with a little spin,
    // then set it down with a clink of sparkles and a glow on the recipient.
    const dx = a.left + a.width / 2 - b.left - b.width / 2, dy = a.top - b.top;
    const lift = -Math.max(90, Math.abs(dx) * .35) - Math.random() * 40;
    const spin = (Math.random() < .5 ? -1 : 1) * (200 + Math.random() * 160);
    const frames = Array.from({ length: 13 }, (_, i) => {
      const t = i / 12, u = 1 - t;
      const x = u * u * dx + 2 * u * t * (dx * .5) + 0;
      const y = u * u * dy + 2 * u * t * (dy * .5 + lift);
      const scale = .45 + .75 * Math.sin(Math.PI * Math.min(1, t * 1.1)) * (t < .9 ? 1 : .8) + (t > .9 ? .55 : 0);
      return { transform:`translate(${x}px, ${y}px) rotate(${spin * u}deg) scale(${Math.max(.45, Math.min(1.2, scale))})`, opacity: t === 0 ? 0 : 1 };
    });
    frames.push({ transform:'translate(0, 4px) rotate(0deg) scale(1.08)', opacity:1 }, { transform:'translate(0, 0) rotate(-4deg) scale(1)', opacity:1 });
    const flight = token.animate(frames, { duration:1150, easing:'cubic-bezier(.25,.7,.3,1)' });
    flight.onfinish = () => {
      for (let i = 0; i < 9; i++) {
        const spark = document.createElement('i');
        spark.className = 'drink-spark';
        const angle = (i / 9) * Math.PI * 2 + Math.random() * .4;
        spark.style.left = token.style.left; spark.style.top = token.style.top;
        document.body.append(spark);
        spark.animate([{ transform:'translate(-50%,-50%) scale(1)', opacity:1 },
          { transform:`translate(calc(-50% + ${Math.cos(angle) * (34 + Math.random() * 22)}px), calc(-50% + ${Math.sin(angle) * (28 + Math.random() * 18) + 10}px)) scale(.2)`, opacity:0 }],
          { duration:650 + Math.random() * 200, easing:'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => spark.remove();
      }
      target.querySelector('.nameplate')?.animate([{ boxShadow:'0 0 0 0 #f2c46b00' }, { boxShadow:'0 0 0 6px #f2c46b55, 0 0 34px #f2c46b66' }, { boxShadow:'0 0 0 0 #f2c46b00' }], { duration:1100, easing:'ease-out' });
      token.animate([{ transform:'translate(0,0) rotate(-4deg)' }, { transform:'translate(0,-5px) rotate(3deg)' }, { transform:'translate(0,0) rotate(-2deg)' }], { duration:900, iterations:2, easing:'ease-in-out' });
    };
    setTimeout(() => token.animate([{ opacity:1, transform:'translateY(0) scale(1)' }, { opacity:0, transform:'translateY(-26px) scale(.8)' }], { duration:450, easing:'ease-in', fill:'forwards' }), 2900);
  }
  setTimeout(() => token.remove(), 3400);
}
let drinkRecipient = null;
let drinkRoom = null;
let selectedDrink = 'martini';
function updateDrinkButton() {
  const selected = $('drinksForm').querySelector('input[name="drink"]:checked');
  if (selected) selectedDrink = selected.value;
  $('sendDrink').textContent = `Send ${DRINKS[selectedDrink].label}`;
}
function openDrinks(to) {
  const players = room?.view?.players ?? game.players;
  const player = players[to];
  if (!Number.isInteger(to) || !player || to === (room?.me ?? 0) || (room && (!player.occupied || !player.online))) return;
  drinkRecipient = to; drinkRoom = room;
  $('drinkRecipientName').textContent = player.name;
  $('drinkRecipientAvatar').textContent = player.name[0];
  $('drinkMenu').innerHTML = ['Cocktails','Zero-proof'].map(group => `<fieldset class="drink-collection"><legend>${group}</legend><div class="drink-grid">${Object.entries(DRINKS).filter(([,d]) => d.group === group).map(([id,d]) => `<label class="drink-card"><input type="radio" name="drink" value="${id}" ${id === selectedDrink ? 'checked' : ''}><span class="drink-art" aria-hidden="true">${d.icon}</span><span class="drink-name">${d.label}</span><span class="drink-note">${d.note}</span><span class="drink-check" aria-hidden="true">✓</span></label>`).join('')}</div></fieldset>`).join('');
  $('drinkError').textContent = '';
  updateDrinkButton();
  $('drinksDialog').showModal();
}
$('seats').addEventListener('click', event => {
  const button = event.target.closest('[data-gift-seat]');
  if (button) openDrinks(Number(button.dataset.giftSeat));
});
$('drinksForm').addEventListener('change', updateDrinkButton);
$('closeDrinks').onclick = () => $('drinksDialog').close();
$('drinksDialog').addEventListener('close', () => {
  document.querySelector(`[data-gift-seat="${drinkRecipient}"]`)?.focus({preventScroll:true});
});
$('drinksForm').onsubmit = event => {
  event.preventDefault();
  try {
    if (room !== drinkRoom) throw Error('The table changed. Choose a player again.');
    if (room) room.buyDrink(drinkRecipient, selectedDrink);
    else receiveGift(soloGifts.create(0, drinkRecipient, selectedDrink, game.players.map(() => ({online:true}))));
    $('drinksDialog').close();
  } catch (error) { $('drinkError').textContent = error.message; }
};
$('help').onclick = () => $('rules').showModal();
$('closeHelp').onclick = () => $('rules').close();
let lobby;
function openLobby() {
  clearTimeout(timer);
  $('friendsLobby').hidden = false;
  $('gameSurface').hidden = true;
  $('closeMultiplayer').hidden = !room?.view;
  lobby.open();
  $('friendsTitle').focus({ preventScroll: true });
}
function closeLobby() {
  $('friendsLobby').hidden = true;
  $('gameSurface').hidden = false;
  lobby.close();
  $('gameSurface').setAttribute('tabindex', '-1');
  $('gameSurface').focus({ preventScroll: true });
}
$('multiplayer').onclick = () => {
  if (friendsPage) openLobby();
  else location.href = 'friends.html';
};
if (friendsPage) {
  const lobbyClient = new LobbyClient();
  // Use whichever server answers fastest from this network (matters for friends overseas).
  if (friendsPage) pickServer().then(url => { if (url && !room) lobbyClient.base = url.replace(/\/$/, ''); }).catch(() => {});
  $('checkConnection')?.addEventListener('click', async () => {
    const list = $('connectionResults');
    list.replaceChildren(Object.assign(document.createElement('li'), { textContent: 'Checking…' }));
    const results = await probeServers(serverCandidates());
    list.replaceChildren(...results.map(r => {
      const li = document.createElement('li');
      const host = r.url.startsWith('http') ? new URL(r.url).host : location.host;
      li.textContent = r.ok ? `${host}: reachable · ${r.ms} ms${r.ms > 800 ? ' (slow, but playable)' : ''}` : `${host}: not reachable from this network`;
      li.className = r.ok ? 'ok' : 'bad';
      return li;
    }));
    const best = results.filter(r => r.ok).sort((a, b) => a.ms - b.ms)[0];
    if (best && !room) { lobbyClient.base = best.url.replace(/\/$/, ''); try { localStorage.setItem('poker-server', best.url); } catch {} }
    if (!best) list.append(Object.assign(document.createElement('li'), { className: 'bad', textContent: 'No game server answered. Try Direct connection, or ask the host for a link to a server near you.' }));
  });
  lobby = bindLobby(lobbyClient, () => room);
  // One tap for a fun name, so nobody stalls on the name box.
  const NAME_A = ['Lucky', 'Sneaky', 'Neon', 'Sleepy', 'Turbo', 'Cosmic', 'Tiny', 'Brave', 'Fuzzy', 'Glitchy', 'Mellow', 'Spicy'];
  const NAME_B = ['Panda', 'Otter', 'Fox', 'Mochi', 'Pixel', 'Bean', 'Comet', 'Noodle', 'Gecko', 'Waffle', 'Byte', 'Koala'];
  $('rollName')?.addEventListener('click', () => {
    $('nickname').value = `${NAME_A[Math.floor(Math.random() * NAME_A.length)]} ${NAME_B[Math.floor(Math.random() * NAME_B.length)]}`;
    $('nickname').dispatchEvent(new Event('input'));
    $('nickname').focus();
  });
  // Arriving from an invite: say whose table it is and make joining one step.
  {
    const invite = new URLSearchParams(location.hash.slice(1)).get('room');
    if (invite && $('inviteBanner')) {
      $('inviteBanner').hidden = false;
      $('inviteBanner').textContent = `You’re invited to table ${invite.slice(0, 8).toUpperCase()}. Pick a name and hit Join.`;
      $('joinRoom').classList.add('primary');
      $('setupTitle').textContent = 'Pick a name';
    }
  }
  document.querySelector('.app-nav a[aria-current="page"]').addEventListener('click', event => { event.preventDefault(); openLobby(); });
  $('closeMultiplayer').onclick = () => { if (room?.view) closeLobby(); };
  $('multiplayerForm').onsubmit = async event => {
    event.preventDefault();
    if (room) return;
    const name = $('nickname').value.trim();
    if (!name) { $('nickname').focus(); return; }
    const create = event.submitter?.id === 'createRoom';
    const code = $('joinCode').value.trim();
    if (!create && !code) { $('lobbyError').textContent = 'Enter the room code your friend shared.'; $('joinCode').focus(); return; }
    $('lobbyError').textContent = create ? 'Opening your table…' : 'Connecting to your friend…';
    $('createRoom').disabled = $('joinRoom').disabled = true;
    clearTimeout(timer);
    const RoomClass = $('connectionMode').value === 'direct' ? OnlineRoom : ServerRoom;
    const session = new RoomClass({
      client: lobbyClient,
      onGift: gift => { if (room === session) receiveGift(gift); },
      onChat: chat => { if (room === session) receiveChat(chat); },
      onState: () => {
        if (room !== session) return;
        pendingAction = false;
        clearTimeout(pendingTimer);
        render();
      },
      onStatus: message => { if (room === session) { if (!session.view) { $('lobbyError').textContent = message; return; } connectionMessage = message; render(); } },
      onError: message => { if (room === session) { if (!session.view) $('lobbyError').textContent = message; else showRoomError(message); } },
    });
    room = session;
    lastFrame = null;
    connectionMessage = '';
    try {
      if (create) await session.create(name);
      else await session.join(name, code);
      if (room !== session) return;
      closeLobby();
      $('lobbyError').textContent = '';
      renderRoom();
    } catch (error) {
      if (room !== session) return;
      session.close();
      room = null;
      lastFrame = null;
      $('lobbyError').textContent = error.message;
      render();
      schedule();
    } finally { $('createRoom').disabled = $('joinRoom').disabled = false; }
  };
  $('copyInvite').onclick = async () => {
    if (!room) return;
    const url = new URL(location.href);
    url.hash = `room=${room.code}&mode=${room.server ? 'server' : 'direct'}`;
    // Carry the host's server so a friend abroad lands on the same one.
    if (room.server && lobbyClient.base.startsWith('https://')) url.searchParams.set('server', lobbyClient.base);
    try { await navigator.clipboard.writeText(url.href); connectionMessage = 'Invite link copied. Send it to your friends.'; }
    catch { connectionMessage = `Share room code ${room.code} with your friends.`; }
    renderRoom();
  };
  $('reconnect').onclick = async () => {
    if (!room) return;
    $('reconnect').disabled = true;
    connectionMessage = 'Reconnecting…';
    renderRoom();
    try { await room.reconnect(); connectionMessage = ''; render(); }
    catch (error) { showRoomError(error.message); }
    finally { $('reconnect').disabled = false; }
  };
}
$('restart').onclick = () => {
  if (!confirm(room ? (room.host ? 'Close this room for everyone?' : 'Leave this room?') : 'Start a new table with 1,000 chips each?')) return;
  room?.close();
  room = null;
  botStyles = Array.from({ length:SEATS }, () => randomStyle());
  clearTimeout(pendingTimer);
  pendingAction = false;
  connectionMessage = '';
  game = new Poker();
  history.replaceState(null, '', location.pathname + location.search);
  if (friendsPage) { renderRoom(); openLobby(); } else start();
};
window.addEventListener('beforeunload', event => {
  if (room?.view) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('pagehide', () => room?.close({ leave: false }));
if (friendsPage) {
  let invited = new URLSearchParams(location.hash.slice(1)).get('room');
  try { if (MULTIPLAYER_API_URL) invited ||= sessionStorage.getItem('poker-active-server-room'); } catch {}
  if (invited) {
    $('joinCode').value = invited.slice(0, 8).toUpperCase();
    const inviteParams = new URLSearchParams(location.hash.slice(1));
    $('connectionMode').value = inviteParams.has('room') && inviteParams.get('mode') !== 'server' ? 'direct' : 'server';
  }
  openLobby();
} else {
  start();
}

const context = document.modelContext;
if (context?.registerTool) {
  const lifecycle = new AbortController();
  window.addEventListener('pagehide', () => lifecycle.abort(), { once:true });
  const state = () => {
    if (friendsPage && !room?.view) return { lobby: true, online: false };
    const v = view();
    return { hand:v.hand, done:v.done, online:!!room, turn:v.done ? null : v.players[v.turn].name,
      board:v.board, holeCards:v.players[0].cards, pot:v.pot,
      players:v.players.map(p => ({ name:p.name, stack:p.stack, folded:p.folded, bet:p.bet })),
      options:v.turn === 0 && !v.done ? options() : null, result:v.done ? v.result : null };
  };
  for (const tool of [
    { name:'read_poker_table', description:'Read public table state and your own private cards.', inputSchema:{ type:'object', properties:{}, additionalProperties:false }, annotations:{ readOnlyHint:true }, execute:state },
    { name:'play_poker_action', description:'Fold, call/check, raise, or go all in on your turn using play chips.', inputSchema:{ type:'object', properties:{ action:{ type:'string', enum:['fold','call','raise','allin'] }, amount:{ type:'integer' } }, required:['action'], additionalProperties:false }, annotations:{ readOnlyHint:false }, execute:input => {
      const v = view();
      if (!input || v.done || v.turn !== 0 || pendingAction) throw Error('It is not your turn.');
      if (room) { room.action(input.action, input.amount); return { submitted:true }; }
      if (!soloAction(input.action, input.amount)) throw Error('Invalid poker action.');
      render(); schedule(); return state();
    } },
    { name:'deal_next_hand', description:'Deal the next hand after the current hand ends; room host only in multiplayer.', inputSchema:{ type:'object', properties:{}, additionalProperties:false }, annotations:{ readOnlyHint:false }, execute:() => {
      if (room) { room.deal(); return state(); }
      if (friendsPage) throw Error('Join a table first.');
      if (!game.done || !game.players[0].stack || game.players.filter(p => p.stack > 0).length < 2) throw Error('A next hand is not available.');
      start(); return state();
    } },
  ]) {
    try { Promise.resolve(context.registerTool(tool, { signal:lifecycle.signal })).catch(() => {}); } catch {}
  }
}

// The lamp over the table eases toward the pointer (no motion for reduced-motion users).
{
  const arena = document.querySelector('.arena'), felt = arena?.querySelector('.felt');
  if (felt && !matchMedia('(prefers-reduced-motion: reduce)').matches && matchMedia('(hover: hover)').matches) {
    let target = [50, 38], current = [50, 38], frame = 0;
    const step = () => {
      current = current.map((c, i) => c + (target[i] - c) * .08);
      felt.style.setProperty('--lamp-x', `${current[0].toFixed(2)}%`);
      felt.style.setProperty('--lamp-y', `${current[1].toFixed(2)}%`);
      frame = Math.abs(current[0] - target[0]) + Math.abs(current[1] - target[1]) > .05 ? requestAnimationFrame(step) : 0;
    };
    arena.addEventListener('pointermove', event => {
      const r = felt.getBoundingClientRect();
      target = [Math.max(10, Math.min(90, (event.clientX - r.left) / r.width * 100)), Math.max(10, Math.min(90, (event.clientY - r.top) / r.height * 100))];
      if (!frame) frame = requestAnimationFrame(step);
    });
    arena.addEventListener('pointerleave', () => { target = [50, 38]; if (!frame) frame = requestAnimationFrame(step); });
  }
}
