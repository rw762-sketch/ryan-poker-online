import {sampleSeed} from './sample-seed.mjs';
import {writeFileSync,mkdirSync} from 'node:fs';
import {Poker} from '../engine.js';
import {PlayerMemory} from '../player-memory.js';
import {seededRandom} from '../poker-math.js';
const sessions=[],start=Date.now();let responses=0,totalActions=0;const phases={warmup:{n:0,model:0,baseline:0},established:{n:0,model:0,baseline:0},shift:{n:0,model:0,baseline:0}};
for(let session=0;session<10;session++){
 const memory=new PlayerMemory();let modelLoss=0,baseLoss=0,n=0,active=0;
 for(let hand=0;hand<600;hand++){
  const seed=4400000+session*1000+hand,rng=seededRandom(sampleSeed(seed)),g=new Poker();g.dealer=hand%4-1;g.start(rng);memory.begin(g);let moves=0;
  while(!g.done&&moves++<200){
   const seat=g.turn,o=g.options(),price=o.call/Math.max(1,g.pot+o.call);
   const style=(seat+(hand>=300?2:0))%4;
   const prob=[.05+1.7*price,.05+.15*price,.15+1.2*price+(g.stage>1?.2:0),.08+.7*price][style];
   let action=o.owed&&rng()<prob?'fold':'call',amount;
   if(action==='call'&&o.canRaise&&rng()<.22){action='raise';amount=Math.min(o.max,Math.max(o.min,g.current+Math.round((g.pot+o.call)*[.33,.65,1][Math.floor(rng()*3)])));}
   const event=memory.capture(g,action,amount);
   if(event.faced){
    // Predict before this action or this hand enters the training set.
    const p=memory.predictFold(seat,event.context),baseline=memory.profile(seat).fold,y=action==='fold'?1:0;
    const c=Math.min(.65,p.confidence),prediction=baseline*(1-c)+p.fold*c;
    const ml=(prediction-y)**2,bl=(baseline-y)**2;modelLoss+=ml;baseLoss+=bl;n++;responses++;if(c)active++;
    const phase=phases[hand<40?'warmup':hand>=300&&hand<420?'shift':'established'];phase.n++;phase.model+=ml;phase.baseline+=bl;
   }
   if(!g.act(action,amount))throw Error('Illegal learning sample');memory.record(event);totalActions++;
  }
  if(!g.done||g.players.reduce((s,p)=>s+p.stack,0)!==6000)throw Error('Invalid completed learning hand');memory.finish();
  if(hand===599){const restored=new PlayerMemory(JSON.parse(JSON.stringify(memory.save())));for(let seat=0;seat<4;seat++){const context={street:1,price:.2,spr:2,opponents:1};if(JSON.stringify(restored.predictFold(seat,context))!==JSON.stringify(memory.predictFold(seat,context)))throw Error('Persistence changed model');}}
 }
 sessions.push({session,responses:n,modelBrier:modelLoss/n,baselineBrier:baseLoss/n,delta:(modelLoss-baseLoss)/n,activePredictions:active});console.log(JSON.stringify(sessions.at(-1)));
}
const mean=sessions.reduce((s,x)=>s+x.delta,0)/sessions.length,se=Math.sqrt(sessions.reduce((s,x)=>s+(x.delta-mean)**2,0)/9/10);
const report={seedMix:'32-bit avalanche',hands:6000,independentSessions:10,responses,totalActions,seedStart:4400000,method:'Prequential prediction: train only on prior completed hands, retain at most 120 hands, switch opponent styles halfway through each session. Compare confidence-blended ML predictions to smoothed fold-rate baseline.',sessions,phases:Object.fromEntries(Object.entries(phases).map(([k,v])=>[k,{responses:v.n,modelBrier:v.model/v.n,baselineBrier:v.baseline/v.n}])),meanSessionBrierDelta:mean,sessionClusterInterval95:[mean-2.262*se,mean+2.262*se],elapsedSeconds:(Date.now()-start)/1000,limitations:['Synthetic responses; no human accuracy claim.','Prediction scores do not establish poker profitability.','Confidence-blended probability is an evaluation diagnostic; live policy blends bluff frequencies instead.','No benchmark hand histories or weights are installed into player browser storage.']};
mkdirSync('training/regression-2026-09-25',{recursive:true});writeFileSync('training/regression-2026-09-25/learning.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
