import test from 'node:test';
import assert from 'node:assert/strict';
import {Arena} from '../arena-model.js';
import {seededRandom} from '../poker-math.js';
import {chooseBotAction,chooseBotDecision,botObservation} from '../ai.js';
test('arena steps real AI actions with matching explanation snapshots',()=>{
 const a=new Arena(seededRandom(42));let decisions=0;
 for(let i=0;i<250;i++){
  if(a.game.done&&a.game.players.filter(p=>p.stack>0).length<2)a.newMatch();
  const before=a.game.pot,seat=a.game.turn,s=a.step();
  if(typeof s==='object'){decisions++;assert.equal(s.seat,seat);assert.equal(s.pot,before);assert.ok(s.analysis.reason);assert.ok(s.analysis.equity===null||s.analysis.equity>=0&&s.analysis.equity<=1);}
  assert.equal(a.game.players.reduce((n,p)=>n+p.stack,0)+(a.game.done?0:a.game.pot),6000);
 }
 assert.ok(decisions>100);assert.ok(a.memory.history.length>0);assert.ok(a.decisions.length<=100);
 const memory=a.memory.history.length;a.newMatch();assert.equal(a.memory.history.length,memory);a.reset();assert.equal(a.memory.history.length,0);assert.equal(a.decisions.length,0);
});
test('explanations do not resample or change the normal bot action',()=>{
 const a=new Arena(seededRandom(5));
 for(let i=0;i<30&&!a.game.done;i++){
  const obs=botObservation(a.game,a.memory),d=chooseBotDecision(obs,'hard',seededRandom(i+1));
  const expected=chooseBotAction(obs,'hard',seededRandom(i+1));
  assert.deepEqual({action:d.action,...(d.amount===undefined?{}:{amount:d.amount})},expected);
  assert.equal(d.analysis.reads.length,obs.opponents);a.step();
 }
});
