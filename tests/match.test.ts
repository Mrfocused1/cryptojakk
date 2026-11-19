// Room-level features: house rules / match options, multi-hand matches, dealer rotation, turn timer, late joiners, history.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerId } from '../shared/engine';
import type { ServerMessage } from '../shared/protocol';
import { DEFAULT_TIMING, type Timing } from '../server/config';
import { Room, type Profile } from '../server/room';
import { parseClientMessage } from '../server/validate';
import { scenario, seededRng } from './helpers';

const TIMING: Timing = { ...DEFAULT_TIMING, botMinMs: 10, botMaxMs: 10, awayTurnMs: 100_000 };
const AV = { emoji: '🦊', color: '#fff' };
const prof = (id: string): Profile => ({ playerId: id, name: id, avatar: AV });

function makeRoom(mode: 'friends' | 'ai' = 'friends', extra: string[] = ['P']) {
  const sent: Array<{ to: PlayerId; msg: ServerMessage }> = [];
  const room = new Room('ROOM1', mode, prof('H'), {
    rng: seededRng(11),
    timing: TIMING,
    botJakkRate: 1,
    send: (to, msg) => sent.push({ to, msg }),
    now: () => Date.now(),
    onDestroy: () => {},
    log: () => {},
  });
  for (const p of extra) {
    room.join(prof(p));
    room.setReady(p, true);
  }
  return { room, sent };
}
const states = (sent: Array<{ to: PlayerId; msg: ServerMessage }>, to: string) =>
  sent.filter((s) => s.to === to && s.msg.type === 'state').map((s) => s.msg as Extract<ServerMessage, { type: 'state' }>);

/** Put the room into a state where H finishes next move (JAKK declared). */
function arrangeHWins(room: Room, others: Record<string, string[]> = { P: ['3S', '4S', '9D'] }) {
  room.state = scenario({ hands: { H: ['9H'], ...others }, top: '5H', turn: 'H', jakk: ['H'], dealer: 'P' });
}

describe('house rules and match options', () => {
  it('are host-only, validated, visible to everyone, and reach the engine rules', () => {
    const { room, sent } = makeRoom();
    expect(room.setOptions('P', { houseRules: { bringBacks: true } })).toMatchObject({ code: 'NOT_HOST' });
    expect(room.setOptions('H', { houseRules: { bringBacks: true, flexibleQueenCover: false }, options: { handsToWin: 3, turnSeconds: 30 } })).toBeNull();
    const snap = room.snapshot();
    expect(snap.houseRules).toEqual({ flexibleQueenCover: false, mixedStacking: true, bringBacks: true, finishOnPower: true, firstCardActive: false });
    expect(snap.options).toEqual({ handsToWin: 3, turnSeconds: 30 });
    expect(snap.rules.bringBacks).toBe(true);
    expect(sent.some((s) => s.to === 'P' && s.msg.type === 'roomState' && s.msg.room.houseRules.bringBacks)).toBe(true);
    // changing rules un-readies guests so everyone re-confirms
    expect(snap.players.find((p) => p.playerId === 'P')!.ready).toBe(false);
    room.setReady('P', true);
    expect(room.start('H')).toBeNull();
    expect(room.state!.rules).toMatchObject({ bringBacks: true, flexibleQueenCover: false });
    // never mid-hand
    expect(room.setOptions('H', { houseRules: { bringBacks: false } })).toMatchObject({ code: 'HAND_IN_PROGRESS' });
    expect(room.state!.rules.bringBacks).toBe(true);
  });

  it('solo (ai) rooms accept house rules but never run a turn timer', () => {
    const { room } = makeRoom('ai', []);
    room.startAi(2, { houseRules: { firstCardActive: true }, options: { turnSeconds: 45, handsToWin: 5 } });
    expect(room.options).toEqual({ handsToWin: 5, turnSeconds: 0 });
    expect(room.state!.rules.firstCardActive).toBe(true);
    expect(room.seats).toHaveLength(3);
  });

  it('the wire format rejects unknown rules and values', () => {
    const bad = (m: object) => parseClientMessage({ type: 'setOptions', ...m });
    expect(bad({ houseRules: { nope: true } })).toMatchObject({ ok: false, code: 'INVALID_OPTIONS' });
    expect(bad({ options: { turnSeconds: 25 } })).toMatchObject({ ok: false, code: 'INVALID_OPTIONS' });
    expect(bad({})).toMatchObject({ ok: false, code: 'INVALID_OPTIONS' });
    expect(bad({ options: { handsToWin: 5 } })).toMatchObject({ ok: true });
    expect(parseClientMessage({ type: 'createRoom', mode: 'ai', botCount: 5 })).toMatchObject({ ok: true });
    expect(parseClientMessage({ type: 'createRoom', mode: 'ai', botCount: 6 })).toMatchObject({ ok: false });
    expect(parseClientMessage({ type: 'action', version: 1, action: { type: 'chooseSuit', suit: 'H' } })).toMatchObject({ ok: true });
    expect(parseClientMessage({ type: 'action', version: 1, action: { type: 'pass' } })).toMatchObject({ ok: false });
    expect(parseClientMessage({ type: 'nextHand' })).toMatchObject({ ok: true });
    expect(parseClientMessage({ type: 'requestHistory' })).toMatchObject({ ok: true });
  });
});

describe('multi-hand match', () => {
  it('handsToWin 3: scores accumulate, the dealer rotates, "next hand" is host-only, the third win ends the match, rematch keeps settings and resets scores', () => {
    const { room } = makeRoom();
    room.setOptions('H', { options: { handsToWin: 3 }, houseRules: { bringBacks: true } });
    room.setReady('P', true);
    room.start('H');
    expect(room.handNumber).toBe(1);
    const dealers = [room.state!.dealer];
    for (let hand = 1; hand <= 3; hand++) {
      arrangeHWins(room);
      expect(room.action('H', 0, { type: 'play', cardIds: ['9H'] })).toBeNull();
      expect(room.state!.winner).toBe('H');
      expect(room.scores.H).toBe(hand);
      if (hand < 3) {
        expect(room.phase).toBe('handOver');
        expect(room.matchWinner).toBeNull();
        expect(room.nextHand('P')).toMatchObject({ code: 'NOT_HOST' });
        expect(room.nextHand('H')).toBeNull();
        expect(room.phase).toBe('playing');
        expect(room.handNumber).toBe(hand + 1);
        dealers.push(room.state!.dealer);
        expect(room.state!.rules.bringBacks).toBe(true); // same house rules every hand
        expect(room.state!.players.every((p) => room.state!.hands[p].length === 7)).toBe(true);
      }
    }
    expect(room.phase).toBe('finished');
    expect(room.matchWinner).toBe('H');
    expect(room.nextHand('H')).toMatchObject({ code: 'WRONG_PHASE' });
    // dealer moved one seat each hand
    expect(dealers[1]).toBe((dealers[0] + 1) % 2);
    expect(dealers[2]).toBe((dealers[1] + 1) % 2);
    // rematch keeps the agreed settings but starts from 0-0
    expect(room.rematch('H')).toBeNull();
    expect(room.phase).toBe('rematch');
    expect(room.options.handsToWin).toBe(3);
    expect(room.houseRules.bringBacks).toBe(true);
    room.setReady('P', true);
    room.start('H');
    expect(room.scores).toEqual({});
    expect(room.handNumber).toBe(1);
  });

  it('a hand that ends with no winner awards nothing, even with handsToWin 1', () => {
    const { room } = makeRoom();
    room.start('H');
    room.state = scenario({
      hands: { H: ['9S', '3C', '4C', '6D', '7S'], P: ['4D', '5D', '6S', '8S', '9D'] },
      top: '5H',
      turn: 'H',
      rest: 'none',
      penalty: { kind: 'two', amount: 2 },
    });
    // H must pick up 2 with nothing left anywhere and a tie for most cards: no winner
    expect(room.action('H', 0, { type: 'takePenalty' })).toBeNull();
    expect(room.state!.handOver).toEqual({ winner: null, reason: 'deckExhausted' });
    expect(room.scores).toEqual({});
    expect(room.phase).toBe('handOver');
    expect(room.matchWinner).toBeNull();
    expect(room.nextHand('H')).toBeNull();
    expect(room.phase).toBe('playing');
  });
});

describe('turn timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const startTimed = (secs: 20 | 30) => {
    const made = makeRoom();
    made.room.setOptions('H', { options: { turnSeconds: secs } });
    made.room.setReady('P', true);
    made.room.start('H');
    return made;
  };
  const turnPlayer = (room: Room) => room.state!.players[room.state!.turn];

  it('is server-authoritative: the state message carries an absolute deadline + server time for the player to move', () => {
    const { room, sent } = startTimed(20);
    const first = states(sent, 'H').at(-1)!;
    const who = turnPlayer(room);
    expect(first.timer).toMatchObject({ playerId: who, seconds: 20 });
    expect(first.timer!.deadline - first.timer!.serverTime).toBe(20_000);
    expect(first.timer!.serverTime).toBe(Date.now());
  });

  it('on expiry the server plays the legal default: draw 1 (or take the pending penalty), with a timedOut event', () => {
    const { room, sent } = startTimed(20);
    const who = turnPlayer(room);
    room.state = scenario({ hands: { H: ['9S', '3C', '4C'], P: ['4D', '5D', '6S'] }, top: '5H', turn: who, draw: ['KC', 'QC'] });
    (room as unknown as { schedule(): void }).schedule();
    const v0 = room.state!.version;
    vi.advanceTimersByTime(19_999);
    expect(room.state!.version).toBe(v0);
    vi.advanceTimersByTime(2);
    expect(room.state!.version).toBe(v0 + 1);
    expect(room.state!.hands[who]).toHaveLength(4);
    const last = states(sent, who).at(-1)!;
    expect(last.events[0]).toEqual({ type: 'timedOut', playerId: who });
    expect(room.history.at(-1)!.kind).toBe('timeout');
    // a pending penalty is taken instead
    const other = turnPlayer(room);
    room.state = scenario({ hands: { H: ['9S', '3C', '4C'], P: ['4D', '5D', '6S'] }, top: '2H', turn: other, penalty: { kind: 'two', amount: 2 }, draw: ['KC', 'QC'] });
    (room as unknown as { schedule(): void }).schedule();
    vi.advanceTimersByTime(20_001);
    expect(room.state!.hands[other]).toHaveLength(5);
    expect(room.state!.penalty).toBeNull();
  });

  it('a new turn gets a fresh clock; reconnecting does not reset the running one', () => {
    const { room, sent } = startTimed(30);
    const who = turnPlayer(room);
    room.state = scenario({ hands: { H: ['9S', '3C', '4C'], P: ['4D', '5D', '6S'] }, top: '5H', turn: who });
    (room as unknown as { schedule(): void }).schedule();
    const d0 = room.timerMsg()!.deadline;
    vi.advanceTimersByTime(12_000);
    room.setConnected(who, false);
    room.setConnected(who, true);
    room.sendView(who);
    const resent = states(sent, who).at(-1)!;
    expect(resent.resync).toBe(true);
    expect(resent.timer!.deadline).toBe(d0); // same absolute deadline after reconnecting
    // acting starts a clock for the next player
    expect(room.action(who, room.state!.version, { type: 'draw' })).toBeNull();
    const t1 = room.timerMsg();
    expect(t1!.playerId).not.toBe(who);
    expect(t1!.deadline).toBeGreaterThan(d0);
  });

  it('there is no timer when turnSeconds is 0, nor for bots', () => {
    const { room, sent } = makeRoom();
    room.start('H');
    expect(states(sent, 'H').at(-1)!.timer).toBeNull();
    const ai = makeRoom('ai', []);
    ai.room.startAi(1);
    expect(ai.room.timerMsg()).toBeNull();
  });
});

describe('late joiners (rule 154)', () => {
  it('join mid-hand as a waiting spectator, see only public info, and are dealt in from the next hand; room-full still rejects', () => {
    const { room, sent } = makeRoom();
    room.start('H');
    expect(room.join(prof('L'))).toBeNull();
    const seat = room.snapshot().players.find((p) => p.playerId === 'L')!;
    expect(seat.waiting).toBe(true);
    room.sendFull('L');
    const view = states(sent, 'L').at(-1)!.view;
    expect(view).toMatchObject({ spectator: true, hand: [] });
    expect(view.players).not.toContain('L');
    expect(JSON.stringify(view)).not.toContain(room.state!.hands.H[0].id + '","rank"');
    expect(room.action('L', room.state!.version, { type: 'draw' })).toMatchObject({ code: 'NOT_YOUR_TURN' });
    // state broadcasts reach the spectator too, with redacted events
    arrangeHWins(room);
    room.action('H', 0, { type: 'play', cardIds: ['9H'] });
    expect(states(sent, 'L').at(-1)!.view.handOver).toMatchObject({ winner: 'H' });
    // dealt in next hand
    room.options.handsToWin = 3;
    room.phase = 'handOver';
    room.nextHand('H');
    expect(room.state!.players).toContain('L');
    expect(room.state!.hands.L).toHaveLength(7);
    expect(room.snapshot().players.find((p) => p.playerId === 'L')!.waiting).toBe(false);
    // the room is full at 6
    for (const id of ['A1', 'A2', 'A3']) expect(room.join(prof(id))).toBeNull();
    expect(room.join(prof('X'))).toMatchObject({ code: 'ROOM_FULL' });
  });

  it('a waiting participant who leaves simply disappears (no bot is left behind)', () => {
    const { room } = makeRoom();
    room.start('H');
    room.join(prof('L'));
    room.leave('L');
    expect(room.seats.some((s) => s.playerId === 'L')).toBe(false);
  });

  it('solo rooms cannot be joined', () => {
    const { room } = makeRoom('ai', []);
    room.startAi(1);
    expect(room.join(prof('X'))).toMatchObject({ code: 'GAME_IN_PROGRESS' });
  });
});

describe('move history (R197)', () => {
  it('keeps an ordered, public log of the current hand and resets each hand', () => {
    const { room, sent } = makeRoom();
    room.start('H');
    expect(room.history[0]).toMatchObject({ kind: 'deal', playerId: null, hand: 1 });
    const who = room.state!.players[room.state!.turn];
    room.action(who, room.state!.version, { type: 'draw' });
    const e = room.history.at(-1)!;
    expect(e).toMatchObject({ kind: 'draw', playerId: who, version: 1 });
    expect(e.events.find((x) => x.type === 'drew')).toBeTruthy();
    for (const x of room.history.flatMap((h) => h.events)) if (x.type === 'drew') expect('cards' in x).toBe(false);
    room.join(prof('L'));
    sent.length = 0;
    expect(room.sendHistory('L')).toBeNull();
    const msg = sent.find((s) => s.to === 'L')!.msg as Extract<ServerMessage, { type: 'history' }>;
    expect(msg.type).toBe('history');
    expect(msg.entries.map((h) => h.seq)).toEqual(room.history.map((h) => h.seq));
    expect(room.sendHistory('nobody')).toMatchObject({ code: 'NOT_IN_ROOM' });
    arrangeHWins(room);
    room.action('H', 0, { type: 'play', cardIds: ['9H'] });
    room.options.handsToWin = 3;
    room.phase = 'handOver';
    room.nextHand('H');
    expect(room.history).toHaveLength(1);
    expect(room.history[0]).toMatchObject({ kind: 'deal', hand: 2 });
  });
});
