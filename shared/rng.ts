// Browser- and Node-safe cryptographic randomness (globalThis.crypto.getRandomValues; Node >= 19 and every modern browser).
import type { Rng } from './engine';

function u32(): number {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0];
}

/** Uniform float in [0, 1) with 53 random bits. Used for the Fisher-Yates shuffle. */
export const cryptoRng: Rng = () => {
  const a = new Uint32Array(2);
  globalThis.crypto.getRandomValues(a);
  return ((a[0] >>> 5) * 67108864 + (a[1] >>> 6)) / 9007199254740992;
};

/** Uniform integer in [min, max] inclusive (rejection sampling, no modulo bias). */
export function cryptoInt(min: number, max: number): number {
  const span = max - min + 1;
  if (span <= 1) return min;
  const limit = Math.floor(4294967296 / span) * span;
  let x = u32();
  while (x >= limit) x = u32();
  return min + (x % span);
}
