// Pure card primitives. No Node/DOM imports.

export const SUITS = ['S', 'H', 'D', 'C'] as const;
export type Suit = (typeof SUITS)[number];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export type Rank = (typeof RANKS)[number];

/** Card ids are rank + suit letter, e.g. "7H", "10S", "AC". Unique per deck. */
export type CardId = string;
export type PlayerId = string;

export interface Card {
  readonly id: CardId;
  readonly rank: Rank;
  readonly suit: Suit;
}

/** `() => number` returning a float in [0, 1). Injected everywhere randomness is needed. */
export type Rng = () => number;

export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAME: Record<Suit, string> = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };

export function isRedSuit(suit: Suit): boolean {
  return suit === 'H' || suit === 'D';
}

export function isSuit(x: unknown): x is Suit {
  return typeof x === 'string' && (SUITS as readonly string[]).includes(x);
}

export function isRank(x: unknown): x is Rank {
  return typeof x === 'string' && (RANKS as readonly string[]).includes(x);
}

const CARD_CACHE = new Map<CardId, Card>();
for (const suit of SUITS) {
  for (const rank of RANKS) {
    const id = `${rank}${suit}`;
    CARD_CACHE.set(id, Object.freeze({ id, rank, suit }));
  }
}

export function isCardId(x: unknown): x is CardId {
  return typeof x === 'string' && CARD_CACHE.has(x);
}

/** Look up the canonical card object for an id. Throws on an unknown id (programmer error). */
export function cardFromId(id: CardId): Card {
  const c = CARD_CACHE.get(id);
  if (!c) throw new Error(`Unknown card id: ${id}`);
  return c;
}

export function buildDeck(): Card[] {
  return [...CARD_CACHE.values()];
}

/** Fisher-Yates. Returns a NEW array; `rng` must return floats in [0,1). */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function rankName(rank: Rank): string {
  switch (rank) {
    case 'A': return 'Ace';
    case 'J': return 'Jack';
    case 'Q': return 'Queen';
    case 'K': return 'King';
    default: return rank;
  }
}

/** "a 9", "an 8", "an Ace", "a Queen" */
export function rankWithArticle(rank: Rank): string {
  const name = rankName(rank);
  return `${rank === '8' || rank === 'A' ? 'an' : 'a'} ${name}`;
}

/** J♠ and J♣ */
export function isBlackJack(card: Card): boolean {
  return card.rank === 'J' && !isRedSuit(card.suit);
}
export function isRedJack(card: Card): boolean {
  return card.rank === 'J' && isRedSuit(card.suit);
}

/** A=1 ... K=13. Runs use this: A is adjacent to 2 only (no K-A wrap). */
export function rankValue(rank: Rank): number {
  return (RANKS as readonly string[]).indexOf(rank) + 1;
}

/** "7♥" */
export function cardLabel(c: Pick<Card, 'rank' | 'suit'>): string {
  return `${c.rank}${SUIT_SYMBOL[c.suit]}`;
}

/** Two cards connect in a sequence when they share a rank, or share a suit with ranks exactly one apart. */
export function connects(prev: Card, next: Card): boolean {
  if (prev.rank === next.rank) return true;
  return prev.suit === next.suit && Math.abs(rankValue(prev.rank) - rankValue(next.rank)) === 1;
}
