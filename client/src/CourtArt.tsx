import { useId, type ReactNode } from 'react';
import type { Suit } from '@shared/engine';
import { SUIT_PATH } from './suitPaths';

/**
 * Original double-ended court-card art (Jack, Queen, King), drawn as flat geometric SVG.
 * One half-figure is authored per rank, clipped on a diagonal and mirrored by a 180 degree
 * rotation about the panel centre. Details tinted by suit colour; `.fine` groups are dropped
 * by CSS when the card is small so the figure stays readable.
 */

export type CourtRank = 'J' | 'Q' | 'K';

const INK = '#141414';
const GOLD = '#f2b705';
const GOLD_DK = '#c98a00';
const BLUE = '#1c4fa3';
const SKIN = '#f6dcc3';
const WHITE = '#ffffff';
const RED = '#c8102e';
const BLACK = '#1b1b22';

/** Face with minimal features, shared by all ranks. */
function Face({ cx = 30, cy = 27, rx = 8, ry = 9.4, brow = true }: { cx?: number; cy?: number; rx?: number; ry?: number; brow?: boolean }) {
  const ex = rx * 0.4;
  const ey = cy - 1.2;
  return (
    <>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={SKIN} />
      <g stroke="none" fill={INK}>
        <circle cx={cx - ex} cy={ey} r={0.95} />
        <circle cx={cx + ex} cy={ey} r={0.95} />
      </g>
      {brow && (
        <g fill="none" strokeWidth={0.6} strokeLinecap="round">
          <path d={`M${cx - ex - 1.9} ${ey - 2.2}q1.900-.9 3.800 0`} />
          <path d={`M${cx + ex - 1.9} ${ey - 2.2}q1.900-.9 3.800 0`} />
        </g>
      )}
      <path d={`M${cx} ${ey + 1.4}v2.600`} fill="none" strokeWidth={0.5} strokeLinecap="round" />
    </>
  );
}

/** Pip in the top-left of the panel, beside the figure. */
function Pip({ suit, tint }: { suit: Suit; tint: string }) {
  return (
    <g className="fine" transform="translate(4.2 5) scale(.37)" fill={tint} stroke="none">
      {SUIT_PATH[suit]}
    </g>
  );
}

function King({ tint, suit }: { tint: string; suit: Suit }) {
  const grey = '#ece8de';
  return (
    <>
      {/* robe: suit-tint half and royal-blue half, gold centre band */}
      <path d="M2 66C2 50 9 43 21 40.500L39 40.500C51 43 58 50 58 66Z" fill={tint} />
      <path d="M30 40.500H39C51 43 58 50 58 66H30Z" fill={BLUE} />
      <path d="M28.600 40.500h2.800V66h-2.800z" fill={GOLD} />
      <g className="fine" stroke="none">
        <path d="M14 52l3 3.600-3 3.600-3-3.600zM22.500 58l2.600 3.100-2.600 3.100-2.600-3.100zM6.500 59l2.600 3.100-2.600 3.100-2.600-3.100z" fill={GOLD} />
        <g fill={WHITE}>
          <circle cx="40" cy="55" r="1.300" />
          <circle cx="47.500" cy="52" r="1.300" />
          <circle cx="36.500" cy="62" r="1.300" />
          <circle cx="45" cy="60" r="1.300" />
          <circle cx="52.500" cy="59" r="1.300" />
        </g>
        <path d="M21 40.500C11 43 4 49 3.200 60M39 40.500C49 43 56 49 56.800 60" fill="none" stroke={GOLD} strokeWidth="1.600" />
      </g>
      {/* sceptre-sword on the right */}
      <path d="M49.500 40V8.500L51.500 4.500 53.500 8.500V40z" fill="#e3e8ef" />
      <path d="M51.500 7V38" fill="none" stroke="#9aa6b6" strokeWidth=".6" />
      <rect x="46" y="40" width="11" height="2.800" rx="1.100" fill={GOLD} />
      <rect x="50.300" y="42.800" width="2.400" height="7" fill={tint} />
      <circle cx="51.500" cy="52" r="1.700" fill={GOLD} />
      {/* neck + ermine collar */}
      <path d="M26 33h8v9h-8z" fill={SKIN} />
      <path d="M16.500 40.500C20 46 40 46 43.500 40.500L46 44.500C40 54 20 54 14 44.500Z" fill={WHITE} />
      <g className="fine" stroke="none" fill={INK}>
        <path d="M20.500 47l.9 2.600h-1.800zM30 50.300l.9 2.600h-1.800zM39.500 47l.9 2.600h-1.800zM25 49.200l.8 2.200h-1.600zM35 49.200l.8 2.200h-1.600z" />
      </g>
      {/* hair and face */}
      <path d="M20.500 24C20 12 40 12 39.500 24L41 36 30 34 19 36Z" fill={grey} />
      <Face brow />
      {/* moustache and beard */}
      <path d="M21.200 27.500C21 37 25 43 30 43.500 35 43 39 37 38.800 27.500 36.500 33 33.500 33.200 30 33.300 26.500 33.200 23.500 33 21.200 27.500Z" fill={grey} />
      <path d="M30 31.300C27 30 24 31.500 23.200 29.800 25 29 28 29.200 30 30.400 32 29.200 35 29 36.800 29.800 36 31.500 33 30 30 31.300Z" fill={grey} />
      <path d="M28.400 36q1.600 1 3.200 0" fill="none" strokeWidth=".5" strokeLinecap="round" />
      {/* crown */}
      <path d="M20.500 19.500 18.800 7.500 25 12.800 30 4.500 35 12.800 41.200 7.500 39.500 19.500Z" fill={GOLD} />
      <path d="M20.200 17.200h19.600v3H20.200z" fill={GOLD_DK} />
      <g stroke="none">
        <circle cx="18.800" cy="7" r="1.500" fill={WHITE} />
        <circle cx="30" cy="4" r="1.600" fill={WHITE} />
        <circle cx="41.200" cy="7" r="1.500" fill={WHITE} />
        <circle cx="25" cy="18.700" r="1.100" fill={tint} />
        <circle cx="30" cy="18.700" r="1.100" fill={BLUE} />
        <circle cx="35" cy="18.700" r="1.100" fill={tint} />
      </g>
            <Pip suit={suit} tint={tint} />
    </>
  );
}

function Queen({ tint, suit }: { tint: string; suit: Suit }) {
  const hair = '#e9a91f';
  return (
    <>
      {/* gown */}
      <path d="M5 66C5 51 11 44 22 41.500L38 41.500C49 44 55 51 55 66Z" fill={BLUE} />
      <path d="M30 41.500H38C49 44 55 51 55 66H30Z" fill={tint} />
      <path d="M28.600 41.500h2.800V66h-2.800z" fill={GOLD} />
      <g className="fine" stroke="none">
        <g fill={GOLD}>
          <circle cx="12" cy="54" r="1.400" />
          <circle cx="19" cy="59" r="1.400" />
          <circle cx="11" cy="62" r="1.400" />
          <circle cx="24" cy="52" r="1.400" />
          <path d="M40 54l2.800 3.200-2.800 3.200-2.800-3.200zM48 58l2.400 2.800-2.400 2.800-2.400-2.800z" />
        </g>
      </g>
      {/* long hair behind shoulders */}
      <path d="M19 25C15 35 15.500 46 21 52L26 40H34L39 52C44.500 46 45 35 41 25Z" fill={hair} />
      <path d="M26 33h8v10h-8z" fill={SKIN} />
      {/* necklace collar */}
      <path d="M20 43.500C25 49 35 49 40 43.500L38 41C34 45 26 45 22 41Z" fill={WHITE} />
      <g className="fine" stroke="none" fill={GOLD}>
        <circle cx="24" cy="46.300" r="1" />
        <circle cx="27" cy="47.500" r="1" />
        <circle cx="30" cy="48" r="1.300" fill={tint} />
        <circle cx="33" cy="47.500" r="1" />
        <circle cx="36" cy="46.300" r="1" />
      </g>
      {/* hair frame + face */}
      <path d="M20.500 26C19 13 41 13 39.500 26 38 21 34 17 30 17 26 17 22 21 20.500 26Z" fill={hair} />
      <Face rx={7.700} ry={9.100} brow={false} />
      <path d="M26.500 23.200q1.800-1 3.200 0M30.300 23.200q1.400-1 3.200 0" fill="none" strokeWidth=".5" strokeLinecap="round" />
      <path d="M28 31.600q2 1.600 4 0" fill="none" stroke={tint} strokeWidth="1.100" strokeLinecap="round" />
      {/* crown with three lobes */}
      <path d="M22 19 20.500 9.500 25.800 13.800 30 7 34.200 13.800 39.500 9.500 38 19Z" fill={GOLD} />
      <path d="M21.800 17h16.400v2.600H21.800z" fill={GOLD_DK} />
      <g stroke="none">
        <circle cx="20.500" cy="9" r="1.400" fill={WHITE} />
        <circle cx="30" cy="6.500" r="1.500" fill={tint} />
        <circle cx="39.500" cy="9" r="1.400" fill={WHITE} />
        <circle cx="26" cy="18.300" r="1" fill={BLUE} />
        <circle cx="30" cy="18.300" r="1" fill={tint} />
        <circle cx="34" cy="18.300" r="1" fill={BLUE} />
      </g>
      {/* flower held at the shoulder */}
      <path d="M47 62V50" fill="none" strokeWidth="1" strokeLinecap="round" />
      <path d="M47 58c-3-.5-4.500-2-5-4 2.500-.2 4.500.8 5 4zM47 56c3-.5 4.500-2 5-4-2.500-.2-4.500.8-5 4z" fill={BLUE} strokeWidth=".5" />
      <g strokeWidth=".6">
        <circle cx="47" cy="45.300" r="2.700" fill={tint} />
        <circle cx="43.900" cy="48" r="2.700" fill={tint} />
        <circle cx="50.100" cy="48" r="2.700" fill={tint} />
        <circle cx="47" cy="48.500" r="2.200" fill={tint} />
        <circle cx="47" cy="47.500" r="1.500" fill={GOLD} />
      </g>
      <Pip suit={suit} tint={tint} />
    </>
  );
}

function Jack({ tint, suit }: { tint: string; suit: Suit }) {
  const hair = '#5a341c';
  return (
    <>
      {/* tunic */}
      <path d="M7 66C7 53 12 46 23 43L37 43C48 46 53 53 53 66Z" fill={tint} />
      <path d="M30 43H37C48 46 53 53 53 66H30Z" fill={BLUE} />
      <path d="M28.800 43h2.400v23h-2.400z" fill={GOLD} />
      <g className="fine" stroke="none" fill={GOLD}>
        <circle cx="30" cy="52" r="1.300" stroke={INK} strokeWidth=".4" />
        <circle cx="30" cy="58" r="1.300" stroke={INK} strokeWidth=".4" />
        <path d="M14 55l2.600 3-2.600 3-2.600-3zM21 60l2.200 2.600-2.200 2.600-2.200-2.600z" />
        <g fill={WHITE}>
          <circle cx="40" cy="55" r="1.200" />
          <circle cx="46.500" cy="59" r="1.200" />
          <circle cx="37" cy="61" r="1.200" />
        </g>
      </g>
      <path d="M26.500 35h7v9h-7z" fill={SKIN} />
      {/* open collar */}
      <path d="M21 44.500 30 51 39 44.500 36.500 42.500 30 47.300 23.500 42.500Z" fill={WHITE} />
      {/* hair bob, face */}
      <path d="M21.500 22C21 36 22.500 37 23 37.500L30 34 37 37.500C37.500 37 39 36 38.500 22Z" fill={hair} />
      <Face rx={7.200} ry={8.300} cy={28} brow={false} />
      <path d="M28.200 33.500q1.800 1.200 3.600 0" fill="none" strokeWidth=".6" strokeLinecap="round" />
      {/* floppy cap with band and long feather */}
      <path d="M40 15C49 5 57 12 54 26 53 19 49 15 40 17Z" fill={WHITE} />
      <path d="M41 16C48 11 52 15 53.500 23" fill="none" stroke={tint} strokeWidth="1" strokeLinecap="round" />
      <path d="M19.500 22C17 9 26 3.500 34 5 41 6.500 43.500 13 41 22Z" fill={tint} />
      <path d="M19.300 18.500h22.200l.4 4H19.600z" fill={GOLD} />
      <g className="fine" stroke="none">
        <circle cx="26" cy="10.500" r="1.100" fill={GOLD} />
        <circle cx="32" cy="9" r="1.100" fill={GOLD} />
        <circle cx="36.800" cy="12.400" r="1.100" fill={GOLD} />
      </g>
      <Pip suit={suit} tint={tint} />
    </>
  );
}

const FIGURE: Record<CourtRank, typeof King> = { J: Jack, Q: Queen, K: King };

export function CourtArt({ rank, suit }: { rank: CourtRank; suit: Suit }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const tint = suit === 'H' || suit === 'D' ? RED : BLACK;
  const Fig = FIGURE[rank];
  const half: ReactNode = (
    <g clipPath={`url(#cl${uid})`} stroke={INK} strokeWidth=".8" strokeLinejoin="round">
      <Fig tint={tint} suit={suit} />
    </g>
  );
  return (
    <svg className="art" viewBox="0 0 60 108" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={`cl${uid}`}>
          <path d="M0 0H60V48L0 60Z" />
        </clipPath>
        <clipPath id={`pn${uid}`}>
          <rect x="1.500" y="1.500" width="57" height="105" rx="3" />
        </clipPath>
        <g id={`h${uid}`}>{half}</g>
      </defs>
      <rect x=".5" y=".5" width="59" height="107" rx="3.500" fill="#fbf6e8" stroke={INK} strokeWidth="1" />
      <g clipPath={`url(#pn${uid})`}>
        <use href={`#h${uid}`} />
        <use href={`#h${uid}`} transform="rotate(180 30 54)" />
        {/* diagonal divider */}
        <path d="M0 60 60 48" stroke={INK} strokeWidth=".9" />
      </g>
      <rect x="2.600" y="2.600" width="54.800" height="102.800" rx="2.600" fill="none" stroke={tint} strokeWidth=".7" className="fine" />
    </svg>
  );
}
