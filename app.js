import { playerOutcome } from './player-outcome.js?v=7710ac3987fa';
import { celebrateTable } from './celebration.js?v=7710ac3987fa';
import { gtoThinkTime } from './gto.js?v=7710ac3987fa';
import { DRINKS, TableGifts, validGift } from './table-gifts.js?v=7710ac3987fa';
import { PlayerMemory } from './player-memory.js?v=7710ac3987fa';
import { Poker, evaluate, labels, SEATS } from './engine.js?v=7710ac3987fa';
import { tableSnapshot, animateTable } from './motion.js?v=7710ac3987fa';
import { LobbyClient, ServerRoom } from './server-room.js?v=7710ac3987fa';
import { MULTIPLAYER_API_URL } from './network-config.js?v=7710ac3987fa';
import { bindLobby } from './lobby.js?v=7710ac3987fa';
import { OnlineRoom } from './multiplayer.js?v=7710ac3987fa';
import { DIFFICULTIES, normalizeDifficulty, botObservation, chooseBotAction } from './ai.js?v=7710ac3987fa';
let selectedDifficulty = 'medium';
try { selectedDifficulty = normalizeDifficulty(localStorage.getItem('river-room-difficulty')); } catch {}
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
function soloAction(action,amount) {
  const observed=playerMemory.capture(game,action,amount);
  if(!game.act(action,amount))return false;
  playerMemory.record(observed);
  if(game.done){playerMemory.finish();savePlayerMemory();}
  return true;
}
let timer = null;
let room = null;
let lastFrame = null;
let pendingAction = false;
let pendingTimer = null;
let connectionMessage = '';
let soloGifts = new TableGifts();

function card(c, hidden = false) {
  if (hidden) return '<div class="card back" aria-label="Face-down card"></div>';
  if (!c) return '<div class="card empty"></div>';
  const rank = ({ 11:'J', 12:'Q', 13:'K', 14:'A' })[c.r] || c.r;
  return `<div class="card ${c.s % 2 ? 'red' : ''}" aria-label="${rank} ${['spades','hearts','clubs','diamonds'][c.s]}"><span>${rank}</span><span class="suit">${suits[c.s]}</span></div>`;
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
function renderTable(v) {
  $('pot').textContent = v.pot.toLocaleString();
  $('handNo').textContent = `HAND ${String(v.hand).padStart(2, '0')}`;
  $('board').innerHTML = Array.from({ length:5 }, (_, i) => card(v.board[i])).join('');
  $('street').textContent = room && !v.started ? 'WAITING FOR FRIENDS' : v.done ? 'HAND COMPLETE' : ['PRE-FLOP','FLOP','TURN','RIVER'][v.stage];
  $('seats').innerHTML = v.players.map((p, i) => {
    const occupied = !room || p.occupied;
    const name = room && i === 0 ? `${p.name} (you)` : p.name;
    const action = !occupied ? 'Invite a friend' : room && !p.online ? 'Disconnected' : p.action;
    return `<div class="seat seat-${i} ${!v.done && v.turn === i ? 'active' : ''} ${p.folded && v.hand ? 'folded' : ''} ${!occupied ? 'empty-seat' : ''}">
      ${i ? `<div class="avatar">${occupied ? escape(p.name[0]) : '+'}</div>` : ''}
      <div class="cards">${p.cards.map(c => card(c, room ? c === null : i !== 0 && !(v.done && v.stage === 4 && !p.folded))).join('')}</div>
      <div class="seat-identity"><div class="nameplate"><div class="player-name">${escape(name)}${v.dealer === i ? '<span class="badge" title="Dealer">D</span>' : ''}</div><div class="stack">${occupied ? p.stack.toLocaleString() : '—'}</div></div>
      ${i && occupied && (!room || p.online) ? `<button type="button" class="seat-drink" data-gift-seat="${room ? (i + room.me) % v.players.length : i}" aria-label="Buy ${escape(p.name)} a drink" title="Buy ${escape(p.name)} a drink" aria-haspopup="dialog"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16l-8 9L4 4Zm8 9v7m-4 0h8M6 7h12"/></svg></button>` : ''}</div>
      <div class="player-action">${escape(action || ' ')}</div></div>`;
  }).join('');
  $('log').innerHTML = v.logs.map(line => `<li>${escape(line)}</li>`).join('');
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
  } else if (soloAction(action, amount)) { render(); schedule(); }
}
function deal() {
  if (!room) { start(); return; }
  try { connectionMessage = ''; room.deal(); } catch (error) { showRoomError(error.message); }
}
function schedule() {
  clearTimeout(timer);
  if (friendsPage || room || game.done || game.turn === 0) return;
  timer = setTimeout(() => {
    if (room) return;
    const decision = chooseBotAction(botObservation(game, playerMemory), handDifficulty);
    act(decision.action, decision.amount);
  }, handDifficulty === 'gto' ? gtoThinkTime({seat:game.turn,options:game.options(),pot:game.pot}) : 850 + Math.random() * 650);
}
function start() { clearTimeout(timer); lastFrame = null; handDifficulty = selectedDifficulty; game.start(); playerMemory.begin(game); if(game.done){playerMemory.finish();savePlayerMemory();} render(); schedule(); }
function renderDifficulty() {
  $('difficultyPanel').hidden = !!room;
  $('aiMemoryPanel').hidden = !!room || handDifficulty === 'gto';
  document.querySelectorAll('input[name="difficulty"]').forEach(input => { input.checked = input.value === selectedDifficulty; });
  $('difficultyStatus').textContent = selectedDifficulty !== handDifficulty
    ? `${DIFFICULTIES[handDifficulty].name} this hand · ${DIFFICULTIES[selectedDifficulty].name} starts next hand`
    : `${DIFFICULTIES[selectedDifficulty].name} opponents · ${DIFFICULTIES[selectedDifficulty].description}`;
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
    token.animate([{ transform:`translate(${a.left+a.width/2-b.left-b.width/2}px,${a.top-b.top}px) scale(.5)`, opacity:0 }, { transform:'translate(0, -12px) scale(1.15)', opacity:1, offset:.7 }, { transform:'translate(0, 0) scale(1)', opacity:1 }], { duration:850, easing:'ease-out' });
  }
  setTimeout(() => token.remove(), 2600);
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
  lobby = bindLobby(lobbyClient, () => room);
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
