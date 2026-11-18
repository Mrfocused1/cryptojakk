import { type Card, type PlayerId, type Rng, buildDeck, isBlackJack, isSuit, shuffle } from './cards';
import { type PlayContext, checkPlay, penaltyReason } from './play';
import { DEFAULT_RULES, type RulesConfig } from './rules';
import type { Action, ApplyResult, DrawReason, GameEvent, GameState, HandEndReason, OpeningEffect, RejectionCode } from './types';

/** A hand that has not ended after this many turn-ending actions ends with no winner (safety net). */
export const TURN_CAP = 3000;

function reject(code: RejectionCode, reason: string): ApplyResult {
  return { ok: false, code, reason };
}

const mod = (x: number, n: number) => ((x % n) + n) % n;

export interface CreateGameOptions {
  /** Seat index of the dealer. Random when omitted. The first player is the seat after the dealer. */
  dealer?: number;
}

export function createGame(
  playerIds: readonly PlayerId[],
  rules: RulesConfig = DEFAULT_RULES,
  rng: Rng,
  opts: CreateGameOptions = {},
): GameState {
  const n = playerIds.length;
  if (n < rules.minPlayers || n > rules.maxPlayers) {
    throw new Error(`Need ${rules.minPlayers}-${rules.maxPlayers} players, got ${n}`);
  }
  if (new Set(playerIds).size !== n) throw new Error('Duplicate player ids');
  if (n * rules.handSize + 1 > 52) throw new Error('Hand size too large for one deck');

  const dealer = opts.dealer !== undefined ? mod(opts.dealer, n) : Math.min(n - 1, Math.floor(rng() * n));
  const deck = shuffle(buildDeck(), rng); // top = end
  const hands: Record<PlayerId, Card[]> = {};
  for (const id of playerIds) hands[id] = [];
  for (let r = 0; r < rules.handSize; r++) {
    for (let k = 1; k <= n; k++) hands[playerIds[mod(dealer + k, n)]].push(deck.pop()!);
  }
  const top = deck.pop()!;

  const s: GameState = {
    version: 0,
    rules,
    players: [...playerIds],
    hands,
    drawPile: deck,
    discard: [top],
    activeSuit: top.suit,
    direction: 1,
    turn: mod(dealer + 1, n),
    dealer,
    penalty: null,
    jakk: {},
    out: [],
    provisional: [],
    awaitingSuit: false,
    coverNeeded: false,
    opening: null,
    turns: 0,
    winner: null,
    handOver: null,
  };

  if (rules.firstCardActive) {
    // The opening card acts as if the dealer had just played it.
    let effect: OpeningEffect | null = null;
    if (top.rank === '2') {
      s.penalty = { kind: 'two', amount: rules.twoPenalty };
      effect = 'two';
    } else if (isBlackJack(top)) {
      s.penalty = { kind: 'jack', amount: rules.blackJackPenalty };
      effect = 'jack';
    } else if (top.rank === 'A') {
      s.awaitingSuit = true;
      effect = 'ace';
    } else if (rules.reverseRank !== null && top.rank === rules.reverseRank) {
      s.direction = -1;
      s.turn = n === 2 ? dealer : mod(dealer - 1, n);
      effect = 'king';
    } else if (rules.skipRank !== null && top.rank === rules.skipRank) {
      s.turn = n === 2 ? dealer : mod(dealer + 2, n);
      effect = 'eight';
    } else if (top.rank === 'Q') {
      s.coverNeeded = true;
      effect = 'queen';
    }
    s.opening = effect;
  }
  return s;
}

export function contextOf(state: GameState, playerId?: PlayerId): PlayContext {
  return {
    top: state.discard[state.discard.length - 1],
    activeSuit: state.activeSuit,
    penalty: state.penalty,
    rules: state.rules,
    direction: state.direction,
    coverNeeded: state.coverNeeded,
    activeSeats: state.players.length - state.out.length,
    jakkLive: playerId !== undefined && !!state.jakk[playerId],
  };
}

function cloneState(s: GameState): GameState {
  const hands: Record<PlayerId, Card[]> = {};
  for (const id of s.players) hands[id] = s.hands[id].slice();
  return {
    ...s,
    hands,
    drawPile: s.drawPile.slice(),
    discard: s.discard.slice(),
    penalty: s.penalty ? { ...s.penalty } : null,
    jakk: { ...s.jakk },
    out: s.out.slice(),
    provisional: s.provisional.slice(),
  };
}

// ---------------------------------------------------------------- hand end / seats / drawing

function endHand(s: GameState, events: GameEvent[], winner: PlayerId | null, reason: HandEndReason): void {
  s.winner = winner;
  s.handOver = { winner, reason };
  s.penalty = null;
  s.awaitingSuit = false;
  s.coverNeeded = false;
  if (winner) events.push({ type: 'won', playerId: winner });
  events.push({ type: 'handEnded', winner, reason });
}

function stepSeat(s: GameState, from: number, dir: 1 | -1): number {
  const n = s.players.length;
  let i = from;
  for (let k = 0; k < n; k++) {
    i = mod(i + dir, n);
    if (!s.out.includes(s.players[i])) return i;
  }
  return from;
}

/** Deck exhaustion (rules 133-136). Returns after sitting a player out or ending the hand. */
function resolveExhaustion(s: GameState, rng: Rng, events: GameEvent[]): void {
  const inPlay = s.players.filter((p) => !s.out.includes(p));
  const max = Math.max(...inPlay.map((p) => s.hands[p].length));
  const holders = inPlay.filter((p) => s.hands[p].length === max);
  if (holders.length !== 1 || max === 0) {
    endHand(s, events, null, 'deckExhausted');
    return;
  }
  const sitter = holders[0];
  const cards = s.hands[sitter];
  s.hands[sitter] = [];
  s.drawPile = shuffle(cards, rng);
  s.out.push(sitter);
  delete s.jakk[sitter];
  s.provisional = s.provisional.filter((p) => p !== sitter);
  events.push({ type: 'satOut', playerId: sitter, cards: cards.length });
  const left = s.players.filter((p) => !s.out.includes(p));
  if (left.length <= 1) endHand(s, events, left[0] ?? null, 'lastStanding');
}

/** Draw up to `count` cards (reshuffling the discard under its top card; deck exhaustion if still short). */
function drawCards(s: GameState, pid: PlayerId, count: number, rng: Rng, events: GameEvent[], reason: DrawReason): Card[] {
  const drawn: Card[] = [];
  let guard = 0;
  while (drawn.length < count) {
    if (s.drawPile.length === 0) {
      if (s.discard.length > 1) {
        const top = s.discard[s.discard.length - 1];
        const rest = s.discard.slice(0, -1);
        s.drawPile = shuffle(rest, rng);
        s.discard = [top];
        events.push({ type: 'reshuffled', playerId: pid, count: rest.length });
      } else {
        if (++guard > s.players.length + 1) break;
        resolveExhaustion(s, rng, events);
        if (s.handOver || s.out.includes(pid)) break;
        continue;
      }
    }
    const c = s.drawPile.pop()!;
    s.hands[pid].push(c);
    drawn.push(c);
  }
  if (drawn.length > 0) events.push({ type: 'drew', playerId: pid, count: drawn.length, reason, cards: drawn });
  return drawn;
}

function confirmProvisional(s: GameState, events: GameEvent[]): boolean {
  if (s.provisional.length > 0 && !s.penalty && !s.handOver) {
    endHand(s, events, s.provisional[0], 'finished');
    return true;
  }
  return false;
}

/** Move the turn; a provisional finisher the pickup penalty lands on takes it and is back in. */
function moveTurn(s: GameState, steps: number, rng: Rng, events: GameEvent[]): void {
  for (let i = 0; i < steps; i++) s.turn = stepSeat(s, s.turn, s.direction);
  events.push({ type: 'turn', playerId: s.players[s.turn] });
  for (let guard = 0; guard < s.players.length; guard++) {
    const p = s.players[s.turn];
    if (!(s.penalty && s.provisional.includes(p))) break;
    const { kind, amount } = s.penalty;
    s.penalty = null;
    s.provisional = s.provisional.filter((x) => x !== p);
    events.push({ type: 'broughtBack', playerId: p, amount });
    events.push({ type: 'penaltyTaken', playerId: p, kind, amount });
    drawCards(s, p, amount, rng, events, 'penalty');
    if (s.handOver) return;
    if (confirmProvisional(s, events)) return;
    s.turn = stepSeat(s, s.turn, s.direction);
    events.push({ type: 'turn', playerId: s.players[s.turn] });
  }
}

/** Everything that happens when an actor's turn-ending action is done (turn movement + JAKK bookkeeping). */
function finishTurn(
  s: GameState,
  pid: PlayerId,
  action: Action,
  rng: Rng,
  events: GameEvent[],
  next: { steps: number; again: boolean },
): void {
  s.coverNeeded = false;
  s.opening = null;
  if (s.handOver) return;
  if (confirmProvisional(s, events)) return;
  s.turns++;
  if (s.turns > TURN_CAP) {
    endHand(s, events, null, 'turnCap');
    return;
  }
  const actorOut = s.out.includes(pid);
  if (next.again && !actorOut) events.push({ type: 'turn', playerId: pid });
  else moveTurn(s, Math.max(1, next.steps), rng, events);
  if (s.handOver) return;

  const continuing = s.players[s.turn] === pid && !actorOut;
  if (!continuing && s.jakk[pid]) {
    delete s.jakk[pid];
    events.push({ type: 'jakkExpired', playerId: pid });
  }
  const flag = (action.type === 'play' || action.type === 'draw' || action.type === 'takePenalty') && action.declareJakk;
  if (flag && s.rules.jakkEnabled && !actorOut && !s.jakk[pid]) {
    s.jakk[pid] = true;
    events.push({ type: 'jakkDeclared', playerId: pid });
  }
}

/**
 * Apply one action. Returns a NEW state plus ordered events, or a typed rejection.
 * Never throws for invalid player input; the input state is never mutated.
 */
export function applyAction(state: GameState, action: Action, rng: Rng): ApplyResult {
  if (state.handOver) return reject('GAME_OVER', 'The hand is over');
  const pid = action?.playerId;
  if (typeof pid !== 'string' || !state.players.includes(pid)) return reject('UNKNOWN_PLAYER', 'Unknown player');
  if (state.out.includes(pid)) return reject('SITTING_OUT', 'You are sitting out the rest of this hand');
  const rules = state.rules;
  const myTurn = state.players[state.turn] === pid;

  if (action.type === 'declareJakk') {
    if (!rules.jakkEnabled) return reject('JAKK_DISABLED', 'JAKK is not used in this game');
    if (myTurn) return reject('JAKK_NOT_ALLOWED', 'Declare JAKK before your turn, or together with your move');
    if (state.hands[pid].length === 0) return reject('JAKK_NOT_ALLOWED', 'You have no cards left');
    if (state.jakk[pid]) return reject('JAKK_ALREADY_DECLARED', 'You already declared JAKK for your next turn');
    const s = cloneState(state);
    s.jakk[pid] = true;
    s.version = state.version + 1;
    return { ok: true, state: s, events: [{ type: 'jakkDeclared', playerId: pid }] };
  }

  if (action.type === 'chooseSuit') {
    if (!myTurn) return reject('NOT_YOUR_TURN', 'Not your turn');
    if (!state.awaitingSuit) return reject('NO_SUIT_CHOICE', 'No suit to choose right now');
    if (!isSuit(action.suit)) return reject('INVALID_ACTION', 'Unknown suit');
    const s = cloneState(state);
    s.activeSuit = action.suit;
    s.awaitingSuit = false;
    s.version = state.version + 1;
    return { ok: true, state: s, events: [{ type: 'suitChosen', playerId: pid, suit: action.suit }] };
  }

  if (action.type !== 'play' && action.type !== 'draw' && action.type !== 'takePenalty') {
    return reject('INVALID_ACTION', 'Unknown action');
  }
  if (!myTurn) return reject('NOT_YOUR_TURN', 'Not your turn');
  if (state.awaitingSuit) return reject('MUST_CHOOSE_SUIT', 'Name a suit for the opening Ace first');

  const s = cloneState(state);
  const events: GameEvent[] = [];

  switch (action.type) {
    case 'draw': {
      if (s.penalty) return reject('PENALTY_PENDING', penaltyReason(s.penalty, rules));
      drawCards(s, pid, rules.drawCount, rng, events, 'draw');
      finishTurn(s, pid, action, rng, events, { steps: 1, again: false });
      break;
    }

    case 'takePenalty': {
      if (!s.penalty) return reject('NO_PENALTY', 'No penalty to pick up');
      const { kind, amount } = s.penalty;
      s.penalty = null;
      events.push({ type: 'penaltyTaken', playerId: pid, kind, amount });
      drawCards(s, pid, amount, rng, events, 'penalty');
      finishTurn(s, pid, action, rng, events, { steps: 1, again: false });
      break;
    }

    case 'play': {
      const chk = checkPlay(contextOf(s, pid), s.hands[pid], action.cardIds, action.suit);
      if (!chk.ok) return reject(chk.code, chk.reason);
      const { cards, outcome } = chk;
      const incoming = s.penalty;

      const ids = new Set(cards.map((c) => c.id));
      s.hands[pid] = s.hands[pid].filter((c) => !ids.has(c.id));
      s.discard.push(...cards);
      events.push({ type: 'played', playerId: pid, cards });
      s.activeSuit = outcome.suit;
      if (outcome.needsSuit) events.push({ type: 'suitChosen', playerId: pid, suit: outcome.suit });

      // Pickup tally (walked in order by checkPlay).
      const pen = outcome.penalty;
      if (pen && (!incoming || pen.amount !== incoming.amount || pen.kind !== incoming.kind)) {
        events.push({ type: 'penaltyAdded', playerId: pid, kind: pen.kind, added: pen.amount - (incoming?.amount ?? 0), total: pen.amount });
      }
      if (incoming && !pen) events.push({ type: 'penaltyCancelled', playerId: pid, kind: incoming.kind, amount: incoming.amount });
      s.penalty = pen ? { ...pen } : null;

      for (const c of cards) {
        if (rules.reverseRank !== null && c.rank === rules.reverseRank) {
          s.direction = s.direction === 1 ? -1 : 1;
          events.push({ type: 'reversed', playerId: pid, direction: s.direction });
        }
      }

      // Emptied the hand?
      if (outcome.emptiesHand && outcome.wins) {
        if (rules.bringBacks && s.penalty) {
          s.provisional.push(pid);
          events.push({ type: 'provisionalFinish', playerId: pid, pending: s.penalty.amount });
        } else {
          endHand(s, events, s.provisional[0] ?? pid, 'finished');
          s.version = state.version + 1;
          return { ok: true, state: s, events };
        }
      }

      // Uncovered Queen / blocked finish: the player draws and stays in.
      if (outcome.blocked) {
        const messages = {
          queen: 'A Queen must be covered: it cannot be your last card',
          kingEight: 'In a 2-player game a King or 8 cannot be your last card',
          noJakk: 'You must declare JAKK before the turn you finish on',
        } as const;
        if (outcome.blocked === 'queen') events.push({ type: 'queenUncovered', playerId: pid, count: outcome.drawAfter, wouldHaveWon: true });
        events.push({ type: 'finishBlocked', playerId: pid, reason: outcome.blocked, count: outcome.drawAfter, message: messages[outcome.blocked] });
        drawCards(s, pid, outcome.drawAfter, rng, events, outcome.blocked === 'queen' ? 'queenPenalty' : 'finishPenalty');
      } else if (outcome.endsOnQueen) {
        events.push({ type: 'queenUncovered', playerId: pid, count: outcome.drawAfter, wouldHaveWon: false });
        drawCards(s, pid, outcome.drawAfter, rng, events, 'queenPenalty');
      }

      // Skips / go again.
      const active = s.players.length - s.out.length;
      let steps = 1;
      let again = false;
      if (active === 2 && (outcome.skips > 0 || outcome.reversals > 0)) {
        again = true;
        const other = s.players[stepSeat(s, s.turn, s.direction)];
        for (let i = 0; i < outcome.skips; i++) events.push({ type: 'skipped', playerId: pid, who: other });
      } else {
        let cur = s.turn;
        for (let i = 0; i < outcome.skips; i++) {
          cur = stepSeat(s, cur, s.direction);
          events.push({ type: 'skipped', playerId: pid, who: s.players[cur] });
        }
        steps = 1 + outcome.skips;
      }
      finishTurn(s, pid, action, rng, events, { steps, again });
      break;
    }
  }

  s.version = state.version + 1;
  return { ok: true, state: s, events };
}

