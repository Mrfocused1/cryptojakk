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
} from '@shared/engine';
import type { LobbyPlayer } from '@shared/protocol';
import { AppHeader, Avatar, CardBack, CardFace, DecoChips, Icon, KeyList, Kbd, Sheet, SuitIcon, cardName, useMedia, useMuted } from './components';
import { TableArc } from './Screens';
import { InviteActions } from './Lobby';
import { HowToPlayContent } from './HowToPlay';
import { HistoryPanel } from './History';
import { RulesChips } from './Options';
import { Results } from './Results';
import { TimerReadout, TimerRing } from './Timer';
import { causeText, openingNote, previewFor } from './describe';
import { act, leaveRoom, useApp, type ClientTimer, type Flight } from './store';
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

interface SeatProps {
  player: LobbyPlayer;
  count: number;
  active: boolean;
  jakk: boolean;
  dealing: boolean;
  slot: string;
  dealer: boolean;
  out: boolean;
  provisional: boolean;
  wins: number | null;
  timer: ClientTimer | null;
}

function Seat({ player, count, active, jakk, dealing, slot, dealer, out, provisional, wins, timer }: SeatProps) {
  const shown = Math.min(count, 6);
  const away = !player.connected && !player.isBot;
  return (
    <div
      className={`seat ${active ? 'active' : ''} ${away ? 'away' : ''} ${out ? 'out' : ''} ${provisional ? 'prov' : ''}`}
      data-anchor={`seat-${player.playerId}`}
      data-testid={`seat-${player.playerId}`}
      data-slot={slot}
      data-jakk={jakk ? 'true' : 'false'}
      data-out={out ? 'true' : 'false'}
      data-provisional={provisional ? 'true' : 'false'}
    >
      <div className="seat-top">
        <span className="av-wrap">
          <Avatar avatar={player.avatar} size={40} className="seat-avatar" />
          {timer && <TimerRing timer={timer} size={50} />}
          {dealer && (
            <i className="dealer-btn" title="Dealer" data-testid="dealer-btn" aria-label="Dealer">
              D
            </i>
          )}
        </span>
        <div className="seat-info">
          <span className="seat-name">{player.name}</span>
          <span className="seat-meta">
            {player.isBot && <i className="mark">BOT</i>}
            {away && <i className="mark off">OFFLINE</i>}
            {out && <i className="mark off">SAT OUT</i>}
            {provisional && <i className="mark prov">OUT?</i>}
            {active && !timer && <i className="mark think">turn</i>}
            {active && timer && (
              <i className="mark think">
                <TimerReadout timer={timer} />
              </i>
            )}
            {wins !== null && (
              <i className="mark wins" data-testid="seat-wins" title="Hands won">
                ★ {wins}
              </i>
            )}
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
        {jakk && (
          <span className="jakk-badge" data-testid="seat-jakk" title="JAKK declared">
            JAKK!
          </span>
        )}
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
  cover: boolean;
  order: number;
  shake: boolean;
  hint: string;
  fresh: number | undefined;
  dealing: boolean;
  view: PlayerView;
  onTap: (c: Card) => void;
}

function HandCard({ card, index, left, top, z, legal, dim, selected, cover, order, shake, hint, fresh, dealing, view, onTap }: HandCardProps) {
  const label = `${cardName(card)}${selected ? `, selected, play order ${order}` : cover ? ', can cover the Queen' : legal ? ', playable' : dim ? ', not playable' : ''}`;
  const cls = ['hc', legal ? 'legal' : '', cover ? 'cover' : '', dim ? 'dim' : '', selected ? 'selected' : '', shake ? 'shake' : '', fresh !== undefined ? 'fresh' : '', dealing ? 'dealt' : ''].filter(Boolean).join(' ');
  const style: CSSProperties = { left, top, zIndex: z, ['--i' as string]: index, ['--d' as string]: `${fresh ?? 0}ms` };
  return (
    <button className={cls} style={style} data-hand-card={card.id} data-legal={legal ? 'true' : 'false'} data-selected={selected ? 'true' : 'false'} data-cover={cover ? 'true' : 'false'} aria-label={label} aria-pressed={selected} onClick={() => onTap(card)}>
      <CardFace card={card} rules={view.rules} />
      {selected && order > 0 && (
        <span className="order" data-testid="order-badge">
          {order}
        </span>
      )}
      {cover && !selected && <span className="cover-flag">COVER</span>}
      {hint && <i className="kn" aria-hidden="true">{hint}</i>}
    </button>
  );
}

// ------------------------------------------------------------------ table

export function Table() {
  const app = useApp();
  const { view, room, dealing, callout, feed, topOverride, freshDelay, suitOverride, timer } = app;
  const [sel, setSel] = useState<string[]>([]);
  const [armed, setArmed] = useState(false);
  const [suitOpen, setSuitOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sideTab, setSideTab] = useState<'log' | 'history'>('log');
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
  const handNo = room?.handNumber ?? 0;
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
  }, [winner, handNo]);

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
  const logSeeded = useRef(0);
  useEffect(() => {
    if (!view || !room) return;
    if (logSeeded.current === handNo) return;
    const first = logSeeded.current === 0;
    logSeeded.current = handNo;
    const f = room.players.find((p) => p.playerId === view.turn);
    const text =
      view.version === 0
        ? `Hand ${handNo} dealt. ${view.turn === view.you ? 'You go' : `${f?.name ?? 'Someone'} goes`} first.`
        : first
          ? 'Welcome back. Game on.'
          : `Hand ${handNo} under way.`;
    setLog((l) => [...l, { id: -handNo, text }]);
  }, [view, room, handNo]);
  useLayoutEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length, isDesk, sideTab]);

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
  const spectator = view.spectator;
  const sittingOut = view.out.includes(me);
  const iAmProvisional = view.provisional.includes(me);
  const myTurn = view.turn === me && !view.handOver && !spectator;
  const legalSet = new Set(getLegalCardIds(view));
  const addableSet = new Set(getAddableCardIds(view, sel));
  const lit = sel.length ? addableSet : legalSet;
  const nameOf = (id: string) => room.players.find((p) => p.playerId === id)?.name ?? 'Player';
  const turnPlayer = room.players.find((p) => p.playerId === view.turn);

  const handCount = view.hand.length;
  const declared = !!view.jakk[me];
  const jakkOn = view.rules.jakkEnabled && !spectator && !sittingOut && !view.handOver && !iAmProvisional;
  const armable = jakkOn && myTurn && !declared;
  const jakkArmed = armed && armable;
  const lastSel = sel.length ? view.hand.find((c) => c.id === sel[sel.length - 1]) : undefined;
  const coverMode = lastSel?.rank === 'Q';
  const preview = sel.length ? previewFor(view, sel, undefined) : null;
  const canPlay = myTurn && !!preview && preview.ok;
  const jakkState: 'off' | 'available' | 'arm' | 'armed' | 'declared' = !jakkOn ? 'off' : declared ? 'declared' : myTurn ? (jakkArmed ? 'armed' : 'arm') : 'available';

  const say = (text: string) => setHint({ id: Date.now(), text });

  /** Keep the longest prefix of `ids` that is still a legal sequence (used after removing a card from the middle). */
  function rebuild(ids: string[]): string[] {
    const out: string[] = [];
    for (const id of ids) {
      if (getAddableCardIds(view!, out).includes(id)) out.push(id);
      else break;
    }
    return out;
  }

  function tapCard(card: Card) {
    unlockAudio();
    if (sel.includes(card.id)) {
      const rest = sel.filter((x) => x !== card.id);
      const next = card.id === sel[sel.length - 1] ? rest : rebuild(rest);
      if (next.length < rest.length) say('Cards that no longer connect were taken off too');
      setSel(next);
      return;
    }
    if (lit.has(card.id)) {
      setSel([...sel, card.id]);
      playSfx('pop');
      return;
    }
    const p = previewFor(view!, [...sel, card.id], 'S');
    say(!myTurn ? (spectator ? "You're watching this hand" : view!.handOver ? 'The hand is over' : 'Not your turn') : p.ok ? "You can't add that card" : p.headline);
    setShake({ id: card.id, n: Date.now() });
    setTimeout(() => setShake((s) => (s && s.id === card.id ? null : s)), 450);
  }

  function removeLast() {
    if (!sel.length) return;
    setSel(sel.slice(0, -1));
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
    } else sendPlay();
  }

  function onDraw() {
    unlockAudio();
    if (!myTurn) {
      say(spectator ? "You're watching this hand" : view!.handOver ? 'The hand is over' : 'Not your turn');
      return;
    }
    const flag = jakkArmed ? { declareJakk: true } : {};
    act(view!.penalty ? { type: 'takePenalty', ...flag } : { type: 'draw', ...flag });
    setArmed(false);
  }

  function onJakk() {
    unlockAudio();
    if (jakkState === 'off') return;
    if (declared) {
      say(myTurn ? 'JAKK is live this turn' : 'JAKK declared: it covers your next turn only');
      return;
    }
    if (!myTurn) {
      act({ type: 'declareJakk' }); // before your turn: covers your next turn
      return;
    }
    // On your own turn a standalone declaration is refused; the flag travels with your move and covers the turn after.
    setArmed((a) => !a);
    say(armed ? 'JAKK will not be sent with your move' : 'JAKK will be sent with your move. It covers your NEXT turn only');
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
  const lift = isDesk ? 44 : 42;
  const rowGap = Math.round(ch * 0.52);
  const handH = lift + ch + (rows - 1) * rowGap + 6;

  const dealingCls = dealing ? 'dealing' : '';
  const others = (() => {
    const idx = view.players.indexOf(me);
    const order = idx < 0 ? view.players : [...view.players.slice(idx + 1), ...view.players.slice(0, idx)];
    return order.map((id) => room.players.find((p) => p.playerId === id)).filter((p): p is LobbyPlayer => !!p);
  })();
  const watchers = room.players.filter((p) => p.waiting && p.playerId !== me);
  const showWins = room.options.handsToWin > 1;

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
    if (!myTurn) say(spectator ? "You're watching this hand" : view.handOver ? 'The hand is over' : 'Not your turn');
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
    if (rulesOpen || menuOpen || confirmLeave || historyOpen) {
      if (k === '?' && rulesOpen) setRulesOpen(false);
      return;
    }
    const onCard = !!t?.closest?.('[data-hand-card]');
    const onButton = !!t && (t.tagName === 'BUTTON' || t.tagName === 'A' || t.tagName === 'SUMMARY');
    if (k === '?') {
      e.preventDefault();
      setRulesOpen(true);
    } else if (k === 'Escape') {
      if (sel.length || armed) {
        setSel([]);
        setArmed(false);
      } else (document.activeElement as HTMLElement | null)?.blur?.();
    } else if (k === 'Backspace') {
      e.preventDefault();
      removeLast();
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
      // On a card the browser's click selects it. Anywhere else Enter plays the selection.
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

  const slots =
    others.length === 1
      ? ['top']
      : others.length === 2
        ? ['tl', 'tr']
        : others.length === 3
          ? ['left', 'top', 'right']
          : others.length === 4
            ? ['left', 'tl', 'tr', 'right']
            : ['left', 'tl', 'top', 'tr', 'right'];

  const top = topOverride ?? view.topDiscard;
  const penalty = view.penalty;
  const shownSuit = suitOverride ?? view.activeSuit;
  const suitRed = shownSuit === 'H' || shownSuit === 'D';
  const opening = openingNote(view);
  const myTimer = timer && timer.playerId === me ? timer : null;

  let turnLabel: ReactElement;
  if (view.handOver) turnLabel = <div className="turnlabel">Hand over</div>;
  else if (spectator) {
    turnLabel = (
      <div className="turnlabel watch" data-testid="turn-label">
        Watching - dealt in next hand
      </div>
    );
  } else if (sittingOut) {
    turnLabel = (
      <div className="turnlabel watch" data-testid="turn-label">
        You sat out this hand
      </div>
    );
  } else if (iAmProvisional) {
    turnLabel = (
      <div className="turnlabel watch" data-testid="turn-label">
        You're out - waiting to see if the pickup comes back
      </div>
    );
  } else if (myTurn) {
    turnLabel = (
      <div className={`turnlabel mine ${myTimer ? 'timed' : ''}`} data-testid="turn-label">
        <span>Your turn</span>
        {penalty && <em>{penaltyReason(penalty, view.rules)}</em>}
        {myTimer && <TimerReadout timer={myTimer} bar />}
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

  // The line under the turn label: what the selected cards will do, or a prompt.
  let previewEl: ReactElement;
  if (preview && myTurn) {
    previewEl = (
      <div className="preview" data-testid="preview" data-tone={preview.tone} data-costly={preview.costly ? 'true' : 'false'} aria-live="polite">
        <b>{preview.headline}</b>
        {preview.details.length > 0 && <span>{preview.details.join(' · ')}</span>}
      </div>
    );
  } else {
    let text: string;
    let tone = 'idle';
    if (view.handOver) text = view.winner ? `${view.winner === me ? 'You' : nameOf(view.winner)} won the hand` : 'The hand ended with no winner';
    else if (spectator) text = watchers.length ? `Also watching: ${watchers.map((w) => w.name).join(', ')}` : "You'll be dealt in next hand";
    else if (sittingOut) text = 'Your cards went back into the deck. You rejoin next hand';
    else if (iAmProvisional) text = 'If the pickup is absorbed, you win the hand';
    else if (declared) text = myTurn ? 'JAKK is live this turn. It expires after this turn' : 'JAKK declared - expires after your next turn';
    else if (myTurn && view.awaitingSuit) text = 'Name a suit for the opening Ace';
    else if (myTurn && view.coverNeeded) text = `Cover the opening Queen with ${view.rules.flexibleQueenCover ? 'any card' : `a ${SUIT_NAME[view.topDiscard.suit].replace(/s$/, '')} or another Queen`} as your first card`;
    else if (myTurn && penalty) text = `${penaltyReason(penalty, view.rules)}. You can also play several defence cards together`;
    else if (myTurn) text = 'Tap a lit card to start. Add more for a run or a same-rank set, then Play';
    else if (handCount <= 3 && jakkOn) text = 'Going out on your next turn? Tap JAKK first';
    else text = `${turnPlayer?.name ?? 'Someone'} is on the move`;
    if (!myTurn && !declared && handCount <= 3 && jakkOn) tone = 'jakk';
    previewEl = (
      <div className="preview idle" data-testid="preview" data-tone={tone} aria-live="polite">
        <span>{text}</span>
      </div>
    );
  }

  const feedText = hint?.text ?? feed?.text ?? defaultFeed(view, nameOf);
  const drawLabel = penalty && myTurn ? `Pick up ${penalty.amount}` : 'Draw';
  const playLabel = sel.length > 0 ? `Play ${sel.length} ${sel.length === 1 ? 'card' : 'cards'}` : 'Play';

  const modeLabel = room.mode === 'friends' ? `Room ${room.code}` : `vs ${others.length === 1 ? '1 bot' : `${others.length} bots`}`;
  const matchLabel = `Hand ${room.handNumber}${room.options.handsToWin > 1 ? ` · first to ${room.options.handsToWin}` : ''}`;
  const power: Array<{ id: string; title: string; text: string; full: string }> = [
    { id: '2H', title: '2', text: `+${view.rules.twoPenalty} pickup`, full: `Next player picks up ${view.rules.twoPenalty}, or answers with another 2 to pass the total on.` },
    { id: 'JS', title: 'Black Jack', text: `+${view.rules.blackJackPenalty} pickup`, full: `Next player picks up ${view.rules.blackJackPenalty}. Only another black Jack, or a red Jack, can answer.` },
    { id: 'JH', title: 'Red Jack', text: 'BLOCK a pickup', full: 'Cancels a pickup you face. With no pickup it is an ordinary card.' },
    { id: '8D', title: '8', text: 'SKIP next player', full: 'The next player misses their turn (two 8s skip two players).' },
    { id: 'KS', title: 'King', text: 'REVERSE direction', full: 'Play passes the other way round the table.' },
    { id: 'QD', title: 'Queen', text: 'COVER with next card', full: 'Cover a Queen with the next card of the same turn. An uncovered Queen costs a card and can never be your last card.' },
    { id: 'AS', title: 'Ace', text: 'WILD: name a suit', full: 'Starts a play on anything (except a pickup). End on it and name the suit.' },
    { id: '7C', title: '7', text: 'ordinary card', full: 'The 7 has no special effect.' },
  ];

  const rulesChips = <RulesChips houseRules={room.houseRules} options={room.options} mode={isDesk ? 'inline' : 'sheet'} className={isDesk ? 'in-side' : 'in-strip'} />;
  const phone = !isDesk;

  return (
    <div className={`screen table-screen ${dealingCls} ${myTurn ? 'my-turn' : ''} ${kbd ? 'kbd-on' : ''} ${penalty ? 'has-penalty' : ''}`} data-testid="table" data-turn={myTurn ? 'me' : 'other'} data-version={view.version} data-dir={view.direction} data-opps={others.length} data-spectator={spectator ? 'true' : 'false'}>
      <AppHeader
        className="table-top"
        inGame
        onLeave={() => setConfirmLeave(true)}
        onRules={() => setRulesOpen(true)}
        onHistory={() => setHistoryOpen(true)}
        menuOpen={menuOpen}
        onMenuOpen={setMenuOpen}
        left={
          <span className="mode-chip" aria-label={`${modeLabel}. ${matchLabel}`}>
            <span className="mc-1">{modeLabel}</span>
            <span className="mc-2" data-testid="match-label">
              {matchLabel}
            </span>
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
      {phone && rulesChips}

      <div className="stage">
        <section className="seats" aria-label="Opponents" data-n={others.length}>
          {others.map((p, i) => (
            <Seat
              key={p.playerId}
              player={p}
              slot={slots[i]}
              count={view.handCounts[p.playerId] ?? 0}
              active={view.turn === p.playerId && !view.handOver}
              jakk={!!view.jakk[p.playerId]}
              dealing={dealing}
              dealer={view.dealer === p.playerId}
              out={view.out.includes(p.playerId)}
              provisional={view.provisional.includes(p.playerId)}
              wins={showWins ? (room.scores[p.playerId] ?? 0) : null}
              timer={timer && timer.playerId === p.playerId && !view.handOver ? timer : null}
            />
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
              <CardFace card={top} rules={view.rules} className="top" noTag />
              {penalty && (
                <span className="penalty-badge" key={penalty.amount} data-testid="penalty" data-kind={penalty.kind}>
                  +{penalty.amount}
                </span>
              )}
            </div>
          </div>
          {penalty ? (
            <div className="pickup-note" data-testid="pickup-cause" data-kind={penalty.kind}>
              <b>Pick up {penalty.amount}</b>
              <span>
                {causeText(penalty.kind)}
                {!view.handOver && ` · ${myTurn ? 'answer or pick up' : `${turnPlayer?.name ?? 'next player'} must answer`}`}
              </span>
            </div>
          ) : (
            opening && (
              <div className="opening-note" data-testid="opening-note">
                {opening}
              </div>
            )
          )}
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
          <div className="zone-head">
            {turnLabel}
            {view.dealer === me && (
              <i className="dealer-btn inline" title="You are the dealer" data-testid="dealer-btn-me">
                D
              </i>
            )}
            {showWins && !spectator && (
              <i className="mark wins me" data-testid="my-wins" title="Hands you have won">
                ★ {room.scores[me] ?? 0}
              </i>
            )}
          </div>
          {previewEl}
          {spectator ? (
            <div className="watch-box" data-testid="watch-box">
              <b>You'll be dealt in next hand</b>
              <span>You joined while a hand was running. You can see the table, but not anyone's cards.</span>
            </div>
          ) : (
            <div className="hand-scroll" ref={handRef} data-anchor="hand">
              <div className="hand" style={{ width: innerW, height: handH, ['--cw' as string]: `${cw}px` } as CSSProperties} data-testid="hand" data-count={n}>
                {sorted.map((c, i) => {
                  const row = rows === 1 ? 0 : Math.floor(i / perRow);
                  const col = rows === 1 ? i : i % perRow;
                  const rowCount = rows === 1 ? n : row === rows - 1 ? n - perRow * row : perRow;
                  const rw = cw + (rowCount - 1) * step;
                  const l = (innerW - rw) / 2 + col * step;
                  const isSel = sel.includes(c.id);
                  const isLit = myTurn && lit.has(c.id);
                  return (
                    <HandCard
                      key={c.id}
                      card={c}
                      index={i}
                      left={l}
                      top={lift + row * rowGap}
                      z={10 + row * 40 + col}
                      legal={isLit}
                      cover={isLit && coverMode && !isSel}
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
          )}
        </section>

        <footer className="actions">
          <button className="pill secondary draw-btn" data-testid="draw-btn" onClick={onDraw} disabled={!myTurn} data-penalty={penalty && myTurn ? 'true' : 'false'} aria-keyshortcuts="D">
            <span>{drawLabel}</span>
            <Kbd k="D" />
          </button>
          <button
            className={`pill danger jakk-btn ${jakkState}`}
            data-testid="jakk-btn"
            data-state={jakkState}
            onClick={onJakk}
            disabled={jakkState === 'off'}
            aria-pressed={jakkState === 'armed' || jakkState === 'declared'}
            aria-keyshortcuts="J"
            aria-label={
              jakkState === 'declared'
                ? 'JAKK declared. It expires after your next turn'
                : jakkState === 'armed'
                  ? 'JAKK will be sent with your move. Tap to cancel'
                  : jakkState === 'arm'
                    ? 'Send JAKK with your move'
                    : 'Declare JAKK for your next turn'
            }
          >
            <span className="jakk-l">{jakkState === 'declared' || jakkState === 'armed' ? 'JAKK ✓' : 'JAKK'}</span>
            <small className="jakk-sub">{jakkState === 'declared' ? (myTurn ? 'live this turn' : 'expires after next turn') : jakkState === 'armed' ? 'sent with your move' : jakkState === 'arm' ? 'with your move' : jakkState === 'available' ? 'tap to declare' : ''}</small>
            <Kbd k="J" />
          </button>
          <button className={`pill primary play-btn ${preview?.costly ? 'costly' : ''}`} data-testid="play-btn" onClick={onPlay} disabled={!canPlay} aria-keyshortcuts="P">
            <span>{playLabel}</span>
            <Kbd k="P" />
          </button>
        </footer>
      </div>

      <aside className="side" aria-label="Game panel">
        <section className="side-box side-log">
          <div className="side-tabs" role="tablist" aria-label="Game log">
            <button role="tab" aria-selected={sideTab === 'log'} className={sideTab === 'log' ? 'on' : ''} onClick={() => setSideTab('log')} data-testid="tab-log">
              Game log
            </button>
            <button role="tab" aria-selected={sideTab === 'history'} className={sideTab === 'history' ? 'on' : ''} onClick={() => setSideTab('history')} data-testid="tab-history">
              History
            </button>
          </div>
          {sideTab === 'log' ? (
            <ol className="log" ref={logRef} data-testid="log">
              {log.length === 0 && <li className="log-empty">Waiting for the first move...</li>}
              {log.map((l, i) => (
                <li key={l.id} className={`${l.text.startsWith('You') ? 'me' : ''} ${i === log.length - 1 ? 'new' : ''}`}>
                  {l.text}
                </li>
              ))}
            </ol>
          ) : (
            <HistoryPanel className="in-side" />
          )}
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
        {isDesk && <section className="side-box side-rules">{rulesChips}</section>}
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
            <li className="power-seq" title="Play several cards in one turn: same rank, or same suit one up or down.">
              <span className="mini-run" aria-hidden="true">
                {['2H', '3H', '4H'].map((id) => (
                  <CardFace key={id} noTag card={{ id, rank: id.slice(0, -1) as Card['rank'], suit: 'H' }} style={{ ['--cw' as string]: '26px' }} />
                ))}
              </span>
              <span>
                <b>Sequence</b>
                same rank, or same suit +/-1
              </span>
            </li>
          </ul>
        </section>
        <details className="side-box side-keys">
          <summary className="side-h">Keyboard</summary>
          <KeyList />
        </details>
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

      <Sheet open={historyOpen} onClose={() => setHistoryOpen(false)} title="Move history" tall>
        <HistoryPanel className="in-sheet" />
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
  if (view.handOver) return view.winner ? `${view.winner === view.you ? 'You' : nameOf(view.winner)} won the hand` : 'No winner this hand';
  if (view.spectator) return "You're watching - you'll be dealt in next hand";
  if (view.awaitingSuit && view.turn === view.you) return 'Name a suit for the opening Ace';
  if (view.turn === view.you) return view.penalty ? penaltyReason(view.penalty, view.rules) : 'Play a card or draw';
  return `${nameOf(view.turn)} is on the move`;
}
