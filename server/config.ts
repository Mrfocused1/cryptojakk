export interface Timing {
  botMinMs: number;
  botMaxMs: number;
  /** Minimum bot delay while a HUMAN owes a JAKK call. */
  jakkBotMinMs: number;
  /** A disconnected player's turn is played by the bot logic after this long. */
  awayTurnMs: number;
  /** Room with no connected human for this long is deleted. */
  emptyRoomTtlMs: number;
  /** Room with no activity for this long is deleted. */
  idleRoomTtlMs: number;
  sweepIntervalMs: number;
  heartbeatIntervalMs: number;
}

export const DEFAULT_TIMING: Timing = {
  botMinMs: 900,
  botMaxMs: 1600,
  jakkBotMinMs: 3000,
  awayTurnMs: 15_000,
  emptyRoomTtlMs: 5 * 60_000,
  idleRoomTtlMs: 30 * 60_000,
  sweepIntervalMs: 30_000,
  heartbeatIntervalMs: 30_000,
};

export interface ServerOptions {
  port?: number;
  host?: string;
  /** Directory with the built client (index.html). Auto-detected when omitted. */
  clientDir?: string;
  /** If set, WebSocket upgrades from a different browser Origin are refused. */
  publicOrigin?: string;
  maxRooms?: number;
  timing?: Partial<Timing>;
  /** Per-socket rate limit: burst size and refill per second. */
  rateLimit?: { burst: number; perSecond: number };
  /** Probability a bot declares JAKK. Default 0.9. */
  botJakkRate?: number;
  log?: (msg: string) => void;
}

export const DEFAULT_MAX_ROOMS = 2000;
export const DEFAULT_RATE_LIMIT = { burst: 30, perSecond: 15 };
