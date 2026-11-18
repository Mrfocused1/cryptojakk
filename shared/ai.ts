// Bot move chooser. Takes ONLY a PlayerView (own hand + public info) - never the full state.
import {
  type Card,
  type CardId,
  type PlayerAction,
  type PlayerView,
  type Suit,
  SUITS,
  getLegalCardIds,
  isBlackJack,
  isPowerRank,
  previewPlay,
} from './engine';

export interface BotOptions {
  /** Whether this bot will declare JAKK when it leaves itself with 1 card. The SERVER rolls this (~90% true). */
  declareJakk: boolean;
}

function suitCounts(cards: readonly Card[]): Record<Suit, number> {
  const c: Record<Suit, number> = { S: 0, H: 0, D: 0, C: 0 };
  for (const card of cards) c[card.suit]++;
  return c;
}

/** Most-held suit of `cards`; ties prefer `prefer`, then S,H,D,C order. */
function bestSuit(cards: readonly Card[], prefer: Suit): Suit {
  const counts = suitCounts(cards);
  let best: Suit = prefer;
  for (const s of SUITS) if (counts[s] > counts[best]) best = s;
  return best;
}

/** Arrange a same-rank group: a legal card first, and the card whose suit we hold most last. */
function orderGroup(view: PlayerView, group: Card[], legal: Set<CardId>): { order: Card[]; score: number } | null {
  const others = view.hand.filter((c) => !group.includes(c));
  const counts = suitCounts(others);
  let best: { order: Card[]; score: number } | null = null;
  for (const first of group.filter((c) => legal.has(c.id))) {
    let order: Card[];
    if (!view.rules.multiPlay || group.length === 1) {
      order = [first];
    } else {
      const rest = group.filter((c) => c !== first);
      let last = rest[0];
      for (const c of rest) if (counts[c.suit] > counts[last.suit]) last = c;
      order = [first, ...rest.filter((c) => c !== last), last];
    }
    const score = counts[order[order.length - 1].suit];
    if (!best || score > best.score) best = { order, score };
  }
  return best;
}

function makePlay(view: PlayerView, order: Card[], opts: BotOptions): PlayerAction | null {
  let cards = order;
  while (cards.length > 0) {
    const remaining = view.hand.filter((c) => !cards.includes(c));
    const suit = cards[0].rank === 'A' ? bestSuit(remaining, view.activeSuit) : undefined;
    const check = previewPlay(view, cards.map((c) => c.id), suit);
    if (check.ok) {
      const action: PlayerAction = { type: 'play', cardIds: cards.map((c) => c.id) };
      if (suit) action.suit = suit;
      if (remaining.length === 1) action.declareJakk = opts.declareJakk;
      return action;
    }
    cards = cards.slice(0, -1);
  }
  return null;
}

/**
 * Choose what a bot should do, or null when there is nothing to do (not its turn / game over).
 * Strategy: answer penalties when able; otherwise prefer the largest same-rank set, hold Aces until
 * nothing else is playable, prefer attack/skip/reverse cards when the next opponent has <= 2 cards (and avoid leaving them a Queen),
 * nominate the most-held suit.
 */
export function chooseBotAction(view: PlayerView, opts: BotOptions): PlayerAction | null {
  if (view.winner || view.turn !== view.you) return null;
  const legalIds = getLegalCardIds(view);
  const legal = new Set(legalIds);

  if (view.hasDrawn) {
    // playAfterDraw: play the drawn card if possible, else pass.
    const card = view.hand.find((c) => legal.has(c.id));
    const play = card ? makePlay(view, [card], opts) : null;
    return play ?? { type: 'pass' };
  }

  if (view.penalty) {
    if (legalIds.length === 0) return { type: 'takePenalty' };
    // Prefer cancelling with red Jacks; otherwise stack on. Play every card of the answering kind.
    const answers = view.hand.filter((c) => legal.has(c.id));
    const reds = answers.filter((c) => c.rank === 'J' && !isBlackJack(c));
    const pick = reds.length > 0 ? reds : answers;
    const play = makePlay(view, pick, opts);
    return play ?? { type: 'takePenalty' };
  }

  if (legalIds.length === 0) return { type: 'draw' };

  const myIdx = view.players.indexOf(view.you);
  const nextId = view.players[(((myIdx + view.direction) % view.players.length) + view.players.length) % view.players.length];
  const threatened = nextId !== view.you && view.handCounts[nextId] <= 2;

  const ranks = new Set(view.hand.filter((c) => legal.has(c.id)).map((c) => c.rank));
  let best: { action: PlayerAction; score: number } | null = null;
  for (const rank of ranks) {
    const group = view.hand.filter((c) => c.rank === rank);
    const arranged = orderGroup(view, group, legal);
    if (!arranged) continue;
    const action = makePlay(view, arranged.order, opts);
    if (!action || action.type !== 'play') continue;
    const played = action.cardIds.length;
    const clears = played === view.hand.length;
    const { skipRank, reverseRank } = view.rules;
    // Skip and reverse both keep a threatening next opponent (<= 2 cards) from moving right away.
    const attack = rank === '2' || (skipRank !== null && rank === skipRank) || (reverseRank !== null && rank === reverseRank) || arranged.order.some(isBlackJack);
    // A Queen on top accepts anything: don't hand that to an opponent who is nearly out (unless it wins).
    const gift = rank === 'Q' && view.rules.queenAcceptsAny && threatened;
    const score =
      (clears ? 1000 : 0) +
      (gift ? -400 : 0) +
      (rank === 'A' ? 0 : 500) +
      (threatened && attack ? 200 : 0) +
      played * 20 +
      (isPowerRank(rank, view.rules) ? 0 : 5) +
      arranged.score;
    if (!best || score > best.score) best = { action, score };
  }
  return best ? best.action : { type: 'draw' };
}
