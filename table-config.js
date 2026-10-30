// Solo table settings (players, blinds, starting chips) and bet-size shortcuts.
export const BLIND_LEVELS = Object.freeze({ '5/10': [5, 10], '10/20': [10, 20], '25/50': [25, 50], '50/100': [50, 100] });
export const STACK_SIZES = Object.freeze([500, 1000, 2000, 5000]);
const STORE = 'river-room-table';
export const DEFAULT_TABLE = Object.freeze({ seats: 6, blinds: '10/20', stack: 1000 });

export function cleanTableConfig(raw = {}) {
  const seats = Math.min(6, Math.max(2, Math.round(Number(raw.seats)) || 6));
  const blinds = Object.hasOwn(BLIND_LEVELS, raw.blinds) ? raw.blinds : DEFAULT_TABLE.blinds;
  const stack = STACK_SIZES.includes(Number(raw.stack)) ? Number(raw.stack) : DEFAULT_TABLE.stack;
  return { seats, blinds, stack };
}

export function loadTableConfig(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem(STORE) || 'null');
    if (saved) return cleanTableConfig(saved);
    // Older versions stored only the seat count.
    const seats = Number(storage?.getItem('river-room-seats'));
    if (seats) return cleanTableConfig({ seats });
  } catch {}
  return { ...DEFAULT_TABLE };
}
export function saveTableConfig(config, storage = globalThis.localStorage) {
  try { storage?.setItem(STORE, JSON.stringify(cleanTableConfig(config))); } catch {}
}
export const blindsOf = config => BLIND_LEVELS[config.blinds] || BLIND_LEVELS[DEFAULT_TABLE.blinds];
export function tableSummary(config) {
  return `${config.seats} seats · blinds ${config.blinds} · ${config.stack.toLocaleString('en-US')} chips`;
}
export function stackDepth(config) {
  const bb = blindsOf(config)[1];
  return Math.round(config.stack / bb);
}

// Raise-to totals for the quick buttons. "Pot" means raising by the size of the
// pot after calling, the usual pot-limit meaning. Amounts snap to the small blind.
export function betPresets({ pot, current, call, min, max, smallBlind = 10 }) {
  const snap = v => Math.round(v / smallBlind) * smallBlind;
  const after = pot + call;
  const list = [['Min', min], ['½ pot', current + after * .5], ['¾ pot', current + after * .75], ['Pot', current + after]];
  const seen = new Set();
  return list.map(([label, raw]) => [label, Math.min(max, Math.max(min, label === 'Min' ? raw : snap(raw)))])
    .filter(([, amount]) => !seen.has(amount) && seen.add(amount))
    .map(([label, amount]) => ({ label, amount }));
}
