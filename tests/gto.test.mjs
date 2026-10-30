import test from 'node:test';
import assert from 'node:assert/strict';
import {openingMix,bluffBudget,gtoDecision,rangeMix} from '../gto.js';
import {chooseBotDecision,normalizeDifficulty,botObservation} from '../ai.js';
import {Poker} from '../engine.js';
import {seededRandom} from '../poker-math.js';
const cards=s=>s.split(' ').map(c=>({r:'23456789TJQKA'.indexOf(c[0])+2,s:'shcd'.indexOf(c[1])}));
const obs={cards:cards('As Ks'),board:cards('Qs Js Ts 2d 3c'),opponents:1,opponentRanges:['standard'],pot:200,current:0,bet:0,stack:1000,effectiveStack:1000,position:'late',bigBlind:20,options:{owed:0,call:0,min:20,max:1000,canRaise:true}};
test('GTO is selectable; openings widen in position without dropping premium pairs',()=>{
 assert.equal(normalizeDifficulty('gto'),'gto');
 assert.equal(openingMix(cards('As Ah'),'early'),1);
 assert.equal(openingMix(cards('7s 2h'),'early'),0);
 let early=0,late=0;
 for(let r=2;r<=14;r++)for(let s=2;s<=14;s++){early+=openingMix([{r,s:0},{r:s,s:1}],'early');late+=openingMix([{r,s:0},{r:s,s:1}],'late');}
 assert.ok(late>early);
});
test('polar river bluff budgets follow sizing and shrink multiway',()=>{
 assert.equal(bluffBudget(90,50,100),30);
 assert.equal(bluffBudget(90,100,100),45);
 assert.ok(bluffBudget(90,100,100,3)<bluffBudget(90,100,100));
 const mix=rangeMix(obs,150);assert.ok(mix.value);assert.ok(mix.valueFrequency<1);
});
test('nuts mix value bets with protected checks, and free checks never fold',()=>{
 assert.equal(gtoDecision(obs,()=>.1,20).action,'raise');
 assert.equal(gtoDecision(obs,()=>.99,20).action,'call');
 const weak={...obs,cards:cards('4h 5c'),board:cards('2s 8d Jh Qc As')};
 for(let seed=1;seed<8;seed++)assert.notEqual(gtoDecision(weak,seededRandom(seed),40).action,'fold');
});
test('profitable all-in calls have no future-street penalty; board ties check',()=>{
 const allin={...obs,stack:20,options:{...obs.options,call:20,owed:20,canRaise:false,max:20}};
 assert.equal(gtoDecision(allin,seededRandom(1),30).action,'call');
 const tied={...obs,cards:cards('2h 3c'),board:cards('As Ks Qs Js Ts')};
 assert.equal(gtoDecision(tied,()=>.01,20).action,'call');
});
test('GTO ignores learned exploit profiles and is reproducible with the same random seed',()=>{
 const a=chooseBotDecision(obs,'gto',seededRandom(43));
 const b=chooseBotDecision({...obs,opponentProfiles:[{fold:1,confidence:1}],foldPredictions:{'.5':{fold:1,confidence:1}}},'gto',seededRandom(43));
 assert.deepEqual(a,b);
});
test('GTO completes seeded full games with legal bets and conserved chips',()=>{
 for(let seed=1;seed<=30;seed++){
  const g=new Poker(),rng=seededRandom(seed);g.start(rng);let moves=0;
  while(!g.done&&moves++<200){const decision=chooseBotDecision(botObservation(g),'gto',rng);assert.ok(g.act(decision.action,decision.amount));}
  assert.ok(g.done);assert.equal(g.players.reduce((s,p)=>s+p.stack,0),6000);
 }
});

import {gtoStyle,gtoThinkTime} from '../gto.js';
const withRoll=roll=>{const rng=seededRandom(73);let first=true;return ()=>{if(first){first=false;return roll;}return rng();};};
test('live draws can semi-bluff above the old 40-percent equity ceiling and also check',()=>{
 const draw={...obs,cards:cards('Qs Js'),board:cards('Ts 9d 2s'),seat:2};
 const bet=gtoDecision(draw,withRoll(.001),400),check=gtoDecision(draw,withRoll(.999),400);
 assert.ok(bet.analysis.equity>.4);assert.equal(bet.analysis.bluffKind,'semi-bluff');
 assert.ok(bet.analysis.raiseFrequency>0&&bet.analysis.raiseFrequency<1);
 assert.equal(bet.action,'raise');assert.equal(check.action,'call');
});
test('no bluffs into an all-in player or multiple opponents',()=>{
 const draw={...obs,cards:cards('Qs Js'),board:cards('Ts 9d 2s'),seat:2};
 const allin=gtoDecision({...draw,effectiveStack:0},withRoll(.001),100);
 assert.equal(allin.analysis.bluffKind,null);
 const multi=gtoDecision({...draw,opponents:3,opponentRanges:['standard','standard','standard']},withRoll(.001),100);
 assert.equal(multi.analysis.bluffKind,null);
});
test('personalities keep protected strong checks and timing is independent of cards',()=>{
 for(let seat=0;seat<4;seat++){
  const style=gtoStyle(seat);assert.ok(style.valueFrequency>.65&&style.valueFrequency<.9);
  assert.equal(gtoDecision({...obs,seat},withRoll(.999),30).action,'call');
  const weak={...obs,seat,cards:cards('4h 5c')};
  assert.equal(gtoThinkTime({...obs,seat},()=>.4),gtoThinkTime(weak,()=>.4));
 }
 assert.notEqual(gtoStyle(1).name,gtoStyle(2).name);
});
test('continuation trace lowers weak river barrel frequency instead of auto-bluffing',()=>{
 const river={...obs,cards:cards('6h 5c'),board:cards('2s 9d Jh Qc As'),seat:2};
 const first=gtoDecision(river,withRoll(.001),100);
 const second=gtoDecision({...river,selfLine:[{type:'raise',street:2}]},withRoll(.001),100);
 assert.equal(second.analysis.continuing,true);
 assert.ok(second.analysis.raiseFrequency<=first.analysis.raiseFrequency);
});

import {distributeBluffs} from '../gto.js';
test('bluff randomization preserves its budget and keeps every eligible hand mixed',()=>{
 const frequencies=distributeBluffs([0,1,4,8],2);
 assert.ok(Math.abs(frequencies.reduce((a,b)=>a+b,0)-2)<1e-9);
 assert.ok(frequencies.every(p=>p>0&&p<=.8));
 assert.ok(frequencies[3]>=frequencies[0]);
 assert.deepEqual(distributeBluffs([0,4],0),[0,0]);
 assert.deepEqual(distributeBluffs([],4),[]);
 assert.ok(distributeBluffs([0,4],10).every(p=>p===.8));
 const rng=seededRandom(543),p=frequencies[1];let count=0;
 for(let i=0;i<10000;i++)if(rng()<p)count++;
 assert.ok(Math.abs(count/10000-p)<.025);
});
