import test from 'node:test';
import assert from 'node:assert/strict';
import { Poker } from '../engine.js';
import { botObservation, chooseBotAction, estimateEquity, normalizeDifficulty } from '../ai.js';
function seeded(seed = 1) { return () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296); }
const cards = text => text.split(' ').map(c => ({ r:'23456789TJQKA'.indexOf(c[0])+2, s:'shcd'.indexOf(c[1]) }));
test('observation never reads opponents cards or the deck', () => {
  const g = new Poker(); g.start();
  Object.defineProperty(g, 'deck', { get() { throw Error('deck leak'); } });
  g.players.forEach((p,i) => { if (i !== g.turn) Object.defineProperty(p, 'cards', { get() { throw Error('hole card leak'); } }); });
  const seen = botObservation(g);
  assert.equal(seen.cards.length,2);
  assert.equal('deck' in seen,false);
  for (const level of ['easy','medium','hard','gto']) assert.ok(['call','raise','fold'].includes(chooseBotAction(seen,level,seeded()).action));
});
test('equity recognizes unbeatable hands and splits board ties', () => {
  assert.equal(estimateEquity({cards:cards('As Ks'),board:cards('Qs Js Ts 2d 3c'),opponents:3},30,seeded()),1);
  assert.equal(estimateEquity({cards:cards('2h 3c'),board:cards('As Ks Qs Js Ts'),opponents:3},30,seeded()),.25);
});
test('difficulty changes decisions; hard folds expensive weak hands', () => {
  const v = { cards:cards('As Ks'), board:cards('Qs Js Ts 2d 3c'), opponents:1, pot:200, current:20, options:{call:20,owed:20,min:40,max:1000,canRaise:true} };
  assert.equal(chooseBotAction(v,'easy',()=>.5).action,'call');
  assert.equal(chooseBotAction(v,'hard',()=>.5).action,'raise');
  const weak = { ...v, cards:cards('4h 5s'), board:cards('2c 3d 7h 9s Jc'), opponents:3, options:{call:1000,owed:1000,min:1000,max:1000,canRaise:false} };
  assert.equal(chooseBotAction(weak,'hard',seeded(200)).action,'fold');
  assert.equal(normalizeDifficulty('invalid'),'medium');
  assert.equal(normalizeDifficulty(null),'medium');
});
test('all levels finish hands with legal moves and conserved chips', () => {
  for (const level of ['easy','medium','hard','gto']) {
    const random=seeded(12),g=new Poker();
    for(let hand=0;hand<4;hand++) {
      if(!g.start()) break;
      let moves=0;
      while(!g.done && moves++<300) {
        const observation=botObservation(g),decision=chooseBotAction(observation,level,random);
        if(!observation.options.owed) assert.notEqual(decision.action,'fold');
        assert.ok(g.act(decision.action,decision.amount));
        assert.equal(g.players.reduce((s,p)=>s+p.stack,0)+(g.done?0:g.pot),6000);
      }
      assert.ok(g.done);
    }
  }
});
