import { type Avatar, sanitizeName, validateAvatar } from '@shared/protocol';
import { readStore, writeStore } from './storage';
import { AVATAR_ICONS } from './avatarIcons';

export interface Identity {
  name: string;
  avatar: Avatar;
}

/** Jewel-tone chip colours (the mark is gold on the dark ones, ink on ivory). */
export const AVATAR_COLORS = ['#7d1622', '#16171a', '#0d5a35', '#1d3b6e', '#4e2463', '#8a5a14', '#1f5f5b', '#ece4d2'];
export { AVATAR_ICONS };

/** Earlier avatar sets. Saved guests holding one are moved to the matching slot of the current set. */
const LEGACY_EMOJI_SETS = [
  ['🦊', '🐼', '🐸', '🦁', '🐙', '🦄', '🐲', '🐧', '🦉', '🐯', '🐵', '🦖', '🐢', '🦈', '🐝', '🦋'],
  ['🃏', '👑', '💎', '🎩', '🎲', '🍀', '🔥', '⭐', '🚀', '⚡', '🎯', '🏆', '🪙', '🌙', '😎', '🎰'],
];
const LEGACY_COLORS = ['#c6ff3d', '#ffb020', '#ff7a59', '#ff5d8f', '#b794f6', '#5eb0ff', '#3dd6c6', '#e9e4d8'];

function upgradeAvatar(a: Avatar): Avatar | null {
  const ci = LEGACY_COLORS.indexOf(a.color);
  const color = ci >= 0 ? AVATAR_COLORS[ci] : a.color;
  if (a.icon && AVATAR_ICONS.includes(a.icon) && !a.emoji && ci < 0) return null;
  let icon = a.icon && AVATAR_ICONS.includes(a.icon) ? a.icon : undefined;
  if (!icon) {
    const slot = a.emoji ? Math.max(...LEGACY_EMOJI_SETS.map((set) => set.indexOf(a.emoji as string))) : -1;
    icon = AVATAR_ICONS[(slot < 0 ? 0 : slot) % AVATAR_ICONS.length];
  }
  return { icon, color };
}

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
    if (!name || !avatar) return null;
    const upgraded = upgradeAvatar(avatar);
    if (!upgraded) return { name, avatar };
    const id = { name, avatar: upgraded };
    saveIdentity(id);
    return id;
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
    avatar: { icon: AVATAR_ICONS[rand(AVATAR_ICONS.length)], color: AVATAR_COLORS[rand(AVATAR_COLORS.length)] },
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
