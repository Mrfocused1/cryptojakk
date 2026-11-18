// Plain-language text for the UI: events -> feed / history lines, the live "what will this play do" preview, error toasts.
// Rules are NEVER decided here: every verdict comes from the shared engine helpers (previewPlay, tallyPenalty, events).
import {
  type Card,
  type GameEvent,
  type HouseRules,
  type MatchOptions,
  type Penalty,
  type PenaltyKind,
  type PlayerView,
  type Suit,
  SUIT_SYMBOL,
  cardLabel,
  isBlackJack,
  previewPlay,
  tallyPenalty,
} from '@shared/engine';
import type { ErrorCode } from '@shared/protocol';

export type Tone = 'info' | 'danger' | 'good';
export type CalloutKind = 'info' | 'danger' | 'good' | 'red' | 'black';

export interface NameCtx {
  me: string;
  nameOf: (id: string) => string;
}

export interface Line {
  text: string;
  tone: Tone;
  callout?: { text: string; kind: CalloutKind };
}

const who = (id: string, c: NameCtx) => (id === c.me ? 'You' : c.nameOf(id));
const pick = (id: string, c: NameCtx, you: string, other: string) => (id === c.me ? you : other);
const poss = (id: string, c: NameCtx) => (id === c.me ? 'Your' : `${c.nameOf(id)}'s`);

export function causeText(kind: PenaltyKind): string {
  return kind === 'two' ? 'from 2s' : kind === 'jack' ? 'from black Jacks' : 'from 2s + Jacks mixed';
}

export function causeShort(kind: PenaltyKind): string {
  return kind === 'two' ? '2s' : kind === 'jack' ? 'Jacks' : 'mixed';
}

// ------------------------------------------------------------------ events

export interface Group {
  e: GameEvent;
  /** Effects that belong to a `played` event (reversed, skipped, suitChosen, penalty changes, JAKK, go-again). */
  extras: GameEvent[];
}

/** Fold the effect events that directly follow a `played` into it; everything else stands alone. */
export function groupEvents(events: readonly GameEvent[]): Group[] {
  const out: Group[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.type !== 'played') {
      out.push({ e, extras: [] });
      continue;
    }
    const extras: GameEvent[] = [];
    let j = i + 1;
    for (; j < events.length; j++) {
      const n = events[j];
      if (n.type === 'reversed' || n.type === 'skipped' || n.type === 'suitChosen' || n.type === 'penaltyAdded' || n.type === 'penaltyCancelled' || n.type === 'jakkDeclared') extras.push(n);
      else if (n.type === 'turn' && n.playerId === e.playerId) extras.push(n);
      else break;
    }
    out.push({ e, extras });
    i = j - 1;
  }
  return out;
}

function playedLine(g: Group & { e: Extract<GameEvent, { type: 'played' }> }, c: NameCtx): Line {
  const e = g.e;
  const bits: string[] = [];
  let callout: Line['callout'];
  let tone: Tone = 'info';
  const setCallout = (x: Line['callout']) => {
    if (!callout || callout.kind !== 'danger') callout = x;
  };
  for (const n of g.extras) {
    if (n.type === 'reversed') {
      if (!bits.includes('direction reversed')) bits.push('direction reversed');
      setCallout({ text: 'REVERSE', kind: 'info' });
    } else if (n.type === 'skipped') {
      const msg = `${who(n.who, c)} ${pick(n.who, c, 'are', 'is')} skipped`;
      if (!bits.includes(msg)) bits.push(msg);
      setCallout({ text: 'SKIP', kind: 'info' });
    } else if (n.type === 'suitChosen') {
      bits.push(`suit is now ${SUIT_SYMBOL[n.suit]}`);
      setCallout({ text: SUIT_SYMBOL[n.suit], kind: n.suit === 'H' || n.suit === 'D' ? 'red' : 'black' });
    } else if (n.type === 'penaltyAdded') {
      bits.push(`+${n.total} to pick up (${causeText(n.kind)})`);
      callout = { text: `+${n.total}`, kind: 'danger' };
      tone = 'danger';
    } else if (n.type === 'penaltyCancelled') {
      bits.push(`pickup of ${n.amount} cancelled`);
      setCallout({ text: 'BLOCKED', kind: 'good' });
      tone = 'good';
    } else if (n.type === 'jakkDeclared') {
      bits.push('JAKK declared');
      setCallout({ text: 'JAKK!', kind: 'good' });
    } else if (n.type === 'turn') {
      bits.push(e.playerId === c.me ? 'you go again' : 'goes again');
      if (!callout) setCallout({ text: 'GO AGAIN', kind: 'info' });
    }
  }
  const cards = e.cards.map(cardLabel).join(' ');
  return { text: `${who(e.playerId, c)} played ${cards}${bits.length ? ' - ' + bits.join(', ') : ''}`, tone, callout };
}

const BLOCK_TEXT: Record<'queen' | 'kingEight' | 'noJakk', string> = {
  noJakk: "didn't declare JAKK before going out",
  queen: "can't win on a Queen",
  kingEight: "can't win on a King or an 8 in a 2-player hand",
};

const HAND_END_TEXT: Record<string, string> = {
  deckExhausted: 'No winner - the deck ran out',
  lastStanding: 'Everyone else sat out - last player standing',
  turnCap: 'No winner - the turn limit was reached',
  finished: 'The hand is over',
};

/** One feed / history line for a group (null = nothing to say, e.g. a bare `turn`). */
export function describeGroup(g: Group, c: NameCtx): Line | null {
  const e = g.e;
  switch (e.type) {
    case 'played':
      return playedLine({ ...g, e }, c);
    case 'drew': {
      const n = e.count;
      switch (e.reason) {
        case 'draw':
          return { text: `${who(e.playerId, c)} ${pick(e.playerId, c, 'draw', 'draws')} ${n === 1 ? 'a card' : `${n} cards`}`, tone: 'info' };
        case 'penalty':
          return { text: `${who(e.playerId, c)} ${pick(e.playerId, c, 'pick', 'picks')} up ${n} (the pickup penalty)`, tone: 'danger', callout: n > 1 ? { text: `+${n}`, kind: 'danger' } : undefined };
        case 'queenPenalty':
          return { text: `${who(e.playerId, c)} left a Queen uncovered and ${pick(e.playerId, c, 'draw', 'draws')} ${n}`, tone: 'danger' };
        default:
          return { text: `${who(e.playerId, c)} ${pick(e.playerId, c, 'draw', 'draws')} ${n} (finish penalty)`, tone: 'danger' };
      }
    }
    case 'penaltyTaken':
      return null; // folded into the `drew` that follows
    case 'skipped':
      return { text: `${who(e.who, c)} ${pick(e.who, c, 'are', 'is')} skipped (8)`, tone: 'info', callout: { text: 'SKIP', kind: 'info' } };
    case 'reversed':
      return { text: 'Direction reversed (King)', tone: 'info', callout: { text: 'REVERSE', kind: 'info' } };
    case 'suitChosen':
      return { text: `${who(e.playerId, c)} named ${SUIT_SYMBOL[e.suit]}`, tone: 'info' };
    case 'penaltyAdded':
    case 'penaltyCancelled':
      return null;
    case 'jakkDeclared':
      return { text: `${who(e.playerId, c)} ${pick(e.playerId, c, 'declared', 'declared')} JAKK - it covers ${pick(e.playerId, c, 'your', 'their')} next turn only`, tone: 'good', callout: { text: 'JAKK!', kind: 'good' } };
    case 'jakkExpired':
      return { text: `${poss(e.playerId, c)} JAKK expired${e.playerId === c.me ? ' - declare it again before the turn you finish on' : ''}`, tone: 'info' };
    case 'finishBlocked':
      return {
        text: `${who(e.playerId, c)} ${BLOCK_TEXT[e.reason] ?? 'could not go out'} - the cards stay played, ${pick(e.playerId, c, 'you draw', `${c.nameOf(e.playerId)} draws`)} ${e.count} and ${pick(e.playerId, c, 'stay', 'stays')} in`,
        tone: 'danger',
        callout: { text: 'NOT OUT', kind: 'danger' },
      };
    case 'queenUncovered':
      if (g.extras.length === 0 && e.wouldHaveWon) return null; // finishBlocked says it
      return { text: `${who(e.playerId, c)} left a Queen uncovered - ${pick(e.playerId, c, 'you draw', `${c.nameOf(e.playerId)} draws`)} ${e.count}`, tone: 'danger', callout: { text: 'UNCOVERED', kind: 'danger' } };
    case 'provisionalFinish':
      return { text: `${who(e.playerId, c)} ${pick(e.playerId, c, 'are', 'is')} out of cards - but a pickup of ${e.pending} is still live (Bring Backs)`, tone: 'good', callout: { text: 'OUT?', kind: 'good' } };
    case 'broughtBack':
      return { text: `The pickup came back to ${who(e.playerId, c)} - ${pick(e.playerId, c, 'take', 'takes')} ${e.amount} and ${pick(e.playerId, c, 'are', 'is')} back in`, tone: 'danger', callout: { text: 'BROUGHT BACK', kind: 'danger' } };
    case 'reshuffled':
      return { text: 'The discard pile was shuffled into the deck', tone: 'info' };
    case 'satOut':
      return { text: `${who(e.playerId, c)} held the most cards and ${pick(e.playerId, c, 'sit', 'sits')} out the rest of the hand (${e.cards} cards back in the deck)`, tone: 'danger', callout: { text: 'SITS OUT', kind: 'danger' } };
    case 'timedOut':
      return { text: `${who(e.playerId, c)} ran out of time - the default move was played`, tone: 'danger' };
    case 'won':
      return { text: `${who(e.playerId, c)} ${pick(e.playerId, c, 'win', 'wins')} the hand!`, tone: 'good', callout: { text: e.playerId === c.me ? 'YOU WIN' : 'OUT!', kind: 'good' } };
    case 'handEnded':
      if (e.winner && e.reason === 'finished') return null;
      return { text: HAND_END_TEXT[e.reason] ?? 'The hand is over', tone: e.winner ? 'good' : 'danger' };
    default:
      return null; // turn
  }
}

/** All lines for a list of events, in order (used by the move history). */
export function describeEvents(events: readonly GameEvent[], c: NameCtx): Line[] {
  const out: Line[] = [];
  const groups = groupEvents(events);
  groups.forEach((g, i) => {
    // The `drew` after queenUncovered / finishBlocked repeats what that event just said.
    if (g.e.type === 'drew' && (g.e.reason === 'queenPenalty' || g.e.reason === 'finishPenalty')) {
      const prev = groups.slice(0, i).some((p) => (p.e.type === 'queenUncovered' || p.e.type === 'finishBlocked') && p.e.playerId === (g.e as { playerId: string }).playerId);
      if (prev) return;
    }
    const l = describeGroup(g, c);
    if (l) out.push(l);
  });
  return out;
}

// ------------------------------------------------------------------ preview

export interface Preview {
  tone: 'info' | 'good' | 'warn' | 'danger';
  headline: string;
  details: string[];
  /** The Queen warning / blocked finish: the play still goes through but costs a card. */
  costly: boolean;
  wins: boolean;
  ok: boolean;
}

function cardToken(c: Card): string {
  return c.rank === '2' ? '2' : isBlackJack(c) ? 'black Jack' : cardLabel(c);
}

/** "2 + 2 + black Jack" for the cards of this play that actually add to the pickup (a plain walk with tallyPenalty). */
function pickupBreakdown(view: PlayerView, cards: readonly Card[]): string {
  const tokens: string[] = [];
  let prev = view.penalty?.amount ?? 0;
  for (let i = 0; i < cards.length; i++) {
    const now = tallyPenalty(view.rules, view.penalty, cards.slice(0, i + 1))?.amount ?? 0;
    if (now > prev) tokens.push(cardToken(cards[i]));
    else if (now < prev || now === 0) tokens.length = 0;
    prev = now;
  }
  const waiting = view.penalty?.amount ?? 0;
  const parts = waiting > 0 ? [`${waiting} waiting`, ...tokens] : tokens;
  return parts.join(' + ');
}

export function previewFor(view: PlayerView, sel: readonly string[], suit: Suit | undefined): Preview {
  const r = previewPlay(view, sel, suit ?? 'S');
  if (!r.ok) return { tone: 'danger', headline: r.reason, details: [], costly: false, wins: false, ok: false };
  const o = r.outcome;
  const cards = r.cards;
  const details: string[] = [];
  let tone: Preview['tone'] = 'info';
  let headline = `Plays ${cards.map(cardLabel).join(' ')}`;
  let costly = false;

  if (o.wins) {
    tone = 'good';
    headline = 'Wins the hand';
    if (o.penalty && view.rules.bringBacks) details.push(`only provisionally while the pickup of ${o.penalty.amount} is live - if it comes back to you, you take it`);
    else if (view.rules.jakkEnabled) details.push('your JAKK is live');
  } else if (o.blocked) {
    tone = 'danger';
    costly = true;
    const why = o.blocked === 'noJakk' ? 'no JAKK declared' : o.blocked === 'queen' ? 'a Queen can never be the last card' : "a King or 8 can't win a 2-player hand";
    headline = `Can't win on this card - you'll draw ${o.drawAfter} (${why})`;
    if (o.blocked === 'noJakk') details.push('JAKK must be declared before the turn you finish on');
  } else if (o.endsOnQueen) {
    tone = 'warn';
    costly = true;
    headline = `Queen needs a cover - add a lit card or you'll draw ${o.drawAfter}`;
  }

  if (o.cancelsPenalty && view.penalty) {
    details.push(`cancels the pickup of ${view.penalty.amount}`);
    if (tone === 'info') tone = 'good';
  } else if (o.penalty) {
    const b = pickupBreakdown(view, cards);
    const multi = b.includes('+');
    details.push(`Next player picks up ${o.penalty.amount}${multi ? ` - ${b}` : ` (${causeText(o.penalty.kind)})`}`);
    if (tone === 'info') tone = 'warn';
  }
  if (o.skips > 0) details.push(view.players.length - view.out.length === 2 ? 'skips them - you go again' : o.skips === 1 ? 'skips the next player' : `skips the next ${o.skips} players`);
  else if (o.goAgain) details.push('you go again');
  if (o.reversals > 0) details.push(o.reversals % 2 === 1 ? 'reverses direction' : 'Kings cancel out - direction unchanged');
  if (o.needsSuit && !suit) details.push("you'll name the suit next");
  else if (o.suit !== view.activeSuit || o.needsSuit) details.push(`suit becomes ${SUIT_SYMBOL[o.suit]}`);
  if (o.blocked === 'kingEight' || (o.blocked && o.goAgain)) details.push('then you go again');
  if (headline.startsWith('Plays ') && details.length) {
    // nothing dramatic: lead with the most useful effect instead of repeating the cards
    const first = details.shift() as string;
    headline = first.charAt(0).toUpperCase() + first.slice(1);
  }

  return { tone, headline, details, costly, wins: o.wins, ok: true };
}

// ------------------------------------------------------------------ rules text

export const HOUSE_RULE_INFO: Array<{ key: keyof HouseRules; title: string; short: string; on: string; off: string; hint: string }> = [
  {
    key: 'flexibleQueenCover',
    title: 'Flexible Queen cover',
    short: 'Queen: any cover',
    on: 'Any card can cover a Queen.',
    off: 'A Queen needs a card of its own suit, or another Queen.',
    hint: 'Any card covers a Queen. Off: same suit or another Queen only.',
  },
  {
    key: 'mixedStacking',
    title: 'Mixed 2 / Jack stacking',
    short: 'Mixed stacking',
    on: '2s and black Jacks stack on each other; a red Jack cancels any pickup.',
    off: '2s only answer 2s, Jacks only answer Jacks.',
    hint: '2s and black Jacks can stack on each other; red Jack cancels any pickup.',
  },
  {
    key: 'bringBacks',
    title: 'Bring Backs',
    short: 'Bring Backs',
    on: 'If you go out and leave a pickup, you only win once it is absorbed. If it comes back to you, you take it and play on.',
    off: 'Going out legally wins at once, even if your last card left a pickup.',
    hint: 'Going out on a pickup is only provisional until it is absorbed.',
  },
  {
    key: 'finishOnPower',
    title: 'Finish on power cards',
    short: 'Finish on power',
    on: 'You may win with an Ace, 2, 8, Jack or King.',
    off: "You can't go out on an Ace, 2, 8, Jack or King.",
    hint: 'Allow winning with an Ace, 2, 8, Jack or King.',
  },
  {
    key: 'firstCardActive',
    title: 'First Card Active',
    short: 'First card active',
    on: 'The opening card counts as if the dealer just played it (2, Jack, 8, King, Queen, Ace).',
    off: 'The opening card is neutral: just match its suit or rank.',
    hint: "The opening card's power applies to the first player.",
  },
];

export const HANDS_LABEL: Record<number, string> = { 1: 'Single hand', 3: 'First to 3 hands', 5: 'First to 5 hands' };

export function timerLabel(s: number): string {
  return s === 0 ? 'Off' : `${s}s`;
}

/** Short chips for the "House rules" strip: the non-default rules first, in words a player understands. */
export function ruleChips(hr: HouseRules, opts: MatchOptions): Array<{ label: string; on: boolean; key: string }> {
  const chips: Array<{ label: string; on: boolean; key: string }> = [];
  chips.push({ key: 'q', label: hr.flexibleQueenCover ? 'Queen: any cover' : 'Queen: strict cover', on: !hr.flexibleQueenCover });
  chips.push({ key: 'm', label: hr.mixedStacking ? 'Mixed stacking' : '2s / Jacks separate', on: hr.mixedStacking });
  chips.push({ key: 'b', label: hr.bringBacks ? 'Bring Backs' : 'No Bring Backs', on: hr.bringBacks });
  chips.push({ key: 'f', label: hr.finishOnPower ? 'Finish on power' : 'No power finish', on: !hr.finishOnPower });
  chips.push({ key: 'c', label: hr.firstCardActive ? 'First card active' : 'Neutral opener', on: hr.firstCardActive });
  chips.push({ key: 'h', label: HANDS_LABEL[opts.handsToWin] ?? `First to ${opts.handsToWin}`, on: opts.handsToWin > 1 });
  if (opts.turnSeconds > 0) chips.push({ key: 't', label: `${opts.turnSeconds}s turns`, on: true });
  return chips;
}

export function openingNote(view: PlayerView): string | null {
  if (view.version !== 0 || view.discardCount !== 1 || view.handOver) return null;
  const r = view.topDiscard.rank;
  if (view.opening) {
    switch (view.opening) {
      case 'two':
        return 'Opening 2 is active: first player picks up 2 or defends';
      case 'jack':
        return 'Opening black Jack is active: first player picks up 5 or defends';
      case 'ace':
        return 'Opening Ace is active: first player names the suit';
      case 'king':
        return 'Opening King is active: play starts the other way';
      case 'eight':
        return 'Opening 8 is active: the first seat is skipped';
      default:
        return 'Opening Queen is active: it must be covered first';
    }
  }
  return ['2', 'J', '8', 'K', 'Q', 'A'].includes(r) ? 'Opening card - no effect' : null;
}

// ------------------------------------------------------------------ errors

/** Codes that need no message: a corrected `state` follows, or the situation is harmless. */
export const SILENT_ERRORS: ErrorCode[] = ['STALE_VERSION', 'JAKK_ALREADY_DECLARED', 'NOT_YOUR_TURN'];

const FRIENDLY: Partial<Record<ErrorCode, string>> = {
  BAD_MESSAGE: 'Something went wrong. Please try again',
  RATE_LIMITED: 'Easy there - too many taps. Try again in a second',
  NOT_AUTHENTICATED: 'Still connecting. Try again in a moment',
  INVALID_TOKEN: 'Your seat key is invalid. Reload the page to get a new one',
  INVALID_NAME: 'Names need 1 to 16 characters',
  INVALID_AVATAR: 'That avatar is not allowed. Pick another',
  INVALID_OPTIONS: 'Those options are not allowed',
  ROOM_NOT_FOUND: 'Room not found. It may have expired',
  ROOM_FULL: 'That room is full (6 players)',
  GAME_IN_PROGRESS: 'That game has already started',
  ALREADY_IN_ROOM: 'You are already in a room. Leave it first',
  NOT_IN_ROOM: 'You are not in a room',
  NOT_HOST: 'Only the host can do that',
  NOT_ALL_READY: 'Waiting for everyone to be ready',
  NOT_ENOUGH_PLAYERS: 'You need at least 2 players',
  WRONG_PHASE: "That isn't possible right now",
  HAND_IN_PROGRESS: 'House rules can only change between matches',
  NOT_A_BOT: "That player isn't a bot",
  BOT_LIMIT: 'No more bots can join this table',
  SERVER_BUSY: 'The server is busy. Try again in a minute',
  NO_PENALTY: 'There is no pickup to take',
  SUIT_REQUIRED: 'Choose a suit for your Ace',
  MUST_CHOOSE_SUIT: 'Name a suit for the opening Ace first',
  NO_SUIT_CHOICE: 'No suit to choose right now',
  CANNOT_FINISH_ON_POWER: "House rule: you can't go out on an Ace, 2, 8, Jack or King",
  JAKK_NOT_ALLOWED: 'Declare JAKK before your turn, or tick it with your move',
  JAKK_DISABLED: 'JAKK is not used in this game',
  CARD_NOT_IN_HAND: "That card isn't in your hand",
  DUPLICATE_CARD: 'Each card can only be played once',
  EMPTY_PLAY: 'Pick a card first',
  SITTING_OUT: "You're sitting out the rest of this hand",
  GAME_OVER: 'That hand is over',
  UNKNOWN_PLAYER: "You aren't seated in this hand",
  INVALID_ACTION: "That move isn't allowed",
};

/** Codes whose server message already names the card / rule at fault: show it as is. */
const USE_SERVER_MESSAGE: ErrorCode[] = ['ILLEGAL_CARD', 'BAD_SEQUENCE', 'MUST_ANSWER_PENALTY', 'PENALTY_PENDING'];

export function friendlyError(code: ErrorCode, message: string): string {
  if (USE_SERVER_MESSAGE.includes(code)) return message;
  return FRIENDLY[code] ?? message;
}
