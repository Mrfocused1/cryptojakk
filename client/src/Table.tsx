import { type CSSProperties, type ReactElement, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  type Card,
  type PlayerView,
  type Suit,
  SUIT_NAME,
  SUITS,
  getAddableCardIds,
  getLegalCardIds,
  needsSuitChoice,
  penaltyReason,
  previewPlay,
} from '@shared/engine';
import type { LobbyPlayer } from '@shared/protocol';
import { AppHeader, Avatar, CardBack, CardFace, Icon, KeyList, Kbd, Sheet, SuitIcon, cardName, useMedia } from './components';
import { InviteActions } from './Lobby';
import { HowToPlayContent } from './HowToPlay';
import { Results } from './Results';
import { act, leaveRoom, useApp, type Flight } from './store';
import { removeFlight } from './fx';
import { playSfx, unlockAudio } from './sound';

const RANK_ORDER = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUIT_ORDER: Suit[] = ['S', 'H', 'C', 'D'];

function sortHand(hand: Card[]): Card[] {
  return hand
    .slice()
    .sort((a, b) => SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit) || RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank));
}

// ------------------------------------------------------------------ flights + callout

function FlightEl({ f }: { f: Flight }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const dx = f.to.x - f.from.x;
    const dy = f.to.y - f.from.y;
    const s = f.to.w / f.from.w;
    const anim = el.animate(
      [
        { transform: 'translate(0px,0px) scale(1) rotate(0deg)' },
        { transform: `translate(${dx}px,${dy}px) scale(${s}) rotate(${f.rot}deg)` },
      ],
      { duration: f.dur, delay: f.delay, easing: 'cubic-bezier(.22,.8,.3,1)', fill: 'both' },
    );
    anim.onfinish = () => removeFlight(f.id);
    return () => anim.cancel();
  }, [f]);
  const style: CSSProperties = { left: f.from.x, top: f.from.y, width: f.from.w, height: f.from.h, ['--cw' as string]: `${f.from.w}px` };
  return (
    <div ref={ref} className="flight" style={style}>
      {f.card ? <CardFace card={f.card} style={{ ['--cw' as string]: `${f.from.w}px` }} /> : <CardBack style={{ ['--cw' as string]: `${f.from.w}px` }} />}
    </div>
  );
}

function FlightLayer() {
  const { flights } = useApp();
  return (
    <div className="flight-layer" aria-hidden="true">
      {flights.map((f) => (
        <FlightEl key={f.id} f={f} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ seats

function Seat({ player, count, active, jakk, dealing, slot }: { player: LobbyPlayer; count: number; active: boolean; jakk: boolean; dealing: boolean; slot: string }) {
  const shown = Math.min(count, 8);
  const away = !player.connected && !player.isBot;
  return (
    <div className={`gt-seat ${active ? 'active' : ''} ${away ? 'away' : ''}`} data-anchor={`seat-${player.playerId}`} data-testid={`seat-${player.playerId}`} data-slot={slot} style={{ ['--n' as string]: shown } as CSSProperties}>
      <div className="gt-plate">
        <Avatar avatar={player.avatar} size={38} className="gt-avatar" />
        <span className="gt-name">
          {player.name}
          {player.isBot && <small> (BOT)</small>}
          {away && <small className="off"> OFFLINE</small>}
        </span>
        <span className="gt-count" data-count={count}>
          {count}
        </span>
        {jakk && <span className="jakk-badge">JAKK!</span>}
      </div>
      <div className="gt-fan" aria-label={`${player.name} has ${count} cards`} style={{ ['--n' as string]: shown } as CSSProperties}>
        {Array.from({ length: shown }, (_, i) => (
          <CardBack key={i} className={dealing ? 'deal-in' : ''} style={{ ['--i' as string]: i } as CSSProperties} />
        ))}
      </div>
    </div>
  );
}

/**
 * The table's frame: a charcoal panel with concave (scooped) corners and a double emerald border, drawn as SVG
 * so the corners stay true circles at any size.
 */
function TableFrame() {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const { w, h } = box;
  const r = Math.max(24, Math.min(64, Math.round(Math.min(w, h) * 0.085)));
  const path = (i: number) => {
    const R = Math.max(4, r - i);
    return `M${R + i} ${i}H${w - R - i}A${R} ${R} 0 0 0 ${w - i} ${R + i}V${h - R - i}A${R} ${R} 0 0 0 ${w - R - i} ${h - i}H${R + i}A${R} ${R} 0 0 0 ${i} ${h - R - i}V${R + i}A${R} ${R} 0 0 0 ${R + i} ${i}Z`;
  };
  return (
    <div className="gt-frame" ref={ref} aria-hidden="true">
      {w > 0 && (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
          <defs>
            <radialGradient id="gt-felt" cx="50%" cy="45%" r="70%">
              <stop offset="0" stopColor="#15271f" />
              <stop offset="0.75" stopColor="#081511" />
              <stop offset="1" stopColor="#050f0b" />
            </radialGradient>
          </defs>
          <path d={path(1)} fill="url(#gt-felt)" stroke="#1a9a62" strokeWidth="2" />
          <path d={path(7)} fill="none" stroke="#4ee3a1" strokeOpacity="0.55" strokeWidth="1" />
        </svg>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ hand

interface HandCardProps {
  card: Card;
  index: number;
  left: number;
  top: number;
  z: number;
  legal: boolean;
  dim: boolean;
  selected: boolean;
  order: number;
  shake: boolean;
  hint: string;
  fresh: number | undefined;
  dealing: boolean;
  view: PlayerView;
  rot?: number;
  onTap: (c: Card) => void;
}

function HandCard({ card, index, left, top, z, legal, dim, selected, order, shake, hint, fresh, dealing, view, rot = 0, onTap }: HandCardProps) {
  const label = `${cardName(card)}${selected ? `, selected, play order ${order}` : legal ? ', playable' : dim ? ', not playable' : ''}`;
  const cls = ['hc', legal ? 'legal' : '', dim ? 'dim' : '', selected ? 'selected' : '', shake ? 'shake' : '', fresh !== undefined ? 'fresh' : '', dealing ? 'dealt' : ''].filter(Boolean).join(' ');
  const style: CSSProperties = { left, top, zIndex: selected ? 200 : z, rotate: rot ? `${rot.toFixed(2)}deg` : undefined, ['--i' as string]: index, ['--d' as string]: `${fresh ?? 0}ms` };
  return (
    <button className={cls} style={style} data-hand-card={card.id} data-legal={legal ? 'true' : 'false'} data-selected={selected ? 'true' : 'false'} aria-label={label} aria-pressed={selected} onClick={() => onTap(card)}>
      <CardFace card={card} rules={view.rules} />
      {selected && order > 0 && <span className="order">{order}</span>}
      {hint && <i className="kn" aria-hidden="true">{hint}</i>}
    </button>
  );
}

// ------------------------------------------------------------------ table

export function Table() {
  const app = useApp();
  const { view, room, dealing, callout, feed, topOverride, freshDelay } = app;
  const [sel, setSel] = useState<string[]>([]);
  const [armed, setArmed] = useState(false);
  const [suitOpen, setSuitOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [hint, setHint] = useState<{ id: number; text: string } | null>(null);
  const [shake, setShake] = useState<{ id: string; n: number } | null>(null);
  const [handW, setHandW] = useState(360);
  const handRef = useRef<HTMLDivElement>(null);
  const [showResults, setShowResults] = useState(false);
  const [suitHl, setSuitHl] = useState(0);
  const [kbd, setKbd] = useState(false);
  const [log, setLog] = useState<Array<{ id: number; text: string }>>([]);
  const logRef = useRef<HTMLOListElement>(null);
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const lastFocus = useRef(0);
  const isDesk = useMedia('(min-width: 1024px)');
  const isTab = useMedia('(min-width: 601px)');
  const [vh, setVh] = useState(() => window.innerHeight);
  useEffect(() => {
    const on = () => setVh(window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  const version = view?.version ?? -1;
  useEffect(() => {
    setSel([]);
    setArmed(false);
    setSuitOpen(false);
  }, [version]);

  const winner = view?.winner ?? null;
  useEffect(() => {
    if (!winner) {
      setShowResults(false);
      return;
    }
    const t = setTimeout(() => setShowResults(true), app.feed ? 900 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winner]);

  useLayoutEffect(() => {
    const el = handRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHandW(el.clientWidth));
    ro.observe(el);
    setHandW(el.clientWidth);
    return () => ro.disconnect();
  }, [!!view]);

  // Desktop side panel: a running log of the presentation queue's feed lines (newest at the bottom).
  const feedId = feed?.id;
  useEffect(() => {
    if (!feed) return;
    setLog((l) => (l.some((x) => x.id === feed.id) ? l : [...l.slice(-79), { id: feed.id, text: feed.text }]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedId]);
  const logSeeded = useRef(false);
  useEffect(() => {
    if (logSeeded.current || !view || !room) return;
    logSeeded.current = true;
    const first = room.players.find((p) => p.playerId === view.turn);
    const text = view.version === 0 ? `Cards dealt. ${view.turn === view.you ? 'You go' : `${first?.name ?? 'Someone'} goes`} first.` : 'Welcome back. Game on.';
    setLog((l) => [{ id: -1, text }, ...l]);
  }, [view, room]);
  useLayoutEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length, isDesk]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => keyRef.current(e);
    const off = () => setKbd(false);
    window.addEventListener('keydown', on);
    window.addEventListener('pointerdown', off);
    return () => {
      window.removeEventListener('keydown', on);
      window.removeEventListener('pointerdown', off);
    };
  }, []);

  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 1900);
    return () => clearTimeout(t);
  }, [hint]);

  const sorted = useMemo(() => (view ? sortHand(view.hand) : []), [view]);

  if (!view || !room) {
    return (
      <div className="screen table-screen center-msg">
        <p className="dealing-msg">Dealing...</p>
      </div>
    );
  }

  const me = view.you;
  const myTurn = view.turn === me && !view.winner;
  const legalSet = new Set(getLegalCardIds(view));
  const addableSet = new Set(getAddableCardIds(view, sel));
  const lit = sel.length ? addableSet : legalSet;
  const nameOf = (id: string) => room.players.find((p) => p.playerId === id)?.name ?? 'Player';
  const turnPlayer = room.players.find((p) => p.playerId === view.turn);

  const handCount = view.hand.length;
  const armable = view.rules.jakkEnabled && sel.length > 0 && handCount - sel.length === 1;
  const jakkArmed = armed && armable;
  const owed = view.jakkOwed === me;
  const preview = sel.length ? previewPlay(view, sel, view.rules.aceWild ? 'S' : undefined) : null;
  const canPlay = myTurn && !!preview && preview.ok;

  const say = (text: string) => setHint({ id: Date.now(), text });

  function tapCard(card: Card) {
    unlockAudio();
    if (sel.includes(card.id)) {
      const idx = sel.indexOf(card.id);
      let next = sel.filter((x) => x !== card.id);
      // The first card must be a legal start; if it was removed, re-check what is left.
      if (idx === 0 && next.length && !legalSet.has(next[0])) next = [];
      setSel(next);
      return;
    }
    if (lit.has(card.id)) {
      setSel([...sel, card.id]);
      playSfx('pop');
      return;
    }
    const r = previewPlay(view!, [...sel, card.id], view!.rules.aceWild ? 'S' : undefined);
    say(r.ok ? "You can't add that card" : r.reason);
    setShake({ id: card.id, n: Date.now() });
    setTimeout(() => setShake((s) => (s && s.id === card.id ? null : s)), 450);
  }

  function sendPlay(suit?: Suit) {
    const ok = act({ type: 'play', cardIds: sel, ...(suit ? { suit } : {}), ...(jakkArmed ? { declareJakk: true } : {}) });
    if (ok) {
      setSuitOpen(false);
      setSel([]);
      setArmed(false);
    }
  }

  function onPlay() {
    unlockAudio();
    if (!canPlay) return;
    if (needsSuitChoice(view!, sel)) {
      setSuitHl(0);
      setSuitOpen(true);
    }
    else sendPlay();
  }

  function onDraw() {
    unlockAudio();
    if (!myTurn) {
      say(view!.winner ? 'The game is over' : 'Not your turn');
      return;
    }
    act(view!.penalty ? { type: 'takePenalty' } : { type: 'draw' });
  }

  function onJakk() {
    unlockAudio();
    if (owed) {
      act({ type: 'declareJakk' });
      return;
    }
    if (armable) setArmed((a) => !a);
    else say(handCount <= 2 ? 'Select the card that leaves you on one card' : 'JAKK is for when you are down to one card');
  }

  // ---- hand geometry: thin flat cards with a light overlap; phones fan them on a gentle arc
  // phones fan the hand, which pushes the end cards outwards, so leave extra room at the sides
  const pad = isTab ? 8 : 18;
  const avail = Math.max(200, handW - pad * 2);
  const cw = isDesk
    ? Math.max(64, Math.min(100, Math.round(vh * 0.096)))
    : isTab
      ? Math.max(66, Math.min(100, Math.round(handW * 0.13)))
      : Math.max(46, Math.min(78, Math.round(handW * 0.165)));
  const ch = Math.round(cw * 1.565);
  const n = sorted.length;
  const idealStep = cw * (isDesk ? 1.0 : isTab ? 0.92 : 0.9);
  const fit1 = n <= 1 ? idealStep : (avail - cw) / (n - 1);
  const minStep = cw * (isDesk ? 0.22 : 0.32);
  const rows = !isDesk && fit1 < minStep * 1.02 ? 2 : 1;
  const perRow = Math.ceil(n / rows);
  const step = Math.max(minStep, Math.min(idealStep, perRow <= 1 ? idealStep : (avail - cw) / (perRow - 1)));
  const rowW = cw + (perRow - 1) * step;
  const innerW = Math.max(handW, rowW + pad * 2);
  const left0 = (innerW - rowW) / 2;
  const arc = !isTab && rows === 1 ? 1 : 0;
  const lift = isDesk ? 30 : 26;
  const rowGap = Math.round(ch * 0.52);
  const handH = lift + ch + (rows - 1) * rowGap + (arc ? Math.round(cw * 0.22) : 0) + 6;

  const dealingCls = dealing ? 'dealing' : '';
  const others = (() => {
    const idx = view.players.indexOf(me);
    const order = [...view.players.slice(idx + 1), ...view.players.slice(0, idx)];
    return order.map((id) => room.players.find((p) => p.playerId === id)).filter((p): p is LobbyPlayer => !!p);
  })();

  // ---- keyboard (desktop). Never fires while typing in a field.
  const focusCard = (i: number) => {
    const c = sorted[Math.max(0, Math.min(sorted.length - 1, i))];
    if (!c) return;
    lastFocus.current = sorted.indexOf(c);
    handRef.current?.querySelector<HTMLElement>(`[data-hand-card="${c.id}"]`)?.focus();
  };
  const focusedIdx = () => {
    const a = document.activeElement as HTMLElement | null;
    const id = a?.getAttribute?.('data-hand-card');
    return id ? sorted.findIndex((c) => c.id === id) : -1;
  };
  const playKey = () => {
    if (!myTurn) say(view.winner ? 'The game is over' : 'Not your turn');
    else if (!sel.length) say('Pick a card first: press 1-9 or use the arrow keys');
    else onPlay();
  };
  keyRef.current = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (showResults) return;
    const k = e.key;
    const low = k.length === 1 ? k.toLowerCase() : k;
    setKbd(true);
    if (suitOpen) {
      const i = ['s', 'h', 'd', 'c'].indexOf(low);
      if (i >= 0) {
        e.preventDefault();
        sendPlay(SUITS[i]);
      } else if (k === 'ArrowLeft' || k === 'ArrowUp') {
        e.preventDefault();
        setSuitHl((h) => (h + 3) % 4);
      } else if (k === 'ArrowRight' || k === 'ArrowDown') {
        e.preventDefault();
        setSuitHl((h) => (h + 1) % 4);
      } else if (k === 'Enter' || k === ' ') {
        e.preventDefault();
        sendPlay(SUITS[suitHl]);
      }
      return;
    }
    if (rulesOpen || menuOpen || confirmLeave) {
      if (k === '?' && rulesOpen) setRulesOpen(false);
      return;
    }
    const onCard = !!t?.closest?.('[data-hand-card]');
    const onButton = !!t && (t.tagName === 'BUTTON' || t.tagName === 'A');
    if (k === '?') {
      e.preventDefault();
      setRulesOpen(true);
    } else if (k === 'Escape') {
      if (sel.length || armed) {
        setSel([]);
        setArmed(false);
      } else (document.activeElement as HTMLElement | null)?.blur?.();
    } else if (low === 'd' && !e.repeat) {
      e.preventDefault();
      onDraw();
    } else if (low === 'j' && !e.repeat) {
      e.preventDefault();
      onJakk();
    } else if (low === 'p' && !e.repeat) {
      e.preventDefault();
      playKey();
    } else if (k === 'Enter') {
      if (!onButton && !e.repeat) {
        e.preventDefault();
        playKey();
      }
    } else if (k === ' ') {
      if (!onButton) e.preventDefault();
    } else if (k === 'ArrowRight' || k === 'ArrowLeft' || k === 'ArrowDown' || k === 'ArrowUp') {
      if (onButton && !onCard) return;
      e.preventDefault();
      const dir = k === 'ArrowRight' || k === 'ArrowDown' ? 1 : -1;
      const cur = focusedIdx();
      if (cur >= 0) focusCard(cur + dir);
      else {
        const firstLegal = sorted.findIndex((c) => lit.has(c.id));
        focusCard(lastFocus.current > 0 ? lastFocus.current : firstLegal >= 0 ? firstLegal : 0);
      }
    } else if (k === 'Home' || k === 'End') {
      if (onButton && !onCard) return;
      e.preventDefault();
      focusCard(k === 'Home' ? 0 : sorted.length - 1);
    } else if (/^[0-9]$/.test(k) && (!onButton || onCard)) {
      const i = k === '0' ? 9 : Number(k) - 1;
      if (i < sorted.length) {
        e.preventDefault();
        focusCard(i);
        tapCard(sorted[i]);
      }
    }
  };

  const slots = others.length === 1 ? ['top'] : others.length === 2 ? ['tl', 'tr'] : ['left', 'top', 'right'];

  const top = topOverride ?? view.topDiscard;
  const penalty = view.penalty;
  const suitRed = view.activeSuit === 'H' || view.activeSuit === 'D';

  let turnLabel: ReactElement;
  if (view.winner) turnLabel = <div className="turnlabel">Game over</div>;
  else if (myTurn) {
    turnLabel = (
      <div className="turnlabel mine" data-testid="turn-label">
        <span>Your turn</span>
        {penalty && <em>{penaltyReason(penalty, view.rules)}</em>}
      </div>
    );
  } else {
    turnLabel = (
      <div className="turnlabel" data-testid="turn-label">
        {turnPlayer ? `${turnPlayer.name} is ${turnPlayer.isBot || turnPlayer.connected ? 'thinking' : 'away'}` : 'Waiting'}
        <span className="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
    );
  }

  const feedText = hint?.text ?? feed?.text ?? defaultFeed(view, nameOf);
  const drawLabel = penalty && myTurn ? `Pick up ${penalty.amount}` : 'Draw';

  const modeLabel = room.mode === 'friends' ? `Room ${room.code}` : `vs ${others.length === 1 ? '1 bot' : `${others.length} bots`}`;
  const power: Array<{ id: string; title: string; text: string; full: string }> = [
    { id: '2H', title: '2', text: `+${view.rules.twoPenalty}, stackable`, full: `Next player picks up ${view.rules.twoPenalty}, or answers with another 2 to pass the total on.` },
    { id: 'JS', title: 'Black Jack', text: `+${view.rules.blackJackPenalty}, Jack answers`, full: `Next player picks up ${view.rules.blackJackPenalty}. Only another Jack can answer.` },
    { id: 'JH', title: 'Red Jack', text: 'Cancels a penalty', full: 'Played on a Jack penalty it cancels the whole thing.' },
    { id: '7C', title: '7', text: 'Skip next player', full: 'The next player misses their turn.' },
    { id: '8D', title: '8', text: 'Reverse direction', full: 'Play passes the other way round the table.' },
    { id: 'AS', title: 'Ace', text: 'Wild: name a suit', full: 'Play it on anything (except a penalty) and name the next suit.' },
  ];

  const dirLabel = view.direction === 1 ? 'Play is clockwise' : 'Play is reversed';
  return (
    <div className={`screen gt-screen ${dealingCls} ${myTurn ? 'my-turn' : ''} ${kbd ? 'kbd-on' : ''}`} data-testid="table" data-turn={myTurn ? 'me' : 'other'} data-version={view.version} data-dir={view.direction} data-opps={others.length}>
      <AppHeader
        className="gt-hdr"
        inGame
        onLeave={() => setConfirmLeave(true)}
        onRules={() => setRulesOpen(true)}
        menuOpen={menuOpen}
        onMenuOpen={setMenuOpen}
        left={
          <span className="gt-mode" aria-label={modeLabel}>
            <img className="gt-mode-ico" src={room.mode === 'friends' ? '/art/icon-users.webp' : '/art/icon-robot.webp'} alt="" width="28" height="28" draggable={false} />
            {modeLabel}
          </span>
        }
        extra={
          <>
            <button className="hdr-btn gt-icon" aria-label="How to play" title="How to play (?)" onClick={() => setRulesOpen(true)}>
              <Icon name="help" />
            </button>
          </>
        }
      />

      <div className="gt-body">
        <section className="gt-seats" aria-label="Opponents" data-n={others.length}>
          {others.map((p, i) => (
            <Seat key={p.playerId} player={p} slot={slots[i]} count={view.handCounts[p.playerId] ?? 0} active={view.turn === p.playerId && !view.winner} jakk={(view.handCounts[p.playerId] ?? 0) === 1} dealing={dealing} />
          ))}
        </section>

        <section className="gt-table" aria-label="Table">
          <TableFrame />
          <div className="gt-centre">
            <span className="gt-dir l" data-dir={view.direction} aria-hidden="true" />
            <button className={`gt-pile gt-draw ${myTurn ? 'live' : ''}`} data-anchor="draw" data-testid="draw-pile" onClick={onDraw} aria-label={`Draw pile, ${view.drawCount} cards. ${penalty && myTurn ? `Pick up ${penalty.amount}` : 'Tap to draw'}`}>
              <CardBack className="p3" />
              <CardBack className="p2" />
              <CardBack className="p1" />
              <span className="gt-pile-count">{view.drawCount}</span>
            </button>
            <div className="gt-suit" data-testid="active-suit" data-suit={view.activeSuit} aria-label={`Active suit: ${SUIT_NAME[view.activeSuit]}`}>
              <span className="gt-suit-cap">SUIT</span>
              <span className={`gt-suit-disc ${suitRed ? 'red' : 'black'}`} key={view.activeSuit}>
                <SuitIcon suit={view.activeSuit} />
              </span>
            </div>
            <div className="gt-pile gt-discard" data-anchor="discard" data-testid="discard-pile" aria-label={`Top card: ${cardName(top)}`}>
              <div className="under u1" />
              <CardFace card={top} rules={view.rules} className="top" />
              {penalty && (
                <span className="penalty-badge" key={penalty.amount} data-testid="penalty">
                  +{penalty.amount}
                </span>
              )}
            </div>
            <span className="gt-dir r" data-dir={view.direction} aria-label={dirLabel} role="img" />
            {callout && (
              <div className={`callout ${callout.kind}`} key={callout.id} aria-hidden="true">
                {callout.text}
              </div>
            )}
          </div>

          <p className={`gt-caption ${hint ? 'hint' : ''}`} key={hint?.id ?? 'rule'}>
            {hint ? hint.text : 'First to empty their hand wins'}
          </p>
          <div className="sr-only" aria-live="polite" data-testid="feed">
            {feedText}
          </div>
          {turnLabel}

          <div className="gt-play">
            <section className="gt-hand" aria-label="Your hand">
          <div className="hand-scroll" ref={handRef} data-anchor="hand">
            <div className="hand" style={{ width: innerW, height: handH, ['--cw' as string]: `${cw}px` } as CSSProperties} data-testid="hand" data-count={n}>
              {sorted.map((c, i) => {
                const row = rows === 1 ? 0 : Math.floor(i / perRow);
                const col = rows === 1 ? i : i % perRow;
                const rowCount = rows === 1 ? n : row === rows - 1 ? n - perRow * row : perRow;
                const rw = cw + (rowCount - 1) * step;
                const l = (innerW - rw) / 2 + col * step;
                void left0;
                const isSel = sel.includes(c.id);
                // phones: tilt and drop outer cards a little so the hand reads as a held fan
                const t = arc && rowCount > 1 ? (col - (rowCount - 1) / 2) / ((rowCount - 1) / 2) : 0;
                return (
                  <HandCard
                    rot={t * 7}
                    key={c.id}
                    card={c}
                    index={i}
                    left={l}
                    top={lift + row * rowGap + Math.round(t * t * cw * 0.2)}
                    z={10 + row * 40 + col}
                    legal={myTurn && lit.has(c.id)}
                    dim={myTurn && !lit.has(c.id) && !isSel}
                    selected={isSel}
                    order={sel.indexOf(c.id) + 1}
                    shake={shake?.id === c.id}
                    hint={i < 10 ? String((i + 1) % 10) : ''}
                    fresh={freshDelay[c.id]}
                    dealing={dealing}
                    view={view}
                    onTap={tapCard}
                  />
                );
              })}
            </div>
          </div>
            </section>
            <button className="gt-btn draw-btn" data-testid="draw-btn" onClick={onDraw} disabled={!myTurn} data-penalty={penalty && myTurn ? 'true' : 'false'} aria-keyshortcuts="D">
              <img className="gt-btn-badge" src="/art/icon-cards.webp" alt="" width="32" height="32" draggable={false} />
              <span>{drawLabel}</span>
              <Kbd k="D" />
            </button>
            <button
              className={`gt-btn jakk-btn ${owed ? 'owed' : jakkArmed ? 'armed' : armable ? 'armable' : ''}`}
              data-testid="jakk-btn"
              data-state={owed ? 'owed' : jakkArmed ? 'armed' : armable ? 'armable' : 'idle'}
              onClick={onJakk}
              disabled={!view.rules.jakkEnabled || (!owed && !armable && !(myTurn && handCount <= 3))}
              aria-pressed={jakkArmed}
              aria-keyshortcuts="J"
              aria-label={owed ? 'Declare JAKK now' : jakkArmed ? 'JAKK armed. Tap to cancel' : 'JAKK'}
            >
              <img className="gt-btn-badge" src="/art/icon-spade.webp" alt="" width="32" height="32" draggable={false} />
              <span>{jakkArmed ? 'JAKK ✓' : 'JAKK'}</span>
              <Kbd k="J" />
            </button>
            <button className="gt-btn primary play-btn" data-testid="play-btn" onClick={onPlay} disabled={!canPlay} aria-keyshortcuts="P">
              <img className="gt-btn-badge" src="/art/icon-bolt.webp" alt="" width="32" height="32" draggable={false} />
              <span>Play{sel.length > 0 ? ` ${sel.length}` : ''}</span>
              <Kbd k="P" />
            </button>
          </div>
        </section>

        <section className="gt-panels" aria-label="Game panels">
          <details className="gt-panel">
            <summary>
              <span className="gt-tri" aria-hidden="true" />
              <span className="gt-sum">Game Log</span>
              <span className="gt-badge">{log.length}</span>
              <Icon name="down" className="gt-chev" />
            </summary>
            <ol className="log" ref={logRef} data-testid="log">
              {log.length === 0 && <li className="log-empty">Waiting for the first move...</li>}
              {log.map((l, i) => (
                <li key={l.id} className={`${l.text.startsWith('You') ? 'me' : ''} ${i === log.length - 1 ? 'new' : ''}`}>
                  {l.text}
                </li>
              ))}
            </ol>
          </details>
          <details className="gt-panel">
            <summary>
              <span className="gt-tri" aria-hidden="true" />
              <span className="gt-sum">Power Cards Guide</span>
              <Icon name="down" className="gt-chev" />
            </summary>
            <ul className="power">
              {power.map((p) => (
                <li key={p.id} title={p.full}>
                  <CardFace card={{ id: p.id, rank: p.id.slice(0, -1) as Card['rank'], suit: p.id.slice(-1) as Card['suit'] }} rules={view.rules} style={{ ['--cw' as string]: '34px' }} />
                  <span>
                    <b>{p.title}</b>
                    {p.text}
                  </span>
                </li>
              ))}
            </ul>
            <KeyList className="gt-keys" />
          </details>
          {room.mode === 'friends' && (
            <details className="gt-panel">
              <summary>
                <span className="gt-tri" aria-hidden="true" />
                <span className="gt-sum">Room {room.code}</span>
                <Icon name="down" className="gt-chev" />
              </summary>
              <div className="side-code" data-testid="side-room-code">
                {room.code}
              </div>
              <InviteActions code={room.code} compact />
            </details>
          )}
        </section>
      </div>

      <FlightLayer />

      <Sheet open={suitOpen} onClose={() => setSuitOpen(false)} title="Choose a suit">
        <div className="suit-grid" data-testid="suit-picker">
          {SUITS.map((s) => (
            <button key={s} className={`suit-btn ${s === 'H' || s === 'D' ? 'red' : 'black'} ${SUITS[suitHl] === s ? 'hl' : ''}`} onClick={() => sendPlay(s)} aria-label={SUIT_NAME[s]} data-suit={s}>
              <SuitIcon suit={s} className="sb-corner tl" />
              <SuitIcon suit={s} className="sb-pip" />
              <span className="sb-name">{SUIT_NAME[s]}</span>
              <SuitIcon suit={s} className="sb-corner br" />
              <Kbd k={s} />
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={rulesOpen} onClose={() => setRulesOpen(false)} title="How to play" tall>
        <HowToPlayContent />
      </Sheet>

      <Sheet open={confirmLeave} onClose={() => setConfirmLeave(false)} title="Leave this game?">
        <p className="sheet-text">{room.mode === 'friends' ? 'A bot will take your seat and play on without you.' : 'The game will end.'}</p>
        <div className="menu-list">
          <button className="pill secondary wide" onClick={() => setConfirmLeave(false)}>
            Keep playing
          </button>
          <button className="pill danger wide" data-testid="confirm-leave" onClick={leaveRoom}>
            Leave
          </button>
        </div>
      </Sheet>

      {showResults && <Results view={view} room={room} />}
    </div>
  );
}

function defaultFeed(view: PlayerView, nameOf: (id: string) => string): string {
  if (view.winner) return `${view.winner === view.you ? 'You' : nameOf(view.winner)} won the game`;
  if (view.turn === view.you) return view.penalty ? penaltyReason(view.penalty, view.rules) : 'Play a card or draw';
  return `${nameOf(view.turn)} is on the move`;
}

