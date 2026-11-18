import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'landing' }
  | { name: 'friends' }
  | { name: 'ai' }
  | { name: 'how' }
  | { name: 'profile' }
  | { name: 'join'; code: string }
  | { name: 'play' };

export function parsePath(path: string): Route {
  const p = path.replace(/\/+$/, '') || '/';
  const join = /^\/r\/([^/]+)$/i.exec(p);
  if (join) return { name: 'join', code: decodeURIComponent(join[1]) };
  switch (p) {
    case '/friends':
      return { name: 'friends' };
    case '/ai':
      return { name: 'ai' };
    case '/how-to-play':
      return { name: 'how' };
    case '/profile':
      return { name: 'profile' };
    case '/play':
      return { name: 'play' };
    default:
      return { name: 'landing' };
  }
}

const listeners = new Set<() => void>();
let current = typeof location !== 'undefined' ? location.pathname : '/';

function emit() {
  current = location.pathname;
  for (const l of listeners) l();
}
if (typeof window !== 'undefined') window.addEventListener('popstate', emit);

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  if (location.pathname === path) return;
  if (opts.replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => current, () => '/');
}

export function useRoute(): Route {
  return parsePath(usePath());
}
