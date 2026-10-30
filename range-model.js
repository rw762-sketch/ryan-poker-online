import {preflopStrength,rankHand} from './poker-math.js?v=1c7d05e7291b';
import {boardTexture} from './strategy.js?v=1c7d05e7291b';
import {RANGE_ACTION_COUNTS,RANGE_BACKOFF_COUNTS} from './range-model-data.js?v=1c7d05e7291b';
export function handFeatures(cards,board=[]) {
 if(!board.length){const strength=preflopStrength(cards);return {bucket:strength<.3?0:strength<.45?1:strength<.6?2:strength<.75?3:4,draw:0};}
 const category=Math.floor(rankHand([...cards,...board])/15**5),boardCategory=Math.floor(rankHand(board)/15**5);
 const pocket=cards[0].r===cards[1].r,matched=cards.some(c=>board.some(b=>b.r===c.r));
 let bucket=category>=4?4:category>=2?3:category===1?1:0;
 if(category===1&&((pocket&&cards[0].r>=Math.max(...board.map(c=>c.r)))||cards.some(c=>c.r===Math.max(...board.map(b=>b.r)))))bucket=2;
 if(category===boardCategory&&!pocket&&!matched)bucket=category>=4?(board.length===5&&rankHand([...cards,...board])===rankHand(board)?0:4):0;
 return {bucket,draw:boardTexture(cards,board).draw?1:0};
}
export function actionClass(action){return action.type==='fold'?0:action.type==='raise'?(action.size>.75?3:2):1;}
export function featureKeys(cards,board,action,features=handFeatures(cards,board)){
 const {bucket,draw}=features,street=action.street,price=action.context?.price||0;
 const faced=action.faced?1:0,priceBand=!faced?0:price<.2?1:price<.34?2:3;
 return {key:`${street}:${priceBand}:${bucket}:${draw}`,backoff:`${street}:${faced}:${bucket}:${draw}`};
}
export function actionLikelihood(cards,board,action,counts=RANGE_ACTION_COUNTS,backoffs=RANGE_BACKOFF_COUNTS,features){
 const {key,backoff}=featureKeys(cards,board,action,features),kind=actionClass(action);
 const prior=action.faced?[.25,.5,.17,.08]:[0,.7,.2,.1];
 const parent=backoffs[backoff]||[0,0,0,0],parentN=parent.reduce((s,n)=>s+n,0);
 const base=(parent[kind]+20*prior[kind])/(parentN+20);
 const cell=counts[key]||[0,0,0,0],n=cell.reduce((s,x)=>s+x,0);
 return Math.max(.005,(cell[kind]+30*base)/(n+30));
}
// All combinations use only the observer's own cards, public board, and public actions.
export function inferRange(cards,board,line=[],counts=RANGE_ACTION_COUNTS,backoffs=RANGE_BACKOFF_COUNTS){
 const used=new Set([...cards,...board].map(c=>c.s*13+c.r)),deck=[];
 for(let s=0;s<4;s++)for(let r=2;r<=14;r++)if(!used.has(s*13+r))deck.push({r,s});
 const evidence=line.filter(a=>a&&Number.isInteger(a.street)&&a.street>=0&&a.street<=3&&['fold','call','check','raise'].includes(a.type)).slice(-10);
 const range=[];let sum=0;
 for(let i=0;i<deck.length-1;i++)for(let j=i+1;j<deck.length;j++){
  const hand=[deck[i],deck[j]],featuresByStreet={};let logWeight=0;
  for(const action of evidence){const n=action.street===0?0:action.street+2;const publicBoard=board.slice(0,n);if(publicBoard.length!==n)continue;logWeight+=.65*Math.log(actionLikelihood(hand,publicBoard,action,counts,backoffs,featuresByStreet[action.street]??=handFeatures(hand,publicBoard)));}
  const weight=Math.exp(logWeight);range.push({cards:hand,weight});sum+=weight;
 }
 // Retain an explicit uncertainty component instead of ruling out rare bluffs.
 for(const candidate of range)candidate.weight=.9*candidate.weight/sum+.1/range.length;
 return range;
}
export function inferOpponentRanges(obs){
 if(!obs.opponentLines?.some(line=>line.length))return obs;
 return {...obs,weightedRanges:Array.from({length:obs.opponents},(_,i)=>inferRange(obs.cards,obs.board,obs.opponentLines[i]||[]))};
}
