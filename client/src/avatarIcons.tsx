import type { ReactNode } from 'react';
import { SUIT_PATH } from './suitPaths';

/**
 * Avatar marks: card-table symbols drawn in a 24x24 box and rendered in gold (or ink on light chips)
 * on a solid jewel-tone chip. Keys travel in the protocol's `avatar.icon` field.
 */
function Letter({ ch }: { ch: string }) {
  return (
    <text x="12" y="19.2" textAnchor="middle" fontFamily="'Roboto Slab', Georgia, serif" fontWeight="900" fontSize="20">
      {ch}
    </text>
  );
}

export const AVATAR_ICON_ART: Record<string, ReactNode> = {
  spade: SUIT_PATH.S,
  heart: SUIT_PATH.H,
  diamond: SUIT_PATH.D,
  club: SUIT_PATH.C,
  ace: <Letter ch="A" />,
  king: <Letter ch="K" />,
  queen: <Letter ch="Q" />,
  jack: <Letter ch="J" />,
  seven: <Letter ch="7" />,
  crown: <path d="M2.5 7.5 7.2 12 12 4.5l4.8 7.5 4.7-4.5-1.9 10.5H4.4zM4.6 19.6h14.8v2.2H4.6z" />,
  star: <path d="m12 2.2 2.9 6.4 7 .7-5.3 4.7 1.5 6.9L12 17.3l-6.1 3.6 1.5-6.9-5.3-4.7 7-.7z" />,
  chip: (
    <path
      fillRule="evenodd"
      d="M12 1.8a10.2 10.2 0 1 1 0 20.4 10.2 10.2 0 0 1 0-20.4zm-1.4 2.1v3.2a5 5 0 0 1 2.8 0V3.9a8.200 8.200 0 0 0-2.800 0zm0 13v3.2a8.200 8.200 0 0 0 2.800 0v-3.200a5 5 0 0 1-2.800 0zM3.900 10.600a8.200 8.200 0 0 0 0 2.800h3.200a5 5 0 0 1 0-2.800zm13 0a5 5 0 0 1 0 2.800h3.200a8.200 8.200 0 0 0 0-2.800zM12 8.400a3.600 3.600 0 1 0 0 7.200 3.600 3.600 0 0 0 0-7.200z"
    />
  ),
  /** Bots. */
  cpu: (
    <path
      fillRule="evenodd"
      d="M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm2.5 4.5v5h5v-5zM8.2 1.800h1.800V4H8.200zm5.800 0h1.800V4H14zM8.200 20h1.800v2.200H8.200zM14 20h1.800v2.200H14zM1.800 8.200H4V10H1.800zm0 5.800H4v1.800H1.800zM20 8.200h2.200V10H20zm0 5.800h2.200v1.800H20z"
    />
  ),
};

/** The marks a player can choose (bots use `cpu`). */
export const AVATAR_ICONS = ['spade', 'heart', 'diamond', 'club', 'ace', 'king', 'queen', 'jack', 'crown', 'star', 'chip', 'seven'];

/** Ink colour for a mark on a given chip colour: gold on dark chips, near-black on light ones. */
export function markColour(bg: string): string {
  const n = parseInt(bg.slice(1), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum > 150 ? '#1a1712' : '#f0d58f';
}
