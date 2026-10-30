// Structured awards keep split pots and uncalled-chip returns out of win effects.
export function celebrationEvent(before, after) {
  if (!before || before.hand !== after.hand) return null;
  if (after.done && !before.done) {
    // The frame is already rotated so seat zero is the current viewer.
    return after.outcome || null;
  }
  const pushed = after.players.filter((p, i) => i === 0 && p.allIn && !before.players[i].allIn);
  return pushed.length ? { kind: 'all-in', title: 'ALL IN', detail: pushed.map(p => p.name).join(' · ') } : null;
}
let dismissTimer;
export function celebrateTable(before, after) {
  const arena = document.querySelector('.arena');
  if (!arena) return;
  if (!before || before.hand !== after.hand) {
    clearTimeout(dismissTimer);
    arena.querySelector('.table-celebration')?.remove();
    arena.classList?.remove('result-win', 'result-loss');
  }
  const event = celebrationEvent(before, after);
  if (!event) return;
  clearTimeout(dismissTimer);
  arena.querySelector('.table-celebration')?.remove();
  const banner = document.createElement('div');
  banner.className = `table-celebration ${event.kind}`;
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  const title = document.createElement('strong'); title.textContent = event.title;
  const detail = document.createElement('span'); detail.textContent = (event.detail || '').replace(/\s*Net: [^.]*chips\.?$/, '');
  banner.append(title, detail);
  const net = /Net: ([+-]?\d[\d,]*)|\(\+(\d[\d,]*) net\)/.exec(event.detail || '');
  if (net) banner.setAttribute('data-net', net[1] ? `${net[1].startsWith('-') ? '−' + net[1].slice(1) : net[1]} chips` : `+${net[2]} chips`);
  arena.classList?.remove('result-win', 'result-loss');
  if (/win/.test(event.kind)) arena.classList?.add('result-win');
  else if (event.kind === 'loss') arena.classList?.add('result-loss');
  if (event.kind === 'all-in-win' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (let i = 0; i < 24; i++) {
      const piece = document.createElement('i');
      piece.setAttribute('aria-hidden', 'true');
      const angle = (i / 24) * Math.PI * 2;
      piece.style.setProperty('--x', `${(i / 23) * 100}%`);
      piece.style.setProperty('--dx', `${Math.round(Math.cos(angle) * (180 + (i % 5) * 40))}px`);
      piece.style.setProperty('--dy', `${Math.round(Math.sin(angle) * (110 + (i % 4) * 30))}px`);
      piece.style.setProperty('--drift', `${(i % 2 ? 1 : -1) * (30 + i * 3)}px`);
      piece.style.setProperty('--delay', `${(i % 6) * 50}ms`);
      banner.append(piece);
    }
  }
  arena.append(banner);
  dismissTimer = setTimeout(() => { banner.remove(); arena.classList?.remove('result-win', 'result-loss'); },
    event.kind === 'all-in-win' ? 4800 : /win|loss|split|partial/.test(event.kind) ? 3600 : 2200);
}
