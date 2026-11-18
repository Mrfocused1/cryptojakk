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
import { Avatar, CardBack, CardFace, Sheet, SuitIcon, cardName } from './components';
import { HowToPlayContent } from './HowToPlay';
import { Results } from './Results';
import { act, leaveRoom, useApp, type Flight } from './store';
import { removeFlight } from './fx';
import { isMuted, playSfx, setMuted, subscribeMuted, unlockAudio } from './sound';

const RANK_ORDER = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUIT_ORDER: Suit[] = ['S', 'H', 'C', 'D'];

function sortHand(hand: Card[]): Card[] {
  return hand
    .slice()
    .sort((a, b) => SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit) || RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank));
}

function useMuted(): boolean {
  return useSyncExternalStore(subscribeMuted, isMuted, isMuted);
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

function Seat({ player, count, active, jakk, dealing }: { player: LobbyPlayer; count: number; active: boolean; jakk: boolean; dealing: boolean }) {
  const shown = Math.min(count, 6);
  return (
    <div className={`seat ${active ? 'active' : ''} ${!player.connected && !player.isBot ? 'away' : ''}`} data-anchor={`seat-${player.playerId}`} data-testid={`seat-${player.playerId}`}>
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
            <CardBack key={i} className={dealing ? 'deal-in' : ''} style={{ ['--i' as string]: i, ['--n' as string]: shown, ['--cw' as string]: '24px' } as CSSProperties} />
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
  fresh: number | undefined;
  dealing: boolean;
  view: PlayerView;
  onTap: (c: Card) => void;
}

function HandCard({ card, index, left, top, z, legal, dim, selected, order, shake, fresh, dealing, view, onTap }: HandCardProps) {
  const label = `${cardName(card)}${selected ? `, selected, play order ${order}` : legal ? ', playable' : dim ? ', not playable' : ''}`;
  const cls = ['hc', legal ? 'legal' : '', dim ? 'dim' : '', selected ? 'selected' : '', shake ? 'shake' : '', fresh !== undefined ? 'fresh' : '', dealing ? 'dealt' : ''].filter(Boolean).join(' ');
  const style: CSSProperties = { left, top, zIndex: selected ? 200 : z, ['--i' as string]: index, ['--d' as string]: `${fresh ?? 0}ms` };
  return (
    <button className={cls} style={style} data-hand-card={card.id} data-legal={legal ? 'true' : 'false'} data-selected={selected ? 'true' : 'false'} aria-label={label} aria-pressed={selected} onClick={() => onTap(card)}>
      <CardFace card={card} rules={view.rules} />
      {selected && order > 0 && <span className="order">{order}</span>}
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
  const muted = useMuted();
  const [showResults, setShowResults] = useState(false);

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
    if (needsSuitChoice(view!, sel)) setSuitOpen(true);
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

  // ---- hand geometry
  const pad = 10;
  const avail = Math.max(200, handW - pad * 2);
  const cw = Math.max(50, Math.min(92, Math.round(handW * 0.21)));
  const ch = Math.round(cw * 1.42);
  const n = sorted.length;
  const idealStep = cw * 0.62;
  const fit1 = n <= 1 ? idealStep : (avail - cw) / (n - 1);
  const minStep = cw * 0.3;
  const rows = fit1 >= minStep * 1.02 ? 1 : 2;
  const perRow = Math.ceil(n / rows);
  const step = Math.max(minStep, Math.min(idealStep, perRow <= 1 ? idealStep : (avail - cw) / (perRow - 1)));
  const rowW = cw + (perRow - 1) * step;
  const innerW = Math.max(handW, rowW + pad * 2);
  const left0 = (innerW - rowW) / 2;
  const lift = 36;
  const rowGap = Math.round(ch * 0.52);
  const handH = lift + ch + (rows - 1) * rowGap + 6;

  const dealingCls = dealing ? 'dealing' : '';
  const others = (() => {
    const idx = view.players.indexOf(me);
    const order = [...view.players.slice(idx + 1), ...view.players.slice(0, idx)];
    return order.map((id) => room.players.find((p) => p.playerId === id)).filter((p): p is LobbyPlayer => !!p);
  })();

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

  return (
    <div className={`screen table-screen ${dealingCls} ${myTurn ? 'my-turn' : ''}`} data-testid="table" data-turn={myTurn ? 'me' : 'other'} data-version={view.version} data-dir={view.direction}>
      <header className="table-top">
        <button className="icon-btn" aria-label="How to play" onClick={() => setRulesOpen(true)}>
          ?
        </button>
        <span className="room-chip" aria-hidden="true">
          {room.mode === 'friends' ? room.code : 'vs bots'}
        </span>
        <button className="icon-btn" aria-label={muted ? 'Sound off. Turn sound on' : 'Sound on. Turn sound off'} onClick={() => setMuted(!muted)}>
          {muted ? '🔇' : '🔊'}
        </button>
        <button className="icon-btn" aria-label="Menu" onClick={() => setMenuOpen(true)}>
          ⋯
        </button>
      </header>

      <section className="seats" aria-label="Opponents">
        {others.map((p) => (
          <Seat key={p.playerId} player={p} count={view.handCounts[p.playerId] ?? 0} active={view.turn === p.playerId && !view.winner} jakk={(view.handCounts[p.playerId] ?? 0) === 1} dealing={dealing} />
        ))}
      </section>

      <section className="centre" aria-label="Table">
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
          <div className="suit-chip" data-testid="active-suit" data-suit={view.activeSuit} aria-label={`Active suit: ${SUIT_NAME[view.activeSuit]}`}>
            <span className="suit-cap">SUIT</span>
            <span className={`suit-box ${suitRed ? 'red' : 'black'}`} key={view.activeSuit}>
              <SuitIcon suit={view.activeSuit} />
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

      <div className={`feed ${hint ? 'hint' : ''}`} aria-live="polite" data-testid="feed">
        <span key={hint?.id ?? feed?.id ?? 0}>{feedText}</span>
      </div>

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
        <button className="btn secondary draw-btn" data-testid="draw-btn" onClick={onDraw} disabled={!myTurn} data-penalty={penalty && myTurn ? 'true' : 'false'}>
          <span>{drawLabel}</span>
        </button>
        <button
          className={`btn jakk-btn ${owed ? 'owed' : jakkArmed ? 'armed' : armable ? 'armable' : ''}`}
          data-testid="jakk-btn"
          data-state={owed ? 'owed' : jakkArmed ? 'armed' : armable ? 'armable' : 'idle'}
          onClick={onJakk}
          disabled={!view.rules.jakkEnabled || (!owed && !armable && !(myTurn && handCount <= 3))}
          aria-pressed={jakkArmed}
          aria-label={owed ? 'Declare JAKK now' : jakkArmed ? 'JAKK armed. Tap to cancel' : 'JAKK'}
        >
          {jakkArmed ? 'JAKK ✓' : 'JAKK'}
        </button>
        <button className="btn primary play-btn" data-testid="play-btn" onClick={onPlay} disabled={!canPlay}>
          <span>Play{sel.length > 0 ? ` ${sel.length}` : ''}</span>
        </button>
      </footer>

      <FlightLayer />

      <Sheet open={suitOpen} onClose={() => setSuitOpen(false)} title="Choose a suit">
        <div className="suit-grid" data-testid="suit-picker">
          {SUITS.map((s) => (
            <button key={s} className={`suit-btn ${s === 'H' || s === 'D' ? 'red' : 'black'}`} onClick={() => sendPlay(s)} aria-label={SUIT_NAME[s]} data-suit={s}>
              <SuitIcon suit={s} />
              <span>{SUIT_NAME[s]}</span>
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={rulesOpen} onClose={() => setRulesOpen(false)} title="How to play" tall>
        <HowToPlayContent />
      </Sheet>

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu">
        <div className="menu-list">
          <button
            className="btn secondary wide"
            onClick={() => {
              setMenuOpen(false);
              setRulesOpen(true);
            }}
          >
            How to play
          </button>
          <button className="btn secondary wide" onClick={() => setMuted(!muted)}>
            Sound: {muted ? 'off' : 'on'}
          </button>
          <button
            className="btn danger wide"
            onClick={() => {
              setMenuOpen(false);
              setConfirmLeave(true);
            }}
          >
            Leave game
          </button>
        </div>
      </Sheet>

      <Sheet open={confirmLeave} onClose={() => setConfirmLeave(false)} title="Leave this game?">
        <p className="sheet-text">{room.mode === 'friends' ? 'A bot will take your seat and play on without you.' : 'The game will end.'}</p>
        <div className="menu-list">
          <button className="btn secondary wide" onClick={() => setConfirmLeave(false)}>
            Keep playing
          </button>
          <button className="btn danger wide" data-testid="confirm-leave" onClick={leaveRoom}>
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

