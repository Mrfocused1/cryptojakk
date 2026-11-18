import type { Card, CardId, PlayerId, Suit } from './cards';
import { type CheckResult, type PlayContext, checkPlay, isLegalStart } from './play';
import type { RulesConfig } from './rules';
import type { GameEvent, GameState, Penalty } from './types';

/** Everything one player may know. This is the ONLY game-state shape sent to clients. */
export interface PlayerView {
  version: number;
  you: PlayerId;
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
  penalty: Penalty | null;
  jakkOwed: PlayerId | null;
  winner: PlayerId | null;
  /** playAfterDraw only: the turn player has drawn and may play only the drawn card or pass. */
  hasDrawn: boolean;
  /** playAfterDraw only: the drawn card id, visible only to the player who drew it. */
  drewCardId: CardId | null;
  rules: RulesConfig;
}

export function toPlayerView(state: GameState, playerId: PlayerId): PlayerView {
  const handCounts: Record<PlayerId, number> = {};
  for (const id of state.players) handCounts[id] = state.hands[id].length;
  const turn = state.players[state.turn];
  return {
    version: state.version,
    you: playerId,
    players: [...state.players],
    handCounts,
    hand: (state.hands[playerId] ?? []).slice(),
    topDiscard: state.discard[state.discard.length - 1],
    discardCount: state.discard.length,
    drawCount: state.drawPile.length,
    activeSuit: state.activeSuit,
    direction: state.direction,
    turn,
    penalty: state.penalty ? { ...state.penalty } : null,
    jakkOwed: state.jakkOwed,
    winner: state.winner,
    hasDrawn: state.drewCardId !== null,
    drewCardId: state.drewCardId !== null && turn === playerId ? state.drewCardId : null,
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

function contextOfView(view: PlayerView): PlayContext {
  return {
    top: view.topDiscard,
    activeSuit: view.activeSuit,
    penalty: view.penalty,
    rules: view.rules,
    // With playAfterDraw the only playable card is the one just drawn. (Only known to the drawer, who is the turn player.)
    mustPlayId: view.hasDrawn ? (view.drewCardId ?? '__none__') : null,
  };
}

/** Ids of cards that may START a play right now (empty if it is not your turn or the game is over). */
export function getLegalCardIds(view: PlayerView): CardId[] {
  if (view.winner || view.turn !== view.you) return [];
  const ctx = contextOfView(view);
  return view.hand.filter((c) => isLegalStart(ctx, c, view.hand.length)).map((c) => c.id);
}

/**
 * Which cards the player may tap next given the cards already selected (in selection order).
 * Empty selection -> getLegalCardIds. Otherwise: the first selected card must be a legal start,
 * and further cards must share its rank (and multi-play must be enabled).
 */
export function getAddableCardIds(view: PlayerView, selectedIds: readonly CardId[]): CardId[] {
  if (selectedIds.length === 0) return getLegalCardIds(view);
  if (view.winner || view.turn !== view.you || !view.rules.multiPlay || view.hasDrawn) return [];
  const first = view.hand.find((c) => c.id === selectedIds[0]);
  if (!first || !getLegalCardIds(view).includes(first.id)) return [];
  return view.hand.filter((c) => c.rank === first.rank && !selectedIds.includes(c.id)).map((c) => c.id);
}

/** Dry-run a play against a view (same rules + same reason strings the server will use). */
export function previewPlay(view: PlayerView, cardIds: readonly CardId[], suit?: Suit): CheckResult | { ok: false; code: 'NOT_YOUR_TURN'; reason: string } {
  if (view.winner) return { ok: false, code: 'NOT_YOUR_TURN', reason: 'The game is over' };
  if (view.turn !== view.you) return { ok: false, code: 'NOT_YOUR_TURN', reason: 'Not your turn' };
  return checkPlay(contextOfView(view), view.hand, cardIds, suit);
}

/** True if the selection contains an Ace that needs a suit nomination. */
export function needsSuitChoice(view: PlayerView, selectedIds: readonly CardId[]): boolean {
  return view.rules.aceWild && selectedIds.some((id) => view.hand.find((c) => c.id === id)?.rank === 'A');
}
