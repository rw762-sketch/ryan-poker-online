import test from 'node:test';
import assert from 'node:assert/strict';
import {PlayerMemory,adaptStrategy} from '../player-memory.js';
import {Poker} from '../engine.js';
import {botObservation,chooseBotAction} from '../ai.js';
import {DEFAULT_POLICY,strategicAction} from '../strategy.js';
import {seededRandom} from '../poker-math.js';
const event=(type,street=0)=>({seat:0,street,type,faced:true,size:type==='raise'?.7:0,chips:type==='fold'?0:20});
function train(type,count=50){const m=new PlayerMemory();for(let i=0;i<count;i++){m.begin({players:[{folded:false}]});m.record(event(type));m.record(event(type,1));m.record(event(type,2));m.finish();}return m;}
const obs={cards:[{r:14,s:0},{r:12,s:1}],board:[{r:2,s:0},{r:7,s:1},{r:9,s:2}],opponents:1,opponentRanges:['standard'],opponentLines:[],pot:100,stack:1000,bet:0,current:0,position:'late',bigBlind:20,options:{owed:0,call:0,min:20,max:1000,canRaise:true}};
test('public traces distinguish callers, folders and aggressive players with sample limits',()=>{
 assert.equal(train('call',3).profile(0).confidence,0);
 assert.equal(train('call').profile(0).label,'Calls often');
 assert.equal(train('fold').profile(0).label,'Folds often');
 assert.equal(train('raise').profile(0).label,'Aggressive');
 const m=train('call',160);assert.equal(m.history.length,120);
 assert.deepEqual(new PlayerMemory(JSON.parse(JSON.stringify(m.save()))).profile(0),m.profile(0));
 m.finish();assert.equal(m.history.length,120);
});
test('recent behavior changes the read instead of permanently labeling a player',()=>{
 const m=train('fold',60),before=m.profile(0).fold;
 for(let i=0;i<60;i++){m.begin({players:[{folded:false}]});m.record(event('call'));m.record(event('call',1));m.finish();}
 assert.ok(m.profile(0).fold<before-.3);
 assert.equal(new PlayerMemory({version:1,history:[{seats:[0],actions:[{type:'raise'}]}]}).history.length,0);
});
test('same hand gets larger value bets against callers and selective bluffs against folders',()=>{
 const caller=adaptStrategy({...obs,opponentProfiles:[train('call').profile(0)]},DEFAULT_POLICY);
 const folder=adaptStrategy({...obs,opponentProfiles:[train('fold').profile(0)]},DEFAULT_POLICY);
 assert.ok(caller.policy.size>folder.policy.size);
 assert.ok(caller.policy.bluff<folder.policy.bluff);
 const a=strategicAction(caller.observation,caller.policy,()=>.01,1,.8);
 const b=strategicAction(folder.observation,folder.policy,()=>.01,1,.8);
 assert.equal(a.action,'raise');assert.equal(b.action,'raise');assert.ok(a.amount>b.amount);
 const river={...obs,board:[{r:2,s:0},{r:5,s:1},{r:9,s:2},{r:13,s:3},{r:14,s:2}]};
 const c=adaptStrategy({...river,opponentProfiles:[train('call').profile(0)]},DEFAULT_POLICY);
 const f=adaptStrategy({...river,opponentProfiles:[train('fold').profile(0)]},DEFAULT_POLICY);
 const roll=(c.policy.bluff+f.policy.bluff)/2;
 assert.equal(strategicAction(c.observation,c.policy,()=>roll,1,.25).action,'call');
 assert.equal(strategicAction(f.observation,f.policy,()=>roll,1,.25).action,'raise');
});
test('current multi-street aggression tempers the learned loose range',()=>{
 const profile=train('raise').profile(0);
 const a=adaptStrategy({...obs,opponentProfiles:[profile],opponentLines:[[event('raise',1)]]},DEFAULT_POLICY);
 assert.equal(a.observation.opponentRanges[0],'loose');
 const b=adaptStrategy({...obs,opponentProfiles:[profile],opponentLines:[[event('raise',1),event('raise',2)]]},DEFAULT_POLICY);
 assert.equal(b.observation.opponentRanges[0],'standard');
});
test('history and bot observations cannot inspect opponents cards or future deck',()=>{
 const g=new Poker();g.start(seededRandom(1));const m=new PlayerMemory();m.begin(g);
 Object.defineProperty(g,'deck',{get(){throw Error('hidden deck');}});
 g.players.forEach((p,i)=>{if(i!==g.turn)Object.defineProperty(p,'cards',{get(){throw Error('hidden cards');}});});
 m.record(m.capture(g,'call'));const o=botObservation(g,m);assert.ok(o.opponentProfiles.length);
 assert.equal(JSON.stringify(m.save()).includes('cards'),false);
});
test('adaptive bots complete many hands with legal actions and conserved chips',()=>{
 const m=new PlayerMemory(),rng=seededRandom(413);
 for(let h=0;h<100;h++){
  const g=new Poker();g.dealer=h%4-1;g.start(rng);m.begin(g);let moves=0;
  while(!g.done&&moves++<150){const a=chooseBotAction(botObservation(g,m),'hard',rng),e=m.capture(g,a.action,a.amount);assert.equal(g.act(a.action,a.amount),true);m.record(e);}
  assert.ok(g.done);m.finish();assert.equal(g.players.reduce((s,p)=>s+p.stack,0),6000);
 }
 assert.equal(m.history.length,100);
});
