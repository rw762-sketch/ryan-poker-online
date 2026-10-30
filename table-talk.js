// Offline table talk: replies built from what was said, the hand, and the bot's
// own mood, so it reads like a person at the table rather than a canned list.
// The bots never reveal or hint at their cards.

const pick = (list, rng) => list[Math.floor(rng() * list.length)];
const chance = (p, rng) => rng() < p;

function voice(style = {}) {
  if (style.tilt > .3) return 'tilted';
  if (style.aggressive > .62) return 'cocky';
  if (style.tight > .62) return 'dry';
  if (style.sticky > .62) return 'chatty';
  return 'easy';
}

// Small habits so two bots in the same mood still sound different.
function finish(line, style, rng) {
  let out = line;
  if (style.sloppy > .22 && chance(.5, rng)) out = out.toLowerCase().replace(/[.!]$/, '');
  if (voice(style) === 'chatty' && chance(.3, rng)) out += pick([' lol', ' haha', ' 😄'], rng);
  if (voice(style) === 'dry' && out.endsWith('!')) out = out.slice(0, -1) + '.';
  return out.slice(0, 80);
}

const TOPICS = [
  { test: /\b(all[ -]?in|shove|jam|push)\b/i, lines: {
    cocky: ['Do it. I’ll look you up.', 'Shove it then, see what happens.', 'Big words for {pot} in the middle.'],
    dry: ['Noted.', 'We’ll see if you mean it.', 'Plenty of hands left for that.'],
    chatty: ['Ooh, threats already!', 'You say that every hand, {you}.', 'All in on hand {hand}? Bold.'],
    tilted: ['Go on. Not like my night can get worse.', 'Sure. Why not.'],
    easy: ['Brave.', 'Can’t wait.', 'I’ll believe it when I see the chips.'] } },
  { test: /\b(bluff|bluffing|liar|lying)\b/i, lines: {
    cocky: ['Only one way to find out.', 'Maybe. Pay to see.', 'I bluff when I want to.'],
    dry: ['Everybody bluffs sometimes.', 'Could be.'],
    chatty: ['Me? Never. Okay, sometimes.', 'Wouldn’t you like to know!'],
    tilted: ['I don’t have the energy to bluff right now.'],
    easy: ['Who, me?', 'Nobody ever knows.'] } },
  { test: /\b(nice|good) (hand|call|play|fold)\b|\bnh\b|\bwp\b/i, lines: {
    cocky: ['I know.', 'Took you long enough to notice.'],
    dry: ['Thanks.', 'Appreciated.'],
    chatty: ['Aw, thank you!', 'Finally someone says it!'],
    tilted: ['First good thing all night.', 'Thanks. Needed that.'],
    easy: ['Thanks!', 'Cheers.'] } },
  { test: /\b(gg|good game|gl|good luck)\b/i, lines: {
    cocky: ['You’ll need it.', 'Luck has nothing to do with it.'],
    dry: ['You too.', 'Same.'],
    chatty: ['Good luck to all of us, except Sam.', 'You too! May the river be kind.'],
    tilted: ['Luck. Right.', 'Hope yours is better than mine.'],
    easy: ['You too.', 'Gl!'] } },
  { test: /\b(fold|folding|scared|chicken)\b/i, lines: {
    cocky: ['I fold when I feel like it.', 'Scared? Look at my stack.'],
    dry: ['Folding is a skill.', 'Patience pays.'],
    chatty: ['I fold way too much, I know.', 'Hey, I’m saving myself for a good one!'],
    tilted: ['Folding is all I’ve done tonight.'],
    easy: ['Sometimes you have to.', 'Next hand, maybe.'] } },
  { test: /\b(lucky|luck|rigged|cooler|bad beat)\b/i, lines: {
    cocky: ['Call it luck if it helps.', 'Skill looks like luck from over there.'],
    dry: ['Variance.', 'It evens out.'],
    chatty: ['The deck hates all of us equally.', 'It’s not rigged, it’s just mean.'],
    tilted: ['Tell me about it.', 'Rigged against me, maybe.'],
    easy: ['That’s poker.', 'Happens to everyone.'] } },
  { test: /\b(drink|cheers|beer|coffee|martini)\b/i, lines: {
    cocky: ['Make mine a double.', 'Buy me one when you’re ahead.'],
    dry: ['Water for me.', 'Cheers.'],
    chatty: ['Cheers! Next round’s on {you}.', 'Ooh, I’ll take an espresso martini.'],
    tilted: ['I need one.', 'Make it strong.'],
    easy: ['Cheers!', 'Thanks!'] } },
  { test: /\?$/, lines: {
    cocky: ['Wouldn’t you like to know.', 'Ask the cards.'],
    dry: ['Hard to say.', 'Depends.'],
    chatty: ['Honestly? No idea.', 'Good question!'],
    tilted: ['Don’t ask me.', 'No clue.'],
    easy: ['Maybe.', 'We’ll see.'] } },
];

const GENERAL = {
  cocky: ['Talk is cheap, chips aren’t.', 'Keep talking, I’m listening.', 'You’re awfully chatty for {stack} chips.'],
  dry: ['Mm.', 'Sure.', 'Let’s play.'],
  chatty: ['Ha, you’re fun.', 'I like this table.', 'Okay but who’s dealing faster tonight?'],
  tilted: ['Just deal.', 'Can we play?', 'Mhm.'],
  easy: ['Ha.', 'Fair.', 'True.'],
};

function fill(line, ctx) {
  return line.replace('{you}', ctx.you || 'you').replace('{pot}', (ctx.pot || 0).toLocaleString())
    .replace('{stack}', (ctx.userStack ?? 1000).toLocaleString()).replace('{hand}', String(ctx.hand || 1));
}

// Reply to something typed at the table. Returns '' when the bot stays quiet.
export function replyTo(text, ctx, rng = Math.random) {
  const v = voice(ctx.style);
  const topic = TOPICS.find(t => t.test.test(text));
  const quietness = v === 'dry' ? .55 : v === 'chatty' ? .1 : .3;
  if (!topic && chance(quietness, rng)) return '';
  const lines = topic ? topic.lines[v] : GENERAL[v];
  return finish(fill(pick(lines, rng), ctx), ctx.style || {}, rng);
}

// Comment on how a hand ended. kind: 'won-big' | 'lost-big' | 'bad-beat' | 'user-won-big'.
export function reactTo(kind, ctx, rng = Math.random) {
  const v = voice(ctx.style);
  const table = {
    'won-big': { cocky: ['Ship it.', 'Thank you, thank you.'], dry: ['I’ll take it.'], chatty: ['YES. Finally!', 'Did you see that?'], tilted: ['About time.'], easy: ['Nice.', 'Lucky me.'] },
    'lost-big': { cocky: ['That won’t happen twice.', 'Fine. Enjoy it.'], dry: ['Next.', 'Unlucky.'], chatty: ['Ouch. Ouch!', 'Well that hurt.'], tilted: ['Of course.', 'Unreal.', 'Every time.'], easy: ['Oof.', 'Nice hand.'] },
    'user-won-big': { cocky: ['Enjoy it while it lasts, {you}.', 'Fine, nice hand.'], dry: ['Well played.', 'Nh.'], chatty: ['Okay {you}, I see you!', 'Who invited this person?'], tilted: ['Great. Just great.'], easy: ['Nh!', 'Well played.'] },
  }[kind];
  if (!table || chance(.45, rng)) return '';
  return finish(fill(pick(table[v], rng), ctx), ctx.style || {}, rng);
}

// Saying thanks for a drink, flavoured by what it was. taste comes from faces.js.
const DRINK_LINES = {
  cheers: { cocky: ['Now we’re talking.', 'Knew you liked me.'], dry: ['Thanks. Cheers.', 'Appreciated.'],
    chatty: ['Aww, cheers {from}!', 'Best table ever, honestly.', 'You remembered my order!'], tilted: ['Okay. That helps.', 'Needed this.'], easy: ['Cheers!', 'Thank you!'] },
  wired: { cocky: ['Caffeine. Bad news for all of you.', 'Now I see everything.'], dry: ['Good. Awake now.', 'Sharp.'],
    chatty: ['I can hear colours now.', 'OKAY I’m awake, deal deal deal!'], tilted: ['Fine. Focus.', 'Coffee won’t fix the river.'], easy: ['Ooh, perfect.', 'Wide awake.'] },
  calm: { cocky: ['Calm and deadly.', 'Zen mode.'], dry: ['Nice and calm.', 'Good choice.'],
    chatty: ['Ahh, cosy. Thank you!', 'Tea at a poker table, love it.'], tilted: ['Okay. Breathing.', 'Deep breath. Thanks.'], easy: ['So calming.', 'Lovely.'] },
  sour: { cocky: ['Sour. Like your last bluff.', 'Mm! Strong.'], dry: ['Tart.', 'Bit sour. Good.'],
    chatty: ['Whoa, sour! 😖 love it', 'My face just folded.'], tilted: ['Even the drink is bitter.', 'Fitting.'], easy: ['Sour! Nice.', 'Zingy.'] },
  cool: { cocky: ['Smooth. Like me.', 'A drink for a closer.'], dry: ['Classic.', 'Neat. Thanks.'],
    chatty: ['Ooh, fancy!', 'I feel like a movie villain now.'], tilted: ['Strong. Good.', 'Just what I needed.'], easy: ['Smooth.', 'Classy, thanks.'] },
};
export function drinkLine(taste, ctx, rng = Math.random) {
  const v = voice(ctx.style);
  const lines = (DRINK_LINES[taste] || DRINK_LINES.cheers)[v];
  if (chance(v === 'dry' ? .45 : .25, rng)) return '';
  return finish(pick(lines, rng).replace('{from}', ctx.from || 'friend'), ctx.style || {}, rng);
}
