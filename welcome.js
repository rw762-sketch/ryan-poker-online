// Keep previously shared room links working after adding the opening screen.
if (new URLSearchParams(location.hash.slice(1)).has('room')) {
  const destination = new URL('friends.html', location.href);
  destination.hash = location.hash;
  location.replace(destination.href);
}

// Toss the cards and chips onto the table a little differently on every visit.
const felt = document.querySelector('.scene-felt');
if (felt) {
  const r = (lo, hi) => lo + Math.random() * (hi - lo);
  const spots = [[20, 30], [30, 26], [50, 44], [60, 18], [40, 55]];
  felt.querySelectorAll('.toss').forEach((card, i) => {
    const [x, y] = spots[i % spots.length];
    card.style.left = `${x + r(-5, 5)}%`;
    card.style.top = `${y + r(-5, 5)}%`;
    card.style.transform = `rotate(${r(-34, 30).toFixed(1)}deg)`;
  });
  felt.querySelectorAll('.pile, .loose').forEach(chip => {
    const left = parseFloat(getComputedStyle(chip).left) / felt.clientWidth * 100;
    const top = parseFloat(getComputedStyle(chip).top) / felt.clientHeight * 100;
    chip.style.left = `${left + r(-4, 4)}%`;
    chip.style.top = `${top + r(-4, 4)}%`;
  });
  const title = document.querySelector('.scene h1');
  if (title) title.style.rotate = `${r(-1.2, 1.2).toFixed(2)}deg`;
}
