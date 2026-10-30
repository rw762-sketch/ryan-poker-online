import { describeHand, compareHandsText } from './hand-description.js?v=6979f681616d';
export const SEATS=6;
export const SEAT_NAMES=['You','Jules','Morgan','Alex','Riley','Sam'];
export const labels=['High card','One pair','Two pair','Three of a kind','Straight','Flush','Full house','Four of a kind','Straight flush'];
export function compare(a,b){for(let i=0;i<Math.max(a.length,b.length);i++){let d=(a[i]||0)-(b[i]||0);if(d)return d;}return 0;}
function five(cards){const ranks=cards.map(c=>c.r).sort((a,b)=>b-a),counts={};ranks.forEach(r=>counts[r]=(counts[r]||0)+1);const g=Object.entries(counts).map(([r,n])=>({r:+r,n})).sort((a,b)=>b.n-a.n||b.r-a.r);const flush=cards.every(c=>c.s===cards[0].s);let straight=0;if(g.length===5){if(ranks[0]-ranks[4]===4)straight=ranks[0];else if(ranks.join()==='14,5,4,3,2')straight=5;}if(flush&&straight)return[8,straight];if(g[0].n===4)return[7,g[0].r,g[1].r];if(g[0].n===3&&g[1].n===2)return[6,g[0].r,g[1].r];if(flush)return[5,...ranks];if(straight)return[4,straight];if(g[0].n===3)return[3,...g.map(x=>x.r)];if(g[0].n===2&&g[1].n===2)return[2,...g.map(x=>x.r)];if(g[0].n===2)return[1,...g.map(x=>x.r)];return[0,...ranks];}
export function evaluate(cards){let best=[-1];for(let a=0;a<cards.length-4;a++)for(let b=a+1;b<cards.length-3;b++)for(let c=b+1;c<cards.length-2;c++)for(let d=c+1;d<cards.length-1;d++)for(let e=d+1;e<cards.length;e++){let v=five([cards[a],cards[b],cards[c],cards[d],cards[e]]);if(compare(v,best)>0)best=v;}return best;}
export class Poker{
constructor(){this.players=SEAT_NAMES.map(name=>({name,stack:1000,cards:[],folded:false,bet:0,total:0,action:''}));this.dealer=-1;this.hand=0;this.logs=[];this.done=true;this.board=[];this.pot=0;this.awards=[];this.pots=[];}
log(s){this.logs.unshift(s);this.logs=this.logs.slice(0,70);}
next(i,fn=p=>p.stack>0){const n=this.players.length;for(let j=1;j<=n;j++){let k=(i+j)%n;if(fn(this.players[k]))return k;}return -1;}
pay(i,n){let p=this.players[i],amount=Math.min(n,p.stack);p.stack-=amount;p.bet+=amount;p.total+=amount;this.pot+=amount;if(amount>0&&!p.stack)p.allIn=true;return amount;}
start(shuffleRandom){if(this.players.filter(p=>p.stack>0).length<2)return false;this.hand++;this.awards=[];this.pots=[];this.result='';this.done=false;this.board=[];this.pot=0;this.stage=0;this.current=20;this.minRaise=20;this.acted=new Set();this.raiseAt={};this.deck=[];for(let s=0;s<4;s++)for(let r=2;r<=14;r++)this.deck.push({r,s});for(let i=51;i>0;i--){let j;if(shuffleRandom){j=Math.floor(shuffleRandom()*(i+1));}else{const a=new Uint32Array(1);globalThis.crypto.getRandomValues(a);j=a[0]%(i+1);}[this.deck[i],this.deck[j]]=[this.deck[j],this.deck[i]];}this.players.forEach(p=>{p.allIn=false;p.folded=p.stack===0;p.bet=p.total=0;p.action=p.folded?'Out of chips':'';p.cards=p.folded?[]:[this.deck.pop(),this.deck.pop()];if(!p.folded)p.dealt=(p.dealt||0)+1;});this.dealer=this.next(this.dealer);let heads=this.players.filter(p=>!p.folded).length===2;let sb=heads?this.dealer:this.next(this.dealer),bb=this.next(sb);this.pay(sb,10);this.pay(bb,20);this.players[sb].action='Small blind';this.players[bb].action='Big blind';this.turn=this.next(bb,p=>!p.folded&&p.stack>0);this.log(`Hand ${this.hand} · ${this.players[this.dealer].name} deals.`);this.advance(false);return true;}
options(){let p=this.players[this.turn];if(!p||this.done)return{};let call=Math.max(0,this.current-p.bet),max=p.bet+p.stack;return{call:Math.min(call,p.stack),owed:call,min:Math.min(max,this.current+this.minRaise),max,canRaise:max>this.current&&(this.raiseAt[this.turn]===undefined||this.current-this.raiseAt[this.turn]>=this.minRaise)&&this.players.some((q,i)=>i!==this.turn&&!q.folded&&q.stack>0)};}
act(type,amount){if(this.done)return false;const i=this.turn,p=this.players[i],o=this.options();if(type==='allin'){if(o.owed>=p.stack)type='call';else if(o.canRaise){type='raise';amount=o.max;}else return false;}if(!['fold','call','raise'].includes(type))return false;if(type==='raise'&&(!o.canRaise||!Number.isInteger(amount)||amount<o.min||amount>o.max))return false;if(type==='fold'){p.folded=true;p.action='Fold';}else if(type==='call'){let paid=this.pay(i,o.owed);p.action=paid?`Call ${paid}`:'Check';}else{let increase=amount-this.current;this.pay(i,amount-p.bet);if(increase>=this.minRaise){this.minRaise=increase;this.acted.clear();this.raiseAt={};}this.current=amount;p.action=`Raise to ${amount}`;}if(!p.stack&&!p.folded){p.action+=' · All in';if(type==='raise')p.shoves=(p.shoves||0)+1;}this.acted.add(i);this.raiseAt[i]=this.current;this.log(`${p.name}: ${p.action}.`);this.advance(true);return true;}
advance(move){let live=this.players.filter(p=>!p.folded);if(live.length===1){live[0].stack+=this.pot;this.awards=[{seat:this.players.indexOf(live[0]),amount:this.pot,profit:this.pot-live[0].total,allIn:!!live[0].allIn}];this.result=`${live[0].name} wins ${this.pot} chips. Everyone else folded.`;this.finish();return;}let needs=(p,i)=>!p.folded&&p.stack>0&&(!this.acted.has(i)||p.bet<this.current);const active=live.filter(p=>p.stack>0);if(active.length<=1&&active.every(p=>p.bet>=this.current)){while(this.board.length<5)this.board.push(this.deck.pop());this.showdown();return;}if(!this.players.some(needs)){if(this.stage===3){this.showdown();return;}this.stage++;this.deck.pop();for(let n=0;n<(this.stage===1?3:1);n++)this.board.push(this.deck.pop());this.players.forEach(p=>{p.bet=0;if(!p.folded)p.action=p.stack?'':'All in';});this.current=0;this.minRaise=20;this.acted.clear();this.raiseAt={};this.turn=this.next(this.dealer,p=>!p.folded&&p.stack>0);this.log(['','Flop','Turn','River'][this.stage]+' dealt.');return;}if(move||!needs(this.players[this.turn],this.turn))this.turn=this.next(this.turn,(p)=>needs(p,this.players.indexOf(p)));}
showdown() {
  this.stage = 4;
  this.pots = [];
  const levels = [...new Set(this.players.map(p => p.total).filter(Boolean))].sort((a,b) => a-b);
  let previous = 0, potNumber = 0;
  const winnings = new Map(), explanations = [];
  for (const level of levels) {
    const contributors = this.players.filter(p => p.total >= level);
    const amount = (level - previous) * contributors.length;
    previous = level;
    const eligible = contributors.filter(p => !p.folded);
    if (!eligible.length) continue;
    const scores = eligible.map(p => ({ p, v: evaluate([...p.cards, ...this.board]) }))
      .sort((a,b) => compare(b.v, a.v));
    const winners = scores.filter(x => compare(x.v, scores[0].v) === 0).map(x => x.p);
    winners.sort((a,b) => ((this.players.indexOf(a)-this.dealer-1+this.players.length)%this.players.length)-((this.players.indexOf(b)-this.dealer-1+this.players.length)%this.players.length));
    this.pots.push({ amount, eligible:eligible.map(p => this.players.indexOf(p)), winners:winners.map(p => this.players.indexOf(p)), refund:contributors.length === 1 });
    winners.forEach((p,i) => {
      const share = Math.floor(amount/winners.length) + (i < amount%winners.length ? 1 : 0);
      p.stack += share;
      winnings.set(p, (winnings.get(p) || 0) + share);
    });
    if (contributors.length === 1) {
      explanations.push(`${winners[0].name} gets ${amount} uncalled chips back.`);
      continue;
    }
    const potName = levels.length === 1 ? 'the pot' : potNumber === 0 ? 'the main pot' : `side pot ${potNumber}`;
    potNumber++;
    const names = winners.map(p => p.name).join(' and ');
    const losers = scores.filter(x => !winners.includes(x.p));
    if (winners.length > 1) {
      explanations.push(`${names} split ${potName} (${amount} chips): the same best five-card hand, ${describeHand(scores[0].v)}.${losers.length ? ' This beats ' + losers.map(x => `${x.p.name}’s ${describeHand(x.v)}`).join(' and ') + '.' : ''}`);
    } else if (!losers.length) {
      explanations.push(`${names} wins ${potName} (${amount} chips): everyone else in this pot folded.`);
    } else {
      explanations.push(`${names} wins ${potName} (${amount} chips): ` + losers.map(x => `${compareHandsText(scores[0].v, x.v)} (${x.p.name})`).join('; ') + '.');
    }
  }
  this.players.forEach(p => { if (!p.folded) p.action = labels[evaluate([...p.cards, ...this.board])[0]]; });
  this.awards = [...winnings].map(([p,n]) => ({ seat:this.players.indexOf(p), amount:n, profit:n-p.total, allIn:!!p.allIn }));
  this.result = explanations.join(' ');
  this.finish();
}
finish(){this.done=true;this.log(this.result);}
}
