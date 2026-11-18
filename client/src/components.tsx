import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { type Card, type RulesConfig, type Suit, DEFAULT_RULES, SUIT_NAME, isBlackJack, isRedSuit } from '@shared/engine';
import type { Avatar as AvatarT } from '@shared/protocol';
import { takeOver, useApp } from './store';
import { navigate } from './router';
import { CourtArt } from './CourtArt';
import { AVATAR_ICON_ART, markColour } from './avatarIcons';
import { SUIT_PATH } from './suitPaths';
import { isMuted, setMuted, subscribeMuted } from './sound';

// ------------------------------------------------------------------ suits and cards

export function SuitIcon({ suit, className }: { suit: Suit; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true" focusable="false">
      {SUIT_PATH[suit]}
    </svg>
  );
}

export function cardName(c: Pick<Card, 'rank' | 'suit'>): string {
  const r = { A: 'ace', J: 'jack', Q: 'queen', K: 'king' }[c.rank as string] ?? c.rank;
  return `${r} of ${SUIT_NAME[c.suit].toLowerCase()}`;
}

/** Short effect tag shown on power cards so players learn them. */
export function powerTag(c: Card, rules: RulesConfig = DEFAULT_RULES): { text: string; danger: boolean } | null {
  switch (c.rank) {
    case '2':
      return { text: `+${rules.twoPenalty}`, danger: true };
    case '7':
      return { text: 'SKIP', danger: false };
    case '8':
      return { text: 'REV', danger: false };
    case 'J':
      return isBlackJack(c) ? { text: `+${rules.blackJackPenalty}`, danger: true } : { text: 'BLOCK', danger: false };
    case 'A':
      return { text: 'WILD', danger: false };
    default:
      return null;
  }
}

/** Standard pip positions for 2-10 inside the pip box: [x, y] with x in {0, .5, 1} and y from 0 (top) to 1. */
const PIP_LAYOUT: Record<string, Array<[number, number]>> = {
  '2': [[0.5, 0], [0.5, 1]],
  '3': [[0.5, 0], [0.5, 0.5], [0.5, 1]],
  '4': [[0, 0], [1, 0], [0, 1], [1, 1]],
  '5': [[0, 0], [1, 0], [0.5, 0.5], [0, 1], [1, 1]],
  '6': [[0, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  '7': [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  '8': [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0.5, 0.75], [0, 1], [1, 1]],
  '9': [[0, 0], [1, 0], [0, 1 / 3], [1, 1 / 3], [0.5, 0.5], [0, 2 / 3], [1, 2 / 3], [0, 1], [1, 1]],
  '10': [[0, 0], [1, 0], [0.5, 1 / 6], [0, 1 / 3], [1, 1 / 3], [0, 2 / 3], [1, 2 / 3], [0.5, 5 / 6], [0, 1], [1, 1]],
};

export function CardFace({ card, rules, className = '', style }: { card: Card; rules?: RulesConfig; className?: string; style?: CSSProperties }) {
  const tag = powerTag(card, rules);
  const court = card.rank === 'J' || card.rank === 'Q' || card.rank === 'K' ? card.rank : null;
  // The king of spades uses the photographed panel; the other court cards are drawn.
  const kingArt = card.rank === 'K' && card.suit === 'S';
  const index = (
    <>
      <b>{card.rank}</b>
      <SuitIcon suit={card.suit} />
    </>
  );
  return (
    <div className={`card face ${PIP_LAYOUT[card.rank] ? 'num' : ''} ${isRedSuit(card.suit) ? 'red' : 'black'} ${court ? `court court-${court}` : ''} ${card.rank === 'A' ? 'ace' : ''} ${className}`} style={style}>
      {court && (kingArt ? <img className="art" src="/art/king-spades-art.webp" alt="" draggable={false} /> : <CourtArt rank={court} suit={card.suit} />)}
      <span className="corner">{index}</span>
      <span className="corner br" aria-hidden="true">
        {index}
      </span>
      <SuitIcon suit={card.suit} className="pip" />
      {PIP_LAYOUT[card.rank] && (
        <span className="pips" aria-hidden="true">
          {PIP_LAYOUT[card.rank].map(([x, y], i) => (
            <svg key={i} viewBox="0 0 24 24" className={y > 0.5 ? 'flip' : ''} style={{ left: `${x * 100}%`, top: `${y * 100}%` }} fill="currentColor" focusable="false">
              {SUIT_PATH[card.suit]}
            </svg>
          ))}
        </span>
      )}
      {tag && <span className={`tag ${tag.danger ? 'danger' : ''}`} data-tag={tag.text}>{tag.text}</span>}
    </div>
  );
}

export function CardBack({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return (
    <div className={`card back ${className}`} style={style} aria-hidden="true" />
  );
}

// ------------------------------------------------------------------ people

export function Avatar({ avatar, size = 44, className = '' }: { avatar: AvatarT; size?: number; className?: string }) {
  return (
    <span className={`avatar ${className}`} style={{ background: avatar.color, color: markColour(avatar.color), width: size, height: size, fontSize: size * 0.54 }} aria-hidden="true">
      {avatar.icon && AVATAR_ICON_ART[avatar.icon] ? (
        <svg viewBox="0 0 24 24" fill="currentColor" width="58%" height="58%" focusable="false">
          {AVATAR_ICON_ART[avatar.icon]}
        </svg>
      ) : (
        (avatar.emoji ?? (avatar.icon ? avatar.icon[0].toUpperCase() : '?'))
      )}
    </span>
  );
}

// ------------------------------------------------------------------ chrome

/** The brand tile: black wordmark on a white, tilted, rounded tile. */
export function LogoTile({ className = '' }: { className?: string }) {
  return (
    <span className={`logo-tile ${className}`}>
      <img src="/logo-white.png" alt="Crypto Jakk" width={900} height={646} />
    </span>
  );
}
export function Logo({ className = '' }: { className?: string }) {
  return <LogoTile className={className} />;
}

export function Sheet({ open, onClose, title, children, tall = false, variant }: { open: boolean; onClose: () => void; title: string; children: ReactNode; tall?: boolean; variant?: 'menu' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      // Keep Tab inside the dialog (keyboard users should not wander onto the table behind it).
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, [tabindex]:not([tabindex="-1"])'));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === ref.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  if (variant === 'menu') {
    // Site menu: ivory card-stock panel with a green suit rail down the left, logo, slab-serif title.
    return (
      <div className="sheet-wrap" onClick={onClose}>
        <div ref={ref} tabIndex={-1} className="sheet menu-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
          <div className="menu-paper" aria-hidden="true">
            <div />
          </div>
          <div className="menu-rail" aria-hidden="true">
            {(['S', 'H', 'D', 'C'] as const).map((su) => (
              <svg key={su} viewBox="0 0 24 24" focusable="false">
                {SUIT_PATH[su]}
              </svg>
            ))}
          </div>
          <div className="menu-main">
            <button className="menu-close" onClick={onClose} aria-label="Close">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
            <img className="menu-logo" src="/logo-black.png" alt="" width={900} height={646} />
            <h2>{title}</h2>
            <div className="sheet-body">{children}</div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div ref={ref} tabIndex={-1} className={`sheet ${tall ? 'tall' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function Banner() {
  const { conn, online } = useApp();
  // Don't flash "Connecting..." on a fast first connect.
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    if (conn !== 'connecting') return;
    const t = setTimeout(() => setLate(true), 900);
    return () => clearTimeout(t);
  }, [conn]);
  let text: ReactNode = null;
  let kind = 'info';
  if (conn === 'taken') {
    kind = 'warn';
    text = (
      <>
        Opened in another tab or device.{' '}
        <button className="banner-btn" onClick={takeOver}>
          Use here
        </button>
      </>
    );
  } else if (!online) {
    kind = 'warn';
    text = "You're offline. We'll reconnect when you are back.";
  } else if (conn === 'reconnecting') text = 'Reconnecting...';
  else if (conn === 'connecting' && late) text = 'Connecting...';
  if (!text) return null;
  return (
    <div className={`banner ${kind}`} role="status" aria-live="polite">
      {text}
    </div>
  );
}

export function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  return (
    <div className="toast" role="status" aria-live="polite" key={toast.id}>
      {toast.text}
    </div>
  );
}

export function BackButton({ onClick, label = 'Back' }: { onClick: () => void; label?: string }) {
  return (
    <button className="hdr-btn back-btn" onClick={onClick} aria-label={label}>
      <Icon name="back" />
    </button>
  );
}

// ------------------------------------------------------------------ desktop helpers

/** Live `matchMedia` flag. */
export function useMedia(query: string): boolean {
  const sub = (cb: () => void) => {
    const m = window.matchMedia(query);
    m.addEventListener('change', cb);
    return () => m.removeEventListener('change', cb);
  };
  return useSyncExternalStore(sub, () => window.matchMedia(query).matches, () => false);
}

/** A small keyboard-key hint. Hidden below desktop widths by CSS. */
export function Kbd({ k, className = '' }: { k: string; className?: string }) {
  return (
    <kbd className={`kh ${className}`} aria-hidden="true">
      {k}
    </kbd>
  );
}

export const SHORTCUTS: Array<{ keys: string[]; text: string }> = [
  { keys: ['1', '-', '9'], text: 'Pick card by position' },
  { keys: ['←', '→'], text: 'Move between cards' },
  { keys: ['Enter', 'Space'], text: 'Select the focused card' },
  { keys: ['P'], text: 'Play selection' },
  { keys: ['D'], text: 'Draw / pick up' },
  { keys: ['J'], text: 'Call or arm JAKK' },
  { keys: ['Esc'], text: 'Clear selection / close' },
  { keys: ['?'], text: 'How to play' },
];

export function KeyList({ className = '' }: { className?: string }) {
  return (
    <dl className={`keylist ${className}`}>
      {SHORTCUTS.map((s) => (
        <div key={s.text}>
          <dt>
            {s.keys.map((k, i) => (k === '-' ? <span key={i}>to</span> : <kbd key={i}>{k}</kbd>))}
          </dt>
          <dd>{s.text}</dd>
        </div>
      ))}
    </dl>
  );
}

// ------------------------------------------------------------------ icons

const ICONS: Record<string, ReactNode> = {
  spade: <path d="M12 2.800c3.400 4.200 7.500 6.200 7.500 10.200a3.700 3.700 0 0 1-6.300 2.600c0 2 .4 3.700 1.600 5.600H9.200c1.200-1.900 1.600-3.600 1.600-5.600A3.700 3.700 0 0 1 4.500 13c0-4 4.100-6 7.500-10.200z" />,
  bolt: <path d="M13.500 2 4.500 13.500H11l-1 8.500 9-11.500h-6.500z" />,
  layers: (
    <>
      <path d="m12 3 9 4.800-9 4.800-9-4.800z" />
      <path d="m3 12 9 4.800 9-4.800" />
      <path d="m3 16.200 9 4.800 9-4.800" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4.500 6v5.500c0 4.600 3.200 8 7.500 9.500 4.300-1.500 7.500-4.900 7.500-9.500V6z" />
      <path d="m8.800 12 2.400 2.400 4.200-4.600" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.200" />
      <path d="M2.800 20c0-3.400 2.800-6 6.200-6s6.200 2.600 6.200 6" />
      <circle cx="17.200" cy="9" r="2.500" />
      <path d="M16.800 14.100c2.600.3 4.400 2.500 4.400 5.400" />
    </>
  ),
  cards: (
    <>
      <rect x="4" y="4.500" width="11" height="15" rx="2" transform="rotate(-8 9.500 12)" />
      <path d="M17 7.200c1.600.6 2.400 1.200 2.200 3l-1 8.500-3.300.5" />
      <path d="M9.400 9.600c1.200 1.500 2.400 2 2.400 3.200a1.200 1.200 0 0 1-2 .8c0 .7.100 1.200.5 1.800H8c.4-.6.5-1.100.5-1.800a1.200 1.200 0 0 1-2-.8c0-1.200 1.200-1.700 2.900-3.200z" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.500 21c0-4.200 3.400-7 7.500-7s7.500 2.800 7.500 7" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.200" />
      <path d="M12 2.500v3M12 18.500v3M2.500 12h3M18.500 12h3M5.300 5.300l2.100 2.100M16.600 16.600l2.100 2.100M18.700 5.300l-2.100 2.100M7.400 16.600l-2.100 2.100" />
    </>
  ),
  sound: (
    <>
      <path d="M4 9.500v5h3.800l5.200 4V5.500l-5.200 4z" />
      <path d="M16 9a4.200 4.200 0 0 1 0 6M18.600 6.400a8 8 0 0 1 0 11.200" />
    </>
  ),
  mute: (
    <>
      <path d="M4 9.500v5h3.800l5.200 4V5.500l-5.200 4z" />
      <path d="m16.500 9.500 4.500 5M21 9.500l-4.500 5" />
    </>
  ),
  motion: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  door: <path d="M9.500 4H5v16h4.500M15.500 8l4 4-4 4M19.500 12H9" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.500 9.600a2.600 2.600 0 1 1 3.600 2.400c-.8.500-1.100 1-1.100 1.800M12 17v.4" />
    </>
  ),
  lock: (
    <>
      <rect x="5.500" y="10.500" width="13" height="10" rx="2" />
      <path d="M8.500 10.500V8a3.500 3.500 0 0 1 7 0v2.500" />
    </>
  ),
  hash: <path d="M5 9h14M5 15h14M10.200 4 8.800 20M15.200 4l-1.400 16" />,
  phone: (
    <>
      <rect x="7" y="2.800" width="10" height="18.400" rx="2" />
      <path d="M11 18h2" />
    </>
  ),
  bot: (
    <>
      <rect x="4.500" y="8" width="15" height="11" rx="3" />
      <path d="M12 4v4M9.200 13h.01M14.800 13h.01M2.500 13v2M21.500 13v2" />
    </>
  ),
  link: <path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.500M12 7.600v.01" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  back: <path d="m14.500 5.500-6.500 6.500 6.500 6.500" />,
  next: <path d="m9 5.500 6.500 6.500L9 18.500" />,
  down: <path d="m5.500 9.500 6.500 6.500 6.500-6.500" />,
  plus: <path d="M12 5v14M5 12h14" />,
  home: <path d="M4 11 12 4l8 7v9h-5.500v-6h-5v6H4z" />,
};

export function Icon({ name, className = '' }: { name: keyof typeof ICONS | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`ico ${className}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICONS[name]}
    </svg>
  );
}

// ------------------------------------------------------------------ casino chips (decoration only)

/** A photographed stack of casino chips: five red or three black. */
export function ChipStack({ color = 'red', className = '', style }: { color?: 'red' | 'black'; className?: string; style?: CSSProperties }) {
  return <img src={`/art/chips-${color}.webp`} alt="" className={`chip-stack ${className}`} style={style} aria-hidden="true" draggable={false} />;
}

/** A drifting group of chip stacks pinned to the edges of a screen. Pure decoration. */
export function DecoChips({ variant = 'bottom' }: { variant?: 'bottom' | 'corners' | 'sides' | 'table' }) {
  if (variant === 'sides') {
    return (
      <div className="deco deco-sides" aria-hidden="true">
        <img src="/art/chips-group.webp" alt="" className="chip-group l" draggable={false} />
        <img src="/art/chips-group.webp" alt="" className="chip-group r" draggable={false} />
      </div>
    );
  }
  return (
    <div className={`deco deco-${variant}`} aria-hidden="true">
      <ChipStack color="red" className="d1" />
      <ChipStack color="black" className="d2" />
      <ChipStack color="red" className="d3" />
      <ChipStack color="black" className="d4" />
    </div>
  );
}

// ------------------------------------------------------------------ header + menu

export function useMuted(): boolean {
  return useSyncExternalStore(subscribeMuted, isMuted, isMuted);
}

export function AppHeader({
  onBack,
  backLabel = 'Back',
  inGame = false,
  onLeave,
  onRules,
  menuOpen,
  onMenuOpen,
  extra,
  nav,
  left,
  className = '',
}: {
  onBack?: () => void;
  backLabel?: string;
  inGame?: boolean;
  onLeave?: () => void;
  onRules?: () => void;
  menuOpen?: boolean;
  onMenuOpen?: (o: boolean) => void;
  extra?: ReactNode;
  nav?: ReactNode;
  left?: ReactNode;
  className?: string;
}) {
  const [own, setOwn] = useState(false);
  const open = menuOpen ?? own;
  const setOpen = onMenuOpen ?? setOwn;
  const muted = useMuted();
  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };
  return (
    <>
      <header className={`hdr ${className}`}>
        <div className="hdr-l">{onBack ? <BackButton onClick={onBack} label={backLabel} /> : (left ?? <span className="hdr-sp" />)}</div>
        {inGame ? (
          // In a room the logo still leads home, but through the screen's leave flow (which confirms mid-game).
          <button type="button" className="hdr-logo" aria-label="Crypto Jakk home. Leave this game" onClick={() => (onLeave ? onLeave() : navigate('/'))}>
            <LogoTile />
          </button>
        ) : (
          <a className="hdr-logo" href="/" aria-label="Crypto Jakk home" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
            <LogoTile />
          </a>
        )}
        {nav}
        <div className="hdr-r">
          {extra}
          <button className="hdr-btn menu-btn" aria-label="Menu" aria-haspopup="dialog" onClick={() => setOpen(true)}>
            <Icon name="menu" />
          </button>
        </div>
      </header>
      <Sheet open={open} onClose={() => setOpen(false)} title="Menu" variant="menu">
        <div className="rows">
          <button
            className="row"
            onClick={() => {
              setOpen(false);
              if (onRules) onRules();
              else navigate('/how-to-play');
            }}
          >
            <Icon name="help" className="row-ico" />
            <span className="row-t">
              <strong>How to Play</strong>
              <small>Power cards, JAKK and the basics</small>
            </span>
            <Icon name="next" className="row-go" />
          </button>
          {!inGame && (
            <button className="row" onClick={() => go('/profile')}>
              <Icon name="user" className="row-ico" />
              <span className="row-t">
                <strong>Profile &amp; Settings</strong>
                <small>Name, avatar, sound, animation</small>
              </span>
              <Icon name="next" className="row-go" />
            </button>
          )}
          <button className="row" onClick={() => setMuted(!muted)}>
            <Icon name={muted ? 'mute' : 'sound'} className="row-ico" />
            <span className="row-t">
              <strong>Sound</strong>
              <small>{muted ? 'Off' : 'On'}</small>
            </span>
            <Icon name="next" className="row-go" />
          </button>
          {inGame && onLeave && (
            <button
              className="row danger"
              onClick={() => {
                setOpen(false);
                onLeave();
              }}
            >
              <Icon name="door" className="row-ico" />
              <span className="row-t">
                <strong>Leave game</strong>
                <small>Head back to the main menu</small>
              </span>
              <Icon name="next" className="row-go" />
            </button>
          )}
        </div>
      </Sheet>
    </>
  );
}
