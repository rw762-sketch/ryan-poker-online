import {sampleSeed} from './sample-seed.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Poker} from '../engine.js';
import {botObservation,chooseBotDecision} from '../ai.js';
import {seededRandom,preflopStrength} from '../poker-math.js';
import {PlayerMemory} from '../player-memory.js';
const mode=process.argv[2]||'paired',started=Date.now();
const directory='training/regression-2026-09-25';mkdirSync(directory,{recursive:true});
function summary(xs){const n=xs.length,mean=xs.reduce((s,x)=>s+x,0)/n,variance=xs.reduce((s,x)=>s+(x-mean)**2,0)/Math.max(1,n-1),se=Math.sqrt(variance/n);return {n,mean,se,interval95:[mean-1.96*se,mean+1.96*se]};}
function verify(g,total){
 if(g.players.some(p=>!Number.isInteger(p.stack)||p.stack<0||!Number.isInteger(p.bet)||p.bet<0))throw Error('Invalid stack or bet');
 if(g.players.reduce((s,p)=>s+p.stack,0)+(g.done?0:g.pot)!==total)throw Error('Chip conservation');
 const cards=[...g.board,...g.players.flatMap(p=>p.cards)];if(new Set(cards.map(c=>c.s*13+c.r)).size!==cards.length)throw Error('Duplicate dealt cards');
}
function opponent(obs,style,rng){
 const o=obs.options,strength=preflopStrength(obs.cards),price=o.call/Math.max(1,obs.pot+o.call);
 if(style==='medium')return chooseBotDecision(obs,'medium',rng);
 if(style==='caller')return {action:'call'};
 if(style==='folder'&&o.owed&&rng()<.7)return {action:'fold'};
 if(style==='selective'&&o.owed&&strength<.55&&price>.12)return {action:'fold'};
 if(o.canRaise&&rng()<(style==='pressure'?.7:style==='min-raise'?.6:.2))return {action:'raise',amount:style==='min-raise'?o.min:Math.min(o.max,Math.max(o.min,obs.current+Math.round((obs.pot+o.call)*(style==='pressure'?1:.55))))};
 return {action:'call'};
}
if(mode==='paired'){
 const base=await import(pathToFileURL(resolve(process.argv[3]||'/tmp/ryan-poker-regression-baseline/dist','ai.js')));
 const rows=[],all=[],counts={actions:0,folds:0,bluffs:0,raises:0};
 function play(h,style,previous){
  const g=new Poker(),hero=h%4,seed=2200000+h;g.dealer=(h>>2)%4-1;g.start(seededRandom(sampleSeed(seed)));
  const rngs=Array.from({length:4},(_,i)=>seededRandom(sampleSeed(seed*31+i*997))),self=[];let moves=0;
  while(!g.done&&moves++<200){
   const seat=g.turn,obs={...botObservation(g),seat,selfLine:self};
   const d=seat===hero?(previous?base.chooseBotDecision:chooseBotDecision)(obs,'gto',rngs[seat]):opponent(obs,style,rngs[seat]);
   if(seat===hero){self.push({type:d.action,street:g.stage});if(!previous){counts.actions++;if(d.action==='fold')counts.folds++;if(d.action==='raise'){counts.raises++;if(d.analysis.bluffKind)counts.bluffs++;}}}
   if(!obs.options.owed&&d.action==='fold')throw Error('Free-check fold');
   if(!g.act(d.action,d.amount))throw Error(`Illegal action ${JSON.stringify({h,style,previous,d})}`);verify(g,6000);
  }
  if(!g.done)throw Error('Hand did not finish');return (g.players[hero].stack-1000)/20;
 }
 for(const [i,style] of ['caller','folder','selective','pressure','min-raise','medium'].entries()){
  const current=[],previous=[],difference=[];
  for(let j=0;j<2000;j++) {const h=i*2000+j,a=play(h,style,false),b=play(h,style,true);current.push(a);previous.push(b);difference.push(a-b);if((j+1)%500===0)console.log(JSON.stringify({mode,style,pairs:j+1,seconds:Math.round((Date.now()-started)/1000)}));}
  rows.push({style,current:summary(current),previous:summary(previous),pairedDelta:summary(difference)});all.push(...difference);
 }
 const report={seedMix:'32-bit avalanche',mode,hands:24000,pairedHands:12000,seedStart:2200000,baseline:'15ffc56',candidate:'4827998',productionRollouts:true,rows,pairedDelta:summary(all),counts,correctnessFailures:0,elapsedSeconds:(Date.now()-started)/1000,limitations:['Six synthetic opponent tables; not human or equilibrium performance.','Intervals describe these fixed independent seeded hands and equal matchup weights.','Per-matchup intervals are descriptive; no multiple-comparison significance claim.','Fresh stacks each hand; four hero seats and dealer positions rotated.']};
 writeFileSync(`${directory}/paired.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} else if(mode==='stress'){
 let hands=0,actions=0;const levels=['easy','medium','hard','gto'];
 for(let table=0;table<600;table++){
  const rng=seededRandom(3300000+table),g=new Poker(),memory=new PlayerMemory();
  // Include short stacks, deep stacks, empty seats and awkward odd-chip side pots.
  g.players.forEach((p,i)=>p.stack=i<2?1+Math.floor(rng()*2000):rng()<.25?0:1+Math.floor(rng()*4000));
  const total=g.players.reduce((s,p)=>s+p.stack,0);
  for(let h=0;h<10;h++){
   if(!g.start(rng))break;memory.begin(g);let moves=0;
   while(!g.done&&moves++<200){const obs=botObservation(g,memory),d=chooseBotDecision(obs,levels[(table+g.turn)%4],rng),e=memory.capture(g,d.action,d.amount);if(!obs.options.owed&&d.action==='fold')throw Error('Free-check fold');if(!g.act(d.action,d.amount))throw Error('Illegal action');memory.record(e);verify(g,total);actions++;}
   if(!g.done)throw Error('Hand did not finish');memory.finish();hands++;
  }
  if((table+1)%100===0)console.log(JSON.stringify({mode,tables:table+1,hands,actions}));
 }
 const report={mode,tables:600,hands,actions,seedStart:3300000,correctnessFailures:0,elapsedSeconds:(Date.now()-started)/1000};writeFileSync(`${directory}/stress.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
