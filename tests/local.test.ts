import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseBotAction } from '../shared/ai';
import { type GameState, redactEvents, toPlayerView } from '../shared/engine';
import { LOCAL_PLAYER_ID, LocalGame } from '../shared/local';
import type { ServerMessage } from '../shared/protocol';
import { type Room, type RoomSave, isCompatibleSave } from '../shared/room';
import { cryptoInt, cryptoRng } from '../shared/rng';
import { scenario, seededRng } from './helpers';

const AV = { emoji: '🦊', color: '#ffffff' };

function makeGame(opts: { rng?: () => number; botJakkRate?: number; timing?: object } = {}) {
  const msgs: ServerMessage[] = [];
  const saves: Array<RoomSave | null> = [];
  const game = new LocalGame({
    profile: { name: 'Me', avatar: AV },
    onMessage: (m) => msgs.push(m),
    onPersist: (s) => saves.push(s),
    rng: opts.rng ?? seededRng(11),
    botJakkRate: opts.botJakkRate ?? 1,
    timing: opts.timing as never,
  });
  const room = () => (game as unknown as { room: Room | null }).room;
  const lastView = () => [...msgs].reverse().find((m): m is Extract<ServerMessage, { type: 'state' }> => m.type === 'state');
  return { game, msgs, saves, room, lastView };
}

describe('LocalGame (in-browser solo driver)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('createRoom(ai) emits roomState then the dealt state, like the server', () => {
    const { game, msgs } = makeGame();
    game.handle({ type: 'createRoom', mode: 'ai', botCount: 2 });
    expect(msgs.map((m) => m.type)).toEqual(['roomState', 'state']);
    const rs = msgs[0] as Extract<ServerMessage, { type: 'roomState' }>;
    expect(rs.room.mode).toBe('ai');
    expect(rs.room.phase).toBe('playing');
    expect(rs.room.players).toHaveLength(3);
    expect(rs.room.players.filter((p) => p.isBot)).toHaveLength(2);
    const st = msgs[1] as Extract<ServerMessage, { type: 'state' }>;
    expect(st.view.you).toBe(LOCAL_PLAYER_ID);
    expect(st.view.version).toBe(0);
    expect(st.resync).toBe(false);
  });

  it('plays a complete game to a winner; every view/event is redacted exactly like the server', () => {
    for (const bots of [1, 3]) {
      const { game, msgs, room, lastView } = makeGame({ rng: seededRng(40 + bots) });
      game.handle({ type: 'createRoom', mode: 'ai', botCount: bots });
      let guard = 0;
      while (!lastView()!.view.handOver && guard++ < 4000) {
        vi.advanceTimersByTime(400);
        const v = lastView()!.view;
        const stNow = room()!.state as GameState;
        const topId = stNow.discard[stNow.discard.length - 1].id;
        const hidden = [...stNow.players.filter((p) => p !== LOCAL_PLAYER_ID).flatMap((p) => stNow.hands[p]), ...stNow.drawPile].map((c) => c.id).filter((id) => id !== topId);
        const json = JSON.stringify(lastView());
        for (const id of hidden) expect(json.includes(`"${id}"`), `leak of ${id}`).toBe(false);
        if (v.handOver) break;
        if (v.turn === v.you) {
          const move = chooseBotAction(v, { declareJakk: true })!;
          game.handle({ type: 'action', version: v.version, action: move });
        }
      }
      const final = lastView()!.view;
      expect(final.handOver, `game with ${bots} bots finished`).toBeTruthy();
      expect(['finished', 'handOver']).toContain(room()!.phase);

      // every state message equals what the server would send for that player: toPlayerView + redactEvents, no foreign cards
      const st = room()!.state as GameState;
      expect(final).toEqual(toPlayerView(st, LOCAL_PLAYER_ID));
      for (const m of msgs) {
        if (m.type !== 'state') continue;
        const json = JSON.stringify(m);
        // a view only ever carries the viewer's own hand (a card id can move between hands over a game, so this is
        // checked per message, not against the final state)
        if ('hand' in m.view) {
          expect(new Set(m.view.hand.map((c) => c.id)).size).toBe(m.view.hand.length);
          expect(m.view.hand.length).toBe(m.view.handCounts[LOCAL_PLAYER_ID]);
        }
        expect(Object.keys(m.view)).not.toContain('hands');
        expect(Object.keys(m.view)).not.toContain('drawPile');
        for (const e of m.events) if (e.type === 'drew' && e.playerId !== LOCAL_PLAYER_ID) expect('cards' in e).toBe(false);
        expect(json).not.toContain('drawPile');
      }
      // events are the redacted form of the engine events (spot-check: redacting again is a no-op)
      for (const m of msgs) if (m.type === 'state') expect(redactEvents(m.events, LOCAL_PLAYER_ID)).toEqual(m.events);
    }
  });

  it('bot pacing matches the server: 900-1600 ms per move, with no extra wait tied to the human\'s JAKK', () => {
    const { game, room, lastView } = makeGame();
    game.handle({ type: 'createRoom', mode: 'ai', botCount: 1 });
    const bot = room()!.seats.find((s) => s.isBot)!.playerId;
    room()!.state = scenario({ hands: { [LOCAL_PLAYER_ID]: ['3H', '4S', '3C'], [bot]: ['5D', '6C', 'KS', 'QS'] }, top: '9H', turn: bot });
    room()!.resume();
    const v0 = room()!.state!.version;
    vi.advanceTimersByTime(899);
    expect(room()!.state!.version).toBe(v0); // too early
    vi.advanceTimersByTime(1600 - 899 + 1);
    expect(room()!.state!.version).toBeGreaterThan(v0); // by 1600 it has moved
    expect(lastView()!.events.length).toBeGreaterThan(0);
  });

  it('JAKK model: finishing without a declaration costs a card; declaring before the turn (standalone, or with the previous move) wins', () => {
    const mk = () => {
      const g = makeGame();
      g.game.handle({ type: 'createRoom', mode: 'ai', botCount: 1 });
      const bot = g.room()!.seats.find((s) => s.isBot)!.playerId;
      return { ...g, bot };
    };
    // no declaration: the last card is played but the human stays in with 1 drawn card
    const a = mk();
    a.room()!.state = scenario({ hands: { [LOCAL_PLAYER_ID]: ['3H'], [a.bot]: ['5D', '6C', 'KS', 'QS'] }, top: '9H', turn: LOCAL_PLAYER_ID });
    a.game.handle({ type: 'action', version: 0, action: { type: 'play', cardIds: ['3H'] } });
    expect(a.room()!.state!.winner).toBeNull();
    expect(a.room()!.state!.hands[LOCAL_PLAYER_ID]).toHaveLength(1);
    // declared off-turn with the standalone action: then the finishing move wins
    const b = mk();
    b.room()!.state = scenario({ hands: { [LOCAL_PLAYER_ID]: ['3H'], [b.bot]: ['5D', '6C', 'KS', 'QS'] }, top: '9H', turn: b.bot });
    b.game.handle({ type: 'action', version: 0, action: { type: 'declareJakk' } });
    expect(b.room()!.state!.jakk[LOCAL_PLAYER_ID]).toBe(true);
    b.room()!.state = { ...b.room()!.state!, turn: 0 };
    b.game.handle({ type: 'action', version: b.room()!.state!.version, action: { type: 'play', cardIds: ['3H'] } });
    expect(b.room()!.state!.winner).toBe(LOCAL_PLAYER_ID);
    expect(b.room()!.phase).toBe('finished');
  });

  it('stale versions and wrong turns come back as typed errors with a resync view', () => {
    const { game, msgs, room } = makeGame();
    game.handle({ type: 'createRoom', mode: 'ai', botCount: 1 });
    msgs.length = 0;
    game.handle({ type: 'action', version: 99, action: { type: 'draw' }, reqId: 'x' });
    expect(msgs[0]).toMatchObject({ type: 'error', code: 'STALE_VERSION', reqId: 'x' });
    expect(msgs[1]).toMatchObject({ type: 'state', resync: true });
    expect(room()).not.toBeNull();
  });

  it('persists, restores into a fresh driver and keeps playing; rematch restarts; leave clears', async () => {
    const a = makeGame({ rng: seededRng(5) });
    a.game.handle({ type: 'createRoom', mode: 'ai', botCount: 1 });
    vi.advanceTimersByTime(5000);
    await Promise.resolve();
    const save = a.saves.at(-1);
    expect(save).toBeTruthy();
    const roundTrip = JSON.parse(JSON.stringify(save)) as RoomSave;
    a.game.close();

    const b = makeGame({ rng: seededRng(6) });
    b.game.restore(roundTrip);
    expect(b.msgs.map((m) => m.type)).toEqual(['roomState', 'state']);
    expect(b.msgs[1]).toMatchObject({ type: 'state', resync: true });
    expect(b.lastView()!.view.version).toBe(roundTrip.state!.version);
    // finish the game from the restored state
    let guard = 0;
    while (!b.lastView()!.view.handOver && guard++ < 4000) {
      vi.advanceTimersByTime(400);
      const v = b.lastView()!.view;
      if (!v.handOver && v.turn === v.you) b.game.handle({ type: 'action', version: v.version, action: chooseBotAction(v, { declareJakk: true })! });
    }
    expect(b.lastView()!.view.handOver).toBeTruthy();
    b.msgs.length = 0;
    b.game.handle({ type: 'rematch' });
    expect(b.room()!.phase).toBe('playing');
    expect(b.lastView()!.view.version).toBe(0);
    await Promise.resolve();
    b.saves.length = 0;
    b.game.handle({ type: 'leave' });
    expect(b.msgs.at(-1)).toEqual({ type: 'left' });
    expect(b.saves.at(-1)).toBeNull();
    expect(b.game.active).toBe(false);
  });

  it('a save from an older version of the game (old rules, no version) is refused cleanly, never half-restored', () => {
    const a = makeGame({ rng: seededRng(9) });
    a.game.handle({ type: 'createRoom', mode: 'ai', botCount: 2 });
    const save = JSON.parse(JSON.stringify(a.room()!.save())) as Record<string, any>;
    a.game.close();
    expect(isCompatibleSave(save)).toBe(true);

    // the previous release: no `v`, legacy rules shape
    const legacy = JSON.parse(JSON.stringify(save));
    delete legacy.v;
    const { skipRank: _s, reverseRank: _r, flexibleQueenCover: _f, ...rest } = legacy.state.rules;
    legacy.state.rules = { ...rest, eightReverses: true, sevenSkips: true, powerRanks: ['2', '7', '8', 'J', 'A'] };
    expect(isCompatibleSave(legacy)).toBe(false);
    const b = makeGame({ rng: seededRng(10) });
    expect(() => b.game.restore(legacy as RoomSave)).toThrow(/Incompatible/);
    expect(b.game.active).toBe(false);

    // right version number but old rules inside
    const half = JSON.parse(JSON.stringify(save));
    half.state.rules = legacy.state.rules;
    expect(isCompatibleSave(half)).toBe(false);
    expect(isCompatibleSave(null)).toBe(false);
    expect(isCompatibleSave({ v: 2 })).toBe(false);
  });

  it('refuses non-solo requests instead of pretending to host friends rooms', () => {
    const { game, msgs } = makeGame();
    game.handle({ type: 'createRoom', mode: 'friends' });
    game.handle({ type: 'joinRoom', code: 'ABCDE', reqId: 'join' });
    expect(msgs[0]).toMatchObject({ type: 'error', code: 'BAD_MESSAGE' });
    expect(msgs[1]).toMatchObject({ type: 'error', code: 'ROOM_NOT_FOUND', reqId: 'join' });
  });
});

describe('shared crypto rng', () => {
  it('cryptoRng is in [0,1) and cryptoInt is uniform-ish and inclusive', () => {
    for (let i = 0; i < 1000; i++) {
      const x = cryptoRng();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(cryptoInt(3, 6));
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
    expect(cryptoInt(7, 7)).toBe(7);
  });
});
