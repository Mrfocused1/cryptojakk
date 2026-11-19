import type { Rank } from './cards';

/**
 * Every number / toggle of the rulebook lives here (see docs/RULEBOOK.md).
 * The server always starts from DEFAULT_RULES plus the host's house rules; tests override individual fields.
 */
export interface RulesConfig {
  minPlayers: number;
  maxPlayers: number;
  /** Cards dealt to each player. */
  handSize: number;
  /** Cards drawn when a player draws (voluntarily or because they have no play). The turn then ends. */
  drawCount: number;

  twoPenalty: number;
  blackJackPenalty: number;
  /** Rank that skips one more seat per card played (2 players: the player goes again). null = no skip card. */
  skipRank: Rank | null;
  /** Rank that flips the direction once per card played (2 players: the player goes again). null = no reverse card. */
  reverseRank: Rank | null;
  /** Cards drawn when a play ends on an uncovered Queen. */
  uncoveredQueenPenalty: number;
  /** Cards drawn when the hand is emptied illegally (no JAKK, Queen, 2-player King/8). The player stays in. */
  finishPenalty: number;
  jakkEnabled: boolean;

  // ---- house rules (host-configurable, lobby only) ----
  /** true: any card may cover a Queen. false (strict): same suit or another Queen. */
  flexibleQueenCover: boolean;
  /** true: 2s and black Jacks stack on each other and a red Jack cancels any penalty. false: a 2-penalty is answered only by 2s. */
  mixedStacking: boolean;
  /** true: a finisher who leaves a live pickup penalty is only provisionally out until it is absorbed or comes back to them. */
  bringBacks: boolean;
  /** false: a play that would empty the hand ending on A, 2, 8, J or K is rejected. */
  finishOnPower: boolean;
  /** true: the opening discard's effect applies (as if the dealer had played it). false: it is neutral. */
  firstCardActive: boolean;
}

export const HOUSE_RULE_KEYS = ['flexibleQueenCover', 'mixedStacking', 'bringBacks', 'finishOnPower', 'firstCardActive'] as const;
export type HouseRuleKey = (typeof HOUSE_RULE_KEYS)[number];
export type HouseRules = Pick<RulesConfig, HouseRuleKey>;

export const HANDS_TO_WIN_OPTIONS = [1, 3, 5] as const;
export const TURN_SECONDS_OPTIONS = [0, 20, 30, 45, 60] as const;

/** Room-level options that are not engine rules. */
export interface MatchOptions {
  /** Hands a player must win to win the match. */
  handsToWin: (typeof HANDS_TO_WIN_OPTIONS)[number];
  /** 0 = no turn timer. */
  turnSeconds: (typeof TURN_SECONDS_OPTIONS)[number];
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = { handsToWin: 1, turnSeconds: 0 };

export const DEFAULT_RULES: RulesConfig = {
  minPlayers: 2,
  maxPlayers: 6,
  handSize: 7,
  drawCount: 1,
  twoPenalty: 2,
  blackJackPenalty: 5,
  skipRank: '8',
  reverseRank: 'K',
  uncoveredQueenPenalty: 1,
  finishPenalty: 1,
  jakkEnabled: true,
  flexibleQueenCover: true,
  mixedStacking: true,
  bringBacks: false,
  finishOnPower: true,
  firstCardActive: false,
};

export function withRules(overrides: Partial<RulesConfig> = {}): RulesConfig {
  return { ...DEFAULT_RULES, ...overrides };
}

export function houseRulesOf(rules: RulesConfig): HouseRules {
  return {
    flexibleQueenCover: rules.flexibleQueenCover,
    mixedStacking: rules.mixedStacking,
    bringBacks: rules.bringBacks,
    finishOnPower: rules.finishOnPower,
    firstCardActive: rules.firstCardActive,
  };
}

/** Ranks that may not be the finishing card when `finishOnPower` is off. */
export const POWER_FINISH_RANKS: readonly Rank[] = ['A', '2', '8', 'J', 'K'];

export function isPowerRank(rank: Rank): boolean {
  return POWER_FINISH_RANKS.includes(rank);
}

/** True if `x` looks like a RulesConfig of the current version (used to discard incompatible saves). */
export function isCurrentRules(x: unknown): x is RulesConfig {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.flexibleQueenCover === 'boolean' &&
    typeof r.mixedStacking === 'boolean' &&
    typeof r.bringBacks === 'boolean' &&
    typeof r.finishOnPower === 'boolean' &&
    typeof r.firstCardActive === 'boolean' &&
    'skipRank' in r &&
    'reverseRank' in r &&
    typeof r.finishPenalty === 'number'
  );
}
