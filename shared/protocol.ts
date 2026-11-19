// Client <-> server protocol. Keep docs/PROTOCOL.md in sync with this file.
// Transport: one WebSocket at /ws, JSON text frames, one message object per frame.
import { HANDS_TO_WIN_OPTIONS, HOUSE_RULE_KEYS, TURN_SECONDS_OPTIONS } from './engine';
import type {
  CardId,
  GameEvent,
  HouseRules,
  MatchOptions,
  PlayerAction,
  PlayerId,
  PlayerView,
  RejectionCode,
  RulesConfig,
} from './engine';

export const PROTOCOL_VERSION = 2;

// ---------------------------------------------------------------- shared constants

/** 32 symbols: A-Z and 2-9 without I, O (and 0, 1). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
export const NAME_MAX_LENGTH = 16;
export const MAX_MESSAGE_BYTES = 4096;
export const MAX_BOTS_AI_MODE = 5;

export type RoomMode = 'friends' | 'ai';
/**
 * lobby    - friends room waiting to start (also used for the first game)
 * rematch  - friends room after a finished game, waiting for the host to start again (same code)
 * playing  - a hand is in progress
 * handOver - a hand ended and nobody has reached `options.handsToWin` yet: waiting for `nextHand`
 * finished - the match is over (`matchWinner`); rematch can be requested
 */
export type RoomPhase = 'lobby' | 'rematch' | 'playing' | 'handOver' | 'finished';

export interface Avatar {
  /** An emoji (1-8 chars). At least one of emoji / icon must be present. */
  emoji?: string;
  /** Icon key understood by the client, /^[a-z0-9_-]{1,24}$/. */
  icon?: string;
  /** "#rrggbb" */
  color: string;
}

export interface LobbyPlayer {
  playerId: PlayerId;
  name: string;
  avatar: Avatar;
  isHost: boolean;
  isBot: boolean;
  /** Bots are always ready. The host's flag is irrelevant for starting. */
  ready: boolean;
  connected: boolean;
  /** Joined mid-hand: watching (public info only) and dealt in from the next hand. */
  waiting: boolean;
}

export interface RoomSnapshot {
  code: string;
  mode: RoomMode;
  phase: RoomPhase;
  hostId: PlayerId;
  /** Seat order == turn order of the game. */
  players: LobbyPlayer[];
  minPlayers: number;
  maxPlayers: number;
  /** True when the host could press Start right now (>=2 seats and all non-host humans ready). */
  canStart: boolean;
  /** Effective rules of the next / current hand (defaults + houseRules). */
  rules: RulesConfig;
  /** House rules chosen by the host (also visible to everybody before a match). */
  houseRules: HouseRules;
  options: MatchOptions;
  /** Hands won so far in this match. */
  scores: Record<PlayerId, number>;
  /** 1-based number of the current / last hand (0 before the first deal). */
  handNumber: number;
  /** Set when the match is over (phase 'finished'). */
  matchWinner: PlayerId | null;
}

/** Server-authoritative turn clock. Show `deadline - (Date.now() + (serverTime - clientReceiveTime))`, or just use `remainingMs`. */
export interface TurnTimer {
  playerId: PlayerId;
  /** Absolute server timestamp (ms since epoch) when the turn expires. */
  deadline: number;
  /** Server clock at the time of sending, so clients can correct their clock offset. */
  serverTime: number;
  seconds: number;
}

export interface HistoryEntry {
  seq: number;
  /** Hand number within the match. */
  hand: number;
  /** State version after the entry (0 for the deal). */
  version: number;
  /** Who acted; null for the deal. */
  playerId: PlayerId | null;
  kind: 'deal' | 'play' | 'draw' | 'takePenalty' | 'declareJakk' | 'chooseSuit' | 'timeout' | 'bot';
  /** Public events only (a drawer's cards are never included). */
  events: GameEvent[];
}

// ---------------------------------------------------------------- client -> server

interface Base {
  /** Optional client-chosen id (<= 64 chars), echoed back on an `error` response to this message. */
  reqId?: string;
}

export type ClientMessage =
  | (Base & { type: 'hello'; protocol?: number; sessionToken: string; name: string; avatar: Avatar })
  | (Base & { type: 'createRoom'; mode: RoomMode; botCount?: number; houseRules?: Partial<HouseRules>; options?: Partial<MatchOptions> })
  /** Host only, lobby / rematch only. */
  | (Base & { type: 'setOptions'; houseRules?: Partial<HouseRules>; options?: Partial<MatchOptions> })
  /** Host only, phase handOver: deal the next hand. */
  | (Base & { type: 'nextHand' })
  | (Base & { type: 'requestHistory' })
  | (Base & { type: 'joinRoom'; code: string })
  | (Base & { type: 'leave' })
  | (Base & { type: 'setReady'; ready: boolean })
  | (Base & { type: 'addBot' })
  | (Base & { type: 'removeBot'; playerId: PlayerId })
  | (Base & { type: 'startGame' })
  | (Base & { type: 'action'; version: number; action: PlayerAction })
  | (Base & { type: 'rematch' })
  | (Base & { type: 'requestState' })
  | (Base & { type: 'ping'; t?: number });

export type ClientMessageType = ClientMessage['type'];

// ---------------------------------------------------------------- server -> client

export type ServerErrorCode =
  | 'BAD_MESSAGE'
  | 'RATE_LIMITED'
  | 'NOT_AUTHENTICATED'
  | 'INVALID_TOKEN'
  | 'INVALID_NAME'
  | 'INVALID_AVATAR'
  | 'UNSUPPORTED_PROTOCOL'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'GAME_IN_PROGRESS'
  | 'ALREADY_IN_ROOM'
  | 'NOT_IN_ROOM'
  | 'NOT_HOST'
  | 'NOT_ALL_READY'
  | 'NOT_ENOUGH_PLAYERS'
  | 'WRONG_PHASE'
  | 'HAND_IN_PROGRESS'
  | 'INVALID_OPTIONS'
  | 'NOT_A_BOT'
  | 'BOT_LIMIT'
  | 'SERVER_BUSY'
  | 'STALE_VERSION';

/** Everything the server can put in `error.code`: server codes plus the engine's rejection codes. */
export type ErrorCode = ServerErrorCode | RejectionCode;

export type ServerMessage =
  | {
      type: 'welcome';
      protocol: number;
      playerId: PlayerId;
      /** true if this token already had a seat in a live room (state follows). */
      resumed: boolean;
      roomCode: string | null;
    }
  | { type: 'roomState'; room: RoomSnapshot }
  | {
      type: 'state';
      /** Your personal, redacted view. Replace your whole local game state with it. */
      view: PlayerView;
      /** Redacted events that produced this view (empty on resync / reconnect). Use for feed + animation only. */
      events: GameEvent[];
      /** true when this is a re-send (reconnect, requestState, stale/wrong-turn rejection) rather than a new action result. */
      resync: boolean;
      /** Turn clock for the player to move (null when no timer is running or a bot is to move). */
      timer: TurnTimer | null;
    }
  | { type: 'history'; entries: HistoryEntry[] }
  | { type: 'error'; code: ErrorCode; message: string; reqId?: string }
  | { type: 'left' }
  | { type: 'roomClosed'; code: string; reason: 'expired' | 'idle' | 'empty' }
  | { type: 'pong'; t?: number; serverTime: number };

export type ServerMessageType = ServerMessage['type'];

// ---------------------------------------------------------------- pure helpers (usable on both sides)

const BS = String.fromCharCode(92);
const CONTROL_SRC = ['0000-' + '001f', '007f-009f', '200b-200f', '2028-202e', '2060-2064', 'feff'].map((r) => r.split('-').map((h) => BS + 'u' + h).join('-')).join('');
const CONTROL_RE = new RegExp('[' + CONTROL_SRC + ']');
const CONTROL_CHARS = new RegExp('[' + CONTROL_SRC + ']', 'g');

/** Trim, strip control/invisible chars, collapse whitespace. Returns null if the result is not 1-16 characters. */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
  const len = [...s].length;
  return len >= 1 && len <= NAME_MAX_LENGTH ? s : null;
}

/** Uppercase + trim; null if it cannot be a room code. Clients should call this on user input / URL params. */
export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toUpperCase();
  if (s.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of s) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return s;
}

export function validateAvatar(a: unknown): Avatar | null {
  if (typeof a !== 'object' || a === null) return null;
  const { emoji, icon, color } = a as Record<string, unknown>;
  if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) return null;
  const out: Avatar = { color: color.toLowerCase() };
  if (emoji !== undefined) {
    if (typeof emoji !== 'string' || emoji.length < 1 || emoji.length > 8 || CONTROL_RE.test(emoji)) return null;
    out.emoji = emoji;
  }
  if (icon !== undefined) {
    if (typeof icon !== 'string' || !/^[a-z0-9_-]{1,24}$/.test(icon)) return null;
    out.icon = icon;
  }
  if (out.emoji === undefined && out.icon === undefined) return null;
  return out;
}

export type { CardId };

export interface OptionsInput {
  houseRules?: Partial<HouseRules>;
  options?: Partial<MatchOptions>;
}

/** Strictly validate host-supplied house rules / match options (unknown keys and bad values give null). */
export function parseOptionsInput(houseRules: unknown, options: unknown): OptionsInput | null {
  const out: OptionsInput = {};
  if (houseRules !== undefined) {
    if (typeof houseRules !== 'object' || houseRules === null || Array.isArray(houseRules)) return null;
    const hr: Partial<HouseRules> = {};
    for (const [k, v] of Object.entries(houseRules)) {
      if (!(HOUSE_RULE_KEYS as readonly string[]).includes(k) || typeof v !== 'boolean') return null;
      (hr as Record<string, boolean>)[k] = v;
    }
    out.houseRules = hr;
  }
  if (options !== undefined) {
    if (typeof options !== 'object' || options === null || Array.isArray(options)) return null;
    const op: Partial<MatchOptions> = {};
    for (const [k, v] of Object.entries(options)) {
      if (k === 'handsToWin' && (HANDS_TO_WIN_OPTIONS as readonly unknown[]).includes(v)) op.handsToWin = v as MatchOptions['handsToWin'];
      else if (k === 'turnSeconds' && (TURN_SECONDS_OPTIONS as readonly unknown[]).includes(v)) op.turnSeconds = v as MatchOptions['turnSeconds'];
      else return null;
    }
    out.options = op;
  }
  return out;
}
