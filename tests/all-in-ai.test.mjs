import test from 'node:test';
import assert from 'node:assert/strict';
import { Poker } from '../engine.js';
import { HostTable } from '../room-state.js';
import { PokerService } from '../server/poker-service.mjs';
import { encode, decode } from '../server/cloud-state.mjs';
import { celebrationEvent } from '../celebration.js';

function headsUp() { const g = new Poker(); g.players.forEach((p, i) => { if (i > 1) p.stack = 0; }); g.start(); return g; }
test('all-in raises the full stack, short calls conserve chips, and awards survive payout', () => {
  const g = headsUp(); g.players[1].stack = 480; // 500 starting chips including blind
  assert.equal(g.act('allin'), true);
  assert.equal(g.players[0].stack, 0); assert.equal(g.players[0].allIn, true);
  assert.equal(g.options().call, 480);
  assert.equal(g.act('allin'), true); assert.equal(g.done, true);
  assert.equal(g.players.reduce((n,p)=>n+p.stack,0), 1500);
  assert.equal(g.awards.reduce((n,a)=>n+a.amount,0), 1500);
  assert.ok(g.awards.every(a=>a.allIn));
  assert.ok(g.awards.every(a=>a.profit===a.amount-g.players[a.seat].total));
});
test('all-in obeys betting reopening restrictions and resets next hand', () => {
  const g = new Poker(); g.start();
  g.raiseAt[g.turn] = g.current;
  assert.equal(g.options().canRaise, false);
  assert.equal(g.act('allin'), false);
  delete g.raiseAt[g.turn]; assert.equal(g.act('allin'), true);
  while(!g.done) g.act('fold');
  assert.ok(g.awards[0].allIn);
  g.start(); assert.deepEqual(g.awards, []);
  assert.ok(g.players.every(p=>!p.allIn));
});
test('AI seats are host-only, removable before dealing, private, and do not time out', () => {
  const table = new HostTable('Host', 1000);
  assert.throws(()=>table.manageAI(1,'fill',null,table.version,1000), /Only the host/);
  table.manageAI(0,'fill',null,table.version,1000);
  assert.equal(table.members.filter(m=>m?.bot).length, 5);
  assert.throws(()=>table.manageAI(0,'add',null,table.version,1000), /full/);
  table.manageAI(0,'remove',2,table.version,1000);
  table.join('Friend',crypto.randomUUID(),1000);
  table.start(0,table.version,1000);
  assert.throws(()=>table.manageAI(0,'remove',1,table.version,1000), /before the first/);
  const view = table.view(0);
  assert.equal(view.players[1].bot,true);
  assert.deepEqual(view.players[1].cards,[null,null]);
  let now = 1000, moves = 0;
  while(!table.game.done && moves++<150) {
    now += 1500;
    table.members.forEach(m=>{if(m&&!m.bot)m.seen=now;});
    if(table.members[table.game.turn].bot) {
      const version = table.version;
      table.tick(now);
      assert.equal(table.version, version+1);
    } else table.act(table.game.turn,{action:'call',version:table.version},now);
  }
  assert.ok(table.game.done); assert.ok(moves<150);
  assert.ok(table.members.filter(m=>m.bot).every(m=>m.online));
  assert.equal(table.game.players.reduce((n,p)=>n+p.stack,0),6000);
});
test('persisted server AI moves once when due and duplicate add requests do not add seats', () => {
  let now = 100000;
  let service = new PokerService(()=>now);
  const host = service.handle('/session','',{name:'Host'});
  const write=(path,body={})=>{now+=101;return service.handle(path,host.token,{requestId:crypto.randomUUID(),...body});};
  const room=write('/create'); const requestId=crypto.randomUUID();
  let state=write('/bots',{operation:'add',version:room.state.version,requestId}).state;
  state=write('/bots',{operation:'add',version:room.state.version,requestId}).state;
  assert.equal(state.players.filter(p=>p.bot).length,1);
  state=write('/deal',{version:state.version}).state;
  state=write('/action',{action:'call',version:state.version}).state;
  assert.equal(state.turn,1);
  service=decode(encode(service),()=>now);
  const version=state.version;
  assert.equal(service.handle('/poll',host.token).state.version,version);
  now+=1300;
  state=service.handle('/poll',host.token).state;
  assert.equal(state.version,version+1);
  assert.equal(service.handle('/poll',host.token).state.version,state.version);
  assert.equal(service.lobby(service.session(host.token)).players.length,1);
});
test('celebrations distinguish commitment, ordinary wins and all-in wins without celebrating refunds', () => {
  const players=[{name:'Host',allIn:false},{name:'AI',allIn:false}];
  const before={hand:1,done:false,players};
  assert.equal(celebrationEvent(before,{...before,players:[{...players[0],allIn:true},players[1]]}).kind,'all-in');
  const win={...before,done:true,outcome:{kind:'win',title:'YOU WIN',detail:'Your flush beat ace-high.'}};
  assert.equal(celebrationEvent(before,win).kind,'win');
  win.outcome.kind='all-in-win';
  assert.equal(celebrationEvent(before,win).kind,'all-in-win');
  win.outcome={kind:'loss',title:'YOU LOST',detail:'Your ace-high lost to a flush.'}; assert.equal(celebrationEvent(before,win).kind,'loss');
  assert.equal(celebrationEvent(win,win),null);
  assert.equal(celebrationEvent(null,win),null);
});
