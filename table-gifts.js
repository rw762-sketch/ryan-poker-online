export const DRINKS = Object.freeze({
  martini: {label:'Martini',icon:'🍸',note:'Crisp & classic',group:'Cocktails'},
  mojito: {label:'Mojito',icon:'🌿',note:'Mint & lime',group:'Cocktails'},
  oldfashioned: {label:'Old Fashioned',icon:'🥃',note:'A timeless pour',group:'Cocktails'},
  margarita: {label:'Margarita',icon:'🍸',note:'Lime & a salted rim',group:'Cocktails'},
  negroni: {label:'Negroni',icon:'🥃',note:'Bittersweet & bold',group:'Cocktails'},
  espresso: {label:'Espresso Martini',icon:'☕',note:'A little pick-me-up',group:'Cocktails'},
  cosmopolitan: {label:'Cosmopolitan',icon:'🍸',note:'Cranberry & citrus',group:'Cocktails'},
  pinacolada: {label:'Piña Colada',icon:'🍍',note:'Pineapple & coconut',group:'Cocktails'},
  spritz: {label:'Aperol Spritz',icon:'🍊',note:'Bubbly & bright',group:'Cocktails'},
  whiskeySour: {label:'Whiskey Sour',icon:'🍋',note:'Smooth & citrusy',group:'Cocktails'},
  coffee: {label:'Coffee',icon:'☕',note:'Keep it sharp',group:'Zero-proof'},
  tea: {label:'Tea',icon:'🍵',note:'A moment of calm',group:'Zero-proof'},
  lemonade: {label:'Lemonade',icon:'🍋',note:'Fresh & easy',group:'Zero-proof'},
  mocktail: {label:'Tropical Mocktail',icon:'🍹',note:'All the island vibes',group:'Zero-proof'},
});
export function validGift(gift) {
  return gift && Number.isInteger(gift.from) && gift.from >= 0 && gift.from < 6 &&
    Number.isInteger(gift.to) && gift.to >= 0 && gift.to < 6 && gift.from !== gift.to &&
    typeof gift.drink === 'string' && Object.hasOwn(DRINKS, gift.drink);
}
// Cosmetics never mutate the poker state, action version, chips, or turn clock.
export class TableGifts {
  constructor() { this.last = new Map(); }
  create(from, to, drink, members, now = Date.now()) {
    const gift = { from, to, drink };
    if (!validGift(gift) || !members[from]?.online || !members[to]?.online) throw Error('Choose a connected player and a drink.');
    if (now - (this.last.get(from) ?? -Infinity) < 4000) throw Error('Give the server a moment — one drink every 4 seconds.');
    this.last.set(from, now);
    return gift;
  }
}

// Table chat: short plain-text lines, rate limited per seat. Shares the gift
// limiter's map (string keys) so saved rooms need no new fields.
export function cleanChat(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}
export function validChat(chat) {
  return chat && chat.kind === 'chat' && Number.isInteger(chat.from) && chat.from >= 0 && chat.from < 6 &&
    typeof chat.text === 'string' && chat.text.length > 0 && chat.text.length <= 120;
}
export function createChat(limiter, from, text, members, now = Date.now()) {
  const clean = cleanChat(text);
  if (!clean) throw Error('Type a message first.');
  if (!members[from]?.online) throw Error('Reconnect before chatting.');
  const key = `chat-${from}`, recent = limiter.last.get(key) ?? [];
  const window = (Array.isArray(recent) ? recent : []).filter(t => now - t < 10000);
  if (window.length >= 5) throw Error('Easy there — a few seconds between messages.');
  limiter.last.set(key, [...window, now]);
  return { kind: 'chat', from, text: clean };
}
