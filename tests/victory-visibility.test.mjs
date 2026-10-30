import test from 'node:test';
import assert from 'node:assert/strict';
import { Poker } from '../engine.js';
import { HostTable } from '../room-state.js';
import { celebrateTable } from '../celebration.js';
const card=(r,s)=>({r,s});

// Inspect the real banner renderer's output for every private viewer, not just
// the outcome labels. Animation timing is disabled so no timer survives a test.
test('only the winning viewer receives a victory banner or confetti, in every seat', () => {
  const saved = Object.fromEntries(['document','matchMedia','setTimeout','clearTimeout'].map(k=>[k,globalThis[k]]));
  let banner;
  const element=()=>({children:[],style:{setProperty(){}},setAttribute(){},append(...children){this.children.push(...children);},remove(){if(banner===this)banner=null;}});
  const arena={querySelector(){return banner;},append(node){banner=node;}};
  globalThis.document={querySelector(){return arena;},createElement:element};
  globalThis.matchMedia=()=>({matches:false});
  globalThis.setTimeout=()=>1;globalThis.clearTimeout=()=>{};
  try {
    for(const winner of [0,1,2,3]) for(const allIn of [false,true]) {
      const g=new Poker();g.hand=1;g.dealer=0;g.pot=400;
      g.board=[card(2,1),card(5,1),card(9,1),card(13,0),card(3,3)];
      const hands=[[card(10,1),card(8,1)],[card(14,2),card(12,0)],[card(11,2),card(7,3)],[card(4,0),card(6,3)]];
      g.players.forEach((p,i)=>Object.assign(p,i<4?{cards:hands[(i-winner+4)%4],stack:0,total:100,folded:false,allIn:i===winner&&allIn}:{cards:[],stack:0,total:0,folded:true,allIn:false}));
      g.showdown();
      const table=new HostTable('Host');table.game=g;
      for(const viewer of [0,1,2,3]) {
        banner=null;
        const v=table.view(viewer);
        celebrateTable({hand:1,done:false},{hand:1,done:true,outcome:v.outcome});
        assert.ok(banner);
        const isVictory=/\b(win|all-in-win)\b/.test(banner.className);
        assert.equal(isVictory,viewer===winner,`winner ${winner}, viewer ${viewer}, allIn ${allIn}`);
        assert.equal(banner.children.length>2,viewer===winner&&allIn);
        assert.equal(banner.children[0].textContent,viewer===winner?(allIn?'ALL-IN VICTORY':'YOU WIN'):'YOU LOST');
        if(viewer!==winner) assert.match(banner.children[1].textContent,/lost to/);
      }
    }
  } finally {
    for(const [key,value] of Object.entries(saved)) if(value===undefined) delete globalThis[key]; else globalThis[key]=value;
  }
});
