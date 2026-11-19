import type { Card, CardId, PlayerId, Suit } from './cards';
import type { RulesConfig } from './rules';

/** What the pickup penalty is made of: only 2s, only Jacks, or both (mixed stacking). */
export type PenaltyKind = 'two' | 'jack' | 'mixed';
export interface Penalty {
  kind: PenaltyKind;
  amount: number;
}

/** What a player asks for. The acting player is attached separately (see Action). */
export type PlayerAction =
  /** `cardIds` is the whole sequence, in play order. `suit` is required when the LAST card is an Ace. */
  | { type: 'play'; cardIds: CardId[]; suit?: Suit; declareJakk?: boolean }
  | { type: 'draw'; declareJakk?: boolean }
  | { type: 'takePenalty'; declareJakk?: boolean }
  /** Declare JAKK for your NEXT turn. Only while it is not your turn (or as a flag on your move). */
  | { type: 'declareJakk' }
  /** Opening Ace with firstCardActive: the first player names the suit before playing. */
  | { type: 'chooseSuit'; suit: Suit };

export type Action = PlayerAction & { playerId: PlayerId };

export type HandEndReason = 'finished' | 'deckExhausted' | 'lastStanding' | 'turnCap';
export interface HandOver {
  /** null = the hand ended with no winner. */
  winner: PlayerId | null;
  reason: HandEndReason;
}

export type OpeningEffect = 'two' | 'jack' | 'ace' | 'king' | 'eight' | 'queen';

/** FULL, server-side state of ONE hand. Never send this to clients - use toPlayerView. */
export interface GameState {
  version: number;
  rules: RulesConfig;
  /** Seating order (clockwise at direction = 1). */
  players: PlayerId[];
  hands: Record<PlayerId, Card[]>;
  /** Top of the pile is the LAST element. */
  drawPile: Card[];
  /** Top of the pile is the LAST element. Never empty after createGame. */
  discard: Card[];
  activeSuit: Suit;
  direction: 1 | -1;
  /** Index into `players`. */
  turn: number;
  /** Index into `players` of the dealer; the first player is the seat after the dealer. */
  dealer: number;
  penalty: Penalty | null;
  /** Players whose JAKK declaration is waiting for / covering their next (or current) turn. */
  jakk: Record<PlayerId, boolean>;
  /** Players who sat out the rest of the hand (deck exhaustion). */
  out: PlayerId[];
  /** bringBacks: players who emptied their hand but leave a live pickup penalty; their win is not confirmed yet. Oldest first. */
  provisional: PlayerId[];
  /** firstCardActive + opening Ace: the first player must name the suit (`chooseSuit`) before anything else. */
  awaitingSuit: boolean;
  /** firstCardActive + opening Queen: the first play's first card must cover it. */
  coverNeeded: boolean;
  /** firstCardActive: which opening effect applied (display only, cleared after the first move). */
  opening: OpeningEffect | null;
  /** Number of turn-ending actions so far (safety cap). */
  turns: number;
  winner: PlayerId | null;
  handOver: HandOver | null;
}

export type RejectionCode =
  | 'GAME_OVER'
  | 'UNKNOWN_PLAYER'
  | 'SITTING_OUT'
  | 'INVALID_ACTION'
  | 'NOT_YOUR_TURN'
  | 'EMPTY_PLAY'
  | 'DUPLICATE_CARD'
  | 'CARD_NOT_IN_HAND'
  | 'ILLEGAL_CARD'
  | 'BAD_SEQUENCE'
  | 'MUST_ANSWER_PENALTY'
  | 'PENALTY_PENDING'
  | 'NO_PENALTY'
  | 'SUIT_REQUIRED'
  | 'MUST_CHOOSE_SUIT'
  | 'NO_SUIT_CHOICE'
  | 'CANNOT_FINISH_ON_POWER'
  | 'JAKK_NOT_ALLOWED'
  | 'JAKK_ALREADY_DECLARED'
  | 'JAKK_DISABLED';

export interface Rejection {
  ok: false;
  code: RejectionCode;
  /** Short, human-readable, suitable for a toast. */
  reason: string;
}

export type FinishBlockReason = 'queen' | 'kingEight' | 'noJakk';
export type DrawReason = 'draw' | 'penalty' | 'queenPenalty' | 'finishPenalty';

/**
 * Events. `playerId` is always the player the event is about / who caused it, EXCEPT:
 *  - `skipped`: playerId = the player who played the 8, `who` = the skipped player
 *  - `turn`: playerId = the player whose turn it now is
 */
export type GameEvent =
  | { type: 'played'; playerId: PlayerId; cards: Card[] }
  /** `cards` is only present for the drawing player (redacted for everyone else). */
  | { type: 'drew'; playerId: PlayerId; count: number; reason: DrawReason; cards?: Card[] }
  | { type: 'penaltyAdded'; playerId: PlayerId; kind: PenaltyKind; added: number; total: number }
  | { type: 'penaltyTaken'; playerId: PlayerId; kind: PenaltyKind; amount: number }
  | { type: 'penaltyCancelled'; playerId: PlayerId; kind: PenaltyKind; amount: number }
  | { type: 'reversed'; playerId: PlayerId; direction: 1 | -1 }
  | { type: 'skipped'; playerId: PlayerId; who: PlayerId }
  | { type: 'suitChosen'; playerId: PlayerId; suit: Suit }
  | { type: 'jakkDeclared'; playerId: PlayerId }
  | { type: 'jakkExpired'; playerId: PlayerId }
  /** The play emptied the hand but could not win: the cards stay played and the player draws `count`. */
  | { type: 'finishBlocked'; playerId: PlayerId; reason: FinishBlockReason; count: number; message: string }
  /** A play ended on a Queen with no cover (`wouldHaveWon`: it also emptied the hand). */
  | { type: 'queenUncovered'; playerId: PlayerId; count: number; wouldHaveWon: boolean }
  /** bringBacks: the player emptied their hand but a pickup penalty is still live. */
  | { type: 'provisionalFinish'; playerId: PlayerId; pending: number }
  /** bringBacks: the pickup penalty reached a provisional finisher, who takes it and is back in. */
  | { type: 'broughtBack'; playerId: PlayerId; amount: number }
  | { type: 'reshuffled'; playerId: PlayerId; count: number }
  /** Deck exhaustion: this player held the most cards and sits out the rest of the hand; their cards went back to the draw pile. */
  | { type: 'satOut'; playerId: PlayerId; cards: number }
  | { type: 'turn'; playerId: PlayerId }
  /** Room-level: the turn timer expired and the server played the default move for this player. */
  | { type: 'timedOut'; playerId: PlayerId }
  | { type: 'won'; playerId: PlayerId }
  | { type: 'handEnded'; winner: PlayerId | null; reason: HandEndReason };

export type ApplyResult = { ok: true; state: GameState; events: GameEvent[] } | Rejection;
