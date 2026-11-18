import { type Avatar, sanitizeName, validateAvatar } from '@shared/protocol';
import { readStore, writeStore } from './storage';

export interface Identity {
  name: string;
  avatar: Avatar;
}

export const AVATAR_EMOJIS = ['🦊', '🐼', '🐸', '🦁', '🐙', '🦄', '🐲', '🐧', '🦉', '🐯', '🐵', '🦖', '🐢', '🦈', '🐝', '🦋'];
export const AVATAR_COLORS = ['#c6ff3d', '#ffb020', '#ff7a59', '#ff5d8f', '#b794f6', '#5eb0ff', '#3dd6c6', '#e9e4d8'];

const ID_KEY = 'cj.identity';
const TOKEN_KEY = 'cj.token';

function rand(n: number): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}

export function loadIdentity(): Identity | null {
  const raw = readStore(ID_KEY);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { name?: unknown; avatar?: unknown };
    const name = sanitizeName(o.name);
    const avatar = validateAvatar(o.avatar);
    return name && avatar ? { name, avatar } : null;
  } catch {
    return null;
  }
}

export function saveIdentity(id: Identity): void {
  writeStore(ID_KEY, JSON.stringify(id));
}

export function randomGuest(): Identity {
  return {
    name: `Guest ${1000 + rand(9000)}`,
    avatar: { emoji: AVATAR_EMOJIS[rand(AVATAR_EMOJIS.length)], color: AVATAR_COLORS[rand(AVATAR_COLORS.length)] },
  };
}

/** The secret session token. Created once, kept in localStorage, only ever sent in `hello`. */
export function getToken(): string {
  const existing = readStore(TOKEN_KEY);
  if (existing && /^[A-Za-z0-9_-]{16,128}$/.test(existing)) return existing;
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  const token = btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  writeStore(TOKEN_KEY, token);
  return token;
}
