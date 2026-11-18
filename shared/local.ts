// In-browser stand-in for the WebSocket server, for solo (bot) games.
// It speaks the same client/server messages as server/hub.ts and drives the very same Room (rules engine, bot AI, timings),
// so the UI cannot tell the difference. No DOM or Node imports: unit-testable under Node.
import {
  type Avatar,
  type ClientMessage,
  MAX_BOTS_AI_MODE,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type ServerMessage,
} from './protocol';
import { type Profile, Room, type RoomDeps, type RoomError, type RoomSave } from './room';
import { cryptoInt, cryptoRng } from './rng';
import { DEFAULT_TIMING, type Timing } from './timing';

export const LOCAL_PLAYER_ID = 'p_local';

export interface LocalGameOptions {
  profile: { name: string; avatar: Avatar };
  /** Receives every message the server would have sent. Called synchronously. */
  onMessage(msg: ServerMessage): void;
  /** Called (coalesced, after the current call stack) with the room to keep, or null when there is nothing to keep. */
  onPersist?(save: RoomSave | null): void;
  rng?: () => number;
  timing?: Partial<Timing>;
  botJakkRate?: number;
  now?: () => number;
}

export class LocalGame {
  private room: Room | null = null;
  private readonly deps: RoomDeps;
  private persistQueued = false;
  private closed = false;

  constructor(private readonly opts: LocalGameOptions) {
    this.deps = {
      rng: opts.rng ?? cryptoRng,
      timing: { ...DEFAULT_TIMING, ...opts.timing },
      botJakkRate: opts.botJakkRate ?? 0.9,
      send: (_pid, msg) => {
        if (this.closed) return;
        opts.onMessage(msg);
        if (msg.type === 'state' || msg.type === 'roomState') this.queuePersist();
      },
      now: opts.now ?? (() => Date.now()),
      onDestroy: (room) => {
        if (this.room === room) this.room = null;
      },
      log: () => {},
    };
  }

  get playerId(): string {
    return LOCAL_PLAYER_ID;
  }

  get active(): boolean {
    return this.room !== null;
  }

  /** Re-attach to a saved game: sends the room and a resync view like a server resume would. */
  restore(save: RoomSave): void {
    const room = Room.restore(save, this.deps);
    this.room = room;
    room.sendFull(LOCAL_PLAYER_ID);
    room.resume();
  }

  close(): void {
    this.closed = true;
    const r = this.room;
    this.room = null;
    // Room.destroy would message the (now gone) client; just stop its timer.
    r?.destroy('empty');
  }

  private genCode(): string {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[cryptoInt(0, ROOM_CODE_ALPHABET.length - 1)];
    return code;
  }

  private queuePersist(): void {
    if (this.persistQueued || !this.opts.onPersist) return;
    this.persistQueued = true;
    queueMicrotask(() => {
      this.persistQueued = false;
      if (this.closed) return;
      this.opts.onPersist?.(this.room ? this.room.save() : null);
    });
  }

  private error(msg: ClientMessage, code: Extract<ServerMessage, { type: 'error' }>['code'], message: string): void {
    const out: ServerMessage = { type: 'error', code, message };
    if (msg.reqId !== undefined) out.reqId = msg.reqId;
    this.opts.onMessage(out);
  }

  /** Handle one client message, mirroring server/hub.ts for the messages a solo game can use. */
  handle(msg: ClientMessage): void {
    if (this.closed) return;
    const pid = LOCAL_PLAYER_ID;
    const profile = (): Profile => ({ playerId: pid, ...this.opts.profile });
    const fail = (e: RoomError | null) => {
      if (!e) return;
      this.error(msg, e.code, e.message);
      if (e.resync) this.room?.sendView(pid);
    };
    switch (msg.type) {
      case 'ping':
        this.opts.onMessage({ type: 'pong', t: msg.t, serverTime: Date.now() });
        return;
      case 'hello':
        return;
      case 'createRoom': {
        if (this.room) return this.error(msg, 'ALREADY_IN_ROOM', 'Leave your current room first');
        if (msg.mode !== 'ai') return this.error(msg, 'BAD_MESSAGE', 'Only solo games run on this device');
        const n = Math.max(1, Math.min(MAX_BOTS_AI_MODE, Math.floor(msg.botCount ?? 1)));
        const room = new Room(this.genCode(), 'ai', profile(), this.deps);
        this.room = room;
        room.startAi(n);
        return;
      }
      case 'leave': {
        const room = this.room;
        this.room = null;
        room?.leave(pid);
        this.opts.onMessage({ type: 'left' });
        this.opts.onPersist?.(null);
        return;
      }
      case 'joinRoom':
        return this.error(msg, 'ROOM_NOT_FOUND', 'Room not found or expired');
      case 'requestState':
        if (!this.room) return this.error(msg, 'NOT_IN_ROOM', 'You are not in a room');
        return this.room.sendFull(pid);
      default: {
        const room = this.room;
        if (!room) return this.error(msg, 'NOT_IN_ROOM', 'You are not in a room');
        switch (msg.type) {
          case 'setReady':
            return fail(room.setReady(pid, msg.ready));
          case 'addBot':
            return fail(room.addBot(pid));
          case 'removeBot':
            return fail(room.removeBot(pid, msg.playerId));
          case 'startGame':
            return fail(room.start(pid));
          case 'rematch':
            return fail(room.rematch(pid));
          case 'action':
            return fail(room.action(pid, msg.version, msg.action));
        }
      }
    }
  }
}

