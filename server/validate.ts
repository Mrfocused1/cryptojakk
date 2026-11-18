import { isCardId, isSuit, type PlayerAction } from '../shared/engine';
import {
  type ClientMessage,
  type ErrorCode,
  MAX_BOTS_AI_MODE,
  normalizeRoomCode,
  sanitizeName,
  validateAvatar,
} from '../shared/protocol';

export type Parsed = { ok: true; msg: ClientMessage } | { ok: false; code: ErrorCode; message: string; reqId?: string };

const bad = (message: string, reqId?: string, code: ErrorCode = 'BAD_MESSAGE'): Parsed => ({ ok: false, code, message, reqId });

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function parseAction(a: unknown): PlayerAction | null {
  if (typeof a !== 'object' || a === null) return null;
  const o = a as Record<string, unknown>;
  switch (o.type) {
    case 'draw':
    case 'takePenalty':
    case 'pass':
    case 'declareJakk':
      return { type: o.type };
    case 'play': {
      if (!Array.isArray(o.cardIds) || o.cardIds.length < 1 || o.cardIds.length > 13) return null;
      if (!o.cardIds.every(isCardId)) return null;
      if (o.suit !== undefined && !isSuit(o.suit)) return null;
      if (o.declareJakk !== undefined && typeof o.declareJakk !== 'boolean') return null;
      const out: PlayerAction = { type: 'play', cardIds: o.cardIds as string[] };
      if (o.suit !== undefined) out.suit = o.suit as never;
      if (o.declareJakk !== undefined) out.declareJakk = o.declareJakk;
      return out;
    }
    default:
      return null;
  }
}

/** Validate one decoded JSON frame. Everything not explicitly allowed is rejected. */
export function parseClientMessage(raw: unknown): Parsed {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return bad('Message must be a JSON object');
  const o = raw as Record<string, unknown>;
  let reqId: string | undefined;
  if (o.reqId !== undefined) {
    if (typeof o.reqId !== 'string' || o.reqId.length > 64) return bad('Invalid reqId');
    reqId = o.reqId;
  }
  const ok = (msg: ClientMessage): Parsed => ({ ok: true, msg: reqId === undefined ? msg : { ...msg, reqId } });

  switch (o.type) {
    case 'hello': {
      if (typeof o.sessionToken !== 'string' || !TOKEN_RE.test(o.sessionToken)) {
        return bad('sessionToken must be 16-128 chars of [A-Za-z0-9_-]', reqId, 'INVALID_TOKEN');
      }
      const name = sanitizeName(o.name);
      if (name === null) return bad('Name must be 1-16 characters', reqId, 'INVALID_NAME');
      const avatar = validateAvatar(o.avatar);
      if (!avatar) return bad('Invalid avatar', reqId, 'INVALID_AVATAR');
      if (o.protocol !== undefined && (typeof o.protocol !== 'number' || !Number.isInteger(o.protocol))) {
        return bad('Invalid protocol version', reqId);
      }
      return ok({ type: 'hello', sessionToken: o.sessionToken, name, avatar, protocol: o.protocol as number | undefined });
    }
    case 'createRoom': {
      if (o.mode !== 'friends' && o.mode !== 'ai') return bad('mode must be "friends" or "ai"', reqId);
      let botCount: number | undefined;
      if (o.botCount !== undefined) {
        if (typeof o.botCount !== 'number' || !Number.isInteger(o.botCount) || o.botCount < 1 || o.botCount > MAX_BOTS_AI_MODE) {
          return bad(`botCount must be 1-${MAX_BOTS_AI_MODE}`, reqId);
        }
        botCount = o.botCount;
      }
      return ok({ type: 'createRoom', mode: o.mode, botCount });
    }
    case 'joinRoom': {
      const code = normalizeRoomCode(o.code);
      if (!code) return bad('Room not found', reqId, 'ROOM_NOT_FOUND');
      return ok({ type: 'joinRoom', code });
    }
    case 'setReady':
      if (typeof o.ready !== 'boolean') return bad('ready must be a boolean', reqId);
      return ok({ type: 'setReady', ready: o.ready });
    case 'removeBot':
      if (typeof o.playerId !== 'string' || o.playerId.length > 64) return bad('playerId required', reqId);
      return ok({ type: 'removeBot', playerId: o.playerId });
    case 'action': {
      if (typeof o.version !== 'number' || !Number.isInteger(o.version) || o.version < 0) return bad('version must be a non-negative integer', reqId);
      const action = parseAction(o.action);
      if (!action) return bad('Invalid action', reqId);
      return ok({ type: 'action', version: o.version, action });
    }
    case 'ping':
      if (o.t !== undefined && typeof o.t !== 'number') return bad('t must be a number', reqId);
      return ok({ type: 'ping', t: o.t as number | undefined });
    case 'leave':
    case 'addBot':
    case 'startGame':
    case 'rematch':
    case 'requestState':
      return ok({ type: o.type });
    default:
      return bad('Unknown message type', reqId);
  }
}
