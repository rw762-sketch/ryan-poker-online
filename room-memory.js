import { PlayerMemory } from './player-memory.js?v=6e6dba662784';

// Persist only public betting observations, never cached models or hidden cards.
const packHand = hand => hand && [hand.seats, hand.actions.map(a => [a.seat,a.street,a.type,a.faced,a.size,a.chips,a.context?.price,a.context?.spr,a.context?.opponents])];
const unpackHand = hand => hand && ({ seats:hand[0], actions:hand[1].map(a => ({seat:a[0],street:a[1],type:a[2],faced:a[3],size:a[4],chips:a[5],context:{street:a[1],price:a[6],spr:a[7],opponents:a[8]}})) });
export function saveRoomMemory(memory) {
  const history = memory.history.slice(-24).map(packHand);
  // Bound each room's history so many tables cannot exhaust shared storage.
  while (history.length && JSON.stringify(history).length > 24000) history.shift();
  return { version:2, history, current:packHand(memory.current) };
}
export function restoreRoomMemory(saved) {
  if (!saved || saved.version !== 2) return new PlayerMemory();
  const memory = new PlayerMemory({ version:1, history:saved.history.map(unpackHand) });
  if (saved.current) memory.current = new PlayerMemory({ version:1, history:[unpackHand(saved.current)] }).history[0] || null;
  return memory;
}
