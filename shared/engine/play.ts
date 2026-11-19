// Play legality shared by the engine (full state) and the client helpers (player view).
import {
  type Card,
  type CardId,
  type Suit,
  SUITS,
  SUIT_SYMBOL,
  cardLabel,
  connects,
  isBlackJack,
  isRedJack,
  isSuit,
  rankWithArticle,
} from './cards';
import { type RulesConfig, isPowerRank } from './rules';
import type { FinishBlockReason, Penalty, PenaltyKind, RejectionCode } from './types';

/** Everything public that legality depends on (plus the actor's own JAKK flag). */
export interface PlayContext {
  top: Card;
  activeSuit: Suit;
  penalty: Penalty | null;
  rules: RulesConfig;
  direction: 1 | -1;
  /** Opening Queen with firstCardActive: the first card must cover it. */
  coverNeeded: boolean;
  /** Seats still in the hand (not sitting out). */
  activeSeats: number;
  /** The actor's JAKK declaration is live for this turn. */
  jakkLive: boolean;
}

/** The projected result of a legal play (also what the client shows before the player commits). */
export interface PlayOutcome {
  /** Pickup penalty the next player will face (null = none). */
  penalty: Penalty | null;
  /** True if an incoming penalty is wiped out by this play. */
  cancelsPenalty: boolean;
  skips: number;
  reversals: number;
  /** Direction after the play. */
  direction: 1 | -1;
  /** The sequence ends on a Queen. */
  endsOnQueen: boolean;
  emptiesHand: boolean;
  /** The play empties the hand and wins (immediately, or provisionally with bringBacks). */
  wins: boolean;
  /** The play empties the hand but cannot win; why. */
  blocked: FinishBlockReason | null;
  /** Cards the actor draws straight away because of an uncovered Queen / blocked finish. */
  drawAfter: number;
  /** The same player moves again (2 seats and an 8 / King). */
  goAgain: boolean;
  needsSuit: boolean;
  /** Active suit after the play. */
  suit: Suit;
}

export type CheckResult =
  | { ok: true; cards: Card[]; outcome: PlayOutcome }
  | { ok: false; code: RejectionCode; reason: string };

export function penaltyReason(penalty: Penalty, rules: RulesConfig): string {
  const n = penalty.amount;
  if (penalty.kind === 'two') return rules.mixedStacking ? `Play a 2 or a Jack, or pick up ${n}` : `Play a 2 or a red Jack, or pick up ${n}`;
  if (penalty.kind === 'jack') return rules.mixedStacking ? `Play a Jack or a 2, or pick up ${n}` : `Play a Jack or pick up ${n}`;
  return `Play a 2 or a Jack, or pick up ${n}`;
}

/** May `card` be played while `penalty` is pending? (Every card of the sequence must pass this.) */
export function isDefenceCard(penalty: Penalty, card: Card, rules: RulesConfig): boolean {
  const two = card.rank === '2';
  const black = isBlackJack(card);
  const red = isRedJack(card);
  if (!two && !black && !red) return false;
  switch (penalty.kind) {
    case 'two':
      // a red Jack always cancels a pickup, including one from 2s (owner decision 2026-11-19)
      return two || red || rules.mixedStacking;
    case 'jack':
      return black || red || rules.mixedStacking;
    default:
      return true;
  }
}

/** Does `cover` legally cover the Queen `queen`? */
export function coversQueen(rules: RulesConfig, queen: Card, cover: Card): boolean {
  return rules.flexibleQueenCover || cover.rank === 'Q' || cover.suit === queen.suit;
}

/** Null when `card` may START a play; otherwise the rejection. (Ignores finishing rules.) */
function startRejection(ctx: PlayContext, card: Card): { code: RejectionCode; reason: string } | null {
  const { penalty, rules } = ctx;
  if (penalty) {
    return isDefenceCard(penalty, card, rules) ? null : { code: 'MUST_ANSWER_PENALTY', reason: penaltyReason(penalty, rules) };
  }
  if (ctx.coverNeeded) {
    if (coversQueen(rules, ctx.top, card)) return null;
    return { code: 'ILLEGAL_CARD', reason: `Cover the Queen with a ${SUIT_SYMBOL[ctx.top.suit]} or another Queen` };
  }
  if (card.rank === 'A') return null;
  if (card.suit === ctx.activeSuit || card.rank === ctx.top.rank) return null;
  return {
    code: 'ILLEGAL_CARD',
    reason: `Must match ${SUIT_SYMBOL[ctx.activeSuit]} or ${rankWithArticle(ctx.top.rank)}`,
  };
}

/** Why a play of `cards` (emptying the hand) may not be made at all; null if allowed. */
function finishRejection(ctx: PlayContext, last: Card): { code: RejectionCode; reason: string } | null {
  if (!ctx.rules.finishOnPower && isPowerRank(last.rank)) {
    return { code: 'CANNOT_FINISH_ON_POWER', reason: "You can't finish on a power card (Ace, 2, 8, Jack or King)" };
  }
  return null;
}

/** May `card` start a play from a hand of `handSize` cards? */
export function isLegalStart(ctx: PlayContext, card: Card, handSize: number): boolean {
  if (startRejection(ctx, card)) return false;
  if (handSize === 1 && finishRejection(ctx, card)) return false;
  return true;
}

/** May `next` follow `prev` inside a sequence (ignoring pickup penalties)? */
export function mayFollow(ctx: PlayContext, prev: Card, next: Card): boolean {
  if (prev.rank === 'Q') return coversQueen(ctx.rules, prev, next);
  return connects(prev, next);
}

function followRejection(ctx: PlayContext, prev: Card, next: Card): { code: RejectionCode; reason: string } | null {
  if (ctx.penalty && !isDefenceCard(ctx.penalty, next, ctx.rules)) {
    return { code: 'MUST_ANSWER_PENALTY', reason: penaltyReason(ctx.penalty, ctx.rules) };
  }
  if (mayFollow(ctx, prev, next)) return null;
  if (prev.rank === 'Q') {
    return { code: 'BAD_SEQUENCE', reason: `Cover the Queen with a ${SUIT_SYMBOL[prev.suit]} or another Queen` };
  }
  return {
    code: 'BAD_SEQUENCE',
    reason: `${cardLabel(next)} doesn't follow ${cardLabel(prev)}: same rank, or same suit one up or down`,
  };
}

/** Walk the pickup tally over a sequence (rules 77 and 87). */
export function tallyPenalty(rules: RulesConfig, incoming: Penalty | null, cards: readonly Card[]): Penalty | null {
  let amount = incoming?.amount ?? 0;
  let kind: PenaltyKind | null = incoming ? incoming.kind : null;
  let added = 0;
  for (const c of cards) {
    const two = c.rank === '2';
    if (two || isBlackJack(c)) {
      const k: PenaltyKind = two ? 'two' : 'jack';
      const n = two ? rules.twoPenalty : rules.blackJackPenalty;
      kind = kind === null || amount === 0 ? k : kind === k ? k : 'mixed';
      amount += n;
      added += n;
    } else if (isRedJack(c) && amount > 0) {
      amount = 0;
      kind = null;
      added = 0;
    } else if (added > 0) {
      // any other card after pickup cards clears what this turn added
      amount -= added;
      added = 0;
      kind = amount > 0 ? (incoming?.kind ?? kind) : null;
    }
  }
  return amount > 0 && kind ? { kind, amount } : null;
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
  const bad = startRejection(ctx, cards[0]);
  if (bad) return { ok: false, ...bad };
  for (let i = 1; i < cards.length; i++) {
    const r = followRejection(ctx, cards[i - 1], cards[i]);
    if (r) return { ok: false, ...r };
  }
  const last = cards[cards.length - 1];
  const rules = ctx.rules;
  const needsSuit = last.rank === 'A';
  if (needsSuit && !(isSuit(suit) && SUITS.includes(suit))) {
    return { ok: false, code: 'SUIT_REQUIRED', reason: 'Choose a suit for your Ace' };
  }
  const emptiesHand = cards.length === hand.length;
  if (emptiesHand) {
    const f = finishRejection(ctx, last);
    if (f) return { ok: false, ...f };
  }

  const penalty = tallyPenalty(rules, ctx.penalty, cards);
  let skips = 0;
  let reversals = 0;
  for (const c of cards) {
    if (rules.skipRank !== null && c.rank === rules.skipRank) skips++;
    else if (rules.reverseRank !== null && c.rank === rules.reverseRank) reversals++;
  }
  const endsOnQueen = last.rank === 'Q';
  let blocked: FinishBlockReason | null = null;
  if (emptiesHand) {
    if (endsOnQueen) blocked = 'queen';
    else if (ctx.activeSeats === 2 && ((rules.skipRank !== null && last.rank === rules.skipRank) || (rules.reverseRank !== null && last.rank === rules.reverseRank))) blocked = 'kingEight';
    else if (rules.jakkEnabled && !ctx.jakkLive) blocked = 'noJakk';
  }
  const drawAfter = blocked ? rules.finishPenalty : endsOnQueen ? rules.uncoveredQueenPenalty : 0;
  return {
    ok: true,
    cards,
    outcome: {
      penalty,
      cancelsPenalty: !!ctx.penalty && !penalty,
      skips,
      reversals,
      direction: reversals % 2 === 0 ? ctx.direction : ((ctx.direction * -1) as 1 | -1),
      endsOnQueen,
      emptiesHand,
      wins: emptiesHand && !blocked,
      blocked,
      drawAfter,
      goAgain: ctx.activeSeats === 2 && (skips > 0 || reversals > 0),
      needsSuit,
      suit: needsSuit ? (suit as Suit) : last.suit,
    },
  };
}
