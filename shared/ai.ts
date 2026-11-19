// Bot move chooser. Takes ONLY a PlayerView (own hand + public info) - never the full state.
import {
  type Card,
  type CardId,
  type PlayOutcome,
  type PlayerAction,
  type PlayerView,
  type Suit,
  SUITS,
  connects,
  coversQueen,
  getAddableCardIds,
  getLegalCardIds,
  isPowerRank,
  previewPlay,
} from './engine';

export interface BotOptions {
  /** Whether this bot will declare JAKK when a finish looks plausible next turn. The SERVER rolls this (~90% true). */
  declareJakk: boolean;
}

const MAX_CANDIDATES = 500;
const MAX_DEPTH = 8;

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

/** Could every card of `cards` be played as one chain (in some order), ignoring the pile? Used to decide on JAKK. */
function chainable(view: PlayerView, cards: readonly Card[]): boolean {
  if (cards.length <= 1) return true;
  if (cards.length > 5) return false;
  const follows = (a: Card, b: Card) => (a.rank === 'Q' ? coversQueen(view.rules, a, b) : connects(a, b));
  const go = (last: Card, rest: Card[]): boolean => {
    if (rest.length === 0) return true;
    return rest.some((c, i) => follows(last, c) && go(c, rest.filter((_, j) => j !== i)));
  };
  return cards.some((c, i) => go(c, cards.filter((_, j) => j !== i)));
}

interface Candidate {
  ids: CardId[];
  suit?: Suit;
  outcome: PlayOutcome;
  remaining: Card[];
  score: number;
}

function enumerate(view: PlayerView): Candidate[] {
  const out: Candidate[] = [];
  const byId = new Map(view.hand.map((c) => [c.id, c]));
  const visit = (chain: CardId[]) => {
    if (out.length >= MAX_CANDIDATES) return;
    const cards = chain.map((id) => byId.get(id)!);
    const remaining = view.hand.filter((c) => !chain.includes(c.id));
    const last = cards[cards.length - 1];
    const suit = last.rank === 'A' ? bestSuit(remaining, view.activeSuit) : undefined;
    const check = previewPlay(view, chain, suit);
    if (check.ok) out.push({ ids: chain, suit, outcome: check.outcome, remaining, score: 0 });
    if (chain.length >= MAX_DEPTH) return;
    for (const next of getAddableCardIds(view, chain)) visit([...chain, next]);
  };
  for (const id of getLegalCardIds(view)) visit([id]);
  return out;
}

function nextOpponent(view: PlayerView): { id: string; count: number } | null {
  const n = view.players.length;
  const myIdx = view.players.indexOf(view.you);
  for (let k = 1; k < n; k++) {
    const id = view.players[(((myIdx + view.direction * k) % n) + n) % n];
    if (!view.out.includes(id)) return { id, count: view.handCounts[id] };
  }
  return null;
}

function scoreCandidate(view: PlayerView, c: Candidate, threatened: boolean): number {
  const o = c.outcome;
  const cards = c.ids.map((id) => view.hand.find((h) => h.id === id)!);
  const last = cards[cards.length - 1];
  if (o.wins) return 100000 + cards.length;
  let score = cards.length * 30;
  if (o.blocked) score -= 400; // emptying the hand illegally: costs the cards back and the win
  if (o.endsOnQueen && !o.blocked) score -= 250; // an uncovered Queen costs a card
  // attacks
  if (o.penalty) {
    const incoming = view.penalty?.amount ?? 0;
    if (o.penalty.amount > incoming) score += threatened ? 150 : 30;
  }
  if (view.penalty && o.cancelsPenalty) score += 300;
  if (o.skips > 0) score += threatened ? 130 * o.skips : 10 * o.skips;
  if (o.reversals % 2 === 1) score += threatened && view.players.length > 2 ? 100 : 0;
  if (o.goAgain) score += 40;
  // hold wild / power cards for when they matter
  if (last.rank === 'A' && c.remaining.length > 0) score -= 40;
  for (const card of cards) {
    if (isPowerRank(card.rank) && !threatened && !view.penalty) score -= 8;
    if (card.rank === 'A') score -= 8;
  }
  // leave the next player a suit we are strong in, keep our hand coherent
  const counts = suitCounts(c.remaining);
  score += counts[o.suit] * 4;
  if (c.remaining.length > 0 && chainable(view, c.remaining)) score += 25;
  return score;
}

/**
 * Choose what a bot should do, or null when there is nothing to do (not its turn / game over).
 * Strategy: name a suit for an opening Ace; answer penalties (red Jack cancel first, else stack); otherwise enumerate
 * every legal sequence (same-rank groups and runs), prefer ones that win, shed the most cards, attack/skip/reverse
 * when the next opponent is nearly out, never end on a Queen if avoidable; declare JAKK (per bot option) when its
 * remaining cards could plausibly finish next turn.
 */
export function chooseBotAction(view: PlayerView, opts: BotOptions): PlayerAction | null {
  if (view.handOver || view.spectator || view.turn !== view.you || view.out.includes(view.you)) return null;
  if (view.awaitingSuit) return { type: 'chooseSuit', suit: bestSuit(view.hand, view.activeSuit) };

  const declareFor = (remaining: readonly Card[]) =>
    view.rules.jakkEnabled && opts.declareJakk && remaining.length > 0 && !view.jakk[view.you] && (remaining.length <= 2 || chainable(view, remaining));
  const passAction = (type: 'draw' | 'takePenalty'): PlayerAction => {
    const a: { type: 'draw' | 'takePenalty'; declareJakk?: boolean } = { type };
    // drawing/taking leaves us with MORE cards, so a finish is only plausible with a very small hand
    if (view.rules.jakkEnabled && opts.declareJakk && view.hand.length <= 2 && !view.jakk[view.you]) a.declareJakk = true;
    return a;
  };

  const legalIds = getLegalCardIds(view);
  if (legalIds.length === 0) return passAction(view.penalty ? 'takePenalty' : 'draw');

  const next = nextOpponent(view);
  const threatened = !!next && next.count <= 2;
  const cands = enumerate(view);
  if (cands.length === 0) return passAction(view.penalty ? 'takePenalty' : 'draw');
  for (const c of cands) c.score = scoreCandidate(view, c, threatened);
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0];
  // Under a penalty, never stack when we could survive cheaply and stacking is not an attack... keep it simple: defend.
  const action: PlayerAction = { type: 'play', cardIds: best.ids };
  if (best.suit) action.suit = best.suit;
  if (declareFor(best.remaining)) action.declareJakk = true;
  return action;
}

