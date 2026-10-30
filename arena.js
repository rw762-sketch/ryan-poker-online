import {Arena,BOT_NAMES} from './arena-model.js?v=1512f49c5b0b';
import {tableSnapshot,animateTable} from './motion.js?v=1512f49c5b0b';
const $=id=>document.getElementById(id), arena=new Arena();
const colors=['#76d3b0','#f2c46b','#85b5ef','#cd9ee9','#f08c6c','#9ad06a'];
const streets=['Pre-flop','Flop','Turn','River','Showdown'];
let running=false,timer=null,selected=null,frame=null;
function card(c,hidden=false){
 if(hidden)return '<div class="card back" aria-label="Hidden card"></div>';
 if(!c)return '<div class="card empty"></div>';
 const rank=({11:'J',12:'Q',13:'K',14:'A'})[c.r]||c.r,suit=['♠','♥','♣','♦'][c.s];
 return `<div class="card ${c.s%2?'red':''}" aria-label="${rank} ${['spades','hearts','clubs','diamonds'][c.s]}"><span>${rank}</span><span class="suit">${suit}</span></div>`;
}
function actionText(s){const d=s.decision;return d.action==='raise'?`Raise to ${d.amount}`:d.action==='fold'?'Fold':s.toCall?`Call ${s.toCall}`:'Check';}
function stop(){running=false;clearTimeout(timer);timer=null;}
function render(){
 const g=arena.game,reveal=$('reveal').checked;
 $('handNo').textContent=`MATCH ${arena.match} · HAND ${g.hand}`;
 $('street').textContent=g.done?'Hand complete':streets[g.stage];$('pot').textContent=g.pot.toLocaleString();
 $('board').innerHTML=Array.from({length:5},(_,i)=>card(g.board[i])).join('');
 $('seats').innerHTML=g.players.map((p,i)=>`<div class="seat seat-${i} ${!g.done&&g.turn===i?'active':''} ${p.folded?'folded':''}">${i?`<div class="avatar" style="color:${colors[i]}">${p.name[0]}</div>`:''}<div class="cards">${p.cards.map(c=>card(c,!reveal&&!(g.done&&g.stage===4&&!p.folded))).join('')}</div><div class="nameplate"><div class="player-name">${p.name}${g.dealer===i?'<span class="badge" title="Dealer">D</span>':''}</div><div class="stack">${p.stack.toLocaleString()}</div></div><div class="player-action">${p.action||' '}</div></div>`).join('');
 const next=tableSnapshot(g);animateTable(frame,next);frame=next;
 const finished=g.done&&g.players.filter(p=>p.stack>0).length<2;
 $('play').textContent=running?'Pause':'Play';$('play').disabled=finished;$('step').disabled=finished;
 $('nextHand').disabled=!g.done||finished;$('newMatch').hidden=!finished;
 $('arenaStatus').textContent=g.done?g.result+(finished?' Match complete. Start a new match.':running?' Next hand shortly.':' Select Next hand to continue.'):`${running?'Playing':'Paused'} · ${g.players[g.turn].name} is next.`;
 $('readRows').innerHTML=g.players.map((p,i)=>{return `<tr><th scope="row"><span class="bot-dot" style="background:${colors[i]}"></span>${p.name}</th><td>${g.hand}</td><td>${p.stack.toLocaleString()}</td></tr>`;}).join('');
 $('timeline').replaceChildren(...arena.decisions.slice().reverse().map(s=>{const li=document.createElement('li'),b=document.createElement('button'),meta=document.createElement('small');meta.textContent=`Match ${s.match} · Hand ${s.hand} · ${streets[s.street]}`;b.append(meta,`${s.name} — ${actionText(s)}`);b.setAttribute('aria-pressed',String(selected===s));b.onclick=()=>{stop();selected=s;render();};li.append(b);return li;}));
 renderDecision();renderChart();
}
function renderDecision(){
 $('decisionEmpty').hidden=!!selected;$('decisionContent').hidden=!selected;
 if(!selected){$('decisionTitle').textContent='Ready to observe.';return;}
 const s=selected;
 $('decisionTitle').textContent=`${s.name} · ${actionText(s)}`;
 $('decisionContext').textContent=`Match ${s.match}, hand ${s.hand} · ${streets[s.street]} · Pot ${s.pot} · ${s.toCall} to call`;
 $('decisionCards').innerHTML=s.cards.map(c=>card(c,!$('reveal').checked)).join('');

}
function renderChart(){
 const data=arena.history,w=480,h=180,left=35,right=12,top=14,bottom=28,max=Math.max(1200,...data.flatMap(x=>x.stacks));
 const x=i=>left+i/Math.max(1,data.length-1)*(w-left-right),y=n=>h-bottom-n/max*(h-top-bottom);
 let svg=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Chip stacks after ${data.length-1} completed hands. Current stacks are listed in the table below.">`;
 for(const v of [0,max/2,max])svg+=`<line x1="${left}" y1="${y(v)}" x2="${w-right}" y2="${y(v)}" stroke="#304047"/><text x="${left-6}" y="${y(v)+4}" text-anchor="end" font-size="10" fill="#a2afb6">${Math.round(v)}</text>`;
 BOT_NAMES.forEach((name,seat)=>{svg+=`<polyline fill="none" stroke="${colors[seat]}" stroke-width="2" points="${data.map((d,i)=>`${x(i)},${y(d.stacks[seat])}`).join(' ')}"/><circle cx="${x(data.length-1)}" cy="${y(data.at(-1).stacks[seat])}" r="3" fill="${colors[seat]}"/>`;});
 svg+=`<text x="${left}" y="${h-7}" fill="#a2afb6" font-size="11">Start</text><text x="${w-right}" y="${h-7}" text-anchor="end" fill="#a2afb6" font-size="11">Hand ${data.at(-1).hand}</text></svg><div class="chart-legend">${BOT_NAMES.map((n,i)=>`<span><span class="bot-dot" style="background:${colors[i]}"></span>${n}</span>`).join('')}</div>`;
 $('chipChart').innerHTML=svg;
}
function advance(){try{const result=arena.step();if(!result){stop();render();return;}if(typeof result==='object')selected=result;render();}catch(error){stop();$('arenaStatus').textContent=`Arena paused: ${error.message}`;}}
function queue(){clearTimeout(timer);if(!running)return;timer=setTimeout(()=>{advance();if(arena.game.done&&arena.game.players.filter(p=>p.stack>0).length<2){stop();render();return;}queue();},arena.game.done?Math.max(1600,+$('speed').value):+$('speed').value);}
$('play').onclick=()=>{if(running)stop();else{running=true;queue();}render();};
$('step').onclick=()=>{stop();advance();};
$('nextHand').onclick=()=>{stop();if(arena.nextHand()){selected=null;frame=null;}render();};
$('speed').onchange=queue;
$('reveal').onchange=render;
$('newMatch').onclick=()=>{stop();arena.newMatch();selected=null;frame=null;render();};
$('reset').onclick=()=>{stop();arena.reset();selected=null;frame=null;render();};
document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();render();}});
window.addEventListener('pagehide',stop);
render();
