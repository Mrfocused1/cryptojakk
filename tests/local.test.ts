import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseBotAction } from '../shared/ai';
import { type GameState, DEFAULT_RULES, redactEvents, toPlayerView } from '../shared/engine';
import { LOCAL_PLAYER_ID, LocalGame } from '../shared/local';
import type { ServerMessage } from '../shared/protocol';
import { type Room, type RoomSave } from '../shared/room';
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
      while (!lastView()!.view.winner && guard++ < 4000) {
        vi.advanceTimersByTime(400);
        const v = lastView()!.view;
        const stNow = room()!.state as GameState;
        const topId = stNow.discard[stNow.discard.length - 1].id;
        const hidden = [...stNow.players.filter((p) => p !== LOCAL_PLAYER_ID).flatMap((p) => stNow.hands[p]), ...stNow.drawPile].map((c) => c.id).filter((id) => id !== topId);
        const json = JSON.stringify(lastView());
        for (const id of hidden) expect(json.includes(`"${id}"`), `leak of ${id}`).toBe(false);
        if (v.winner) break;
        if (v.turn === v.you) {
          const move = chooseBotAction(v, { declareJakk: true })!;
          game.handle({ type: 'action', version: v.version, action: move });
        }
      }
      const final = lastView()!.view;
      expect(final.winner, `game with ${bots} bots finished`).toBeTruthy();
      expect(room()!.phase).toBe('finished');

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

  it('bot pacing matches the server: 900-1600 ms, and >= 3000 ms while the human owes JAKK', () => {
    const { game, room, lastView, msgs } = makeGame();
    game.handle({ type: 'createRoom', mode: 'ai', botCount: 1 });
    const bot = room()!.seats.find((s) => s.isBot)!.playerId;
    const hand = ['3H', '4S'];
    room()!.state = scenario({ hands: { [LOCAL_PLAYER_ID]: hand, [bot]: ['5D', '6C', 'KS', 'QS'] }, top: '9H', turn: bot });
    room()!.resume();
    const v0 = room()!.state!.version;
    vi.advanceTimersByTime(899);
    expect(room()!.state!.version).toBe(v0); // too early
    vi.advanceTimersByTime(1600 - 899 + 1);
    expect(room()!.state!.version).toBeGreaterThan(v0); // by 1600 it has moved
    expect(lastView()!.events.length).toBeGreaterThan(0);

    // human to move with 2 cards, plays down to one WITHOUT declaring JAKK
    const { game: g2, room: room2, msgs: msgs2 } = makeGame();
    g2.handle({ type: 'createRoom', mode: 'ai', botCount: 1 });
    const bot2 = room2()!.seats.find((s) => s.isBot)!.playerId;
    room2()!.state = scenario({ hands: { [LOCAL_PLAYER_ID]: ['3H', '4S'], [bot2]: ['5D', '6C', 'KS', 'QS'] }, top: '9H', turn: LOCAL_PLAYER_ID });
    g2.handle({ type: 'action', version: 0, action: { type: 'play', cardIds: ['3H'] } });
    expect(room2()!.state!.jakkOwed).toBe(LOCAL_PLAYER_ID);
    const v1 = room2()!.state!.version;
    vi.advanceTimersByTime(2999);
    expect(room2()!.state!.version).toBe(v1); // bot waits the full JAKK window
    vi.advanceTimersByTime(2);
    expect(room2()!.state!.version).toBeGreaterThan(v1);
    void msgs; void msgs2;
  });

  it('JAKK miss: the forgetful human draws the miss penalty on the next applied action', () => {
    const { game, room, msgs } = makeGame();
    game.handle({ type: 'createRoom', mode: 'ai', botCount: 1 });
    const bot = room()!.seats.find((s) => s.isBot)!.playerId;
    room()!.state = scenario({ hands: { [LOCAL_PLAYER_ID]: ['3H', '4S'], [bot]: ['5D', '6C', 'KS', 'QS'] }, top: '9H', turn: LOCAL_PLAYER_ID });
    msgs.length = 0;
    game.handle({ type: 'action', version: 0, action: { type: 'play', cardIds: ['3H'] } });
    expect(room()!.state!.hands[LOCAL_PLAYER_ID]).toHaveLength(1);
    vi.advanceTimersByTime(3001); // bot acts -> miss applies first
    const hand = room()!.state!.hands[LOCAL_PLAYER_ID];
    expect(hand).toHaveLength(1 + DEFAULT_RULES.jakkMissPenalty);
    const events = msgs.flatMap((m) => (m.type === 'state' ? m.events : []));
    expect(events.some((e) => e.type === 'jakkMissed' && e.playerId === LOCAL_PLAYER_ID)).toBe(true);
    expect(room()!.state!.jakkOwed).toBeNull();
  });

  it('declaring JAKK in time avoids the penalty (and the declare is accepted)', () => {
    const { game, room } = makeGame();
    game.handle({ type: 'createRoom', mode: 'ai', botCount: 1 });
    const bot = room()!.seats.find((s) => s.isBot)!.playerId;
    room()!.state = scenario({ hands: { [LOCAL_PLAYER_ID]: ['3H', '4S'], [bot]: ['5D', '6C', 'KS', 'QS'] }, top: '9H', turn: LOCAL_PLAYER_ID });
    game.handle({ type: 'action', version: 0, action: { type: 'play', cardIds: ['3H'], declareJakk: true } });
    expect(room()!.state!.jakkOwed).toBeNull();
    vi.advanceTimersByTime(2000);
    expect(room()!.state!.hands[LOCAL_PLAYER_ID]).toHaveLength(1);
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
    while (!b.lastView()!.view.winner && guard++ < 4000) {
      vi.advanceTimersByTime(400);
      const v = b.lastView()!.view;
      if (!v.winner && v.turn === v.you) b.game.handle({ type: 'action', version: v.version, action: chooseBotAction(v, { declareJakk: true })! });
    }
    expect(b.lastView()!.view.winner).toBeTruthy();
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

  it('restores a save made under the old rules (8 reverses, 7 skips) with the current rules instead of crashing', () => {
    const a = makeGame({ rng: seededRng(9) });
    a.game.handle({ type: 'createRoom', mode: 'ai', botCount: 2 });
    const save = JSON.parse(JSON.stringify(a.room()!.save())) as RoomSave;
    a.game.close();
    // rewrite the embedded rules into the legacy shape
    const { skipRank: _s, reverseRank: _r, ...rest } = save.state!.rules as unknown as Record<string, unknown>;
    save.state!.rules = { ...rest, eightReverses: true, sevenSkips: true, powerRanks: ['2', '7', '8', 'J', 'A'] } as never;

    const b = makeGame({ rng: seededRng(10) });
    b.game.restore(save);
    const st = b.room()!.state as GameState;
    expect(st.rules.skipRank).toBe('8');
    expect(st.rules.reverseRank).toBe('K');
    expect(st.rules.powerRanks).toContain('K');
    expect(st.rules.powerRanks).not.toContain('7');
    expect(st.hands).toEqual(save.state!.hands); // the game itself is untouched
    expect(b.lastView()!.view.rules.skipRank).toBe('8');
    b.game.close();
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
