// Client <-> server protocol. Keep docs/PROTOCOL.md in sync with this file.
// Transport: one WebSocket at /ws, JSON text frames, one message object per frame.
import type {
  CardId,
  GameEvent,
  PlayerAction,
  PlayerId,
  PlayerView,
  RejectionCode,
  RulesConfig,
} from './engine';

export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------- shared constants

/** 32 symbols: A-Z and 2-9 without I, O (and 0, 1). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
export const NAME_MAX_LENGTH = 16;
export const MAX_MESSAGE_BYTES = 4096;
export const MAX_BOTS_AI_MODE = 3;

export type RoomMode = 'friends' | 'ai';
/**
 * lobby    - friends room waiting to start (also used for the first game)
 * rematch  - friends room after a finished game, waiting for the host to start again (same code)
 * playing  - game in progress
 * finished - game over (winner is in the final view); rematch can be requested
 */
export type RoomPhase = 'lobby' | 'rematch' | 'playing' | 'finished';

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
  rules: RulesConfig;
}

// ---------------------------------------------------------------- client -> server

interface Base {
  /** Optional client-chosen id (<= 64 chars), echoed back on an `error` response to this message. */
  reqId?: string;
}

export type ClientMessage =
  | (Base & { type: 'hello'; protocol?: number; sessionToken: string; name: string; avatar: Avatar })
  | (Base & { type: 'createRoom'; mode: RoomMode; botCount?: number })
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
    }
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
