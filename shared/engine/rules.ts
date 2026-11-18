import type { Rank } from './cards';

/**
 * Every number / toggle of the (PROVISIONAL) rulebook lives here.
 * The server always uses DEFAULT_RULES; tests override individual fields.
 */
export interface RulesConfig {
  minPlayers: number;
  maxPlayers: number;
  /** Cards dealt to each player. */
  handSize: number;
  /** Allow several cards of the same rank in one turn. */
  multiPlay: boolean;
  /** Cards drawn when a player draws voluntarily / has no play. */
  drawCount: number;
  /** After a voluntary draw the player may play the drawn card (only that card) or pass. Default: turn simply ends. */
  playAfterDraw: boolean;
  /** Ranks that count as "power" cards (start-card burying, canFinishOnPower). */
  powerRanks: Rank[];
  /** If false, a play that would empty the hand with a power-rank card is rejected. */
  canFinishOnPower: boolean;

  twoPenalty: number;
  /** A 2 may be answered with 2(s). */
  stackTwos: boolean;

  blackJackPenalty: number;
  /** A black Jack may be answered with a black Jack. */
  stackBlackJacks: boolean;
  /** A red Jack on an active Jack penalty cancels it. */
  redJackCancels: boolean;

  /** 8 reverses direction (with 2 players: the player goes again). */
  eightReverses: boolean;
  /** 7 skips the next player (with 2 players: the player goes again). */
  sevenSkips: boolean;
  /** Ace is wild when no penalty is pending; player nominates the suit. */
  aceWild: boolean;

  jakkEnabled: boolean;
  /** Cards drawn by a player who fails to declare JAKK in time. */
  jakkMissPenalty: number;
}

export const DEFAULT_RULES: RulesConfig = {
  minPlayers: 2,
  maxPlayers: 4,
  handSize: 7,
  multiPlay: true,
  drawCount: 1,
  playAfterDraw: false,
  powerRanks: ['2', '7', '8', 'J', 'A'],
  canFinishOnPower: true,
  twoPenalty: 2,
  stackTwos: true,
  blackJackPenalty: 5,
  stackBlackJacks: true,
  redJackCancels: true,
  eightReverses: true,
  sevenSkips: true,
  aceWild: true,
  jakkEnabled: true,
  jakkMissPenalty: 2,
};

export function withRules(overrides: Partial<RulesConfig> = {}): RulesConfig {
  return { ...DEFAULT_RULES, ...overrides, powerRanks: overrides.powerRanks ?? [...DEFAULT_RULES.powerRanks] };
}

export function isPowerRank(rank: Rank, rules: RulesConfig): boolean {
  return rules.powerRanks.includes(rank);
}
