import { randomInt } from 'node:crypto';
import type { Rng } from '../shared/engine';

/**
 * Cryptographically secure RNG for the engine's Fisher-Yates shuffle.
 * crypto.randomInt gives uniform integers; ~2^48 steps per draw: Fisher-Yates modulo bias is negligible (< 2^-40).
 */
const RNG_RANGE = 2 ** 48 - 1; // randomInt allows a range of at most 2^48 - 1
export const secureRng: Rng = () => randomInt(0, RNG_RANGE) / RNG_RANGE;

/** Uniform integer in [min, max] inclusive. */
export function secureInt(min: number, max: number): number {
  return randomInt(min, max + 1);
}
