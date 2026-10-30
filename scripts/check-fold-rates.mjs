import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const root=resolve(process.argv[2]||'.');
const {Poker}=await import(pathToFileURL(root+'/engine.js'));
const {chooseBotDecision,botObservation}=await import(pathToFileURL(root+'/ai.js'));
const {PlayerMemory}=await import(pathToFileURL(root+'/player-memory.js'));
const {seededRandom}=await import(pathToFileURL(root+'/poker-math.js'));
const results=[];
for(const style of ['min-raise','half-pot','caller']){
 const m=new PlayerMemory();let faced=0,folded=0,showdowns=0,preFaced=0,preFold=0;const reasons={};
 for(let h=0;h<300;h++){
  const g=new Poker();g.dealer=h%4-1;g.start(seededRandom(87000+h));m.begin(g);const rng=seededRandom(97000+h);let actions=0;
  while(!g.done&&actions++<200){
   const obs=botObservation(g,m);let d;
   if(g.turn===0){const o=obs.options;d={action:'call'};if(style!=='caller'&&o.canRaise&&rng()<.7)d={action:'raise',amount:style==='min-raise'?o.min:Math.min(o.max,Math.max(o.min,g.current+Math.round((g.pot+o.call)*.5)))};}
   else {d=chooseBotDecision(obs,'hard',rng);if(obs.options.owed){faced++;if(!g.stage)preFaced++;if(d.action==='fold'){folded++;if(!g.stage)preFold++;const key=d.analysis.reason;reasons[key]=(reasons[key]||0)+1;}}}
   const e=m.capture(g,d.action,d.amount);if(!g.act(d.action,d.amount))throw Error('Invalid action');m.record(e);
  }
  if(!g.done)throw Error('Unfinished hand');if(g.players.reduce((s,p)=>s+p.stack,0)!==6000)throw Error('Chip loss');
  m.finish();if(g.stage===4)showdowns++;
 }
 results.push({style,hands:300,facingBets:faced,folded,foldRate:+(folded/faced).toFixed(3),preflopFoldRate:+(preFold/preFaced).toFixed(3),showdowns,reasons});
}
console.log(JSON.stringify(results,null,2));
