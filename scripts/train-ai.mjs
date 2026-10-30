import { writeFileSync, mkdirSync } from 'node:fs';
import { Poker } from '../engine.js';
import { seededRandom, simulateEquity, preflopStrength } from '../poker-math.js';
import { readObservation, strategicAction, DEFAULT_POLICY } from '../strategy.js';

// Parameter learning from seeded, complete sample games. Not CFR or a GTO solver.
const START = Date.now(), TRAIN_HANDS = 240, HOLDOUT = 1600;
const samples = [], scores = [];
let trainingGames = 0;
function oldAction(obs, random, trials) {
  const o=obs.options, roll=random();
  const eq=simulateEquity({...obs,opponentRanges:[],range:'random'},trials,random).equity;
  const price=o.call/Math.max(1,obs.pot+o.call);
  if(o.owed && eq+.035<price && roll>.04) return {action:'fold'};
  const value=eq>Math.max(.48,1/(obs.opponents+1)+.17);
  const bluff=obs.opponents===1&&eq<.35&&o.call<=obs.pot*.15&&roll<.07;
  if(o.canRaise&&((value&&roll<.8)||bluff)) {
    const fraction=eq>.74?.85:.5+random()*.2;
    return {action:'raise',amount:Math.min(o.max,Math.max(o.min,obs.current+Math.round(Math.max(20,(obs.pot+o.call)*fraction)/10)*10))};
  }
  return {action:'call'};
}
function match(policy, seed, baseline=false, record=false, trials=40) {
  const g=new Poker();g.dealer=seed%4-1;g.start(seededRandom(seed));
  const rngs=Array.from({length:4},(_,i)=>seededRandom(seed*17+i*997));
  const actions=[];let steps=0;
  while(!g.done&&steps++<250) {
    const seat=g.turn,obs=readObservation(g),random=rngs[seat];let d;
    if(seat===0) d=baseline?oldAction(obs,random,trials):strategicAction(obs,policy,random,trials);
    else {
      const type=(seed+seat)%3;
      if(type===0) d=oldAction(obs,random,trials);
      else if(type===1) d={action:obs.options.owed>obs.pot*.85&&preflopStrength(obs.cards)<.45&&random()<.5?'fold':'call'};
      else d=strategicAction(obs,DEFAULT_POLICY,random,trials);
    }
    if(record)actions.push({seat,street:g.stage,pot:g.pot,action:d.action,amount:d.amount??null});
    if(!g.act(d.action,d.amount))throw Error('Illegal generated action');
  }
  if(!g.done)throw Error('Sample hand did not terminate');
  if(g.players.reduce((n,p)=>n+p.stack,0)!==6000)throw Error('Chip conservation failure');
  if(record)samples.push({seed,dealer:g.dealer,board:g.board,actions,result:g.result,heroNet:g.players[0].stack-1000});
  return (g.players[0].stack-1000)/20;
}
function evaluate(policy,offset,count,baseline=false,trials=40) {
  const values=[];
  for(let i=0;i<count;i++)values.push(match(policy,offset+i,baseline,false,trials));
  const mean=values.reduce((a,b)=>a+b,0)/count;
  return {mean,values};
}
const bounds={openEarly:[.48,.76],openLate:[.26,.58],defend:[-.015,.08],value:[.5,.75],aggression:[.45,.95],bluff:[0,.12],size:[.4,.95]};
const random=seededRandom(81926);
let best={...DEFAULT_POLICY};
for(let round=0;round<3;round++) {
  const candidates=[best];
  for(let k=1;k<8;k++) {
    const candidate={...best};
    for(const key of Object.keys(bounds)) {
      const [low,high]=bounds[key],scale=(high-low)*(round===0?.5:.25);
      candidate[key]=Math.round(Math.max(low,Math.min(high,candidate[key]+(random()-.5)*2*scale))*1000)/1000;
    }
    candidates.push(candidate);
  }
  const results=candidates.map((policy,index)=>{
    const result=evaluate(policy,10000+round*1000,TRAIN_HANDS);
    trainingGames+=TRAIN_HANDS;
    console.log(JSON.stringify({phase:'training',round,candidate:index,bbPerHand:+result.mean.toFixed(3)}));
    return {policy,mean:result.mean};
  });
  results.sort((a,b)=>b.mean-a.mean);best=results[0].policy;
  scores.push({round,selected:best,trainingMean:results[0].mean});
}
console.log('Evaluating frozen candidate on held-out games...');
const learned=evaluate(best,900000,HOLDOUT,false,180);
const previous=evaluate(DEFAULT_POLICY,900000,HOLDOUT,true,180);
const differences=learned.values.map((v,i)=>v-previous.values[i]);
const mean=differences.reduce((a,b)=>a+b,0)/HOLDOUT;
const variance=differences.reduce((n,v)=>n+(v-mean)**2,0)/(HOLDOUT-1);
const interval=1.96*Math.sqrt(variance/HOLDOUT);
for(let i=0;i<12;i++)match(best,200000+i,false,true,180);
const report={method:'Seeded complete-game parameter search against a mixture of old-policy, calling and position-aware opponents; no human hand histories.',
 trainingGames,trainingRounds:3,candidatesPerRound:8,trainingRolloutsPerDecision:40,holdoutRolloutsPerDecision:180,
 holdoutGamesPerPolicy:HOLDOUT,holdoutSeedStart:900000,seedSetsDisjoint:true,
 learnedBBPerHand:learned.mean,oldBBPerHand:previous.mean,pairedImprovementBBPerHand:mean,
 pairedImprovement95:[mean-interval,mean+interval],positiveHoldout:mean>0,statisticallyPositive:mean-interval>0,
 parameters:best,search:scores,elapsedSeconds:(Date.now()-START)/1000,
 limitations:['Synthetic opponents only; no guarantee against humans.','Parameter search is not neural-network training or a GTO solver.','Position and range profiles are approximations.'],
 sources:['https://www.pokerstars.com/poker/learn/lesson/pot-odds/','https://www.pokerstars.com/poker/learn/lesson/poker-starting-hands/','https://www.pokerstars.com/poker/learn/strategies/how-to-think-about-hand-ranges-in-poker/','https://www.pokerstars.com/poker/learn/lesson/introduction-to-stack-to-pot-ratio-spr/']};
mkdirSync('training',{recursive:true});writeFileSync('training/report.json',JSON.stringify(report,null,2));
writeFileSync('training/sample-games.json',JSON.stringify(samples,null,2));
writeFileSync('trained-policy.js',`// Learned by scripts/train-ai.mjs; synthetic sample-game parameter search.\nexport const TRAINED_POLICY = ${JSON.stringify(best)};\nexport const TRAINING_SUMMARY = ${JSON.stringify({trainingGames,holdoutGamesPerPolicy:HOLDOUT,learnedBBPerHand:learned.mean,oldBBPerHand:previous.mean,improvement95:report.pairedImprovement95})};\n`);
console.log(JSON.stringify(report,null,2));
