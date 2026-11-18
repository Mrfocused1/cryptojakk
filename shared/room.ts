import { chooseBotAction } from './ai';
import {
  type Action,
  type GameEvent,
  type GameState,
  type PlayerAction,
  type PlayerId,
  type RulesConfig,
  type Rng,
  DEFAULT_RULES,
  applyAction,
  createGame,
  redactEvents,
  toPlayerView,
} from './engine';
import type {
  Avatar,
  ErrorCode,
  LobbyPlayer,
  RoomMode,
  RoomPhase,
  RoomSnapshot,
  ServerMessage,
} from './protocol';
import { cryptoInt as secureInt } from './rng';
import type { Timing } from './timing';

export interface RoomError {
  code: ErrorCode;
  message: string;
  /** Hub should re-send the current view after the error (stale / wrong-turn rejections). */
  resync?: boolean;
}

export interface RoomDeps {
  rng: Rng;
  timing: Timing;
  botJakkRate: number;
  send(playerId: PlayerId, msg: ServerMessage): void;
  now(): number;
  /** Called exactly once when the room is gone (hub removes it from its maps). */
  onDestroy(room: Room, reason: 'expired' | 'idle' | 'empty'): void;
  log(msg: string): void;
}

export interface Profile {
  playerId: PlayerId;
  name: string;
  avatar: Avatar;
}

export interface RoomSave {
  code: string;
  mode: RoomMode;
  phase: RoomPhase;
  hostId: PlayerId;
  seats: Array<{ playerId: PlayerId; name: string; avatar: Avatar; isBot: boolean; ready: boolean }>;
  state: GameState | null;
}

/**
 * Saves made under the old rules (8 reverses, 7 skips: `eightReverses` / `sevenSkips` instead of
 * `skipRank` / `reverseRank` / `queenAcceptsAny`) are carried on with the current default rules, so a game in progress
 * never silently plays without its skip/reverse cards (or with the retired ones).
 */
function migrateSavedState(state: GameState): GameState {
  const r = state.rules as Partial<RulesConfig> | undefined;
  if (r && 'skipRank' in r && 'reverseRank' in r && 'queenAcceptsAny' in r) return state;
  return { ...state, rules: { ...DEFAULT_RULES, powerRanks: [...DEFAULT_RULES.powerRanks] } };
}

interface Seat extends Profile {
  isBot: boolean;
  ready: boolean;
  connected: boolean;
}

const BOT_NAMES = ['Ada', 'Grace', 'Linus', 'Hedy', 'Alan', 'Margaret', 'Dennis', 'Radia'];
const BOT_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
const MAX_SEATS = DEFAULT_RULES.maxPlayers;

export class Room {
  phase: RoomPhase = 'lobby';
  hostId: PlayerId;
  readonly seats: Seat[] = [];
  state: GameState | null = null;
  lastActivity: number;
  emptySince: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(
    readonly code: string,
    readonly mode: RoomMode,
    host: Profile,
    private readonly deps: RoomDeps,
  ) {
    this.hostId = host.playerId;
    this.seats.push({ ...host, isBot: false, ready: false, connected: true });
    this.lastActivity = deps.now();
  }

  // ------------------------------------------------------------------ queries

  hasSeat(playerId: PlayerId): boolean {
    return this.seats.some((s) => s.playerId === playerId && !s.isBot);
  }
  private seat(playerId: PlayerId): Seat | undefined {
    return this.seats.find((s) => s.playerId === playerId);
  }
  private humans(): Seat[] {
    return this.seats.filter((s) => !s.isBot);
  }

  private canStart(): boolean {
    return (
      this.seats.length >= 2 &&
      this.seats.every((s) => s.isBot || s.playerId === this.hostId || s.ready)
    );
  }

  snapshot(): RoomSnapshot {
    const players: LobbyPlayer[] = this.seats.map((s) => ({
      playerId: s.playerId,
      name: s.name,
      avatar: s.avatar,
      isHost: s.playerId === this.hostId,
      isBot: s.isBot,
      ready: s.isBot || s.ready,
      connected: s.isBot || s.connected,
    }));
    return {
      code: this.code,
      mode: this.mode,
      phase: this.phase,
      hostId: this.hostId,
      players,
      minPlayers: DEFAULT_RULES.minPlayers,
      maxPlayers: DEFAULT_RULES.maxPlayers,
      canStart: (this.phase === 'lobby' || this.phase === 'rematch') && this.canStart(),
      rules: DEFAULT_RULES,
    };
  }

  /** Plain-JSON copy of everything needed to rebuild this room later (the browser keeps one for solo games). */
  save(): RoomSave {
    return {
      code: this.code,
      mode: this.mode,
      phase: this.phase,
      hostId: this.hostId,
      seats: this.seats.map((s) => ({ playerId: s.playerId, name: s.name, avatar: s.avatar, isBot: s.isBot, ready: s.ready })),
      state: this.state,
    };
  }

  /** Rebuild a room from `save()`. Call `resume()` afterwards to restart the bot timer. */
  static restore(data: RoomSave, deps: RoomDeps): Room {
    const first = data.seats[0];
    const room = new Room(data.code, data.mode, { playerId: first.playerId, name: first.name, avatar: first.avatar }, deps);
    room.seats.length = 0;
    for (const s of data.seats) room.seats.push({ ...s, connected: true });
    room.hostId = data.hostId;
    room.phase = data.phase;
    room.state = data.state ? migrateSavedState(data.state) : null;
    return room;
  }

  /** (Re)start whatever timer the current game state needs. */
  resume(): void {
    this.schedule();
  }

  expiryReason(now: number): 'empty' | 'idle' | null {
    if (this.emptySince !== null && now - this.emptySince >= this.deps.timing.emptyRoomTtlMs) return 'empty';
    if (now - this.lastActivity >= this.deps.timing.idleRoomTtlMs) return 'idle';
    return null;
  }

  // ------------------------------------------------------------------ sending

  private sendTo(s: Seat, msg: ServerMessage): void {
    if (!s.isBot && s.connected) this.deps.send(s.playerId, msg);
  }

  broadcastRoom(): void {
    const msg: ServerMessage = { type: 'roomState', room: this.snapshot() };
    for (const s of this.seats) this.sendTo(s, msg);
  }

  private broadcastState(events: GameEvent[]): void {
    if (!this.state) return;
    for (const s of this.seats) {
      if (s.isBot) continue;
      this.sendTo(s, {
        type: 'state',
        view: toPlayerView(this.state, s.playerId),
        events: redactEvents(events, s.playerId),
        resync: false,
      });
    }
  }

  /** Re-send the room and (if a game is on) this player's current view. */
  sendFull(playerId: PlayerId): void {
    const s = this.seat(playerId);
    if (!s) return;
    this.sendTo(s, { type: 'roomState', room: this.snapshot() });
    this.sendView(playerId);
  }

  sendView(playerId: PlayerId): void {
    const s = this.seat(playerId);
    if (!s || !this.state || (this.phase !== 'playing' && this.phase !== 'finished')) return;
    this.sendTo(s, { type: 'state', view: toPlayerView(this.state, playerId), events: [], resync: true });
  }

  // ------------------------------------------------------------------ membership

  private touch(): void {
    this.lastActivity = this.deps.now();
  }

  join(p: Profile): RoomError | null {
    if (this.hasSeat(p.playerId)) return null; // hub treats it as a resume
    if (this.mode === 'ai' || this.phase === 'playing') {
      return { code: 'GAME_IN_PROGRESS', message: 'Game already in progress' };
    }
    if (this.phase === 'finished') {
      return { code: 'GAME_IN_PROGRESS', message: 'This game just finished - ask the host for a rematch' };
    }
    // A player who previously left mid-game may have left a bot seat with their id behind.
    const stale = this.seats.findIndex((s) => s.playerId === p.playerId && s.isBot);
    if (stale >= 0) this.seats.splice(stale, 1);
    if (this.seats.length >= MAX_SEATS) return { code: 'ROOM_FULL', message: 'Room is full' };
    this.seats.push({ ...p, isBot: false, ready: false, connected: true });
    this.touch();
    this.refreshEmpty();
    this.broadcastRoom();
    return null;
  }

  updateProfile(p: Profile): void {
    const s = this.seat(p.playerId);
    if (!s || s.isBot) return;
    s.name = p.name;
    s.avatar = p.avatar;
    this.broadcastRoom();
  }

  setConnected(playerId: PlayerId, connected: boolean): void {
    const s = this.seat(playerId);
    if (!s || s.isBot) return;
    s.connected = connected;
    this.touch();
    this.refreshEmpty();
    this.broadcastRoom();
    if (this.phase === 'playing') this.schedule();
  }

  private refreshEmpty(): void {
    const any = this.humans().some((s) => s.connected);
    if (any) this.emptySince = null;
    else if (this.emptySince === null) this.emptySince = this.deps.now();
  }

  leave(playerId: PlayerId): void {
    const s = this.seat(playerId);
    if (!s || s.isBot || this.destroyed) return;
    this.touch();
    if (this.phase === 'playing') {
      // Their seat is taken over by a bot for the rest of the game.
      s.isBot = true;
      s.ready = true;
      s.connected = true;
    } else {
      this.seats.splice(this.seats.indexOf(s), 1);
    }
    const humans = this.humans();
    if (humans.length === 0) {
      this.destroy('empty');
      return;
    }
    if (this.hostId === playerId) this.hostId = humans[0].playerId;
    this.refreshEmpty();
    this.broadcastRoom();
    if (this.phase === 'playing') this.schedule();
  }

  setReady(playerId: PlayerId, ready: boolean): RoomError | null {
    if (this.phase !== 'lobby' && this.phase !== 'rematch') return { code: 'WRONG_PHASE', message: 'Not in the lobby' };
    const s = this.seat(playerId);
    if (!s) return { code: 'NOT_IN_ROOM', message: 'You are not in this room' };
    s.ready = ready;
    this.touch();
    this.broadcastRoom();
    return null;
  }

  private nextBotProfile(): Profile {
    const used = new Set(this.seats.map((s) => s.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.seats.length}`;
    const idx = secureInt(0, 0xffffff).toString(36);
    return {
      playerId: `bot_${idx}${this.seats.length}`,
      name,
      avatar: { emoji: '🤖', color: BOT_COLORS[this.seats.length % BOT_COLORS.length] },
    };
  }

  addBot(playerId: PlayerId): RoomError | null {
    if (this.hostId !== playerId) return { code: 'NOT_HOST', message: 'Only the host can do that' };
    if (this.phase !== 'lobby' && this.phase !== 'rematch') return { code: 'WRONG_PHASE', message: 'Not in the lobby' };
    if (this.seats.length >= MAX_SEATS) return { code: 'ROOM_FULL', message: 'Room is full' };
    this.seats.push({ ...this.nextBotProfile(), isBot: true, ready: true, connected: true });
    this.touch();
    this.broadcastRoom();
    return null;
  }

  removeBot(playerId: PlayerId, botId: PlayerId): RoomError | null {
    if (this.hostId !== playerId) return { code: 'NOT_HOST', message: 'Only the host can do that' };
    if (this.phase !== 'lobby' && this.phase !== 'rematch') return { code: 'WRONG_PHASE', message: 'Not in the lobby' };
    const i = this.seats.findIndex((s) => s.playerId === botId && s.isBot);
    if (i < 0) return { code: 'NOT_A_BOT', message: 'No such bot' };
    this.seats.splice(i, 1);
    this.touch();
    this.broadcastRoom();
    return null;
  }

  // ------------------------------------------------------------------ game flow

  /** ai mode: creator + bots, starts immediately. */
  startAi(botCount: number): void {
    for (let i = 0; i < botCount; i++) this.seats.push({ ...this.nextBotProfile(), isBot: true, ready: true, connected: true });
    this.beginGame();
  }

  start(playerId: PlayerId): RoomError | null {
    if (this.hostId !== playerId) return { code: 'NOT_HOST', message: 'Only the host can start the game' };
    if (this.phase !== 'lobby' && this.phase !== 'rematch') return { code: 'WRONG_PHASE', message: 'Game already started' };
    if (this.seats.length < 2) return { code: 'NOT_ENOUGH_PLAYERS', message: 'Need at least 2 players' };
    if (!this.canStart()) return { code: 'NOT_ALL_READY', message: 'Waiting for everyone to be ready' };
    this.beginGame();
    return null;
  }

  private beginGame(): void {
    this.state = createGame(
      this.seats.map((s) => s.playerId),
      DEFAULT_RULES,
      this.deps.rng,
    );
    this.phase = 'playing';
    this.touch();
    this.broadcastRoom();
    this.broadcastState([]);
    this.schedule();
  }

  rematch(playerId: PlayerId): RoomError | null {
    const s = this.seat(playerId);
    if (!s || s.isBot) return { code: 'NOT_IN_ROOM', message: 'You are not in this room' };
    if (this.phase === 'rematch') {
      s.ready = true;
      this.touch();
      this.broadcastRoom();
      return null;
    }
    if (this.phase !== 'finished') return { code: 'WRONG_PHASE', message: 'The game is not over yet' };
    this.touch();
    if (this.mode === 'ai') {
      this.beginGame();
      return null;
    }
    this.phase = 'rematch';
    this.state = null;
    for (const seat of this.seats) seat.ready = seat.isBot || seat.playerId === playerId;
    this.broadcastRoom();
    return null;
  }

  action(playerId: PlayerId, version: number, action: PlayerAction): RoomError | null {
    if (this.phase !== 'playing' || !this.state) return { code: 'WRONG_PHASE', message: 'No game in progress' };
    const seat = this.seat(playerId);
    if (!seat || seat.isBot) return { code: 'NOT_IN_ROOM', message: 'You are not in this game' };
    if (version !== this.state.version) {
      return { code: 'STALE_VERSION', message: 'Your view was out of date - refreshed', resync: true };
    }
    const res = this.applyInternal({ ...(action as object), playerId } as Action);
    if (res.ok) return null;
    return { code: res.code, message: res.reason, resync: res.code === 'NOT_YOUR_TURN' };
  }

  private applyInternal(action: Action) {
    const res = applyAction(this.state!, action, this.deps.rng);
    if (!res.ok) return res;
    this.state = res.state;
    this.touch();
    this.broadcastState(res.events);
    if (res.state.winner) {
      this.phase = 'finished';
      this.clearTimer();
      this.broadcastRoom();
    } else {
      this.schedule();
    }
    return res;
  }

  // ------------------------------------------------------------------ bots / away players

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    this.clearTimer();
    const st = this.state;
    if (this.destroyed || this.phase !== 'playing' || !st || st.winner) return;
    const pid = st.players[st.turn];
    const seat = this.seat(pid);
    if (!seat) return;
    const t = this.deps.timing;
    let delay: number;
    if (seat.isBot) {
      delay = t.botMinMs + secureInt(0, Math.max(0, t.botMaxMs - t.botMinMs));
      const owed = st.jakkOwed ? this.seat(st.jakkOwed) : undefined;
      if (owed && !owed.isBot) delay = Math.max(delay, t.jakkBotMinMs);
    } else if (!seat.connected) {
      delay = t.awayTurnMs;
    } else {
      return;
    }
    const version = st.version;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.destroyed || !this.state || this.state.version !== version || this.phase !== 'playing') return;
      const s = this.seat(pid);
      if (!s || (!s.isBot && s.connected)) return;
      this.actFor(pid);
    }, delay);
    (this.timer as { unref?: () => void }).unref?.();
  }

  private actFor(pid: PlayerId): void {
    const st = this.state!;
    const view = toPlayerView(st, pid);
    const move = chooseBotAction(view, { declareJakk: this.deps.rng() < this.deps.botJakkRate });
    if (!move) return;
    const res = this.applyInternal({ ...move, playerId: pid } as Action);
    if (!res.ok) {
      this.deps.log(`bot move rejected in ${this.code}: ${res.code} ${res.reason}`);
      // Safety net so a game can never stall on a bot.
      const fallback = this.applyInternal({ type: st.penalty ? 'takePenalty' : 'draw', playerId: pid } as Action);
      if (!fallback.ok) this.deps.log(`bot fallback rejected in ${this.code}: ${fallback.code}`);
    }
  }

  // ------------------------------------------------------------------ teardown

  destroy(reason: 'expired' | 'idle' | 'empty'): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearTimer();
    const closed: ServerMessage = { type: 'roomClosed', code: this.code, reason };
    for (const s of this.seats) this.sendTo(s, closed);
    this.deps.onDestroy(this, reason);
  }
}
