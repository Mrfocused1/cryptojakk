import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { type Card, type RulesConfig, type Suit, DEFAULT_RULES, SUIT_NAME, isBlackJack, isRedSuit } from '@shared/engine';
import type { Avatar as AvatarT } from '@shared/protocol';
import { takeOver, useApp } from './store';
import { navigate } from './router';
import { isMuted, setMuted, subscribeMuted } from './sound';

// ------------------------------------------------------------------ suits and cards

const SUIT_PATH: Record<Suit, ReactNode> = {
  S: <path d="M12 1.6C9.2 6 3.6 9.4 3.6 14.2a4.3 4.3 0 0 0 7 3.3c-.1 1.700-.7 3.200-1.900 4.900h6.600c-1.200-1.700-1.800-3.200-1.900-4.900a4.300 4.300 0 0 0 7-3.300C20.400 9.400 14.800 6 12 1.600z" />,
  H: <path d="M12 22C4.600 16.400 2 12.600 2 8.900A5 5 0 0 1 12 6.700 5 5 0 0 1 22 8.900c0 3.700-2.600 7.500-10 13.100z" />,
  D: <path d="M12 1.500 20.500 12 12 22.500 3.500 12z" />,
  C: (
    <>
      <circle cx="12" cy="6.800" r="4.800" />
      <circle cx="6.200" cy="14" r="4.800" />
      <circle cx="17.800" cy="14" r="4.800" />
      <path d="M12 11 9.600 22.200h4.800z" />
    </>
  ),
};

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

export function CardFace({ card, rules, className = '', style }: { card: Card; rules?: RulesConfig; className?: string; style?: CSSProperties }) {
  const tag = powerTag(card, rules);
  return (
    <div className={`card ${isRedSuit(card.suit) ? 'red' : 'black'} ${className}`} style={style}>
      <span className="corner">
        <b>{card.rank}</b>
        <SuitIcon suit={card.suit} />
      </span>
      <SuitIcon suit={card.suit} className="pip" />
      {tag && <span className={`tag ${tag.danger ? 'danger' : ''}`}>{tag.text}</span>}
    </div>
  );
}

export function CardBack({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return (
    <div className={`card back ${className}`} style={style} aria-hidden="true">
      <span className="back-frame">
        <SuitIcon suit="S" />
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ people

export function Avatar({ avatar, size = 44, className = '' }: { avatar: AvatarT; size?: number; className?: string }) {
  return (
    <span className={`avatar ${className}`} style={{ background: avatar.color, width: size, height: size, fontSize: size * 0.54 }} aria-hidden="true">
      {avatar.emoji ?? (avatar.icon ? avatar.icon[0].toUpperCase() : '?')}
    </span>
  );
}

// ------------------------------------------------------------------ chrome

/** The brand tile: black wordmark on a white, tilted, rounded tile. */
export function LogoTile({ className = '' }: { className?: string }) {
  return (
    <span className={`logo-tile ${className}`}>
      <img src="/logo-mark-black.png" alt="Crypto Jakk" width={709} height={405} />
    </span>
  );
}
export function Logo({ className = '' }: { className?: string }) {
  return <LogoTile className={className} />;
}

export function Sheet({ open, onClose, title, children, tall = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; tall?: boolean }) {
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

/** Shared gradients for every chip. Rendered once at the app root. */
export function ChipDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="cj-red-top" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#ef4a47" />
          <stop offset="1" stopColor="#a5141b" />
        </linearGradient>
        <linearGradient id="cj-red-side" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#6d0a10" />
          <stop offset="0.45" stopColor="#c01f27" />
          <stop offset="1" stopColor="#5a070c" />
        </linearGradient>
        <linearGradient id="cj-black-top" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#4a504d" />
          <stop offset="1" stopColor="#101312" />
        </linearGradient>
        <linearGradient id="cj-black-side" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#050606" />
          <stop offset="0.45" stopColor="#3a3f3d" />
          <stop offset="1" stopColor="#040505" />
        </linearGradient>
      </defs>
    </svg>
  );
}

const CRX = 92;
const CRY = 33;
const CH = 15;

/** A stack of `n` chips seen from slightly above: coloured top, edge inserts, inner ring, shaded side. */
export function ChipStack({ color = 'red', n = 5, className = '', style }: { color?: 'red' | 'black'; n?: number; className?: string; style?: CSSProperties }) {
  const uid = useId().replace(/:/g, '');
  const H = CRY * 2 + 12 + n * CH;
  const cx = 100;
  const stripes = [24, 58, 90, 122, 156].map((deg) => {
    const t = (deg * Math.PI) / 180;
    return { x: cx - CRX * Math.cos(t), y: CRY * Math.sin(t), w: 4 + 13 * Math.sin(t) };
  });
  const chips = [];
  for (let i = 0; i < n; i++) {
    const cy = 6 + CRY + (n - 1 - i) * CH;
    chips.push(
      <g key={i}>
        <clipPath id={`${uid}c${i}`}>
          <path d={`M${cx - CRX} ${cy} a${CRX} ${CRY} 0 0 0 ${CRX * 2} 0 v${CH} a${CRX} ${CRY} 0 0 1 ${-CRX * 2} 0z`} />
        </clipPath>
        <path d={`M${cx - CRX} ${cy} a${CRX} ${CRY} 0 0 0 ${CRX * 2} 0 v${CH} a${CRX} ${CRY} 0 0 1 ${-CRX * 2} 0z`} fill={`url(#cj-${color}-side)`} />
        <g clipPath={`url(#${uid}c${i})`}>
          {stripes.map((st, k) => (
            <rect key={k} x={st.x - st.w / 2} y={cy + st.y - 1} width={st.w} height={CH + 2} fill="#f6efe2" opacity="0.96" />
          ))}
          <rect x="0" y={cy + CRY} width="200" height={CH} fill="#000" opacity="0.1" />
        </g>
        <ellipse cx={cx} cy={cy} rx={CRX} ry={CRY} fill={`url(#cj-${color}-top)`} />
        <ellipse cx={cx} cy={cy} rx={CRX - 5} ry={CRY - 2} fill="none" stroke="#f6efe2" strokeWidth="7" strokeDasharray="21 29" opacity="0.96" />
        <ellipse cx={cx} cy={cy} rx={CRX - 1} ry={CRY - 0.5} fill="none" stroke="#000" strokeOpacity="0.25" strokeWidth="1.5" />
        <ellipse cx={cx} cy={cy} rx={CRX * 0.66} ry={CRY * 0.66} fill="none" stroke="#f6efe2" strokeWidth="2" opacity="0.9" />
        <ellipse cx={cx} cy={cy} rx={CRX * 0.6} ry={CRY * 0.6} fill="#000" fillOpacity="0.14" />
      </g>,
    );
  }
  return (
    <svg viewBox={`0 0 200 ${H}`} className={`chip-stack ${className}`} style={style} aria-hidden="true" focusable="false">
      {chips}
    </svg>
  );
}

/** A drifting group of chip stacks pinned to the edges of a screen. Pure decoration. */
export function DecoChips({ variant = 'bottom' }: { variant?: 'bottom' | 'corners' | 'sides' | 'table' }) {
  return (
    <div className={`deco deco-${variant}`} aria-hidden="true">
      <ChipStack color="red" n={6} className="d1" />
      <ChipStack color="black" n={4} className="d2" />
      <ChipStack color="red" n={3} className="d3" />
      <ChipStack color="black" n={5} className="d4" />
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
          <span className="hdr-logo">
            <LogoTile />
          </span>
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
      <Sheet open={open} onClose={() => setOpen(false)} title="Menu">
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
