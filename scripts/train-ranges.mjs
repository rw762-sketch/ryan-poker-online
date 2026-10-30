import {mkdirSync,writeFileSync} from 'node:fs';
import {Poker} from '../engine.js';
import {PlayerMemory} from '../player-memory.js';
import {handFeatures,featureKeys,actionClass} from '../range-model.js';
import {seededRandom,preflopStrength} from '../poker-math.js';
import {sampleSeed} from './sample-seed.mjs';
export function sampleRangeGame(seed,onAction=()=>{},onAfterAction=()=>{}){
 const rng=seededRandom(sampleSeed(seed)),g=new Poker(),memory=new PlayerMemory();g.dealer=seed%4-1;g.start(rng);memory.begin(g);
 const styles=Array.from({length:4},()=>Math.floor(rng()*6));let moves=0;
 while(!g.done&&moves++<200){
  const seat=g.turn,p=g.players[seat],o=g.options(),f=handFeatures(p.cards,g.board),style=styles[seat],price=o.call/Math.max(1,g.pot+o.call),strength=preflopStrength(p.cards);
  let fold=0,raise=0;
  if(!g.board.length){fold=strength<(.32+(style===1?.13:0))?.7:strength<.55?.24:.04;raise=strength>.7?.65:strength>.5?.32:.06;}
  else{fold=f.bucket===0?(f.draw?.28:.72):f.bucket===1?.3:f.bucket===2?.14:.02;raise=f.bucket>=3?.68:f.bucket===2?.3:f.draw?.3:.09;}
  fold=Math.max(0,Math.min(.97,fold+(price-.2)*.5));
  if(style===0){fold*=.18;raise*=.45;} // calling-heavy
  if(style===1){fold=Math.min(.97,fold*1.3);raise*=.8;} // selective
  if(style===2){fold*=.7;raise=Math.min(.9,raise*1.5+.08);} // pressure
  if(style===3){raise*=.45;} // passive
  if(style===4&&f.draw){fold*=.6;raise=Math.min(.9,raise+.2);} // draw-heavy
  let action=o.owed&&rng()<fold?'fold':o.canRaise&&rng()<raise?'raise':'call',amount;
  if(action==='raise'){const fraction=[.33,.55,.8,1.2][Math.floor(rng()*4)];amount=Math.min(o.max,Math.max(o.min,g.current+Math.round(Math.max(20,(g.pot+o.call)*fraction))));}
  const event=memory.capture(g,action,amount);
  onAction({game:g,event,styles});
  if(!g.act(action,amount))throw Error('Illegal training sample');memory.record(event);onAfterAction({game:g,event,styles});
 }
 if(!g.done||g.players.reduce((s,p)=>s+p.stack,0)!==6000)throw Error('Invalid training hand');
 return {actions:moves,game:g};
}
if(process.argv[1]?.endsWith('train-ranges.mjs')){
 const counts={},backoffs={},started=Date.now();let actions=0;
 for(let h=0;h<30000;h++){
  sampleRangeGame(6600000+h,({game:g,event})=>{
   // Offline labels are the acting simulated player's own cards, not runtime opponent access.
   const keys=featureKeys(g.players[g.turn].cards,g.board,event),kind=actionClass(event);
   (counts[keys.key]??=[0,0,0,0])[kind]++;(backoffs[keys.backoff]??=[0,0,0,0])[kind]++;actions++;
  });
  if((h+1)%5000===0)console.log(JSON.stringify({trainingHands:h+1,actions}));
 }
 const metadata={hands:30000,actions,seedStart:6600000,seedMix:'32-bit avalanche',method:'Smoothed action-likelihood counts from six synthetic playing styles. No human histories.',elapsedSeconds:(Date.now()-started)/1000};
 writeFileSync('range-model-data.js',`// Generated offline by scripts/train-ranges.mjs.\nexport const RANGE_ACTION_COUNTS = ${JSON.stringify(counts)};\nexport const RANGE_BACKOFF_COUNTS = ${JSON.stringify(backoffs)};\nexport const RANGE_TRAINING = ${JSON.stringify(metadata)};\n`);
 mkdirSync('training/range-learning',{recursive:true});writeFileSync('training/range-learning/training.json',JSON.stringify(metadata,null,2));
}
