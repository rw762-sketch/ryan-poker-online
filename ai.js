import { gtoDecision } from './gto.js?v=6979f681616d';
import { learnBluffPolicy } from './opponent-model.js?v=6979f681616d';
import { adaptStrategy } from './player-memory.js?v=6979f681616d';
import { evaluate } from './engine.js?v=6979f681616d';
import { simulateEquity } from './poker-math.js?v=6979f681616d';
import { readObservation, strategicAction, DEFAULT_POLICY, boardTexture } from './strategy.js?v=6979f681616d';
import { TRAINED_POLICY } from './trained-policy.js?v=6979f681616d';
import { chooseNeuralDecision, SEAT_PERSONAS } from './neural-policy.js?v=6979f681616d';
export const DIFFICULTIES = {
  gto: { name:'GTO', description:'Expert play · GTO-inspired.' },
  easy: { name:'Easy', description:'A relaxed table.' },
  medium: { name:'Medium', description:'A steady challenge.' },
  hard: { name:'Hard', description:'The strongest hand-built bots (GTO merged in).' },
  neural: { name:'Neural', description:'Trained neural net · every bot has its own style.' },
  live: { name:'Live AI', description:'LLM players who talk at the table.' },
};
export const normalizeDifficulty = value => Object.hasOwn(DIFFICULTIES, value) ? value : 'medium';
export function botObservation(game, memory) {
  const obs=readObservation(game);
  if (!memory) return obs;
  const seats=game.players.flatMap((p,i)=>i!==game.turn&&!p.folded?[i]:[]);
  // Predictions describe a hypothetical legal heads-up bet, using only public state.
  const opponent=game.players[seats[0]];
  const predictions={};
  if(seats.length===1&&obs.options.canRaise&&obs.board.length) {
    for(const fraction of [.33,.5,.65,.8,1]) {
      const amount=Math.min(obs.options.max,Math.max(obs.options.min,obs.current+Math.round(Math.max(20,(obs.pot+obs.options.call)*fraction)/10)*10));
      const added=amount-obs.bet,call=Math.min(opponent.stack,Math.max(0,amount-opponent.bet));
      const context={street:game.stage,price:call/Math.max(1,obs.pot+added+call),spr:opponent.stack/Math.max(20,obs.pot+added),opponents:1};
      predictions[fraction]={...memory.predictFold(seats[0],context),riskFraction:added/Math.max(1,obs.pot),fraction};
    }
  }
  return {...obs,seat:game.turn,selfLine:memory.line(game.turn),foldPredictions:predictions,opponentProfiles:seats.map(i=>memory.profile(i)),opponentLines:seats.map(i=>memory.line(i))};
}
export function estimateEquity(observation, trials, random = Math.random) {
  return simulateEquity(observation, trials, random).equity;
}
export function chooseBotDecision(obs, difficulty = 'medium', random = Math.random) {
  const level = normalizeDifficulty(difficulty);
  if(level==='gto')return gtoDecision(obs,random);
  // Live AI falls back to the neural bots whenever the server is unavailable.
  if(level==='neural'||level==='live')return chooseNeuralDecision(obs,{persona:obs.style||SEAT_PERSONAS[obs.seat]||'shark',random});
  if (level !== 'easy') {
    const base={...(level==='hard'?TRAINED_POLICY:DEFAULT_POLICY)};
    // Distinct tendencies remain small; every bot responds to the same public evidence.
    if(level==='hard'&&obs.seat===1){base.defend+=.01;base.size-=.05;}
    if(level==='hard'&&obs.seat===2){base.openLate-=.02;base.size+=.05;}
    const adapted=adaptStrategy(obs,base,level==='hard'?1:.5);
    let machineLearning=null;
    if(level==='hard'&&obs.opponents===1&&obs.board.length&&obs.options.canRaise) {
      const wet=boardTexture(obs.cards,obs.board).wet;
      const intended=wet?adapted.policy.size:Math.max(.33,adapted.policy.size-.15);
      const candidates=Object.values(obs.foldPredictions||{});
      machineLearning=candidates.sort((a,b)=>Math.abs(a.fraction-intended)-Math.abs(b.fraction-intended))[0]||null;
      if(machineLearning)adapted.policy=learnBluffPolicy(adapted.policy,machineLearning,machineLearning.riskFraction);
    }
    const analysis={machineLearning,policy:adapted.policy,reads:obs.opponentProfiles||[],position:obs.position};
    const action=strategicAction(adapted.observation,adapted.policy,random,level==='hard'?360:100,undefined,analysis);
    return {...action,analysis};
  }
  const o = obs.options, roll = random();
  const pair = obs.cards[0].r === obs.cards[1].r;
  const made = obs.board.length >= 3 ? evaluate([...obs.cards, ...obs.board])[0] : 0;
  if (o.owed && o.call > obs.pot * .8 && !pair && made < 2 && roll < .45) return { action:'fold' };
  if (o.canRaise && (pair || made >= 2) && roll > .85) return { action:'raise', amount:Math.min(o.max, Math.max(o.min, obs.current + Math.max(20, Math.round((obs.pot + o.call) * .3 / 10) * 10))) };
  return { action:'call' };
}

export function chooseBotAction(obs,difficulty='medium',random=Math.random){ const {action,amount}=chooseBotDecision(obs,difficulty,random); return amount===undefined?{action}:{action,amount}; }
