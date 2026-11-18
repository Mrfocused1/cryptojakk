// localStorage wrapper that never throws (private windows, blocked storage...) and falls back to memory.
const mem = new Map<string, string>();

export function readStore(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return v;
  } catch {
    /* ignore */
  }
  return mem.get(key) ?? null;
}

export function writeStore(key: string, value: string): void {
  mem.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function removeStore(key: string): void {
  mem.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
