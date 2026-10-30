// Presentation only: poker state changes remain synchronous in the engine.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const running = new Set();
let generation = 0;
let displayedPot = null;

// A preference change should settle the current hand immediately, too.
reducedMotion.addEventListener('change', () => {
  if (!reducedMotion.matches) return;
  generation++;
  for (const animation of running) animation.cancel();
  running.clear();
  document.querySelectorAll('.moving-chips').forEach(element => element.remove());
  const pot = document.getElementById('pot');
  if (pot && displayedPot !== null) pot.textContent = displayedPot.toLocaleString();
});

function animate(element, frames, options) {
  if (!element || reducedMotion.matches || !element.animate) return;
  const animation = element.animate(frames, {
    duration: 380,
    easing: 'cubic-bezier(.2,.75,.25,1)',
    ...options,
  });
  running.add(animation);
  animation.finished.catch(() => {}).finally(() => running.delete(animation));
  return animation;
}

function center(element) {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function transfer(from, to, amount, delay = 0) {
  if (!from || !to || amount <= 0 || reducedMotion.matches) return;
  const arena = document.querySelector('.arena');
  const bounds = arena.getBoundingClientRect();
  const origin = center(from);
  const destination = center(to);
  const token = document.createElement('span');
  token.className = 'moving-chips';
  token.setAttribute('aria-hidden', 'true');
  token.textContent = amount.toLocaleString();
  token.style.left = `${origin.x - bounds.left}px`;
  token.style.top = `${origin.y - bounds.top}px`;
  arena.append(token);
  const dx = destination.x - origin.x;
  const dy = destination.y - origin.y;
  const animation = animate(token, [
    { transform: 'translate(-50%, -50%) scale(.65)', opacity: 0 },
    { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: .15 },
    { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.7)`, opacity: 0 },
  ], { duration: 500, delay, fill: 'both' });
  if (animation) animation.finished.catch(() => {}).finally(() => token.remove());
  else token.remove();
}

function countPot(element, from, to) {
  if (from === to || reducedMotion.matches) return;
  const currentGeneration = generation;
  const started = performance.now();
  const step = now => {
    if (currentGeneration !== generation) return;
    const progress = Math.min(1, (now - started) / 420);
    element.textContent = Math.round(from + (to - from) * (1 - (1 - progress) ** 3)).toLocaleString();
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function tableSnapshot(game) {
  return {
    hand: game.hand,
    outcome: game.outcome || null,
    awards: (game.awards || []).map(a => ({ ...a })),
    boardCount: game.board.length,
    done: game.done,
    stage: game.stage,
    pot: game.pot,
    turn: game.turn,
    players: game.players.map(p => ({ name: p.name, allIn: !!p.allIn, stack: p.stack, total: p.total, folded: p.folded })),
  };
}

export function animateTable(before, after) {
  displayedPot = after.pot;
  generation++;
  for (const animation of running) animation.cancel();
  running.clear();
  document.querySelectorAll('.moving-chips').forEach(element => element.remove());
  const pot = document.getElementById('pot');
  const newHand = !before || before.hand !== after.hand;
  const board = [...document.querySelectorAll('#board .card')];
  const seats = [...document.querySelectorAll('.seat')];

  if (newHand) {
    const dealerBlob = document.getElementById('dealerBlob');
    const origin = center(dealerBlob || pot);
    seats.forEach((seat, index) => {
      seat.querySelectorAll('.card').forEach((card, cardIndex) => {
        const destination = center(card);
        animate(card, [
          { opacity: 0, transform: `translate(${origin.x - destination.x}px, ${origin.y - destination.y}px) rotate(-18deg) scale(.45)` },
          { opacity: 1, transform: 'translate(0, 0) rotate(0) scale(1)' },
        ], { duration: 380, delay: (cardIndex * 4 + index) * 45, fill: 'backwards' });
      });
    });
  }

  const oldBoardCount = newHand ? 0 : before.boardCount;
  board.slice(oldBoardCount, after.boardCount).forEach((card, index) => {
    animate(card, [
      { opacity: 0, transform: 'perspective(700px) translateY(-30px) rotateY(90deg) scale(.9)' },
      { opacity: 1, transform: 'perspective(700px) translateY(0) rotateY(0) scale(1)' },
    ], { duration: 380, delay: index * 90, fill: 'backwards' });
  });

  if (!newHand) {
    countPot(pot, before.pot, after.pot);
    seats.forEach((seat, index) => {
      const old = before.players[index];
      const player = after.players[index];
      const paid = Math.max(0, player.total - old.total);
      transfer(seat.querySelector('.nameplate'), pot, paid);
      if (player.folded && !old.folded) {
        animate(seat.querySelector('.cards'), [
          { opacity: 1, transform: 'translateY(0) rotate(0)' },
          { opacity: .35, transform: 'translateY(12px) rotate(-7deg)' },
        ], { duration: 380, fill: 'forwards' });
      }
      if (after.done && !before.done) {
        const winnings = player.stack - old.stack + paid;
        if (winnings > 0) transfer(pot, seat.querySelector('.nameplate'), winnings, 650);
        if (index === 0 && ['win','all-in-win'].includes(after.outcome?.kind)) {
          seat.classList.add('winner');
          animate(seat.querySelector('.nameplate'), [
            { transform: 'scale(1)', boxShadow: '0 0 0 0 #e3bb7200' },
            { transform: 'scale(1.03)', boxShadow: '0 0 0 12px #e3bb7230', offset: .45 },
            { transform: 'scale(1)', boxShadow: '0 0 0 22px #e3bb7200' },
          ], { duration: 600, delay: 300 });
        }
        if (index !== 0 && !player.folded && after.stage === 4) {
          seat.querySelectorAll('.card').forEach((card, cardIndex) => {
            animate(card, [
              { transform: 'perspective(600px) rotateY(90deg)' },
              { transform: 'perspective(600px) rotateY(0)' },
            ], { duration: 450, delay: 300 + cardIndex * 100, fill: 'backwards' });
          });
        }
      }
    });
  }
  if (newHand || before.turn !== after.turn || after.done !== before.done) {
    animate(document.querySelector('.turn-info'), [
      { opacity: .4, transform: 'translateY(7px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 280 });
  }
}
