import { type Card, type PlayerId, type Rng, buildDeck, isBlackJack, isRedJack, shuffle } from './cards';
import { type PlayContext, checkPlay, penaltyReason } from './play';
import { DEFAULT_RULES, type RulesConfig, isPowerRank } from './rules';
import type { Action, ApplyResult, GameEvent, GameState, RejectionCode } from './types';

function reject(code: RejectionCode, reason: string): ApplyResult {
  return { ok: false, code, reason };
}

export function createGame(playerIds: readonly PlayerId[], rules: RulesConfig = DEFAULT_RULES, rng: Rng): GameState {
  const n = playerIds.length;
  if (n < rules.minPlayers || n > rules.maxPlayers) {
    throw new Error(`Need ${rules.minPlayers}-${rules.maxPlayers} players, got ${n}`);
  }
  if (new Set(playerIds).size !== n) throw new Error('Duplicate player ids');
  if (n * rules.handSize + 1 > 52) throw new Error('Hand size too large for one deck');

  const deck = shuffle(buildDeck(), rng); // top = end
  const hands: Record<PlayerId, Card[]> = {};
  for (const id of playerIds) hands[id] = [];
  for (let r = 0; r < rules.handSize; r++) for (const id of playerIds) hands[id].push(deck.pop()!);

  // Start card: power cards are buried at the bottom of the draw pile, then flip again.
  let start: Card | undefined;
  for (let i = 0; i <= deck.length + 1; i++) {
    const c = deck.pop()!;
    if (!isPowerRank(c.rank, rules) || i > deck.length) {
      start = c;
      break;
    }
    deck.unshift(c);
  }
  const top = start!;

  return {
    version: 0,
    rules,
    players: [...playerIds],
    hands,
    drawPile: deck,
    discard: [top],
    activeSuit: top.suit,
    direction: 1,
    turn: Math.min(n - 1, Math.floor(rng() * n)),
    penalty: null,
    jakkOwed: null,
    drewCardId: null,
    winner: null,
  };
}

export function contextOf(state: GameState): PlayContext {
  return {
    top: state.discard[state.discard.length - 1],
    activeSuit: state.activeSuit,
    penalty: state.penalty,
    rules: state.rules,
    mustPlayId: state.drewCardId,
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
  };
}

const mod = (x: number, n: number) => ((x % n) + n) % n;

/** Draw up to `count` cards into the player's hand, reshuffling the discard (minus its top) if needed. */
function drawCards(
  s: GameState,
  pid: PlayerId,
  count: number,
  rng: Rng,
  events: GameEvent[],
  reason: 'draw' | 'penalty' | 'jakkMiss',
): Card[] {
  const drawn: Card[] = [];
  for (let i = 0; i < count; i++) {
    if (s.drawPile.length === 0) {
      if (s.discard.length <= 1) break; // nothing left anywhere: draw as many as exist
      const top = s.discard[s.discard.length - 1];
      const rest = s.discard.slice(0, -1);
      s.drawPile = shuffle(rest, rng);
      s.discard = [top];
      events.push({ type: 'reshuffled', playerId: pid, count: rest.length });
    }
    drawn.push(s.drawPile.pop()!);
  }
  s.hands[pid].push(...drawn);
  events.push({ type: 'drew', playerId: pid, count: drawn.length, reason, cards: drawn });
  return drawn;
}

function passTurn(s: GameState, steps: number, events: GameEvent[]): void {
  s.turn = mod(s.turn + s.direction * steps, s.players.length);
  s.drewCardId = null;
  events.push({ type: 'turn', playerId: s.players[s.turn] });
}

function applyJakkMiss(s: GameState, rng: Rng, events: GameEvent[]): void {
  const owed = s.jakkOwed!;
  s.jakkOwed = null;
  events.push({ type: 'jakkMissed', playerId: owed });
  drawCards(s, owed, s.rules.jakkMissPenalty, rng, events, 'jakkMiss');
}

/**
 * Apply one action. Returns a NEW state plus ordered events, or a typed rejection.
 * Never throws for invalid player input; the input state is never mutated.
 */
export function applyAction(state: GameState, action: Action, rng: Rng): ApplyResult {
  if (state.winner) return reject('GAME_OVER', 'The game is over');
  const pid = action?.playerId;
  if (typeof pid !== 'string' || !state.players.includes(pid)) return reject('UNKNOWN_PLAYER', 'Unknown player');

  if (action.type === 'declareJakk') {
    if (state.jakkOwed !== pid) return reject('JAKK_NOT_NEEDED', 'No JAKK needed right now');
    const s = cloneState(state);
    s.jakkOwed = null;
    s.version = state.version + 1;
    return { ok: true, state: s, events: [{ type: 'jakkDeclared', playerId: pid }] };
  }

  if (action.type !== 'play' && action.type !== 'draw' && action.type !== 'takePenalty' && action.type !== 'pass') {
    return reject('INVALID_ACTION', 'Unknown action');
  }
  if (state.players[state.turn] !== pid) return reject('NOT_YOUR_TURN', 'Not your turn');

  const s = cloneState(state);
  const events: GameEvent[] = [];
  const rules = s.rules;

  // Any applied action while a JAKK call is owed (by anyone, including the forgetful player) costs them cards first.
  if (s.jakkOwed) applyJakkMiss(s, rng, events);

  switch (action.type) {
    case 'draw': {
      if (s.penalty) return reject('PENALTY_PENDING', penaltyReason(s.penalty, rules));
      if (s.drewCardId) return reject('ALREADY_DREW', 'You already drew - play that card or pass');
      const drawn = drawCards(s, pid, rules.drawCount, rng, events, 'draw');
      if (rules.playAfterDraw && drawn.length === 1) {
        const probe = checkPlay(
          { ...contextOf(s), mustPlayId: drawn[0].id },
          s.hands[pid],
          [drawn[0].id],
          drawn[0].rank === 'A' ? s.activeSuit : undefined,
        );
        if (probe.ok) {
          s.drewCardId = drawn[0].id; // turn stays with the player
          break;
        }
      }
      passTurn(s, 1, events);
      break;
    }

    case 'pass': {
      if (!s.drewCardId) return reject('CANNOT_PASS', "You can't pass - draw a card instead");
      passTurn(s, 1, events);
      break;
    }

    case 'takePenalty': {
      if (!s.penalty) return reject('NO_PENALTY', 'No penalty to pick up');
      const { kind, amount } = s.penalty;
      s.penalty = null;
      events.push({ type: 'penaltyTaken', playerId: pid, kind, amount });
      drawCards(s, pid, amount, rng, events, 'penalty');
      passTurn(s, 1, events);
      break;
    }

    case 'play': {
      const chk = checkPlay(contextOf(s), s.hands[pid], action.cardIds, action.suit);
      if (!chk.ok) return reject(chk.code, chk.reason);
      const cards = chk.cards;

      // Move cards, in the chosen order; the last one ends on top.
      const ids = new Set(cards.map((c) => c.id));
      s.hands[pid] = s.hands[pid].filter((c) => !ids.has(c.id));
      s.discard.push(...cards);
      events.push({ type: 'played', playerId: pid, cards });

      const last = cards[cards.length - 1];
      s.activeSuit = last.suit;
      if (cards[0].rank === 'A' && rules.aceWild) {
        s.activeSuit = action.suit!;
        events.push({ type: 'suitChosen', playerId: pid, suit: action.suit! });
      }

      // Resolve effects card by card, in order.
      let skips = 0;
      let reversals = 0;
      for (const card of cards) {
        if (card.rank === '2') {
          const total = (s.penalty?.amount ?? 0) + rules.twoPenalty;
          s.penalty = { kind: 'two', amount: total };
          events.push({ type: 'penaltyAdded', playerId: pid, kind: 'two', added: rules.twoPenalty, total });
        } else if (isBlackJack(card)) {
          const total = (s.penalty?.amount ?? 0) + rules.blackJackPenalty;
          s.penalty = { kind: 'jack', amount: total };
          events.push({ type: 'penaltyAdded', playerId: pid, kind: 'jack', added: rules.blackJackPenalty, total });
        } else if (isRedJack(card)) {
          if (s.penalty?.kind === 'jack' && rules.redJackCancels) {
            events.push({ type: 'penaltyCancelled', playerId: pid, kind: 'jack', amount: s.penalty.amount });
            s.penalty = null;
          }
        } else if (card.rank === '8' && rules.eightReverses) {
          reversals++;
          s.direction = s.direction === 1 ? -1 : 1;
          events.push({ type: 'reversed', playerId: pid, direction: s.direction });
        } else if (card.rank === '7' && rules.sevenSkips) {
          skips++;
        }
      }

      // Win?
      if (s.hands[pid].length === 0) {
        s.winner = pid;
        s.jakkOwed = null;
        s.drewCardId = null;
        events.push({ type: 'won', playerId: pid });
        s.version = state.version + 1;
        return { ok: true, state: s, events };
      }

      // JAKK
      if (rules.jakkEnabled && s.hands[pid].length === 1) {
        if (action.declareJakk) events.push({ type: 'jakkDeclared', playerId: pid });
        else s.jakkOwed = pid;
      }

      // Next player.
      const n = s.players.length;
      if (n === 2) {
        // 7s and 8s: the player goes again (however many were played).
        if (skips > 0 || reversals > 0) {
          const other = s.players[mod(s.turn + 1, 2)];
          for (let i = 0; i < skips; i++) events.push({ type: 'skipped', playerId: pid, who: other });
          passTurn(s, 0, events);
        } else {
          passTurn(s, 1, events);
        }
      } else {
        for (let i = 1; i <= skips; i++) {
          events.push({ type: 'skipped', playerId: pid, who: s.players[mod(s.turn + s.direction * i, n)] });
        }
        passTurn(s, 1 + skips, events);
      }
      break;
    }
  }

  s.version = state.version + 1;
  return { ok: true, state: s, events };
}
