import test from 'node:test';
import assert from 'node:assert/strict';
import {inferRange,handFeatures} from '../range-model.js';
import {simulateEquity,seededRandom} from '../poker-math.js';
import {Poker} from '../engine.js';
import {PlayerMemory} from '../player-memory.js';
import {botObservation,chooseBotDecision} from '../ai.js';
const cards=s=>s.split(' ').map(c=>({r:'23456789TJQKA'.indexOf(c[0])+2,s:'shcd'.indexOf(c[1])}));
const event=type=>({seat:1,street:1,type,faced:false,size:type==='raise'?1:0,chips:0,context:{street:1,price:0,spr:3,opponents:1}});
test('posterior excludes visible cards, stays normalized and retains uncertainty',()=>{
 const own=cards('2h 3h'),board=cards('As Kd 7c'),used=new Set([...own,...board].map(c=>c.s*13+c.r));
 const range=inferRange(own,board,[event('raise')]);
 assert.equal(range.length,1081);
 assert.ok(Math.abs(range.reduce((s,c)=>s+c.weight,0)-1)<1e-10);
 assert.ok(range.every(h=>h.weight>0&&h.cards.every(c=>!used.has(c.s*13+c.r))));
 const checked=inferRange(own,board,[event('check')]);
 const strength=r=>r.reduce((s,h)=>s+h.weight*handFeatures(h.cards,board).bucket,0);
 assert.ok(strength(range)>strength(checked));
});
test('weighted equity samples the supplied distribution, with dead-card validation',()=>{
 const input={cards:cards('As Ah'),board:cards('2c 3d 7h 9s Jc'),opponents:1,weightedRanges:[[{cards:cards('Ks Kh'),weight:.75},{cards:cards('Js Jh'),weight:.25}]]};
 assert.ok(Math.abs(simulateEquity(input,8000,seededRandom(481)).equity-.75)<.02);
 for(const entries of [[{cards:cards('As Ks'),weight:1}],[{cards:cards('Ks Kh'),weight:0}],[{cards:cards('Ks Kh'),weight:-1}],[{cards:cards('Ks Kh'),weight:1},{cards:cards('Kh Ks'),weight:1}]])assert.throws(()=>simulateEquity({...input,weightedRanges:[entries]},1));
});
test('GTO range inference cannot inspect another player cards or deck',()=>{
 const g=new Poker(),m=new PlayerMemory();g.start(seededRandom(439));m.begin(g);
 for(let n=0;n<3&&!g.done;n++){const e=m.capture(g,'call');g.act('call');m.record(e);}
 Object.defineProperty(g,'deck',{get(){throw Error('hidden deck');}});
 g.players.forEach((p,i)=>{if(i!==g.turn)Object.defineProperty(p,'cards',{get(){throw Error('hidden hole cards');}});});
 const obs=botObservation(g,m),decision=chooseBotDecision(obs,'gto',seededRandom(248));
 assert.ok(['raise','call','fold'].includes(decision.action));
});
test('GTO plays complete hands with public history, inferred ranges, and conserved chips',()=>{
 let inferred=0;
 for(let seed=0;seed<30;seed++){
  const g=new Poker(),m=new PlayerMemory(),rng=seededRandom(9300+seed);g.start(rng);m.begin(g);let moves=0;
  while(!g.done&&moves++<200){const d=chooseBotDecision(botObservation(g,m),'gto',rng),e=m.capture(g,d.action,d.amount);inferred+=d.analysis.weightedRangeCombinations?.length||0;assert.ok(g.act(d.action,d.amount));m.record(e);}
  assert.ok(g.done);assert.equal(g.players.reduce((s,p)=>s+p.stack,0),6000);
 }
 assert.ok(inferred>0);
});
