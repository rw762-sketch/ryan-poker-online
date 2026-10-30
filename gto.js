import { inferOpponentRanges } from './range-model.js?v=2faa4b345575';
import { preflopStrength, rankHand, simulateEquity } from './poker-math.js?v=2faa4b345575';
import { boardTexture } from './strategy.js?v=2faa4b345575';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const deck=Array.from({length:52},(_,i)=>({r:2+i%13,s:Math.floor(i/13)}));
const key=c=>c.s*13+c.r;
const same=(a,b)=>a.map(key).sort((x,y)=>x-y).join()===b.map(key).sort((x,y)=>x-y).join();
const combinations=[];
for(let a=0;a<51;a++)for(let b=a+1;b<52;b++)combinations.push([deck[a],deck[b]]);
// Position-based opening frequencies, not copied solver charts for a different format.
export function openingMix(cards,position,opponents=3) {
  const target=opponents===1?.6:position==='late'?.45:position==='middle'?.32:.26;
  const strength=preflopStrength(cards);
  const better=combinations.filter(h=>preflopStrength(h)>strength+1e-9).length;
  const equal=combinations.filter(h=>Math.abs(preflopStrength(h)-strength)<1e-9).length;
  return clamp((target*1326-better)/Math.max(1,equal),0,1);
}
// In the one-bet polar river toy game: bluff:value = bet/(pot+bet).
// This is a range construction budget, never a forced defense frequency.
export function bluffBudget(valueMass,bet,pot,opponents=1,river=true) {
  return valueMass*bet/Math.max(1,pot+bet)*(river?1:.65)/Math.max(1,opponents**2);
}
function blockerScore(cards,board) {
  const counts=[0,0,0,0];board.forEach(c=>counts[c.s]++);
  let score=0;
  for(const c of cards){
    if(c.r===14)score+=1;
    if(counts[c.s]>=3&&c.r===14)score+=4;
    else if(counts[c.s]>=3&&c.r===13)score+=2;
  }
  return score;
}
export function gtoStyle(seat=0) {
  return [
    {name:'Balanced',valueFrequency:.78,size:1,pace:1},
    {name:'Patient',valueFrequency:.74,size:.92,pace:1.12},
    {name:'Pressure',valueFrequency:.82,size:1.08,pace:.9},
    {name:'Tricky',valueFrequency:.76,size:1,pace:1.04},
    {name:'Steady',valueFrequency:.77,size:.96,pace:1.06},
    {name:'Loose',valueFrequency:.8,size:1.04,pace:.94},
  ][Number.isInteger(seat)&&seat>=0&&seat<6?seat:0];
}
// Timing uses public decision complexity only, never hand strength or bluff status.
export function gtoThinkTime(obs,random=Math.random) {
  const complexity=obs.options.owed?Math.min(450,obs.options.call/Math.max(1,obs.pot)*500):0;
  return Math.round((650+random()*950+complexity)*gtoStyle(obs.seat).pace);
}
// Spread a fixed budget across eligible hands, with a soft blocker preference.
// Capping each frequency retains give-ups even for the highest-priority bluff.
export function distributeBluffs(priorities,budget) {
  const frequencies=priorities.map(()=>0),weights=priorities.map(p=>1+.35*Math.max(0,p));
  let remaining=Math.max(0,Math.min(budget,priorities.length*.8));
  let active=priorities.map((_,i)=>i);
  while(remaining>1e-10&&active.length) {
    const total=active.reduce((s,i)=>s+weights[i],0),mass=remaining;
    for(const i of active){const allocated=Math.min(.8-frequencies[i],mass*weights[i]/total);frequencies[i]+=allocated;remaining-=allocated;}
    active=active.filter(i=>frequencies[i]<.8-1e-10);
  }
  return frequencies;
}
export function rangeMix(obs,bet) {
  const used=new Set(obs.board.map(key));
  const cutoff=obs.position==='late'?.31:.42;
  let pool=combinations.filter(h=>h.every(c=>!used.has(key(c)))&&preflopStrength(h)>=cutoff);
  if(!pool.some(h=>same(h,obs.cards)))pool.push(obs.cards);
  const ranked=pool.map(cards=>({cards,rank:rankHand([...cards,...obs.board]),texture:boardTexture(cards,obs.board)})).sort((a,b)=>b.rank-a.rank);
  const valueCut=ranked[Math.floor(ranked.length*.2)].rank;
  const bluffCut=ranked[Math.floor(ranked.length*.55)].rank;
  const valueFrequency=gtoStyle(obs.seat).valueFrequency; // Strong checks protect the checking range.
  // Board-only hands do not count as value combinations on a tied river.
  const boardRank=obs.board.length===5?rankHand(obs.board):-1;
  const values=ranked.filter(h=>h.rank>=valueCut&&h.rank>boardRank);
  const candidates=ranked.filter(h=>h.rank<valueCut&&h.rank<=bluffCut&&
    (obs.board.length===5||h.texture.draw)).map(h=>({...h,priority:(h.texture.draw?4:0)+blockerScore(h.cards,obs.board)}));
  const budget=bluffBudget(values.length*valueFrequency,bet,obs.pot,obs.opponents,obs.board.length===5);
  const own=ranked.find(h=>same(h.cards,obs.cards));
  const bluff=candidates.find(h=>same(h.cards,obs.cards));
  const frequencies=distributeBluffs(candidates.map(h=>h.priority),budget);
  return {value:values.includes(own),valueFrequency,bluffFrequency:bluff?frequencies[candidates.indexOf(bluff)]:0,
    valueCombinations:values.length,bluffMass:frequencies.reduce((sum,p)=>sum+p,0),rangeCombinations:ranked.length};
}
export function gtoDecision(obs,random=Math.random,trials=600) {
  const o=obs.options,roll=random(),call={action:'call'},fold={action:'fold'};
  const style=gtoStyle(obs.seat);
  const analysis={mode:'gto',style:style.name,equity:null,price:o.call/Math.max(1,obs.pot+o.call),ranges:obs.opponentRanges||[],reads:[],position:obs.position,
    approximation:'GTO-inspired range strategy; not a solved full-game equilibrium.'};
  const done=(action,reason)=>({...action,analysis:{...analysis,reason}});
  if(!obs.board.length&&obs.unopened&&!obs.limped&&o.call<obs.stack) {
    const frequency=openingMix(obs.cards,obs.position,obs.opponents);
    analysis.raiseFrequency=frequency;
    if(o.canRaise&&roll<frequency)return done({action:'raise',amount:Math.min(o.max,Math.max(o.min,(obs.bigBlind||20)*(obs.position==='late'?2.5:3)))},`Position-based opening mix: raise ${Math.round(frequency*100)}% of the time with this hand class.`);
    return done(o.owed?fold:call,o.owed?'This hand falls outside the selected opening mix.':'Take the free check outside the opening mix.');
  }
  const inferred=inferOpponentRanges(obs);
  const simulation=simulateEquity(inferred,trials,random),equity=simulation.equity;
  analysis.weightedRangeCombinations=inferred.weightedRanges?.map(range=>range.length)||[];
  analysis.equity=equity;analysis.trials=simulation.trials;
  const terminal=obs.board.length===5||o.call>=obs.stack||obs.effectiveStack===0;
  const usable=equity*(terminal?1:obs.position==='late'?.98:obs.opponents>1?.85:.92);
  analysis.adjustedEquity=usable;
  analysis.callEV=usable*(obs.pot+o.call)-o.call;
  // Pot odds govern defense; MDF is not a universal obligation to call.
  if(o.owed&&analysis.callEV<0&&(!obs.board.length||!o.canRaise))return done(fold,'The estimated call loses chips against the assumed ranges. Fold rather than force a defense target.');
  if(!o.canRaise)return done(call,'Continue at an acceptable price; a raise is unavailable.');
  if(!obs.board.length) {
    if(equity>Math.max(.64,1/(obs.opponents+1)+.28)&&roll<.75)return done({action:'raise',amount:Math.min(o.max,Math.max(o.min,obs.current+Math.round((obs.pot+o.call)*.75)))},'Mix a value re-raise with calls against the opening ranges.');
    return done(call,'Defend the raised pot when estimated equity covers the price.');
  }
  const wet=boardTexture(obs.cards,obs.board).wet, spr=obs.stack/Math.max(1,obs.pot+o.call);
  // Both value and bluff hands use this same public-state sizing distribution.
  const sizeRoll=random();
  const fraction=(spr<1?1:obs.board.length===5?(sizeRoll<.35?.5:.85):wet?(sizeRoll<.35?.55:.8):(sizeRoll<.6?.4:.65))*style.size;
  const amount=Math.min(o.max,Math.max(o.min,obs.current+Math.round(Math.max(20,(obs.pot+o.call)*fraction)/10)*10));
  const risk=amount-obs.bet,mix=rangeMix(obs,risk);
  analysis.mix=mix;analysis.betFraction=risk/Math.max(1,obs.pot);
  const value=mix.value&&equity>Math.max(.62,1/(obs.opponents+1)+.3);
  const texture=boardTexture(obs.cards,obs.board);
  const previousStreet=obs.board.length===5?2:obs.board.length===4?1:0;
  const continuing=(obs.selfLine||[]).some(a=>a.type==='raise'&&a.street===previousStreet);
  const blockers=blockerScore(obs.cards,obs.board);
  const semiBluff=obs.board.length<5&&texture.draw&&equity>=.18&&equity<.65;
  const riverBluff=obs.board.length===5&&equity<.35;
  const bluff=!mix.value&&(semiBluff||riverBluff)&&obs.opponents===1&&o.call<=obs.pot*.35&&obs.effectiveStack!==0;
  // Do not auto-fire every street: continue draws/blockers, give up other weak hands.
  const continuation=continuing?(texture.draw||blockers>=2?.95:.45):1;
  const pressureDiscount=o.owed?.35:1;
  const bluffFrequency=mix.bluffFrequency*continuation*pressureDiscount;
  analysis.bluffKind=bluff?(semiBluff?'semi-bluff':'river bluff'):null;
  analysis.continuing=continuing;
  // A selective semi-bluff raise can be considered even when a passive call loses.
  if(o.owed&&analysis.callEV<0) {
    const canSemiRaise=semiBluff&&bluff&&analysis.price<.23&&equity>.24;
    const frequency=canSemiRaise?Math.min(.12,bluffFrequency):0;
    analysis.raiseFrequency=frequency;
    if(roll<frequency)return done({action:'raise',amount},'Occasionally raise a live draw as a semi-bluff instead of making a losing passive call.');
    return done(fold,'The call is unprofitable and this hand was not selected for the limited semi-bluff raising mix.');
  }
  const frequency=value?mix.valueFrequency:bluff?bluffFrequency:0;
  analysis.raiseFrequency=frequency;
  if(roll<frequency)return done({action:'raise',amount},value?'Bet from the strong part of the assumed range, while retaining some strong checks and calls.':semiBluff?'Semi-bluff a live draw: retain improvement chances when called.':continuing?'Continue the previous-street story with a selected river bluff; other weak hands give up.':'Mix in a river bluff from the weak range, favoring useful blockers.');
  return done(call,value?'This strong hand takes the checking or calling part of its mixed strategy.':o.owed?'Call with sufficient equity; this hand is outside the raising mix.':'Check the middle or unselected weak part of the range.');
}
