import type { Timing } from '../shared/timing';

export { DEFAULT_TIMING, type Timing } from '../shared/timing';

export interface ServerOptions {
  port?: number;
  host?: string;
  /** Directory with the built client (index.html). Auto-detected when omitted. */
  clientDir?: string;
  /** If set, WebSocket upgrades from a browser Origin not in this list are refused. One origin or several. */
  publicOrigin?: string | string[];
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
