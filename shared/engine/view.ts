import type { Card, CardId, PlayerId, Suit } from './cards';
import { type CheckResult, type PlayContext, checkPlay, isDefenceCard, isLegalStart, mayFollow } from './play';
import type { RulesConfig } from './rules';
import type { GameEvent, GameState, HandOver, OpeningEffect, Penalty } from './types';

/** Everything one player (or a spectator) may know. This is the ONLY game-state shape sent to clients. */
export interface PlayerView {
  version: number;
  you: PlayerId;
  /** True for a waiting participant who is not dealt into this hand: `hand` is empty, nothing private is shown. */
  spectator: boolean;
  /** Seating order; direction tells which way play currently moves through it. */
  players: PlayerId[];
  /** Card COUNT of every player (including you). */
  handCounts: Record<PlayerId, number>;
  /** Your own hand, in server order. */
  hand: Card[];
  topDiscard: Card;
  discardCount: number;
  drawCount: number;
  activeSuit: Suit;
  direction: 1 | -1;
  turn: PlayerId;
  dealer: PlayerId;
  penalty: Penalty | null;
  /** Players who declared JAKK for their next / current turn (public). */
  jakk: Record<PlayerId, boolean>;
  /** Players sitting out the rest of the hand (deck exhaustion). */
  out: PlayerId[];
  /** bringBacks: players who emptied their hand but whose win is not confirmed yet. */
  provisional: PlayerId[];
  /** Opening Ace: the turn player must `chooseSuit` first. */
  awaitingSuit: boolean;
  /** Opening Queen: the first card played must cover it. */
  coverNeeded: boolean;
  opening: OpeningEffect | null;
  /** The hand's winner (null while playing, and for a hand that ended with no winner: see handOver). */
  winner: PlayerId | null;
  handOver: HandOver | null;
  rules: RulesConfig;
}

export function toPlayerView(state: GameState, playerId: PlayerId): PlayerView {
  const handCounts: Record<PlayerId, number> = {};
  for (const id of state.players) handCounts[id] = state.hands[id].length;
  return {
    version: state.version,
    you: playerId,
    spectator: !state.players.includes(playerId),
    players: [...state.players],
    handCounts,
    hand: (state.hands[playerId] ?? []).slice(),
    topDiscard: state.discard[state.discard.length - 1],
    discardCount: state.discard.length,
    drawCount: state.drawPile.length,
    activeSuit: state.activeSuit,
    direction: state.direction,
    turn: state.players[state.turn],
    dealer: state.players[state.dealer],
    penalty: state.penalty ? { ...state.penalty } : null,
    jakk: { ...state.jakk },
    out: [...state.out],
    provisional: [...state.provisional],
    awaitingSuit: state.awaitingSuit,
    coverNeeded: state.coverNeeded,
    opening: state.opening,
    winner: state.winner,
    handOver: state.handOver ? { ...state.handOver } : null,
    rules: state.rules,
  };
}

/** Remove everything `viewerId` must not see: other players' drawn cards. */
export function redactEvent(event: GameEvent, viewerId: PlayerId): GameEvent {
  if (event.type === 'drew' && event.playerId !== viewerId) {
    const { cards: _cards, ...rest } = event;
    return rest;
  }
  return event;
}

export function redactEvents(events: readonly GameEvent[], viewerId: PlayerId): GameEvent[] {
  return events.map((e) => redactEvent(e, viewerId));
}

/** Events with every private card removed: safe to show to everybody (move history). */
export function publicEvents(events: readonly GameEvent[]): GameEvent[] {
  return redactEvents(events, '\u0000nobody');
}

function contextOfView(view: PlayerView): PlayContext {
  return {
    top: view.topDiscard,
    activeSuit: view.activeSuit,
    penalty: view.penalty,
    rules: view.rules,
    direction: view.direction,
    coverNeeded: view.coverNeeded,
    activeSeats: view.players.length - view.out.length,
    jakkLive: !!view.jakk[view.you],
  };
}

function canAct(view: PlayerView): boolean {
  return !view.handOver && !view.spectator && view.turn === view.you && !view.awaitingSuit && !view.out.includes(view.you);
}

/** Ids of cards that may START a play right now (empty if it is not your turn or the hand is over). */
export function getLegalCardIds(view: PlayerView): CardId[] {
  if (!canAct(view)) return [];
  const ctx = contextOfView(view);
  return view.hand.filter((c) => isLegalStart(ctx, c, view.hand.length)).map((c) => c.id);
}

/**
 * Which cards the player may tap next given the cards already selected (in selection order).
 * Empty selection -> getLegalCardIds. Otherwise: the first selected card must be a legal start and every further
 * card must follow the previous one (same rank, or same suit one up/down; a Queen needs its cover; under a pickup
 * penalty only defence cards).
 */
export function getAddableCardIds(view: PlayerView, selectedIds: readonly CardId[]): CardId[] {
  if (selectedIds.length === 0) return getLegalCardIds(view);
  if (!canAct(view)) return [];
  const ctx = contextOfView(view);
  const sel = selectedIds.map((id) => view.hand.find((c) => c.id === id));
  if (sel.some((c) => !c)) return [];
  const cards = sel as Card[];
  if (!getLegalCardIds(view).includes(cards[0].id)) return [];
  const last = cards[cards.length - 1];
  return view.hand
    .filter((c) => !selectedIds.includes(c.id))
    .filter((c) => !ctx.penalty || isDefenceCard(ctx.penalty, c, ctx.rules))
    .filter((c) => mayFollow(ctx, last, c))
    .map((c) => c.id);
}

/** Dry-run a play against a view (same rules + same reason strings the server will use), with the projected outcome. */
export function previewPlay(view: PlayerView, cardIds: readonly CardId[], suit?: Suit): CheckResult | { ok: false; code: 'NOT_YOUR_TURN'; reason: string } {
  if (view.handOver) return { ok: false, code: 'NOT_YOUR_TURN', reason: 'The hand is over' };
  if (view.spectator) return { ok: false, code: 'NOT_YOUR_TURN', reason: 'You are watching this hand' };
  if (view.turn !== view.you) return { ok: false, code: 'NOT_YOUR_TURN', reason: 'Not your turn' };
  return checkPlay(contextOfView(view), view.hand, cardIds, suit);
}

/** True if the selection ends on an Ace, which needs a suit nomination. */
export function needsSuitChoice(view: PlayerView, selectedIds: readonly CardId[]): boolean {
  if (selectedIds.length === 0) return false;
  return view.hand.find((c) => c.id === selectedIds[selectedIds.length - 1])?.rank === 'A';
}
