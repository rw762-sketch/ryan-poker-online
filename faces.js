// Little lives for the blob faces: blinking on an irregular rhythm, eyes that
// follow the action, idle habits, and reactions to drinks. Everything here is
// cosmetic and reads only what is already on screen.

// How each drink lands. Keys match DRINKS in table-gifts.js.
export const TASTES = Object.freeze({
  coffee: 'wired', espresso: 'wired',
  tea: 'calm',
  lemonade: 'sour', whiskeySour: 'sour', margarita: 'sour',
  oldfashioned: 'cool', negroni: 'cool',
  martini: 'cheers', mojito: 'cheers', cosmopolitan: 'cheers', pinacolada: 'cheers', spritz: 'cheers', mocktail: 'cheers',
});
export const tasteOf = drink => TASTES[drink] || 'cheers';

const between = (lo, hi, rng) => lo + (hi - lo) * rng();

// People blink every few seconds, faster when nervous, slower when staring someone down.
export function blinkDelay(mood, rng = Math.random) {
  if (mood === 'sweat') return between(500, 1700, rng);
  if (mood === 'think') return between(900, 2600, rng);
  if (mood === 'smug' || mood === 'angry') return between(3200, 7500, rng);
  return between(1800, 6200, rng);
}
const NO_BLINK = new Set(['empty', 'away', 'busted', 'sleep', 'win', 'allin']);
export const canBlink = mood => !NO_BLINK.has(mood);

// Where the eyes go next. Offsets are in pixels, kept inside the face.
export function nextGaze(mood, rng = Math.random, toward = null) {
  if (mood === 'think') {
    // Pondering: up to the side, down at the cards, across the table.
    const spots = [[-2.5, -3], [2.5, -3], [0, 2.5], [-2.5, 0], [2.5, 0], [0, -3.5]];
    const [x, y] = spots[Math.floor(rng() * spots.length)];
    return { x, y, hold: between(450, 1300, rng) };
  }
  if (mood === 'sweat') return { x: between(-2.5, 2.5, rng), y: between(-1, 2, rng), hold: between(220, 600, rng) };
  if (toward && rng() < .65) return { x: toward.x, y: toward.y, hold: between(1400, 3600, rng) };
  if (rng() < .3) return { x: 0, y: 0, hold: between(1200, 3000, rng) };
  return { x: between(-2, 2, rng), y: between(-1.5, 1.5, rng), hold: between(1000, 3200, rng) };
}

// Small habits while waiting: a yawn, a hum, a peek at the cards.
export function idleHabit(mood, rng = Math.random) {
  if (mood !== 'idle' && mood !== 'smug') return null;
  const roll = rng();
  if (roll < .3) return { kind: 'yawn', ms: 1500 };
  if (roll < .6) return { kind: 'hum', ms: 2200 };
  if (roll < .85) return { kind: 'peek', ms: 1100 };
  return { kind: 'wiggle', ms: 900 };
}

const seats = new Map();
const stateFor = i => {
  if (!seats.has(i)) seats.set(i, { nextBlink: 0, nextGaze: 0, gaze: { x: 0, y: 0 }, nextHabit: performance.now() + between(6000, 16000, Math.random) });
  return seats.get(i);
};
const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function seatIndex(el) { return Number(/seat-(\d+)/.exec(el.className)?.[1]); }

function towardActive(el) {
  const active = document.querySelector('.seat.active');
  const board = document.querySelector('.board-area');
  const target = active && active !== el ? active : board;
  if (!target) return null;
  const a = el.getBoundingClientRect(), b = target.getBoundingClientRect();
  const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len * 2.6, y: dy / len * 2.2 };
}

// Re-apply what each face is doing after the table re-renders.
export function applyFaces() {
  const now = performance.now();
  for (const el of document.querySelectorAll('.seat')) {
    const s = seats.get(seatIndex(el));
    const face = el.querySelector('.face');
    if (!s || !face) continue;
    face.style.setProperty('--gx', `${s.gaze.x}px`);
    face.style.setProperty('--gy', `${s.gaze.y}px`);
    if (s.react && now < s.react.until) el.dataset.react = s.react.kind; else delete el.dataset.react;
    if (s.habit && now < s.habit.until) el.dataset.habit = s.habit.kind; else delete el.dataset.habit;
  }
}

function blink(face, twice) {
  face.classList.add('blink');
  setTimeout(() => face.classList.remove('blink'), 120);
  if (twice) setTimeout(() => { face.classList.add('blink'); setTimeout(() => face.classList.remove('blink'), 110); }, 260);
}

function tick() {
  if (document.hidden) return;
  const now = performance.now(), still = reduced();
  for (const el of document.querySelectorAll('.seat')) {
    const face = el.querySelector('.face');
    if (!face) continue;
    const i = seatIndex(el), s = stateFor(i), mood = el.dataset.mood || 'idle';
    const reacting = s.react && now < s.react.until;
    if (!reacting && canBlink(mood) && now >= s.nextBlink) {
      if (s.nextBlink) blink(face, Math.random() < .18);
      s.nextBlink = now + blinkDelay(mood);
    }
    if (still) continue;
    if (now >= s.nextGaze && !reacting && !(s.lookUntil > now)) {
      const g = nextGaze(mood, Math.random, mood === 'idle' || mood === 'smug' || mood === 'angry' ? towardActive(el) : null);
      s.gaze = { x: g.x, y: g.y }; s.nextGaze = now + g.hold;
    }
    if (!reacting && now >= s.nextHabit) {
      const habit = idleHabit(mood);
      if (habit) s.habit = { kind: habit.kind, until: now + habit.ms };
      s.nextHabit = now + between(9000, 24000, Math.random);
    }
  }
  applyFaces();
}

let started = false;
export function startFaces() {
  if (started || typeof document === 'undefined') return;
  started = true;
  setInterval(tick, 110);
}

// The recipient glances at whoever sent the drink while it is on its way.
export function lookAt(seat, fromEl, toEl, ms = 1200) {
  if (!fromEl || !toEl) return;
  const s = stateFor(seat), a = toEl.getBoundingClientRect(), b = fromEl.getBoundingClientRect();
  const dx = b.left - a.left, dy = b.top - a.top, len = Math.hypot(dx, dy) || 1;
  s.gaze = { x: dx / len * 2.6, y: dy / len * 2.2 }; s.lookUntil = performance.now() + ms; s.nextGaze = s.lookUntil;
  applyFaces();
}

// A sip first, then the taste of that particular drink.
export function reactToDrink(seat, drink) {
  const s = stateFor(seat), now = performance.now(), taste = tasteOf(drink);
  s.habit = null;
  s.react = { kind: 'sip', until: now + 950 };
  applyFaces();
  setTimeout(() => { s.react = { kind: taste, until: performance.now() + 2600 }; s.gaze = { x: 0, y: 0 }; applyFaces(); }, 950);
  setTimeout(() => { s.react = null; s.nextBlink = 0; applyFaces(); }, 3600);
  return taste;
}
