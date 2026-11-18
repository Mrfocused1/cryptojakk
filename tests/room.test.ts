import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerId } from '../shared/engine';
import type { ServerMessage } from '../shared/protocol';
import { DEFAULT_TIMING, type Timing } from '../server/config';
import { Room, type Profile } from '../server/room';
import { scenario, seededRng } from './helpers';

// Deterministic coverage of "who plays next?" scheduling in Room: no sockets, fake timers.
const TIMING: Timing = { ...DEFAULT_TIMING, botMinMs: 10, botMaxMs: 10, jakkBotMinMs: 50, awayTurnMs: 100 };
const AV = { emoji: '🦊', color: '#fff' };
const prof = (id: string): Profile => ({ playerId: id, name: id, avatar: AV });

function makeRoom() {
  const sent: Array<{ to: PlayerId; msg: ServerMessage }> = [];
  const destroyed: string[] = [];
  const room = new Room('ROOM1', 'friends', prof('H'), {
    rng: seededRng(3),
    timing: TIMING,
    botJakkRate: 1,
    send: (to, msg) => sent.push({ to, msg }),
    now: () => Date.now(),
    onDestroy: (_r, reason) => destroyed.push(reason),
    log: () => {},
  });
  room.join(prof('P'));
  room.setReady('P', true);
  return { room, sent, destroyed };
}

/** Put the started room into an exact state (H seated first, P second). */
function setState(room: Room, o: Parameters<typeof scenario>[0]) {
  room.state = scenario(o);
}

const HAND_H = ['3H', '4H', '5H'];
const HAND_P = ['3S', '4S', '9D'];
const base = { hands: { H: HAND_H, P: HAND_P }, top: '9H' } as const;

describe('Room scheduling after seat changes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('leaving on your own turn: the new bot plays without any further input', () => {
    const { room } = makeRoom();
    room.start('H');
    setState(room, { ...base, turn: 'P' });
    room.leave('P');
    expect(room.seats.find((s) => s.playerId === 'P')!.isBot).toBe(true);
    const v = room.state!.version;
    vi.advanceTimersByTime(TIMING.botMaxMs + 1);
    expect(room.state!.version).toBeGreaterThan(v);
  });

  it('leaving while a JAKK call is owed by the leaver: the bot still plays', () => {
    const { room } = makeRoom();
    room.start('H');
    setState(room, { hands: { H: HAND_H, P: ['9D'] }, top: '9H', turn: 'P', jakkOwed: 'P' });
    room.leave('P');
    vi.advanceTimersByTime(TIMING.jakkBotMinMs + TIMING.botMaxMs + 1);
    expect(room.state!.version).toBeGreaterThan(0);
  });

  it('leaving while a JAKK call is owed to the remaining human: bot waits, then plays (no stall)', () => {
    const { room } = makeRoom();
    room.start('H');
    setState(room, { hands: { H: ['KD'], P: HAND_P }, top: '9H', turn: 'P', jakkOwed: 'H' });
    room.leave('P');
    vi.advanceTimersByTime(TIMING.botMaxMs + 1);
    expect(room.state!.version).toBe(0); // still giving the human time to declare
    vi.advanceTimersByTime(TIMING.jakkBotMinMs);
    expect(room.state!.version).toBeGreaterThan(0);
  });

  it('leaving while an away-player timer is pending replaces it with the bot timer', () => {
    const { room } = makeRoom();
    room.start('H');
    setState(room, { ...base, turn: 'P' });
    room.setConnected('P', false); // schedules the (slow) away auto-play
    vi.advanceTimersByTime(TIMING.awayTurnMs - 20);
    room.leave('P');
    vi.advanceTimersByTime(TIMING.botMaxMs + 1);
    expect(room.state!.version).toBeGreaterThan(0);
  });

  it('a leave that happens while a bot timer is pending for somebody else does not drop the timer', () => {
    const { room } = makeRoom();
    room.addBot('H');
    room.start('H');
    // seats: H, P, bot. Turn is the bot's, then the human P leaves.
    const bot = room.seats.find((s) => s.isBot)!.playerId;
    setState(room, { hands: { H: HAND_H, P: HAND_P, [bot]: ['6C', '7C', '8C'] }, top: '9C', turn: bot });
    room.leave('P');
    vi.advanceTimersByTime(TIMING.botMaxMs + 1);
    expect(room.state!.version).toBeGreaterThan(0);
  });

  it('disconnected player: away timer plays the turn, and keeps playing every subsequent turn', () => {
    const { room } = makeRoom();
    room.start('H');
    setState(room, { ...base, turn: 'P' });
    room.setConnected('P', false);
    vi.advanceTimersByTime(TIMING.awayTurnMs + 1);
    expect(room.state!.version).toBeGreaterThan(0);
    // hand the turn back to the disconnected player (as after a full round)
    const v = room.state!.version;
    room.state!.turn = room.state!.players.indexOf('P');
    room.setConnected('H', true); // any reschedule trigger
    vi.advanceTimersByTime(TIMING.awayTurnMs + 1);
    expect(room.state!.version).toBeGreaterThan(v);
  });

  it('reconnecting before the away timer fires cancels it', () => {
    const { room } = makeRoom();
    room.start('H');
    setState(room, { ...base, turn: 'P' });
    room.setConnected('P', false);
    vi.advanceTimersByTime(TIMING.awayTurnMs - 10);
    room.setConnected('P', true);
    vi.advanceTimersByTime(TIMING.awayTurnMs * 3);
    expect(room.state!.version).toBe(0);
  });

  it('host leaves mid-game: host moves to the remaining human and the bot that took the seat plays on', () => {
    const { room } = makeRoom();
    room.start('H');
    setState(room, { ...base, turn: 'H' });
    room.leave('H');
    expect(room.hostId).toBe('P');
    expect(room.seats.find((s) => s.playerId === 'H')!.isBot).toBe(true);
    vi.advanceTimersByTime(TIMING.botMaxMs + 1);
    expect(room.state!.version).toBeGreaterThan(0);
  });

  it('host leaves mid-game while P is disconnected: nobody is left connected, room still plays on and expires', () => {
    const { room } = makeRoom();
    room.start('H');
    setState(room, { ...base, turn: 'P' });
    room.setConnected('P', false);
    room.leave('H');
    expect(room.hostId).toBe('P');
    vi.advanceTimersByTime(TIMING.awayTurnMs + TIMING.botMaxMs + 1);
    expect(room.state!.version).toBeGreaterThan(0);
  });

  it('last human leaves mid-game: room is destroyed and no timer keeps running', () => {
    const { room, destroyed } = makeRoom();
    room.start('H');
    room.leave('P');
    room.leave('H');
    expect(destroyed).toEqual(['empty']);
    const v = room.state!.version;
    vi.advanceTimersByTime(10_000);
    expect(room.state!.version).toBe(v);
  });

  it('rematch after a leaver was replaced by a bot starts a game whose bot seats act on their own', () => {
    const { room } = makeRoom();
    room.start('H');
    room.leave('P');
    room.state!.winner = 'H';
    room.phase = 'finished';
    expect(room.rematch('H')).toBeNull();
    expect(room.phase).toBe('rematch');
    expect(room.start('H')).toBeNull(); // bot seat counts as ready
    expect(room.phase).toBe('playing');
    // whoever starts, within a bounded time the game must reach H's turn or finish with bots acting
    room.state!.turn = room.state!.players.indexOf('P');
    room.setConnected('H', true);
    const v = room.state!.version;
    vi.advanceTimersByTime(TIMING.botMaxMs + 1);
    expect(room.state!.version).toBeGreaterThan(v);
  });

  it('a full bot-vs-bot tail (human gone, one disconnected human left) always reaches a winner', () => {
    const { room } = makeRoom();
    room.start('H');
    room.leave('P');
    room.setConnected('H', false);
    vi.advanceTimersByTime(10 * 60_000);
    expect(room.state!.winner).not.toBeNull();
    expect(room.phase).toBe('finished');
  });
});
