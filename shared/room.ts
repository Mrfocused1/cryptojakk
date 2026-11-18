import { chooseBotAction } from './ai';
import {
  type Action,
  type GameEvent,
  type GameState,
  type HouseRules,
  type MatchOptions,
  type PlayerAction,
  type PlayerId,
  type RulesConfig,
  type Rng,
  DEFAULT_MATCH_OPTIONS,
  DEFAULT_RULES,
  applyAction,
  createGame,
  houseRulesOf,
  isCurrentRules,
  publicEvents,
  redactEvents,
  toPlayerView,
  withRules,
} from './engine';
import type {
  Avatar,
  ErrorCode,
  HistoryEntry,
  LobbyPlayer,
  OptionsInput,
  RoomMode,
  RoomPhase,
  RoomSnapshot,
  ServerMessage,
  TurnTimer,
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

/** Bump when the shape of RoomSave / GameState changes in a way old saves cannot be restored from. */
export const SAVE_VERSION = 2;
const HISTORY_CAP = 600;

export interface RoomSave {
  v: number;
  code: string;
  mode: RoomMode;
  phase: RoomPhase;
  hostId: PlayerId;
  seats: Array<{ playerId: PlayerId; name: string; avatar: Avatar; isBot: boolean; ready: boolean; waiting: boolean }>;
  state: GameState | null;
  houseRules: HouseRules;
  options: MatchOptions;
  scores: Record<PlayerId, number>;
  handNumber: number;
  dealerIdx: number;
  matchWinner: PlayerId | null;
  history: HistoryEntry[];
}

/** False for saves made by an older version of the game (other rules / other shape): discard them. */
export function isCompatibleSave(x: unknown): x is RoomSave {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Partial<RoomSave>;
  if (o.v !== SAVE_VERSION || !Array.isArray(o.seats) || o.seats.length < 1 || typeof o.code !== 'string') return false;
  if (!o.houseRules || !o.options || typeof o.scores !== 'object') return false;
  if (o.state) {
    if (!isCurrentRules(o.state.rules) || !Array.isArray(o.state.players) || !Array.isArray(o.state.out)) return false;
  }
  return true;
}

interface Seat extends Profile {
  isBot: boolean;
  ready: boolean;
  connected: boolean;
  /** Joined mid-hand: spectates, dealt in from the next hand. */
  waiting: boolean;
}

interface Clock {
  key: string;
  playerId: PlayerId;
  deadline: number;
}

const BOT_NAMES = ['Ada', 'Grace', 'Linus', 'Hedy', 'Alan', 'Margaret', 'Dennis', 'Radia'];
const BOT_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
const MAX_SEATS = DEFAULT_RULES.maxPlayers;

export class Room {
  phase: RoomPhase = 'lobby';
  hostId: PlayerId;
  readonly seats: Seat[] = [];
  state: GameState | null = null;
  houseRules: HouseRules = houseRulesOf(DEFAULT_RULES);
  options: MatchOptions = { ...DEFAULT_MATCH_OPTIONS };
  scores: Record<PlayerId, number> = {};
  handNumber = 0;
  dealerIdx = 0;
  matchWinner: PlayerId | null = null;
  history: HistoryEntry[] = [];
  lastActivity: number;
  emptySince: number | null = null;
  private seq = 0;
  private clock: Clock | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(
    readonly code: string,
    readonly mode: RoomMode,
    host: Profile,
    private readonly deps: RoomDeps,
  ) {
    this.hostId = host.playerId;
    this.seats.push({ ...host, isBot: false, ready: false, connected: true, waiting: false });
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
    return this.seats.length >= 2 && this.seats.every((s) => s.isBot || s.playerId === this.hostId || s.ready);
  }

  effectiveRules(): RulesConfig {
    return withRules({ ...this.houseRules });
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
      waiting: s.waiting,
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
      rules: this.effectiveRules(),
      houseRules: { ...this.houseRules },
      options: { ...this.options },
      scores: { ...this.scores },
      handNumber: this.handNumber,
      matchWinner: this.matchWinner,
    };
  }

  /** Plain-JSON copy of everything needed to rebuild this room later (the browser keeps one for solo games). */
  save(): RoomSave {
    return {
      v: SAVE_VERSION,
      code: this.code,
      mode: this.mode,
      phase: this.phase,
      hostId: this.hostId,
      seats: this.seats.map((s) => ({ playerId: s.playerId, name: s.name, avatar: s.avatar, isBot: s.isBot, ready: s.ready, waiting: s.waiting })),
      state: this.state,
      houseRules: { ...this.houseRules },
      options: { ...this.options },
      scores: { ...this.scores },
      handNumber: this.handNumber,
      dealerIdx: this.dealerIdx,
      matchWinner: this.matchWinner,
      history: this.history,
    };
  }

  /** Rebuild a room from `save()`. Throws for an incompatible (older) save. Call `resume()` afterwards. */
  static restore(data: RoomSave, deps: RoomDeps): Room {
    if (!isCompatibleSave(data)) throw new Error('Incompatible saved game');
    const first = data.seats[0];
    const room = new Room(data.code, data.mode, { playerId: first.playerId, name: first.name, avatar: first.avatar }, deps);
    room.seats.length = 0;
    for (const s of data.seats) room.seats.push({ ...s, connected: true });
    room.hostId = data.hostId;
    room.phase = data.phase;
    room.state = data.state;
    room.houseRules = { ...data.houseRules };
    room.options = { ...data.options };
    room.scores = { ...data.scores };
    room.handNumber = data.handNumber;
    room.dealerIdx = data.dealerIdx;
    room.matchWinner = data.matchWinner;
    room.history = data.history ?? [];
    room.seq = room.history.length ? room.history[room.history.length - 1].seq + 1 : 0;
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

  /** The turn clock for the player to move (null when none is running). */
  timerMsg(): TurnTimer | null {
    const st = this.state;
    if (!this.clock || !st || this.phase !== 'playing' || st.handOver || st.players[st.turn] !== this.clock.playerId) return null;
    return { playerId: this.clock.playerId, deadline: this.clock.deadline, serverTime: this.deps.now(), seconds: this.options.turnSeconds };
  }

  private broadcastState(events: GameEvent[]): void {
    if (!this.state) return;
    const timer = this.timerMsg();
    for (const s of this.seats) {
      if (s.isBot) continue;
      this.sendTo(s, {
        type: 'state',
        view: toPlayerView(this.state, s.playerId),
        events: redactEvents(events, s.playerId),
        resync: false,
        timer,
      });
    }
  }

  /** Re-send the room and (if a hand is on) this player's current view. */
  sendFull(playerId: PlayerId): void {
    const s = this.seat(playerId);
    if (!s) return;
    this.sendTo(s, { type: 'roomState', room: this.snapshot() });
    this.sendView(playerId);
  }

  sendView(playerId: PlayerId): void {
    const s = this.seat(playerId);
    if (!s || !this.state || this.phase === 'lobby' || this.phase === 'rematch') return;
    this.sendTo(s, { type: 'state', view: toPlayerView(this.state, playerId), events: [], resync: true, timer: this.timerMsg() });
  }

  sendHistory(playerId: PlayerId): RoomError | null {
    const s = this.seat(playerId);
    if (!s) return { code: 'NOT_IN_ROOM', message: 'You are not in this room' };
    this.sendTo(s, { type: 'history', entries: this.history });
    return null;
  }

  // ------------------------------------------------------------------ membership

  private touch(): void {
    this.lastActivity = this.deps.now();
  }

  join(p: Profile): RoomError | null {
    if (this.hasSeat(p.playerId)) return null; // hub treats it as a resume
    if (this.mode === 'ai') return { code: 'GAME_IN_PROGRESS', message: 'Game already in progress' };
    // A player who previously left mid-game may have left a bot seat with their id behind.
    const stale = this.seats.findIndex((s) => s.playerId === p.playerId && s.isBot);
    if (stale >= 0) this.seats.splice(stale, 1);
    if (this.seats.length >= MAX_SEATS) return { code: 'ROOM_FULL', message: 'Room is full' };
    const waiting = this.phase !== 'lobby' && this.phase !== 'rematch';
    this.seats.push({ ...p, isBot: false, ready: false, connected: true, waiting });
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
    if ((this.phase === 'playing' || this.phase === 'handOver') && !s.waiting) {
      // Their seat is taken over by a bot for the rest of the match.
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
    this.seats.push({ ...this.nextBotProfile(), isBot: true, ready: true, connected: true, waiting: false });
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

  /** Merge (already shape-validated) house rules / options. Solo (ai) rooms never run a turn timer. */
  private mergeOptions(input: OptionsInput): void {
    if (input.houseRules) this.houseRules = { ...this.houseRules, ...input.houseRules };
    if (input.options) this.options = { ...this.options, ...input.options };
    if (this.mode === 'ai') this.options.turnSeconds = 0;
  }

  /** Host only, lobby / rematch only (never mid-hand, never mid-match). */
  setOptions(playerId: PlayerId, input: OptionsInput): RoomError | null {
    if (this.hostId !== playerId) return { code: 'NOT_HOST', message: 'Only the host can change the rules' };
    if (this.phase !== 'lobby' && this.phase !== 'rematch') {
      return { code: 'HAND_IN_PROGRESS', message: 'Rules can only be changed between matches' };
    }
    this.mergeOptions(input);
    // everyone must re-confirm after a rules change
    for (const s of this.seats) if (!s.isBot && s.playerId !== this.hostId) s.ready = false;
    this.touch();
    this.broadcastRoom();
    return null;
  }

  // ------------------------------------------------------------------ game flow

  /** ai mode: creator + bots, starts immediately. */
  startAi(botCount: number, input: OptionsInput = {}): void {
    this.mergeOptions(input);
    for (let i = 0; i < botCount; i++) this.seats.push({ ...this.nextBotProfile(), isBot: true, ready: true, connected: true, waiting: false });
    this.beginMatch();
  }

  start(playerId: PlayerId): RoomError | null {
    if (this.hostId !== playerId) return { code: 'NOT_HOST', message: 'Only the host can start the game' };
    if (this.phase !== 'lobby' && this.phase !== 'rematch') return { code: 'WRONG_PHASE', message: 'Game already started' };
    if (this.seats.length < 2) return { code: 'NOT_ENOUGH_PLAYERS', message: 'Need at least 2 players' };
    if (!this.canStart()) return { code: 'NOT_ALL_READY', message: 'Waiting for everyone to be ready' };
    this.beginMatch();
    return null;
  }

  private beginMatch(): void {
    this.scores = {};
    this.matchWinner = null;
    this.handNumber = 0;
    this.beginHand();
  }

  private beginHand(): void {
    for (const s of this.seats) s.waiting = false;
    const ids = this.seats.map((s) => s.playerId);
    const n = ids.length;
    this.dealerIdx = this.handNumber === 0 ? Math.min(n - 1, Math.floor(this.deps.rng() * n)) : (this.dealerIdx + 1) % n;
    this.state = createGame(ids, this.effectiveRules(), this.deps.rng, { dealer: this.dealerIdx });
    this.handNumber++;
    this.history = [];
    this.pushHistory(null, 'deal', []);
    this.clock = null;
    this.phase = 'playing';
    this.touch();
    this.broadcastRoom();
    this.schedule(); // starts the clock before the first state goes out
    this.broadcastState([]);
  }

  nextHand(playerId: PlayerId): RoomError | null {
    if (this.hostId !== playerId) return { code: 'NOT_HOST', message: 'Only the host can deal the next hand' };
    if (this.phase !== 'handOver') return { code: 'WRONG_PHASE', message: 'No hand has just finished' };
    this.beginHand();
    return null;
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
    if (this.phase !== 'finished') return { code: 'WRONG_PHASE', message: 'The match is not over yet' };
    this.touch();
    if (this.mode === 'ai') {
      this.beginMatch();
      return null;
    }
    this.phase = 'rematch';
    this.state = null;
    this.history = [];
    this.clock = null;
    for (const seat of this.seats) {
      seat.waiting = false;
      seat.ready = seat.isBot || seat.playerId === playerId;
    }
    this.broadcastRoom();
    return null;
  }

  action(playerId: PlayerId, version: number, action: PlayerAction): RoomError | null {
    if (this.phase !== 'playing' || !this.state) return { code: 'WRONG_PHASE', message: 'No hand in progress' };
    const seat = this.seat(playerId);
    if (!seat || seat.isBot) return { code: 'NOT_IN_ROOM', message: 'You are not in this game' };
    if (seat.waiting) return { code: 'NOT_YOUR_TURN', message: 'You are watching this hand - you are dealt in next hand' };
    if (version !== this.state.version) {
      return { code: 'STALE_VERSION', message: 'Your view was out of date - refreshed', resync: true };
    }
    const res = this.applyInternal({ ...(action as object), playerId } as Action, 'play');
    if (res.ok) return null;
    return { code: res.code, message: res.reason, resync: res.code === 'NOT_YOUR_TURN' };
  }

  private pushHistory(playerId: PlayerId | null, kind: HistoryEntry['kind'], events: GameEvent[]): void {
    this.history.push({ seq: this.seq++, hand: this.handNumber, version: this.state?.version ?? 0, playerId, kind, events: publicEvents(events) });
    if (this.history.length > HISTORY_CAP) this.history.splice(0, this.history.length - HISTORY_CAP);
  }

  private applyInternal(action: Action, source: 'play' | 'bot' | 'timeout', prefix: GameEvent[] = []) {
    const res = applyAction(this.state!, action, this.deps.rng);
    if (!res.ok) return res;
    this.state = res.state;
    this.touch();
    const events = [...prefix, ...res.events];
    const kind: HistoryEntry['kind'] = source === 'timeout' ? 'timeout' : source === 'bot' ? 'bot' : action.type;
    this.pushHistory(action.playerId, kind, events);
    if (res.events.some((e) => e.type === 'turn')) this.clock = null; // a new turn: schedule() starts a fresh clock
    if (res.state.handOver) {
      this.clearTimer();
      this.clock = null;
      this.finishHand();
      this.broadcastState(events);
      this.broadcastRoom();
    } else {
      this.schedule();
      this.broadcastState(events);
    }
    return res;
  }

  /** Score the hand; decide between 'next hand' and 'match over'. */
  private finishHand(): void {
    const w = this.state?.handOver?.winner ?? null;
    if (w) {
      this.scores[w] = (this.scores[w] ?? 0) + 1;
      if (this.scores[w] >= this.options.handsToWin) this.matchWinner = w;
    }
    this.phase = this.matchWinner ? 'finished' : 'handOver';
  }

  // ------------------------------------------------------------------ bots / away players / turn timer

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    this.clearTimer();
    const st = this.state;
    if (this.destroyed || this.phase !== 'playing' || !st || st.handOver) {
      this.clock = null;
      return;
    }
    const pid = st.players[st.turn];
    const seat = this.seat(pid);
    if (!seat) return;
    const t = this.deps.timing;
    const now = this.deps.now();

    // Turn clock: one per turn, absolute deadline; reconnecting never restarts it.
    const secs = this.options.turnSeconds;
    const key = `${this.handNumber}:${st.turns}`;
    if (!seat.isBot && secs > 0) {
      if (!this.clock || this.clock.key !== key || this.clock.playerId !== pid) {
        this.clock = { key, playerId: pid, deadline: now + secs * 1000 };
      }
    } else {
      this.clock = null;
    }

    let delay: number | null = null;
    let mode: 'bot' | 'away' | 'timeout' = 'bot';
    if (seat.isBot) {
      delay = t.botMinMs + secureInt(0, Math.max(0, t.botMaxMs - t.botMinMs));
    } else {
      if (!seat.connected) {
        delay = t.awayTurnMs;
        mode = 'away';
      }
      if (this.clock) {
        const d = Math.max(0, this.clock.deadline - now);
        if (delay === null || d <= delay) {
          delay = d;
          mode = 'timeout';
        }
      }
    }
    if (delay === null) return;
    const version = st.version;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.destroyed || !this.state || this.state.version !== version || this.phase !== 'playing') return;
      const s = this.seat(pid);
      if (!s) return;
      if (mode === 'timeout') this.timeoutPlay(pid);
      else if (s.isBot || !s.connected) this.actFor(pid);
    }, delay);
    (this.timer as { unref?: () => void }).unref?.();
  }

  private actFor(pid: PlayerId): void {
    const st = this.state!;
    const view = toPlayerView(st, pid);
    const move = chooseBotAction(view, { declareJakk: this.deps.rng() < this.deps.botJakkRate });
    if (!move) return;
    const res = this.applyInternal({ ...move, playerId: pid } as Action, 'bot');
    if (!res.ok) {
      this.deps.log(`bot move rejected in ${this.code}: ${res.code} ${res.reason}`);
      // Safety net so a game can never stall on a bot.
      const fallback = this.applyInternal({ type: st.penalty ? 'takePenalty' : 'draw', playerId: pid } as Action, 'bot');
      if (!fallback.ok) this.deps.log(`bot fallback rejected in ${this.code}: ${fallback.code}`);
    }
  }

  /** The turn clock ran out: the agreed legal default is to take the pending penalty, else draw 1. */
  private timeoutPlay(pid: PlayerId): void {
    const st = this.state!;
    if (st.awaitingSuit) {
      // name a suit first (still the same turn clock; the next tick performs the default move)
      const move = chooseBotAction(toPlayerView(st, pid), { declareJakk: false });
      if (move) this.applyInternal({ ...move, playerId: pid } as Action, 'timeout', [{ type: 'timedOut', playerId: pid }]);
      return;
    }
    const act: Action = { type: st.penalty ? 'takePenalty' : 'draw', playerId: pid };
    const res = this.applyInternal(act, 'timeout', [{ type: 'timedOut', playerId: pid }]);
    if (!res.ok) this.deps.log(`timeout move rejected in ${this.code}: ${res.code}`);
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
