import {
  type Action,
  type GameEvent,
  type GameState,
  type Penalty,
  type PlayerId,
  type RulesConfig,
  type Suit,
  applyAction,
  buildDeck,
  cardFromId,
  withRules,
} from '../shared/engine';

/** Deterministic PRNG (mulberry32). */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ScenarioOpts {
  /** Player id -> card ids. Key order == seating order. */
  hands: Record<PlayerId, string[]>;
  top: string;
  /** Defaults to the suit of `top`. */
  suit?: Suit;
  turn: PlayerId;
  direction?: 1 | -1;
  penalty?: Penalty | null;
  /** Players with a live JAKK declaration. */
  jakk?: PlayerId[];
  /** Cards that will be drawn next, first element first. */
  draw?: string[];
  /** Cards under the top discard (bottom first). */
  under?: string[];
  /** Where all unlisted cards go: 'draw' (default, beneath `draw`) or 'discard' (under the top). */
  rest?: 'draw' | 'discard' | 'none';
  rules?: Partial<RulesConfig>;
  out?: PlayerId[];
  provisional?: PlayerId[];
  dealer?: PlayerId;
  coverNeeded?: boolean;
  awaitingSuit?: boolean;
}

/** Build an exact GameState (all 52 cards accounted for, unless rest: 'none'). */
export function scenario(o: ScenarioOpts): GameState {
  const players = Object.keys(o.hands);
  const used = new Set<string>([...Object.values(o.hands).flat(), o.top, ...(o.draw ?? []), ...(o.under ?? [])]);
  const total = Object.values(o.hands).flat().length + 1 + (o.draw ?? []).length + (o.under ?? []).length;
  if (used.size !== total) throw new Error('scenario: duplicate card ids');
  const rest = o.rest === 'none' ? [] : buildDeck().filter((c) => !used.has(c.id));
  const hands: GameState['hands'] = {};
  for (const p of players) hands[p] = o.hands[p].map(cardFromId);
  const draw = (o.draw ?? []).map(cardFromId).reverse(); // top = end
  const under = (o.under ?? []).map(cardFromId);
  return {
    version: 0,
    rules: withRules(o.rules),
    players,
    hands,
    drawPile: o.rest === 'discard' || o.rest === 'none' ? draw : [...rest, ...draw],
    discard: [...(o.rest === 'discard' ? rest : []), ...under, cardFromId(o.top)],
    activeSuit: o.suit ?? cardFromId(o.top).suit,
    direction: o.direction ?? 1,
    turn: players.indexOf(o.turn),
    dealer: o.dealer ? players.indexOf(o.dealer) : players.length - 1,
    penalty: o.penalty ?? null,
    jakk: Object.fromEntries((o.jakk ?? []).map((p) => [p, true])),
    out: o.out ?? [],
    provisional: o.provisional ?? [],
    awaitingSuit: o.awaitingSuit ?? false,
    coverNeeded: o.coverNeeded ?? false,
    opening: null,
    turns: 0,
    winner: null,
    handOver: null,
  };
}

export const rng0 = seededRng(1);

export function play(
  s: GameState,
  playerId: string,
  cardIds: string[],
  extra: { suit?: Suit; declareJakk?: boolean } = {},
  rng = seededRng(7),
) {
  return applyAction(s, { type: 'play', playerId, cardIds, ...extra } as Action, rng);
}

export function act(s: GameState, a: Action, rng = seededRng(7)) {
  return applyAction(s, a, rng);
}

/** Apply and assert success. */
export function ok(r: ReturnType<typeof applyAction>): { state: GameState; events: GameEvent[] } {
  if (!r.ok) throw new Error(`expected ok but got ${r.code}: ${r.reason}`);
  return r;
}

export function topId(s: GameState): string {
  return s.discard[s.discard.length - 1].id;
}
export function turnId(s: GameState): string {
  return s.players[s.turn];
}
export function handIds(s: GameState, p: string): string[] {
  return s.hands[p].map((c) => c.id);
}
export function eventTypes(events: GameEvent[]): string[] {
  return events.map((e) => e.type);
}

export function assertConserved(s: GameState): void {
  const ids = [...Object.values(s.hands).flat(), ...s.drawPile, ...s.discard].map((c) => c.id);
  if (ids.length !== 52 || new Set(ids).size !== 52) {
    throw new Error(`card conservation violated: ${ids.length} cards, ${new Set(ids).size} unique`);
  }
}
