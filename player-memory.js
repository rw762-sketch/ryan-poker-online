import { OpponentModel, validContext } from './opponent-model.js?v=6979f681616d';
// Public-action learning only: this module never reads cards or the deck.
const LIMIT = 120;
const blank = () => ({ hands:0, vpip:0, pfr:0, faced:0, folds:0, post:0, bets:0, calls:0, sizeTotal:0, sized:0 });
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
export class PlayerMemory {
  constructor(saved) {
    this.history = [];
    this.current = null;
    this.models = new Map();
    if (saved?.version === 1 && Array.isArray(saved.history)) {
      for (const hand of saved.history.slice(-LIMIT)) {
        if (Array.isArray(hand.seats) && hand.seats.every(s=>Number.isInteger(s)&&s>=0&&s<6) && Array.isArray(hand.actions) && hand.actions.length<=200 && hand.actions.every(validAction)) {
          this.history.push({seats:[...new Set(hand.seats)], actions:hand.actions.map(a=>({...a}))});
        }
      }
    }
  }
  begin(game) {
    this.current = { seats:game.players.flatMap((p,i)=>p.folded?[]:[i]), actions:[] };
  }
  capture(game, type, amount) {
    const o=game.options(), p=game.players[game.turn];
    if(type==='allin'){type=o.owed>=p.stack?'call':'raise';amount=o.max;}
    return {seat:game.turn,street:game.stage,type:type==='call'&&!o.owed?'check':type,
      faced:o.owed>0, size:type==='raise'?(amount-game.current)/Math.max(20,game.pot+o.call):0,
      chips:type==='raise'?amount-p.bet:type==='call'?o.call:0,
      context:{street:game.stage,price:o.call/Math.max(1,game.pot+o.call),spr:p.stack/Math.max(20,game.pot),opponents:game.players.filter((other,i)=>i!==game.turn&&!other.folded).length}};
  }
  record(action) {
    if(this.current && validAction(action) && this.current.actions.length<200) this.current.actions.push({...action});
  }
  finish() {
    if(!this.current)return;
    this.models.clear();
    this.history.push(this.current);this.history=this.history.slice(-LIMIT);this.current=null;
  }
  model(seat) {
    if(!this.models.has(seat)) {
      const examples=this.history.flatMap(hand=>hand.actions.filter(a=>a.seat===seat&&a.faced&&validContext(a.context)).map(a=>({context:a.context,fold:a.type==='fold'?1:0})));
      this.models.set(seat,new OpponentModel(examples));
    }
    return this.models.get(seat);
  }
  predictFold(seat, context) {
    const prediction=this.model(seat).predict(context);
    if(this.history.filter(h=>h.seats.includes(seat)).length<8)prediction.confidence=0;
    return prediction;
  }
  profile(seat) {
    const stats=blank();
    this.history.forEach((hand,index)=>{
      if(!hand.seats.includes(seat))return;
      const weight=.985**(this.history.length-1-index), actions=hand.actions.filter(a=>a.seat===seat);
      stats.hands+=weight;
      if(actions.some(a=>a.street===0&&['call','raise'].includes(a.type)))stats.vpip+=weight;
      if(actions.some(a=>a.street===0&&a.type==='raise'))stats.pfr+=weight;
      for(const a of actions) {
        if(a.faced){stats.faced+=weight;if(a.type==='fold')stats.folds+=weight;}
        if(a.street>0){stats.post+=weight;if(a.type==='raise')stats.bets+=weight;if(a.type==='call')stats.calls+=weight;}
        if(a.type==='raise'){stats.sized+=weight;stats.sizeTotal+=Math.min(3,a.size)*weight;}
      }
    });
    const hands=this.history.filter(h=>h.seats.includes(seat)).length;
    // Priors and a minimum history keep one unusual hand from defining a player.
    const vpip=(stats.vpip+3)/(stats.hands+10), pfr=(stats.pfr+1.8)/(stats.hands+10);
    const fold=(stats.folds+3.6)/(stats.faced+8), aggression=(stats.bets+2.5)/(stats.post+10);
    const confidence=hands<8?0:clamp((stats.hands-5)/30,0,1);
    const label=!confidence?'Learning':fold>.62?'Folds often':vpip>.48&&aggression<.26?'Calls often':aggression>.4||pfr>.38?'Aggressive':vpip<.24?'Selective':'Balanced';
    return {hands,vpip,pfr,fold,aggression,confidence,label,
      foldConfidence:confidence*Math.min(1,stats.faced/15),
      aggressionConfidence:confidence*Math.min(1,stats.post/20),
      averageSize:(stats.sizeTotal+1.3)/(stats.sized+2)};
  }
  line(seat) { return (this.current?.actions||[]).filter(a=>a.seat===seat).slice(-12).map(a=>({...a})); }
  save() { return {version:1,history:this.history}; }
}
function validAction(a) {
  return a && Number.isInteger(a.seat)&&a.seat>=0&&a.seat<6&&Number.isInteger(a.street)&&a.street>=0&&a.street<=3&&
    ['fold','call','check','raise'].includes(a.type)&&typeof a.faced==='boolean'&&Number.isFinite(a.size)&&a.size>=0&&a.size<=100000&&Number.isFinite(a.chips)&&a.chips>=0&&a.chips<=10000000&&(a.context===undefined||validContext(a.context));
}
export function adaptStrategy(obs, base, strength=1) {
  const p={...base}, profiles=obs.opponentProfiles||[];
  if(!profiles.length)return {observation:obs,policy:p};
  const ranges=[...obs.opponentRanges];
  let sticky=0, folds=0, pressure=0, cautious=0;
  profiles.forEach((profile,i)=>{
    const c=profile.confidence*strength, line=obs.opponentLines?.[i]||[];
    const latest=line.at(-1), raising=latest?.type==='raise';
    if(c>.15) {
      if(raising) {
        if(profile.pfr>.38 || (latest.street>0&&profile.aggression>.4&&profile.aggressionConfidence>.15))ranges[i]='loose';
        else if(profile.pfr<.18 && (latest.street===0||profile.aggression<.22))ranges[i]='tight';
      } else if(profile.vpip>.48)ranges[i]='loose';
      else if(profile.vpip<.24&&ranges[i]!=='random')ranges[i]='tight';
      // Multiple barrels remain meaningful even for an active player.
      if(new Set(line.filter(a=>a.type==='raise'&&a.street>0).map(a=>a.street)).size>=2&&ranges[i]==='loose')ranges[i]='standard';
    }
    sticky+=clamp((profile.vpip-.35)*2,0,1)*(1-profile.fold)*c;
    folds+=clamp((profile.fold-.45)*3,0,1)*profile.foldConfidence*strength;
    pressure+=clamp((profile.aggression-.3)*2,0,1)*profile.aggressionConfidence*strength;
    if(raising&&latest.street>=2&&profile.aggression<.22)cautious+=c*.03;
  });
  const n=profiles.length;sticky/=n;folds/=n;pressure/=n;
  p.size=clamp(p.size+.25*sticky-.12*folds,.35,1);
  p.value=clamp(p.value-.06*sticky,.48,.75);
  p.valueMargin=clamp(.24-.07*sticky,.16,.24);
  p.bluff=clamp(p.bluff*(1-.8*sticky)+.13*folds,0,.16);
  p.aggression=clamp(p.aggression+.08*sticky,0,1);
  p.defend=clamp(p.defend-.025*pressure+cautious,0,.13);
  p.openLate=clamp(p.openLate-.06*folds,.28,.55);
  return {observation:{...obs,opponentRanges:ranges},policy:p};
}
