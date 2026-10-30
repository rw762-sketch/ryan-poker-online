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
