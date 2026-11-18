import type { Card, CardId, PlayerId, Suit } from './cards';
import type { RulesConfig } from './rules';

export type PenaltyKind = 'two' | 'jack';
export interface Penalty {
  kind: PenaltyKind;
  amount: number;
}

/** What a player asks for. The acting player is attached separately (see Action). */
export type PlayerAction =
  | { type: 'play'; cardIds: CardId[]; suit?: Suit; declareJakk?: boolean }
  | { type: 'draw' }
  | { type: 'takePenalty' }
  | { type: 'pass' } // only meaningful with rules.playAfterDraw
  | { type: 'declareJakk' };

export type Action = PlayerAction & { playerId: PlayerId };

/** FULL, server-side game state. Never send this to clients - use toPlayerView. */
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
  penalty: Penalty | null;
  jakkOwed: PlayerId | null;
  /** Only with rules.playAfterDraw: the card just drawn (the turn player may play only it, or pass). */
  drewCardId: CardId | null;
  winner: PlayerId | null;
}

export type RejectionCode =
  | 'GAME_OVER'
  | 'UNKNOWN_PLAYER'
  | 'INVALID_ACTION'
  | 'NOT_YOUR_TURN'
  | 'EMPTY_PLAY'
  | 'DUPLICATE_CARD'
  | 'CARD_NOT_IN_HAND'
  | 'MULTI_DISABLED'
  | 'MIXED_RANKS'
  | 'ILLEGAL_CARD'
  | 'MUST_ANSWER_PENALTY'
  | 'PENALTY_PENDING'
  | 'NO_PENALTY'
  | 'SUIT_REQUIRED'
  | 'CANNOT_FINISH_ON_POWER'
  | 'JAKK_NOT_NEEDED'
  | 'MUST_PLAY_DRAWN'
  | 'ALREADY_DREW'
  | 'CANNOT_PASS';

export interface Rejection {
  ok: false;
  code: RejectionCode;
  /** Short, human-readable, suitable for a toast. */
  reason: string;
}

/**
 * Events. `playerId` is always the player the event is about / who caused it, EXCEPT:
 *  - `skipped`: playerId = the player who played the skip card (8), `who` = the skipped player
 *  - `turn`: playerId = the player whose turn it now is
 *  - `jakkMissed`: playerId = the forgetful player (the one who drew the penalty)
 */
export type GameEvent =
  | { type: 'played'; playerId: PlayerId; cards: Card[] }
  /** `cards` is only present for the drawing player (redacted for everyone else). */
  | { type: 'drew'; playerId: PlayerId; count: number; reason: 'draw' | 'penalty' | 'jakkMiss'; cards?: Card[] }
  | { type: 'penaltyAdded'; playerId: PlayerId; kind: PenaltyKind; added: number; total: number }
  | { type: 'penaltyTaken'; playerId: PlayerId; kind: PenaltyKind; amount: number }
  | { type: 'penaltyCancelled'; playerId: PlayerId; kind: PenaltyKind; amount: number }
  | { type: 'reversed'; playerId: PlayerId; direction: 1 | -1 }
  | { type: 'skipped'; playerId: PlayerId; who: PlayerId }
  | { type: 'suitChosen'; playerId: PlayerId; suit: Suit }
  | { type: 'jakkDeclared'; playerId: PlayerId }
  | { type: 'jakkMissed'; playerId: PlayerId }
  | { type: 'reshuffled'; playerId: PlayerId; count: number }
  | { type: 'turn'; playerId: PlayerId }
  | { type: 'won'; playerId: PlayerId };

export type ApplyResult = { ok: true; state: GameState; events: GameEvent[] } | Rejection;
