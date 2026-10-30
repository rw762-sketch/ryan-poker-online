import {Poker} from './engine.js?v=1c7d05e7291b';
import {PlayerMemory} from './player-memory.js?v=1c7d05e7291b';
import {botObservation,chooseBotDecision} from './ai.js?v=1c7d05e7291b';
export const BOT_NAMES=['Sage','Jules','Morgan','Alex','Riley','Sam'];
export class Arena {
 constructor(random=Math.random){this.random=random;this.reset();}
 reset(){this.memory=new PlayerMemory();this.decisions=[];this.match=0;this.newMatch();}
 newMatch(){this.game=new Poker();this.game.players.forEach((p,i)=>p.name=BOT_NAMES[i]);this.match++;this.history=[{hand:0,stacks:BOT_NAMES.map(()=>1000)}];this.nextHand();}
 nextHand(){if(!this.game.done)return false;if(!this.game.start(this.random))return false;this.memory.begin(this.game);if(this.game.done)this.complete();return true;}
 complete(){this.memory.finish();this.history.push({hand:this.game.hand,stacks:this.game.players.map(p=>p.stack)});}
 step(){
  if(this.game.done)return this.nextHand();
  const g=this.game,seat=g.turn,obs=botObservation(g,this.memory),decision=chooseBotDecision(obs,'hard',this.random);
  const event=this.memory.capture(g,decision.action,decision.amount);
  const snapshot={seat,name:g.players[seat].name,hand:g.hand,match:this.match,street:g.stage,cards:obs.cards,board:obs.board,
   opponents:g.players.flatMap((p,i)=>i!==seat&&!p.folded?[BOT_NAMES[i]]:[]),pot:g.pot,toCall:obs.options.call,decision,analysis:decision.analysis};
  if(!g.act(decision.action,decision.amount))throw Error('The bot attempted an invalid move.');
  this.memory.record(event);this.decisions.push(snapshot);this.decisions=this.decisions.slice(-100);
  if(g.done)this.complete();return snapshot;
 }
}
