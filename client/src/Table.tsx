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
import { AppHeader, Avatar, CardBack, CardFace, DecoChips, Icon, KeyList, Kbd, Sheet, SuitIcon, cardName, useMedia, useMuted } from './components';
import { TableArc } from './Screens';
import { InviteActions } from './Lobby';
import { HowToPlayContent } from './HowToPlay';
import { Results } from './Results';
import { act, leaveRoom, useApp, type Flight } from './store';
import { removeFlight } from './fx';
import { playSfx, setMuted, unlockAudio } from './sound';

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
  const shown = Math.min(count, 6);
  return (
    <div className={`seat ${active ? 'active' : ''} ${!player.connected && !player.isBot ? 'away' : ''}`} data-anchor={`seat-${player.playerId}`} data-testid={`seat-${player.playerId}`} data-slot={slot}>
      <div className="seat-top">
        <Avatar avatar={player.avatar} size={40} className="seat-avatar" />
        <div className="seat-info">
          <span className="seat-name">{player.name}</span>
          <span className="seat-meta">
            {player.isBot && <i className="mark">BOT</i>}
            {!player.connected && !player.isBot && <i className="mark off">OFFLINE</i>}
            {active && <i className="mark think">turn</i>}
          </span>
        </div>
      </div>
      <div className="seat-cards" aria-label={`${player.name} has ${count} cards`}>
        <div className="fan" aria-hidden="true" style={{ ['--n' as string]: shown } as CSSProperties}>
          {Array.from({ length: shown }, (_, i) => (
            <CardBack key={i} className={dealing ? 'deal-in' : ''} style={{ ['--i' as string]: i, ['--n' as string]: shown, ['--cw' as string]: 'var(--seat-cw, 24px)' } as CSSProperties} />
          ))}
        </div>
        <span className="count" data-count={count}>
          {count}
        </span>
        {jakk && <span className="jakk-badge">JAKK!</span>}
      </div>
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
  onTap: (c: Card) => void;
}

function HandCard({ card, index, left, top, z, legal, dim, selected, order, shake, hint, fresh, dealing, view, onTap }: HandCardProps) {
  const label = `${cardName(card)}${selected ? `, selected, play order ${order}` : legal ? ', playable' : dim ? ', not playable' : ''}`;
  const cls = ['hc', legal ? 'legal' : '', dim ? 'dim' : '', selected ? 'selected' : '', shake ? 'shake' : '', fresh !== undefined ? 'fresh' : '', dealing ? 'dealt' : ''].filter(Boolean).join(' ');
  const style: CSSProperties = { left, top, zIndex: selected ? 200 : z, ['--i' as string]: index, ['--d' as string]: `${fresh ?? 0}ms` };
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
  const { view, room, dealing, callout, feed, topOverride, freshDelay, suitOverride } = app;
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
  const muted = useMuted();
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

  const winner = view?.handOver ? (view.winner ?? 'none') : null;
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
  const myTurn = view.turn === me && !view.handOver && !view.spectator;
  const legalSet = new Set(getLegalCardIds(view));
  const addableSet = new Set(getAddableCardIds(view, sel));
  const lit = sel.length ? addableSet : legalSet;
  const nameOf = (id: string) => room.players.find((p) => p.playerId === id)?.name ?? 'Player';
  const turnPlayer = room.players.find((p) => p.playerId === view.turn);

  const handCount = view.hand.length;
  const declared = !!view.jakk[me];
  const armable = view.rules.jakkEnabled && myTurn && !declared && handCount > 0;
  const jakkArmed = armed && armable;
  const owed = false;
  const preview = sel.length ? previewPlay(view, sel, 'S') : null;
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
    const r = previewPlay(view!, [...sel, card.id], 'S');
    say(r.ok ? "You can't add that card" : r.reason);
    setShake({ id: card.id, n: Date.now() });
    setTimeout(() => setShake((s) => (s && s.id === card.id ? null : s)), 450);
  }

  function sendPlay(suit?: Suit) {
    if (view!.awaitingSuit && suit) {
      act({ type: 'chooseSuit', suit });
      return;
    }
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
      say(view!.handOver ? 'The hand is over' : 'Not your turn');
      return;
    }
    const flag = jakkArmed ? { declareJakk: true } : {};
    act(view!.penalty ? { type: 'takePenalty', ...flag } : { type: 'draw', ...flag });
    setArmed(false);
  }

  function onJakk() {
    unlockAudio();
    if (declared) return;
    if (!myTurn) {
      act({ type: 'declareJakk' }); // before your turn: covers your next turn
      return;
    }
    if (armable) setArmed((a) => !a); // with your move: covers your next turn
  }

  // ---- hand geometry
  const pad = 10;
  const avail = Math.max(200, handW - pad * 2);
  // Phone keeps its original numbers. Tablet and desktop get bigger cards and less overlap.
  const cw = isDesk
    ? Math.max(64, Math.min(124, Math.round(vh * 0.115)))
    : isTab
      ? Math.max(78, Math.min(120, Math.round(handW * 0.14)))
      : Math.max(50, Math.min(92, Math.round(handW * 0.21)));
  const ch = Math.round(cw * 1.42);
  const n = sorted.length;
  const idealStep = cw * (isDesk ? 0.8 : isTab ? 0.7 : 0.62);
  const fit1 = n <= 1 ? idealStep : (avail - cw) / (n - 1);
  const minStep = cw * (isDesk ? 0.2 : 0.3);
  const rows = !isDesk && fit1 < minStep * 1.02 ? 2 : 1;
  const perRow = Math.ceil(n / rows);
  const step = Math.max(minStep, Math.min(idealStep, perRow <= 1 ? idealStep : (avail - cw) / (perRow - 1)));
  const rowW = cw + (perRow - 1) * step;
  const innerW = Math.max(handW, rowW + pad * 2);
  const left0 = (innerW - rowW) / 2;
  const lift = isDesk ? 44 : 36;
  const rowGap = Math.round(ch * 0.52);
  const handH = lift + ch + (rows - 1) * rowGap + 6;

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
    if (!myTurn) say(view.handOver ? 'The hand is over' : 'Not your turn');
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
  const shownSuit = suitOverride ?? view.activeSuit;
  const suitRed = shownSuit === 'H' || shownSuit === 'D';

  let turnLabel: ReactElement;
  if (view.handOver) turnLabel = <div className="turnlabel">Hand over</div>;
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
    { id: '8D', title: '8', text: 'Skip next player', full: 'The next player misses their turn (two 8s skip two players).' },
    { id: 'KS', title: 'King', text: 'Reverse direction', full: 'Play passes the other way round the table.' },
    { id: 'QD', title: 'Queen', text: 'Must be covered', full: 'Cover a Queen with the next card of the same turn. An uncovered Queen costs a card and can never be your last card.' },
    { id: 'AS', title: 'Ace', text: 'Wild: name a suit', full: 'Play it on anything (except a penalty) and name the next suit.' },
  ];

  return (
    <div className={`screen table-screen ${dealingCls} ${myTurn ? 'my-turn' : ''} ${kbd ? 'kbd-on' : ''}`} data-testid="table" data-turn={myTurn ? 'me' : 'other'} data-version={view.version} data-dir={view.direction} data-opps={others.length}>
      <AppHeader
        className="table-top"
        inGame
        onLeave={() => setConfirmLeave(true)}
        onRules={() => setRulesOpen(true)}
        menuOpen={menuOpen}
        onMenuOpen={setMenuOpen}
        left={
          <span className="mode-chip" aria-label={modeLabel}>
            {modeLabel}
          </span>
        }
        extra={
          <>
            <button className="hdr-btn hdr-extra" aria-label="How to play" title="How to play (?)" onClick={() => setRulesOpen(true)}>
              <Icon name="help" />
            </button>
            <button className="hdr-btn hdr-extra" aria-label={muted ? 'Sound off. Turn sound on' : 'Sound on. Turn sound off'} onClick={() => setMuted(!muted)}>
              <Icon name={muted ? 'mute' : 'sound'} />
            </button>
          </>
        }
      />

      <div className="stage">
        <section className="seats" aria-label="Opponents" data-n={others.length}>
          {others.map((p, i) => (
            <Seat key={p.playerId} player={p} slot={slots[i]} count={view.handCounts[p.playerId] ?? 0} active={view.turn === p.playerId && !view.handOver} jakk={!!view.jakk[p.playerId]} dealing={dealing} />
          ))}
        </section>

        <section className="centre" aria-label="Table">
          <TableArc />
          <div className="dir" data-dir={view.direction} aria-label={view.direction === 1 ? 'Play is clockwise' : 'Play is reversed'}>
            <svg viewBox="0 0 320 150" className="dir-svg" aria-hidden="true">
              <ellipse cx="160" cy="75" rx="146" ry="62" className="dir-ring" />
              <path d="M 294 66 L 318 66 L 306 90 Z" className="dir-head" />
              <path d="M 26 84 L 2 84 L 14 60 Z" className="dir-head" />
            </svg>
          </div>
          <div className="piles">
            <button className={`pile draw ${myTurn ? 'live' : ''}`} data-anchor="draw" data-testid="draw-pile" onClick={onDraw} aria-label={`Draw pile, ${view.drawCount} cards. ${penalty && myTurn ? `Pick up ${penalty.amount}` : 'Tap to draw'}`}>
              <CardBack className="p3" />
              <CardBack className="p2" />
              <CardBack className="p1" />
              <span className="pile-count">{view.drawCount}</span>
            </button>
            <div className="suit-chip" data-testid="active-suit" data-suit={shownSuit} aria-label={`Active suit: ${SUIT_NAME[shownSuit]}`}>
              <span className="suit-cap">SUIT</span>
              <span className={`suit-box ${suitRed ? 'red' : 'black'}`} key={shownSuit}>
                <SuitIcon suit={shownSuit} />
              </span>
            </div>
            <div className="pile discard" data-anchor="discard" data-testid="discard-pile" aria-label={`Top card: ${cardName(top)}`}>
              <div className="under u1" />
              <div className="under u2" />
              <CardFace card={top} rules={view.rules} className="top" />
              {penalty && (
                <span className="penalty-badge" key={penalty.amount} data-testid="penalty">
                  +{penalty.amount}
                </span>
              )}
            </div>
          </div>
          {callout && (
            <div className={`callout ${callout.kind}`} key={callout.id} aria-hidden="true">
              {callout.text}
            </div>
          )}
        </section>

        <DecoChips variant="table" />
        <div className={`feed ${hint ? 'hint' : ''}`} aria-live="polite" data-testid="feed">
          <span key={hint?.id ?? feed?.id ?? 0}>{feedText}</span>
        </div>
      </div>

      <div className="hand-row">
        <section className="hand-zone" aria-label="Your hand">
          {turnLabel}
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
                return (
                  <HandCard
                    key={c.id}
                    card={c}
                    index={i}
                    left={l}
                    top={lift + row * rowGap}
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

        <footer className="actions">
          <button className="pill secondary draw-btn" data-testid="draw-btn" onClick={onDraw} disabled={!myTurn} data-penalty={penalty && myTurn ? 'true' : 'false'} aria-keyshortcuts="D">
            <span>{drawLabel}</span>
            <Kbd k="D" />
          </button>
          <button
            className={`pill danger jakk-btn ${owed ? 'owed' : jakkArmed ? 'armed' : armable ? 'armable' : ''}`}
            data-testid="jakk-btn"
            data-state={declared ? 'armed' : jakkArmed ? 'armed' : armable ? 'armable' : 'idle'}
            onClick={onJakk}
            disabled={!view.rules.jakkEnabled || declared || view.handOver !== null || view.spectator}
            aria-pressed={jakkArmed}
            aria-keyshortcuts="J"
            aria-label={declared ? 'JAKK declared for your next turn' : jakkArmed ? 'JAKK armed. Tap to cancel' : 'JAKK'}
          >
            {declared || jakkArmed ? 'JAKK ✓' : 'JAKK'}
            <Kbd k="J" />
          </button>
          <button className="pill primary play-btn" data-testid="play-btn" onClick={onPlay} disabled={!canPlay} aria-keyshortcuts="P">
            <span>Play{sel.length > 0 ? ` ${sel.length}` : ''}</span>
            <Kbd k="P" />
          </button>
        </footer>
      </div>

      <aside className="side" aria-label="Game panel">
        <section className="side-box side-log">
          <h3 className="side-h">Game log</h3>
          <ol className="log" ref={logRef} data-testid="log">
            {log.length === 0 && <li className="log-empty">Waiting for the first move...</li>}
            {log.map((l, i) => (
              <li key={l.id} className={`${l.text.startsWith('You') ? 'me' : ''} ${i === log.length - 1 ? 'new' : ''}`}>
                {l.text}
              </li>
            ))}
          </ol>
        </section>
        {room.mode === 'friends' && (
          <section className="side-box side-room">
            <h3 className="side-h">Room</h3>
            <div className="side-code" data-testid="side-room-code">
              {room.code}
            </div>
            <InviteActions code={room.code} compact />
          </section>
        )}
        <section className="side-box side-power">
          <h3 className="side-h">Power cards</h3>
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
        </section>
        <section className="side-box side-keys">
          <h3 className="side-h">Keyboard</h3>
          <KeyList />
        </section>
      </aside>

      <FlightLayer />

      <Sheet open={suitOpen || (view.awaitingSuit && myTurn)} onClose={() => setSuitOpen(false)} title="Choose a suit">
        <div className="suit-grid" data-testid="suit-picker">
          {SUITS.map((s) => (
            <button key={s} className={`suit-btn ${s === 'H' || s === 'D' ? 'red' : 'black'} ${SUITS[suitHl] === s ? 'hl' : ''}`} onClick={() => sendPlay(s)} aria-label={SUIT_NAME[s]} data-suit={s}>
              <SuitIcon suit={s} />
              <span>{SUIT_NAME[s]}</span>
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
  if (view.handOver) return view.winner ? `${view.winner === view.you ? 'You' : nameOf(view.winner)} won the hand` : 'The hand ended with no winner';
  if (view.spectator) return 'You are watching - you are dealt in next hand';
  if (view.awaitingSuit && view.turn === view.you) return 'Name a suit for the opening Ace';
  if (view.turn === view.you) return view.penalty ? penaltyReason(view.penalty, view.rules) : 'Play a card or draw';
  return `${nameOf(view.turn)} is on the move`;
}

