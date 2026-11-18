// Play legality shared by the engine (full state) and the client helpers (player view).
import {
  type Card,
  type CardId,
  type Suit,
  SUITS,
  SUIT_SYMBOL,
  isBlackJack,
  isRedJack,
  isSuit,
  rankWithArticle,
} from './cards';
import { type RulesConfig, isPowerRank } from './rules';
import type { Penalty, RejectionCode } from './types';

/** Everything public that legality depends on. */
export interface PlayContext {
  top: Card;
  activeSuit: Suit;
  penalty: Penalty | null;
  rules: RulesConfig;
  /** With playAfterDraw: the only card that may be played. */
  mustPlayId: CardId | null;
}

export type CheckResult =
  | { ok: true; cards: Card[] }
  | { ok: false; code: RejectionCode; reason: string };

export function penaltyReason(penalty: Penalty, rules: RulesConfig): string {
  if (penalty.kind === 'two') {
    return rules.stackTwos ? `Play a 2 or pick up ${penalty.amount}` : `Pick up ${penalty.amount}`;
  }
  return `Play a Jack or pick up ${penalty.amount}`;
}

/** Null when `card` may START a play; otherwise the rejection. (Ignores the finish-on-power rule.) */
function startRejection(ctx: PlayContext, card: Card): { code: RejectionCode; reason: string } | null {
  const { penalty, rules } = ctx;
  if (penalty) {
    let ok: boolean;
    if (penalty.kind === 'two') ok = rules.stackTwos && card.rank === '2';
    else if (isBlackJack(card)) ok = rules.stackBlackJacks;
    else ok = isRedJack(card) && rules.redJackCancels;
    return ok ? null : { code: 'MUST_ANSWER_PENALTY', reason: penaltyReason(penalty, rules) };
  }
  if (rules.aceWild && card.rank === 'A') return null;
  if (card.suit === ctx.activeSuit || card.rank === ctx.top.rank) return null;
  return {
    code: 'ILLEGAL_CARD',
    reason: `Must match ${SUIT_SYMBOL[ctx.activeSuit]} or ${rankWithArticle(ctx.top.rank)}`,
  };
}

/** May `card` start a play from a hand of `handSize` cards? */
export function isLegalStart(ctx: PlayContext, card: Card, handSize: number): boolean {
  if (ctx.mustPlayId && card.id !== ctx.mustPlayId) return false;
  if (startRejection(ctx, card)) return false;
  if (handSize === 1 && !ctx.rules.canFinishOnPower && isPowerRank(card.rank, ctx.rules)) return false;
  return true;
}

/** Full validation of a proposed play. Pure; never throws. */
export function checkPlay(ctx: PlayContext, hand: readonly Card[], cardIds: readonly CardId[], suit?: Suit): CheckResult {
  if (!Array.isArray(cardIds) || cardIds.length === 0) {
    return { ok: false, code: 'EMPTY_PLAY', reason: 'Pick a card to play' };
  }
  if (new Set(cardIds).size !== cardIds.length) {
    return { ok: false, code: 'DUPLICATE_CARD', reason: 'Each card can only be played once' };
  }
  const cards: Card[] = [];
  for (const id of cardIds) {
    const c = hand.find((h) => h.id === id);
    if (!c) return { ok: false, code: 'CARD_NOT_IN_HAND', reason: "That card isn't in your hand" };
    cards.push(c);
  }
  if (ctx.mustPlayId && !(cards.length === 1 && cards[0].id === ctx.mustPlayId)) {
    return { ok: false, code: 'MUST_PLAY_DRAWN', reason: 'Play the card you drew, or pass' };
  }
  if (cards.length > 1) {
    if (!ctx.rules.multiPlay) return { ok: false, code: 'MULTI_DISABLED', reason: 'Play one card at a time' };
    if (cards.some((c) => c.rank !== cards[0].rank)) {
      return { ok: false, code: 'MIXED_RANKS', reason: 'Cards must be the same rank' };
    }
  }
  const bad = startRejection(ctx, cards[0]);
  if (bad) return { ok: false, ...bad };
  if (cards.length === hand.length && !ctx.rules.canFinishOnPower && isPowerRank(cards[0].rank, ctx.rules)) {
    return { ok: false, code: 'CANNOT_FINISH_ON_POWER', reason: "You can't finish on a power card" };
  }
  if (cards[0].rank === 'A' && ctx.rules.aceWild && !(isSuit(suit) && SUITS.includes(suit))) {
    return { ok: false, code: 'SUIT_REQUIRED', reason: 'Choose a suit for your Ace' };
  }
  return { ok: true, cards };
}
