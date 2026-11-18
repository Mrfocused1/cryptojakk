import { createHash, randomInt } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { RawData, WebSocket } from 'ws';
import {
  type Avatar,
  type ClientMessage,
  type ErrorCode,
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type ServerMessage,
} from '../shared/protocol';
import { DEFAULT_MAX_ROOMS, DEFAULT_RATE_LIMIT, DEFAULT_TIMING, type ServerOptions, type Timing } from './config';
import { type Profile, Room, type RoomDeps, type RoomError } from './room';
import { secureRng } from './rng';
import { parseClientMessage } from './validate';

interface Conn {
  ws: WebSocket;
  playerId: string | null;
  profile: { name: string; avatar: Avatar } | null;
  alive: boolean;
  tokens: number;
  lastRefill: number;
  violations: number;
}

/** Public player id derived from the secret session token. The token itself is never stored or broadcast. */
export function derivePlayerId(sessionToken: string): string {
  return 'p_' + createHash('sha256').update('crypto-jakk:v1:' + sessionToken).digest('base64url').slice(0, 12);
}

export class Hub {
  readonly rooms = new Map<string, Room>();
  private readonly playerRoom = new Map<string, string>();
  private readonly conns = new Map<string, Conn>();
  private readonly all = new Set<Conn>();
  private readonly timing: Timing;
  private readonly maxRooms: number;
  private readonly rate: { burst: number; perSecond: number };
  private readonly deps: RoomDeps;
  private sweeper: NodeJS.Timeout;
  private heartbeat: NodeJS.Timeout;
  private readonly log: (m: string) => void;

  constructor(opts: ServerOptions = {}) {
    this.timing = { ...DEFAULT_TIMING, ...opts.timing };
    this.maxRooms = opts.maxRooms ?? DEFAULT_MAX_ROOMS;
    this.rate = opts.rateLimit ?? DEFAULT_RATE_LIMIT;
    this.log = opts.log ?? (() => {});
    this.deps = {
      rng: secureRng,
      timing: this.timing,
      botJakkRate: opts.botJakkRate ?? 0.9,
      send: (pid, msg) => this.send(pid, msg),
      now: () => Date.now(),
      onDestroy: (room) => this.onRoomDestroyed(room),
      log: this.log,
    };
    this.sweeper = setInterval(() => this.sweep(), this.timing.sweepIntervalMs);
    this.heartbeat = setInterval(() => this.beat(), this.timing.heartbeatIntervalMs);
    this.sweeper.unref();
    this.heartbeat.unref();
  }

  stats() {
    return { rooms: this.rooms.size, connections: this.all.size };
  }

  // ------------------------------------------------------------------ housekeeping

  private onRoomDestroyed(room: Room): void {
    this.rooms.delete(room.code);
    for (const s of room.seats) if (this.playerRoom.get(s.playerId) === room.code) this.playerRoom.delete(s.playerId);
  }

  sweep(): void {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      const reason = room.expiryReason(now);
      if (reason) {
        this.log(`room ${room.code} expired (${reason})`);
        room.destroy(reason);
      }
    }
  }

  private beat(): void {
    for (const c of this.all) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      try {
        c.ws.ping();
      } catch {
        /* socket already closing */
      }
    }
  }

  close(): void {
    clearInterval(this.sweeper);
    clearInterval(this.heartbeat);
    for (const room of [...this.rooms.values()]) room.destroy('empty');
    for (const c of this.all) c.ws.terminate();
  }

  // ------------------------------------------------------------------ transport

  private send(playerId: string, msg: ServerMessage): void {
    const c = this.conns.get(playerId);
    if (c) this.write(c, msg);
  }

  private write(c: Conn, msg: ServerMessage): void {
    if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
  }

  private error(c: Conn, code: ErrorCode, message: string, reqId?: string): void {
    const msg: ServerMessage = { type: 'error', code, message };
    if (reqId !== undefined) msg.reqId = reqId;
    this.write(c, msg);
  }

  handleConnection(ws: WebSocket, _req?: IncomingMessage): void {
    const conn: Conn = {
      ws,
      playerId: null,
      profile: null,
      alive: true,
      tokens: this.rate.burst,
      lastRefill: Date.now(),
      violations: 0,
    };
    this.all.add(conn);
    ws.on('pong', () => (conn.alive = true));
    ws.on('message', (data, isBinary) => {
      conn.alive = true;
      try {
        this.onMessage(conn, data, isBinary);
      } catch (e) {
        this.log(`handler error: ${(e as Error).stack ?? e}`);
        this.error(conn, 'BAD_MESSAGE', 'Internal error');
      }
    });
    ws.on('close', () => this.onClose(conn));
    ws.on('error', () => ws.terminate());
  }

  private onClose(conn: Conn): void {
    this.all.delete(conn);
    const pid = conn.playerId;
    if (!pid || this.conns.get(pid) !== conn) return; // replaced by a newer connection
    this.conns.delete(pid);
    const code = this.playerRoom.get(pid);
    this.rooms.get(code ?? '')?.setConnected(pid, false);
  }

  private onMessage(conn: Conn, data: RawData, isBinary: boolean): void {
    // Per-socket token bucket.
    const now = Date.now();
    conn.tokens = Math.min(this.rate.burst, conn.tokens + ((now - conn.lastRefill) / 1000) * this.rate.perSecond);
    conn.lastRefill = now;
    if (conn.tokens < 1) {
      this.error(conn, 'RATE_LIMITED', 'Slow down');
      if (++conn.violations > 50) conn.ws.close(1008, 'rate limit');
      return;
    }
    conn.tokens -= 1;

    if (isBinary) return this.error(conn, 'BAD_MESSAGE', 'Text frames only');
    let json: unknown;
    try {
      json = JSON.parse(data.toString());
    } catch {
      return this.error(conn, 'BAD_MESSAGE', 'Invalid JSON');
    }
    const parsed = parseClientMessage(json);
    if (!parsed.ok) return this.error(conn, parsed.code, parsed.message, parsed.reqId);
    const msg = parsed.msg;

    if (msg.type === 'ping') return this.write(conn, { type: 'pong', t: msg.t, serverTime: now });
    if (msg.type === 'hello') return this.onHello(conn, msg);
    if (!conn.playerId) return this.error(conn, 'NOT_AUTHENTICATED', 'Send hello first', msg.reqId);
    this.dispatch(conn, conn.playerId, msg);
  }

  // ------------------------------------------------------------------ handlers

  private onHello(conn: Conn, msg: Extract<ClientMessage, { type: 'hello' }>): void {
    if (msg.protocol !== undefined && msg.protocol !== PROTOCOL_VERSION) {
      return this.error(conn, 'UNSUPPORTED_PROTOCOL', `Server speaks protocol ${PROTOCOL_VERSION}`, msg.reqId);
    }
    const pid = derivePlayerId(msg.sessionToken);
    if (conn.playerId && conn.playerId !== pid) {
      return this.error(conn, 'BAD_MESSAGE', 'This connection is already bound to another session', msg.reqId);
    }
    const prev = this.conns.get(pid);
    conn.playerId = pid;
    conn.profile = { name: msg.name, avatar: msg.avatar };
    this.conns.set(pid, conn);
    if (prev && prev !== conn) prev.ws.close(4000, 'replaced by a newer connection');

    const code = this.playerRoom.get(pid);
    const room = code ? this.rooms.get(code) : undefined;
    const seated = !!room && room.hasSeat(pid);
    if (!seated) this.playerRoom.delete(pid);
    this.write(conn, { type: 'welcome', protocol: PROTOCOL_VERSION, playerId: pid, resumed: seated, roomCode: seated ? code! : null });
    if (room && seated) {
      room.updateProfile({ playerId: pid, ...conn.profile });
      room.setConnected(pid, true);
      room.sendFull(pid);
    }
  }

  private roomOf(pid: string): Room | undefined {
    const code = this.playerRoom.get(pid);
    return code ? this.rooms.get(code) : undefined;
  }

  private genCode(): string | null {
    for (let tries = 0; tries < 50; tries++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    return null;
  }

  private dispatch(conn: Conn, pid: string, msg: ClientMessage): void {
    const fail = (e: RoomError | null) => {
      if (!e) return;
      this.error(conn, e.code, e.message, msg.reqId);
      if (e.resync) this.roomOf(pid)?.sendView(pid);
    };
    const profile = (): Profile => ({ playerId: pid, ...conn.profile! });

    switch (msg.type) {
      case 'createRoom': {
        if (this.roomOf(pid)) return this.error(conn, 'ALREADY_IN_ROOM', 'Leave your current room first', msg.reqId);
        if (this.rooms.size >= this.maxRooms) return this.error(conn, 'SERVER_BUSY', 'Server is busy - try again soon', msg.reqId);
        const code = this.genCode();
        if (!code) return this.error(conn, 'SERVER_BUSY', 'Server is busy - try again soon', msg.reqId);
        const room = new Room(code, msg.mode, profile(), this.deps);
        this.rooms.set(code, room);
        this.playerRoom.set(pid, code);
        if (msg.mode === 'ai') room.startAi(msg.botCount ?? 1, { houseRules: msg.houseRules, options: msg.options });
        else if (msg.houseRules || msg.options) {
          room.setOptions(pid, { houseRules: msg.houseRules, options: msg.options });
          room.broadcastRoom();
        }
        else room.broadcastRoom();
        return;
      }
      case 'joinRoom': {
        const current = this.roomOf(pid);
        if (current && current.code !== msg.code) return this.error(conn, 'ALREADY_IN_ROOM', 'Leave your current room first', msg.reqId);
        const room = this.rooms.get(msg.code);
        if (!room) return this.error(conn, 'ROOM_NOT_FOUND', 'Room not found or expired', msg.reqId);
        if (room.hasSeat(pid)) {
          this.playerRoom.set(pid, room.code);
          room.updateProfile(profile());
          room.setConnected(pid, true);
          return room.sendFull(pid);
        }
        const err = room.join(profile());
        if (err) return fail(err);
        this.playerRoom.set(pid, room.code);
        room.sendFull(pid);
        return;
      }
      case 'leave': {
        const room = this.roomOf(pid);
        this.playerRoom.delete(pid);
        room?.leave(pid);
        this.write(conn, { type: 'left' });
        return;
      }
      case 'requestState': {
        const room = this.roomOf(pid);
        if (!room) return this.error(conn, 'NOT_IN_ROOM', 'You are not in a room', msg.reqId);
        return room.sendFull(pid);
      }
      default: {
        const room = this.roomOf(pid);
        if (!room) return this.error(conn, 'NOT_IN_ROOM', 'You are not in a room', msg.reqId);
        switch (msg.type) {
          case 'setReady':
            return fail(room.setReady(pid, msg.ready));
          case 'addBot':
            return fail(room.addBot(pid));
          case 'removeBot':
            return fail(room.removeBot(pid, msg.playerId));
          case 'startGame':
            return fail(room.start(pid));
          case 'setOptions':
            return fail(room.setOptions(pid, { houseRules: msg.houseRules, options: msg.options }));
          case 'nextHand':
            return fail(room.nextHand(pid));
          case 'requestHistory':
            return fail(room.sendHistory(pid));
          case 'rematch':
            return fail(room.rematch(pid));
          case 'action':
            return fail(room.action(pid, msg.version, msg.action));
        }
      }
    }
  }
}
