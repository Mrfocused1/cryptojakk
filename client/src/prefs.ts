// Small user preferences kept in localStorage. Sound lives in sound.ts; this holds "reduce animation".
import { useSyncExternalStore } from 'react';
import { readStore, writeStore } from './storage';

const KEY = 'cj.reduce';
let reduce = readStore(KEY) === '1';
const subs = new Set<() => void>();

function apply(): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.reduce = reduce ? '1' : '0';
}
apply();

export function isReduceSetting(): boolean {
  return reduce;
}
/** True when the user (or their OS) asked for less motion. */
export function isReduced(): boolean {
  return reduce || (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}
export function setReduce(v: boolean): void {
  reduce = v;
  writeStore(KEY, v ? '1' : '0');
  apply();
  for (const s of subs) s();
}
export function useReduce(): boolean {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => reduce,
    () => reduce,
  );
}
