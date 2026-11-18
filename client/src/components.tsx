import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { type Card, type RulesConfig, type Suit, DEFAULT_RULES, SUIT_NAME, isBlackJack, isRedSuit } from '@shared/engine';
import type { Avatar as AvatarT } from '@shared/protocol';
import { takeOver, useApp } from './store';

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

export function Logo({ className = '', white = true }: { className?: string; white?: boolean }) {
  return <img className={`logo ${className}`} src={white ? '/logo-white.png' : '/logo-black.png'} alt="Crypto Jakk" width={900} height={646} />;
}

export function Sheet({ open, onClose, title, children, tall = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; tall?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
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
    <button className="back-btn" onClick={onClick} aria-label={label}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="3.500" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{label}</span>
    </button>
  );
}
