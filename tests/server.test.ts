import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { chooseBotAction } from '../shared/ai';
import { getLegalCardIds, type PlayerView } from '../shared/engine';
import type { RoomSnapshot, ServerMessage } from '../shared/protocol';
import { createGameServer, type GameServer } from '../server/app';

const FAST = { botMinMs: 5, botMaxMs: 10, awayTurnMs: 150, sweepIntervalMs: 40, emptyRoomTtlMs: 200 };
const AVATAR = { emoji: '🦊', color: '#ff8800' };

type Msg = ServerMessage;

class Client {
  log: Msg[] = [];
  cursor = 0;
  playerId = '';
  view: PlayerView | null = null;
  room: RoomSnapshot | null = null;
  closeCode: number | null = null;
  private listeners: Array<() => void> = [];
  private auto = false;
  private autoDone: ((v: PlayerView) => void) | null = null;

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as Msg;
      this.log.push(m);
      if (m.type === 'state') this.view = m.view;
      if (m.type === 'roomState') this.room = m.room;
      if (m.type === 'welcome') this.playerId = m.playerId;
      if (this.auto && m.type === 'state') this.autoStep(m.view);
      // The server drops (and does not queue) messages beyond the per-socket rate limit. A client that is
      // throttled must ask for the current view again once its bucket has refilled, otherwise the game waits
      // forever on a connected player whose move was never applied.
      if (this.auto && m.type === 'error' && m.code === 'RATE_LIMITED') this.scheduleResync();
      this.listeners.forEach((l) => l());
    });
    ws.on('close', (c) => {
      this.closeCode = c;
      this.listeners.forEach((l) => l());
    });
  }

  static connect(port: number): Promise<Client> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.once('open', () => resolve(new Client(ws)));
      ws.once('error', reject);
    });
  }

  send(o: unknown) {
    this.ws.send(JSON.stringify(o));
  }

  /** Wait for the next message (after the cursor) matching `pred`. */
  next<T extends Msg = Msg>(pred: (m: Msg) => boolean, timeout = 4000): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.listeners = this.listeners.filter((l) => l !== check);
        reject(new Error(`timeout waiting for message; got: ${this.log.slice(this.cursor).map((m) => m.type + ('code' in m ? ':' + m.code : '')).join(',')}`));
      }, timeout);
      const check = () => {
        for (let i = this.cursor; i < this.log.length; i++) {
          if (pred(this.log[i])) {
            this.cursor = i + 1;
            clearTimeout(t);
            this.listeners = this.listeners.filter((l) => l !== check);
            resolve(this.log[i] as T);
            return;
          }
        }
      };
      this.listeners.push(check);
      check();
    });
  }

  type<T extends Msg['type']>(type: T, timeout?: number) {
    return this.next<Extract<Msg, { type: T }>>((m) => m.type === type, timeout);
  }
  error(code: string) {
    return this.next<Extract<Msg, { type: 'error' }>>((m) => m.type === 'error' && m.code === code);
  }
  clear() {
    this.cursor = this.log.length;
  }

  async hello(token: string, name = 'Tester') {
    this.send({ type: 'hello', sessionToken: token, name, avatar: AVATAR, protocol: 2 });
    return this.type('welcome');
  }

  private autoStep(v: PlayerView) {
    if (v.handOver) {
      this.autoDone?.(v);
      return;
    }
    if (v.turn !== v.you) return;
    const move = chooseBotAction(v, { declareJakk: true });
    if (move) this.send({ type: 'action', version: v.version, action: move });
  }

  private resyncTimer: NodeJS.Timeout | null = null;
  private scheduleResync() {
    if (this.resyncTimer) return;
    this.resyncTimer = setTimeout(() => {
      this.resyncTimer = null;
      if (this.auto && this.ws.readyState === WebSocket.OPEN) this.send({ type: 'requestState' });
    }, 150);
  }

  /** Play (via the shared bot) until somebody wins; resolves with the final view, rejects with a diagnostic on stall. */
  autoplay(timeoutMs = 20_000): Promise<PlayerView> {
    return new Promise((resolve, reject) => {
      const stall = setTimeout(() => {
        this.auto = false;
        const v = this.view;
        reject(
          new Error(
            `autoplay stalled: turn=${v?.turn} you=${v?.you} version=${v?.version}; recent: ` +
              this.log.slice(-8).map((m) => m.type + ('code' in m ? ':' + m.code : '')).join(','),
          ),
        );
      }, timeoutMs);
      this.auto = true;
      this.autoDone = (v) => {
        clearTimeout(stall);
        resolve(v);
      };
      if (this.view) this.autoStep(this.view);
    });
  }

  close() {
    if (this.resyncTimer) clearTimeout(this.resyncTimer);
    this.ws.close();
  }
}

const tok = (n: string) => ('tok_' + n.replace(/[^A-Za-z0-9]/g, '')).padEnd(24, 'x');

let server: GameServer;
let port: number;
const open: Client[] = [];
async function client(token?: string, name?: string) {
  const c = await Client.connect(port);
  open.push(c);
  if (token) await c.hello(token, name);
  return c;
}

beforeAll(async () => {
  // Bots run ~100x faster than real life (FAST) and the autoplay client answers instantly, so a whole game fits in
  // well under a second. Production's per-socket limit (30 burst, 15/s) is meant for humans; give this shared
  // server a generous one so the rate limiter is only exercised by the tests that target it ('hardening').
  server = createGameServer({ timing: FAST, rateLimit: { burst: 1000, perSecond: 1000 }, botJakkRate: 1, log: (m) => process.env.JAKK_DEBUG && console.log(m) });
  port = await server.listen(0, '127.0.0.1');
});
afterAll(async () => {
  open.forEach((c) => c.ws.terminate());
  await server.close();
});

async function lobby(names: string[]): Promise<{ clients: Client[]; code: string }> {
  const [host, ...rest] = await Promise.all(names.map((n) => client(tok(n + Math.random().toString(36).slice(2)), n)));
  host.send({ type: 'createRoom', mode: 'friends' });
  const code = (await host.type('roomState')).room.code;
  for (const c of rest) {
    c.send({ type: 'joinRoom', code });
    await c.next((m) => m.type === 'roomState' && m.room.players.length > 1);
  }
  return { clients: [host, ...rest], code };
}

describe('server integration', () => {
  it('create -> join -> ready -> start -> actions -> stale/duplicate -> disconnect/reconnect', async () => {
    const A = await client(tok('A'), 'Alice');
    const B = await client(tok('B'), 'Bob');
    expect(A.playerId).toMatch(/^p_/);
    expect(A.playerId).not.toContain('tok_');

    A.send({ type: 'createRoom', mode: 'friends', reqId: 'r1' });
    const created = await A.type('roomState');
    const code = created.room.code;
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
    expect(created.room).toMatchObject({ mode: 'friends', phase: 'lobby', hostId: A.playerId, canStart: false });

    B.send({ type: 'joinRoom', code: code.toLowerCase() });
    const joined = await B.next<Extract<Msg, { type: 'roomState' }>>((m) => m.type === 'roomState' && m.room.players.length === 2);
    expect(joined.room.players.map((p) => p.name)).toEqual(['Alice', 'Bob']);
    expect(joined.room.players[0]).toMatchObject({ isHost: true, connected: true, avatar: AVATAR });

    // host cannot start until B is ready
    A.send({ type: 'startGame', reqId: 'start1' });
    const notReady = await A.error('NOT_ALL_READY');
    expect(notReady.reqId).toBe('start1');
    B.send({ type: 'setReady', ready: true });
    await A.next((m) => m.type === 'roomState' && m.room.canStart);
    B.send({ type: 'startGame' });
    await B.error('NOT_HOST');
    A.send({ type: 'startGame' });

    const [sa, sb] = await Promise.all([A.type('state'), B.type('state')]);
    expect(sa.resync).toBe(false);
    expect(sa.view.hand).toHaveLength(7);
    expect(sa.view.handCounts[B.playerId]).toBe(7);
    expect(JSON.stringify(sa)).not.toContain(sb.view.hand[0].id + '","rank"'); // never B's cards (ids unique)
    expect(sa.view.version).toBe(0);
    expect(sb.view.you).toBe(B.playerId);

    // a few real actions
    const byId = { [A.playerId]: A, [B.playerId]: B };
    for (let i = 0; i < 4; i++) {
      const turn = A.view!.turn;
      const actor = byId[turn];
      const other = turn === A.playerId ? B : A;
      const v = actor.view!;
      const legal = getLegalCardIds(v);
      const card = v.hand.find((c) => c.id === legal[0]);
      const action = legal.length
        ? { type: 'play', cardIds: [legal[0]], ...(card!.rank === 'A' ? { suit: 'H' } : {}), declareJakk: true }
        : { type: v.penalty ? 'takePenalty' : 'draw' };
      actor.clear();
      other.clear();
      actor.send({ type: 'action', version: v.version, action });
      const [ra, rb] = await Promise.all([actor.type('state'), other.type('state')]);
      expect(ra.view.version).toBe(v.version + 1);
      expect(rb.view.version).toBe(v.version + 1);
      expect(ra.events.length).toBeGreaterThan(0);
      // opponent never sees our drawn cards
      for (const e of rb.events) if (e.type === 'drew' && e.playerId === actor.playerId) expect('cards' in e).toBe(false);
      await new Promise((r) => setTimeout(r, 0));
    }

    // stale version: rejected, view re-sent, nothing applied
    const cur = A.view!;
    const stale = byId[cur.turn];
    stale.clear();
    stale.send({ type: 'action', version: cur.version - 1, action: { type: 'draw' } });
    await stale.error('STALE_VERSION');
    const resync = await stale.type('state');
    expect(resync.resync).toBe(true);
    expect(resync.view.version).toBe(cur.version);

    // wrong turn: typed error + view re-sent
    const waiter = turnOther(cur, A, B);
    waiter.clear();
    waiter.send({ type: 'action', version: cur.version, action: { type: 'draw' } });
    await waiter.error('NOT_YOUR_TURN');
    expect((await waiter.type('state')).resync).toBe(true);

    // duplicate resubmit of an applied action must not double-apply
    const v0 = byId[A.view!.turn].view!;
    const actor = byId[v0.turn];
    const act = { type: 'action', version: v0.version, action: v0.penalty ? { type: 'takePenalty' } : { type: 'draw' } };
    actor.clear();
    actor.send(act);
    const applied = await actor.type('state');
    expect(applied.view.version).toBe(v0.version + 1);
    actor.send(act); // identical resubmit
    await actor.error('STALE_VERSION');
    await new Promise((r) => setTimeout(r, 30));
    expect(actor.view!.version).toBe(v0.version + 1);

    // disconnect B -> A is told; B reconnects with same token and resumes the seat
    const handBefore = B.view!.hand.map((c) => c.id).sort();
    const versionBefore = B.view!.version;
    A.clear();
    B.close();
    const dc = await A.next<Extract<Msg, { type: 'roomState' }>>((m) => m.type === 'roomState' && m.room.players.some((p) => !p.connected));
    expect(dc.room.players.find((p) => p.playerId === B.playerId)!.connected).toBe(false);

    // (the room carries on; B's seat may be played by the bot after the away timeout)
    const B2 = await Client.connect(port);
    open.push(B2);
    const w = await B2.hello(tok('B'), 'Bob');
    expect(w).toMatchObject({ resumed: true, roomCode: code, playerId: B.playerId });
    const rs = await B2.type('roomState');
    expect(rs.room.phase).toBe('playing');
    const st = await B2.type('state');
    expect(st.resync).toBe(true);
    expect(st.events).toEqual([]);
    expect(st.view.version).toBeGreaterThanOrEqual(versionBefore);
    if (st.view.version === versionBefore) expect(st.view.hand.map((c) => c.id).sort()).toEqual(handBefore);
    await A.next((m) => m.type === 'roomState' && m.room.players.every((p) => p.connected));

    // a newcomer joins mid-hand as a waiting spectator: public info only, no hand, cannot act
    const C = await client(tok('C'), 'Cara');
    C.send({ type: 'joinRoom', code });
    const crs = await C.next<Extract<Msg, { type: 'roomState' }>>((m) => m.type === 'roomState');
    expect(crs.room.players.find((p) => p.playerId === C.playerId)).toMatchObject({ waiting: true });
    const cst = await C.type('state');
    expect(cst.view).toMatchObject({ spectator: true, hand: [] });
    expect(JSON.stringify(cst)).not.toContain(A.view!.hand[0].id + '","rank"');
    C.clear();
    C.send({ type: 'action', version: cst.view.version, action: { type: 'draw' } });
    await C.error('NOT_YOUR_TURN');
    // history is available to every seat (waiting ones too) and never carries hidden cards
    C.clear();
    C.send({ type: 'requestHistory' });
    const hist = await C.type('history');
    expect(hist.entries[0]).toMatchObject({ kind: 'deal', playerId: null });
    for (const e of hist.entries.flatMap((x) => x.events)) if (e.type === 'drew') expect('cards' in e).toBe(false);
    // unknown room; returning seat holder may rejoin via joinRoom
    const D = await client(tok('D'), 'Dan');
    D.send({ type: 'joinRoom', code: 'ZZZZZ' });
    await D.error('ROOM_NOT_FOUND');
    D.send({ type: 'joinRoom', code: 'bad' });
    await D.error('ROOM_NOT_FOUND');
    B2.clear();
    B2.send({ type: 'joinRoom', code });
    await B2.type('state');
  });

  it('a disconnected player\'s turn is played by the bot logic after the away timeout', async () => {
    const { clients } = await lobby(['Ann', 'Ben']);
    const [A, B] = clients;
    B.send({ type: 'setReady', ready: true });
    await A.next((m) => m.type === 'roomState' && m.room.canStart);
    A.send({ type: 'startGame' });
    await A.type('state');
    await B.type('state');
    B.close();
    await A.next((m) => m.type === 'roomState' && m.room.players.some((p) => !p.connected));
    // keep A moving; B's turns must be taken by the server within a few away-timeouts
    const deadline = Date.now() + 4000;
    let sawBPlay = false;
    A.clear();
    A.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as Msg;
      if (m.type === 'state') {
        if (m.events.some((e) => 'playerId' in e && e.playerId === B.playerId && (e.type === 'played' || e.type === 'drew'))) sawBPlay = true;
        const v = m.view;
        if (!v.handOver && v.turn === v.you) {
          const mv = chooseBotAction(v, { declareJakk: true });
          if (mv) A.send({ type: 'action', version: v.version, action: mv });
        }
      }
    });
    if (A.view!.turn === A.playerId) {
      const mv = chooseBotAction(A.view!, { declareJakk: true })!;
      A.send({ type: 'action', version: A.view!.version, action: mv });
    }
    while (!sawBPlay && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    expect(sawBPlay).toBe(true);
  });

  it('ai mode starts immediately, bots play, game ends, rematch restarts immediately', async () => {
    const A = await client(tok('Solo'), 'Solo');
    A.send({ type: 'createRoom', mode: 'ai', botCount: 2 });
    const rs = await A.type('roomState');
    expect(rs.room).toMatchObject({ mode: 'ai', phase: 'playing' });
    expect(rs.room.players).toHaveLength(3);
    expect(rs.room.players.filter((p) => p.isBot)).toHaveLength(2);
    await A.type('state');
    const final = await A.autoplay();
    expect(final.handOver).not.toBeNull();
    await A.next((m) => m.type === 'roomState' && (m.room.phase === 'finished' || m.room.phase === 'handOver'));
    A.clear();
    (A as any).auto = false;
    A.send(final.winner ? { type: 'rematch' } : { type: 'nextHand' });
    const again = await A.type('state');
    expect(again.view.handOver).toBeNull();
    expect(again.view.version).toBe(0);
    // another player cannot join an AI room
    const X = await client(tok('X'), 'X');
    X.send({ type: 'joinRoom', code: rs.room.code });
    await X.error('GAME_IN_PROGRESS');
  });

  it('friends lobby: bots, host promotion, full room, leave semantics, rematch lobby', async () => {
    const { clients, code } = await lobby(['H1', 'P2']);
    const [H, P] = clients;
    // add/remove bots (host only)
    P.send({ type: 'addBot' });
    await P.error('NOT_HOST');
    H.send({ type: 'addBot' });
    const withBot = await H.next<Extract<Msg, { type: 'roomState' }>>((m) => m.type === 'roomState' && m.room.players.length === 3);
    const bot = withBot.room.players.find((p) => p.isBot)!;
    expect(bot).toMatchObject({ ready: true, connected: true });
    H.send({ type: 'removeBot', playerId: bot.playerId });
    await H.next((m) => m.type === 'roomState' && m.room.players.length === 2);
    for (let i = 0; i < 4; i++) H.send({ type: 'addBot' });
    await H.next((m) => m.type === 'roomState' && m.room.players.length === 6);
    H.send({ type: 'addBot' });
    await H.error('ROOM_FULL');
    const late = await client(tok('late' + Math.random().toString(36).slice(2)), 'Late');
    late.send({ type: 'joinRoom', code });
    await late.error('ROOM_FULL');
    // remove the two bots again; host leaves -> P promoted
    const snap = H.room!;
    for (const b of snap.players.filter((p) => p.isBot)) H.send({ type: 'removeBot', playerId: b.playerId });
    await H.next((m) => m.type === 'roomState' && m.room.players.length === 2);
    H.send({ type: 'leave' });
    await H.type('left');
    const promoted = await P.next<Extract<Msg, { type: 'roomState' }>>((m) => m.type === 'roomState' && m.room.players.length === 1);
    expect(promoted.room.hostId).toBe(P.playerId);
    // alone in the room: add a bot, start, play out, then rematch lobby keeps seats
    P.send({ type: 'addBot' });
    await P.next((m) => m.type === 'roomState' && m.room.players.length === 2 && m.room.canStart);
    P.send({ type: 'startGame' });
    await P.type('state');
    const final = await P.autoplay();
    expect(final.handOver).not.toBeNull();
    await P.next((m) => m.type === 'roomState' && (m.room.phase === 'finished' || m.room.phase === 'handOver'));
    (P as any).auto = false;
    P.send(final.winner ? { type: 'rematch' } : { type: 'nextHand' });
    const rl = await P.next<Extract<Msg, { type: 'roomState' }>>((m) => m.type === 'roomState' && (m.room.phase === 'rematch' || m.room.phase === 'playing'));
    expect(rl.room.code).toBe(code);
    expect(rl.room.players).toHaveLength(2);
    if (rl.room.phase === 'rematch') P.send({ type: 'startGame' });
    const again = await P.type('state');
    expect(again.view.version).toBe(0);
    // leaving mid-game empties the room (only human) -> it is gone
    P.send({ type: 'leave' });
    await P.type('left');
    const Z = await client(tok('Z' + Math.random().toString(36).slice(2)), 'Z');
    Z.send({ type: 'joinRoom', code });
    await Z.error('ROOM_NOT_FOUND');
  });

  it('leaving mid-game hands the seat to a bot; the other player carries on', async () => {
    const { clients } = await lobby(['L1', 'L2']);
    const [H, P] = clients;
    P.send({ type: 'setReady', ready: true });
    await H.next((m) => m.type === 'roomState' && m.room.canStart);
    H.send({ type: 'startGame' });
    await H.type('state');
    P.clear();
    P.send({ type: 'leave' });
    await P.type('left');
    const rs = await H.next<Extract<Msg, { type: 'roomState' }>>((m) => m.type === 'roomState' && m.room.players.some((p) => p.isBot));
    expect(rs.room.players.find((p) => p.playerId === P.playerId)).toMatchObject({ isBot: true });
    const final = await H.autoplay();
    expect(final.handOver).not.toBeNull();
  });

  it('empty rooms are deleted after the TTL', async () => {
    const A = await client(tok('Ephemeral'), 'Eph');
    A.send({ type: 'createRoom', mode: 'friends' });
    const code = (await A.type('roomState')).room.code;
    A.close();
    await new Promise((r) => setTimeout(r, 450));
    const B = await client(tok('Finder'), 'Finder');
    B.send({ type: 'joinRoom', code });
    await B.error('ROOM_NOT_FOUND');
    expect(server.hub.rooms.has(code)).toBe(false);
  });

  it('input validation, authentication and one-seat-per-room rules', async () => {
    const raw = await client();
    raw.send({ type: 'createRoom', mode: 'ai' });
    await raw.error('NOT_AUTHENTICATED');
    raw.ws.send('{not json');
    await raw.error('BAD_MESSAGE');
    raw.send({ type: 'nope' });
    await raw.error('BAD_MESSAGE');
    raw.send({ type: 'hello', sessionToken: 'short', name: 'x', avatar: AVATAR });
    await raw.error('INVALID_TOKEN');
    raw.send({ type: 'hello', sessionToken: tok('V'), name: '\u0007​  ', avatar: AVATAR });
    await raw.error('INVALID_NAME');
    raw.send({ type: 'hello', sessionToken: tok('V'), name: 'ok', avatar: { color: 'red' } });
    await raw.error('INVALID_AVATAR');
    raw.send({ type: 'hello', sessionToken: tok('V'), name: '  Zed\u0001  Z  ', avatar: AVATAR });
    await raw.type('welcome');
    raw.send({ type: 'createRoom', mode: 'ai', botCount: 9 });
    await raw.error('BAD_MESSAGE');
    raw.send({ type: 'action', version: 0, action: { type: 'play', cardIds: ['ZZ'] } });
    await raw.error('BAD_MESSAGE');
    raw.send({ type: 'action', version: 0, action: { type: 'draw' } });
    await raw.error('NOT_IN_ROOM');
    raw.send({ type: 'createRoom', mode: 'friends' });
    const rs = await raw.type('roomState');
    expect(rs.room.players[0].name).toBe('Zed Z');
    raw.send({ type: 'createRoom', mode: 'friends' });
    await raw.error('ALREADY_IN_ROOM');
    raw.send({ type: 'action', version: 0, action: { type: 'draw' } });
    await raw.error('WRONG_PHASE');
    raw.send({ type: 'ping', t: 5 });
    expect(await raw.type('pong')).toMatchObject({ t: 5 });
    // a second connection with the same token replaces the first
    const again = await client(tok('V'), 'Zed');
    expect(again.playerId).toBe(raw.playerId);
    await new Promise((r) => setTimeout(r, 50));
    expect(raw.closeCode).toBe(4000);
  });

  it('serves /healthz', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});

function turnOther(v: PlayerView, A: Client, B: Client) {
  return v.turn === A.playerId ? B : A;
}

describe('hardening', () => {
  it('a throttled player recovers via requestState instead of stalling the game', async () => {
    // Regression: the server drops (never queues) messages over the per-socket limit. If the human's first move is
    // dropped, nothing else will ever happen - the human is connected so no timer plays for them - and the old
    // autoplay helper waited forever. Bots are slowed down here so that only the initial drain causes drops.
    const s = createGameServer({
      timing: { ...FAST, botMinMs: 40, botMaxMs: 50 },
      botJakkRate: 1,
      rateLimit: { burst: 10, perSecond: 30 },
    });
    const p = await s.listen(0, '127.0.0.1');
    try {
      const c = await Client.connect(p);
      await c.hello(tok('Throttled'), 'Throttled');
      c.send({ type: 'createRoom', mode: 'ai', botCount: 1 });
      await c.type('state');
      for (let i = 0; i < 14; i++) c.send({ type: 'ping', t: i }); // drain the bucket
      await c.error('RATE_LIMITED');
      const final = await c.autoplay(25_000);
      expect(final.handOver).not.toBeNull();
    } finally {
      await s.close();
    }
  }, 30_000);

  it('rate limits per socket and drops oversized frames', async () => {
    const s = createGameServer({ timing: FAST, rateLimit: { burst: 8, perSecond: 1 } });
    const p = await s.listen(0, '127.0.0.1');
    try {
      const c = await Client.connect(p);
      for (let i = 0; i < 30; i++) c.send({ type: 'ping' });
      await c.error('RATE_LIMITED');
      const big = await Client.connect(p);
      big.ws.send('x'.repeat(5000));
      await new Promise((r) => setTimeout(r, 100));
      expect(big.closeCode).toBe(1009);
    } finally {
      await s.close();
    }
  });

  it('caps the number of rooms', async () => {
    const s = createGameServer({ timing: FAST, maxRooms: 1 });
    const p = await s.listen(0, '127.0.0.1');
    try {
      const a = await Client.connect(p);
      await a.hello(tok('cap1'));
      a.send({ type: 'createRoom', mode: 'friends' });
      await a.type('roomState');
      const b = await Client.connect(p);
      await b.hello(tok('cap2'));
      b.send({ type: 'createRoom', mode: 'friends' });
      await b.error('SERVER_BUSY');
    } finally {
      await s.close();
    }
  });
});
