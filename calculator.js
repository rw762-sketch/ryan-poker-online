import { validateScenario } from './poker-math.js?v=1512f49c5b0b';
const $ = id => document.getElementById(id);
const suits = ['♠', '♥', '♣', '♦'], suitNames = ['spades','hearts','clubs','diamonds'];
let worker = null, request = 0;
function picker(parent, id, label, required = false) {
  const select = document.createElement('select'); select.id = id; select.className = 'card-picker';
  select.setAttribute('aria-label', label); select.required = required;
  select.add(new Option('—', ''));
  for (let s = 0; s < 4; s++) for (let r = 14; r >= 2; r--) {
    const rank = {14:'A',13:'K',12:'Q',11:'J',10:'10'}[r] || r;
    const option = new Option(`${rank}${suits[s]}`, `${r}-${s}`);
    option.setAttribute('aria-label', `${rank} of ${suitNames[s]}`); select.add(option);
  }
  $(parent).append(select); return select;
}
for (let i = 0; i < 2; i++) picker('holeCards', `hole${i}`, `Your card ${i + 1}`, true);
for (let i = 0; i < 5; i++) picker('boardCards', `board${i}`, `Community card ${i + 1}`);
for (let i = 0; i < 2; i++) picker('opponentCards', `villain${i}`, `Opponent card ${i + 1}`);
function parse(value) { const [r,s] = value.split('-').map(Number); return { r,s }; }
function updateCards() {
  const count = +$('stage').value;
  for (let i = 0; i < 5; i++) { const el = $(`board${i}`); el.hidden = i >= count; el.required = i < count; if (i >= count) el.value = ''; }
  $('boardCards').hidden = count === 0;
  $('boardRow').hidden = count === 0;
  const selections = [...document.querySelectorAll('.card-picker')];
  const used = new Set(selections.map(el => el.value).filter(Boolean));
  for (const el of selections) {
    el.classList.toggle('red', el.value && parse(el.value).s % 2 === 1);
    for (const option of el.options) option.disabled = !!option.value && used.has(option.value) && option.value !== el.value;
  }
  $('range').disabled = !!$('villain0').value || !!$('villain1').value;
}
function invalidate() {
  request++; worker?.terminate(); worker = null;
  $('calculate').disabled = false; $('calculate').textContent = 'Calculate hand'; $('cancelCalculation').hidden = true;
  $('results').hidden = true; $('emptyResult').hidden = false;
  $('calculationStatus').textContent = 'Inputs changed. Calculate to see updated estimates.';
}
$('calculatorForm').addEventListener('input', () => { updateCards(); invalidate(); });
$('calculatorForm').addEventListener('change', () => { updateCards(); invalidate(); });
$('cancelCalculation').onclick = () => { invalidate(); $('calculationStatus').textContent = 'Calculation canceled.'; };
function readInput() {
  const cards = [0,1].map(i => $(`hole${i}`).value).filter(Boolean).map(parse);
  const board = Array.from({length:+$('stage').value},(_,i)=>$(`board${i}`).value).filter(Boolean).map(parse);
  if(board.length !== +$('stage').value) throw Error('Choose all cards for this betting round.');
  const input = { cards,board,opponents:+$('opponents').value,position:$('position').value,range:$('range').value,
    knownOpponent:[0,1].map(i=>$(`villain${i}`).value).filter(Boolean).map(parse),
    pot:+$('potInput').value,toCall:+$('callInput').value,stack:+$('stackInput').value,ownBet:+$('ownBetInput').value,
    bigBlind:+$('blindInput').value,lastRaise:+$('raiseInput').value };
  validateScenario(input); return input;
}
const pct = value => `${(100 * value).toFixed(1)}%`;
const chips = value => Number(value.toFixed(1)).toLocaleString();
function show(simulation, advice, input) {
  $('emptyResult').hidden = true; $('results').hidden = false;
  $('equityValue').textContent = pct(simulation.equity);
  $('winValue').textContent = pct(simulation.win); $('tieValue').textContent = pct(simulation.tie); $('lossValue').textContent = pct(simulation.loss);
  $('sampleDetails').textContent = `${simulation.trials.toLocaleString()} sample deals · ${input.opponents} opponent${input.opponents > 1 ? 's' : ''}`;
  $('confidence').textContent = `Approx. 95% sampling interval: ${pct(Math.max(0,simulation.equity-simulation.margin95))}–${pct(Math.min(1,simulation.equity+simulation.margin95))}`;
  $('suggestedAction').textContent = ['Check','Fold'].includes(advice.action) ? advice.action : `${advice.action} ${chips(advice.amount)}`;
  $('betExplanation').textContent = advice.action === 'Raise to' ? `Total for this betting round; add ${chips(advice.additional)} more chips.${advice.allIn ? ' This is all in.' : ''}`
    : advice.action === 'Bet' ? `Bet ${chips(advice.amount)} chips.${advice.allIn ? ' This is all in.' : ''}` : advice.action === 'Call' ? `Add ${chips(advice.amount)} chips to match the bet.` : advice.action === 'Check' ? 'No chips needed to stay in this betting round.' : 'Release the hand without committing more chips.';
  $('reasonList').replaceChildren(...advice.reasons.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
  $('requiredEquity').textContent = pct(advice.price);
  $('oddsFormula').textContent = `${chips(input.toCall)} ÷ (${chips(input.pot)} + ${chips(input.toCall)}) = ${pct(advice.price)}`;
  $('callEV').textContent = `${advice.callEV >= 0 ? '+' : ''}${chips(advice.callEV)} chips`;
  $('calculationStatus').textContent = 'Calculation complete. Change the range to explore a different opponent assumption.';
}
$('calculatorForm').onsubmit = event => {
  event.preventDefault();
  let input; try { input = readInput(); } catch (error) { $('calculationStatus').textContent = error.message; return; }
  worker?.terminate(); const generation = ++request;
  $('results').hidden = true; $('emptyResult').hidden = false;
  $('calculate').disabled = true; $('calculate').textContent = 'Calculating…'; $('cancelCalculation').hidden = false;
  $('calculationStatus').textContent = 'Sampling possible hands and boards…';
  const finish = () => { worker?.terminate(); worker = null; $('calculate').disabled = false; $('calculate').textContent = 'Calculate hand'; $('cancelCalculation').hidden = true; };
  try {
    worker = new Worker(new URL('./calculator-worker.js?v=1512f49c5b0b', import.meta.url), { type:'module' });
    worker.onmessage = ({data}) => {
      if(generation !== request) return;
      finish(); if(data.error) $('calculationStatus').textContent = data.error; else show(data.simulation,data.advice,input);
    };
    worker.onerror = () => { if(generation !== request) return; finish(); $('calculationStatus').textContent = 'The calculator could not load. Refresh this page and try again.'; };
    worker.postMessage({ input,trials:+$('trials').value,seed:crypto.getRandomValues(new Uint32Array(1))[0] });
  } catch { finish(); $('calculationStatus').textContent = 'This browser could not start the calculator. Try a current browser.'; }
};
$('loadExample').onclick = () => {
  $('hole0').value = '14-1'; $('hole1').value = '12-1'; $('stage').value = '3';
  $('board0').value = '11-1'; $('board1').value = '7-1'; $('board2').value = '2-2';
  $('villain0').value = ''; $('villain1').value = ''; $('opponents').value = '1'; $('position').value = 'late'; $('range').value = 'standard';
  $('potInput').value = '150'; $('callInput').value = '50'; $('stackInput').value = '1000'; $('ownBetInput').value = '0'; $('blindInput').value = '20'; $('raiseInput').value = '50';
  updateCards(); invalidate(); $('calculatorForm').requestSubmit();
};
updateCards();
