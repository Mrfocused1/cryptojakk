// Turns the server's `events` into a short, ordered presentation queue: feed line, centre-stage callout,
// card flights and sounds. Purely cosmetic: the authoritative `view` is already rendered when this runs.
import { type Card, type GameEvent, type PlayerView, SUIT_SYMBOL, isRedSuit } from '@shared/engine';
import type { RoomSnapshot } from '@shared/protocol';
import { playSfx, type Sfx } from './sound';
import { isReduced } from './prefs';
import { type Callout, type Flight, type Rect, getState, patch } from './store';

let timers: ReturnType<typeof setTimeout>[] = [];
let idc = 1;

export function cancelFx(): void {
  for (const t of timers) clearTimeout(t);
  timers = [];
}

function later(ms: number, fn: () => void): void {
  timers.push(setTimeout(fn, ms));
}

const STEP = 340;
const FLIGHT = 300;

interface Step {
  text: string;
  callout?: Omit<Callout, 'id'>;
  flights: Flight[];
  sfx?: Sfx;
  landTop?: Card;
  landSuit?: Suit;
  dur: number;
}

function rectOf(sel: string): Rect | null {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

function centred(r: Rect, w: number, h: number): Rect {
  return { x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h };
}

export function cardLabel(c: Card): string {
  return `${c.rank}${SUIT_SYMBOL[c.suit]}`;
}

/** Capture DOM geometry NOW (before React re-renders the new view) and return a function that starts the queue. */
export function planEvents(events: GameEvent[], prev: PlayerView | null, view: PlayerView, room: RoomSnapshot | null): () => void {
  const reduced = isReduced();
  const me = view.you;
  const nameOf = (id: string) => (id === me ? 'You' : (room?.players.find((p) => p.playerId === id)?.name ?? 'Player'));
  const verb = (id: string, you: string, other: string) => (id === me ? you : other);
  const drawRect = rectOf('[data-anchor="draw"]');
  const discardRect = rectOf('[data-anchor="discard"]');
  const handRect = rectOf('[data-anchor="hand"]');

  const steps: Step[] = [];
  let pendingReshuffle = false;

  const flightsDraw = (pid: string, count: number): Flight[] => {
    if (!drawRect) return [];
    const to = pid === me ? handRect && centred(handRect, drawRect.w, drawRect.h) : rectOf(`[data-anchor="seat-${pid}"]`);
    if (!to) return [];
    const dest = pid === me ? to : centred(to, drawRect.w * 0.55, drawRect.h * 0.55);
    const out: Flight[] = [];
    for (let k = 0; k < Math.min(count, 5); k++) {
      out.push({ id: idc++, card: null, from: drawRect, to: dest, delay: k * 70, dur: FLIGHT, rot: (k - 1) * 4 });
    }
    return out;
  };

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    switch (e.type) {
      case 'reshuffled':
        pendingReshuffle = true;
        break;
      case 'played': {
        const actor = e.playerId;
        const bits: string[] = [];
        let callout: Step['callout'];
        let landSuit: Suit = e.cards[e.cards.length - 1].suit;
        const setCallout = (c: Step['callout']) => {
          if (!callout || callout.kind !== 'danger') callout = c;
        };
        let j = i + 1;
        for (; j < events.length; j++) {
          const n = events[j];
          if (n.type === 'reversed') {
            bits.push('direction reversed');
            setCallout({ text: 'REVERSE', kind: 'info' });
          } else if (n.type === 'skipped') {
            const msg = `${nameOf(n.who)} skipped`;
            if (!bits.includes(msg)) bits.push(msg);
            setCallout({ text: 'SKIP', kind: 'info' });
          } else if (n.type === 'suitChosen') {
            landSuit = n.suit;
            bits.push(`suit is now ${SUIT_SYMBOL[n.suit]}`);
            setCallout({ text: SUIT_SYMBOL[n.suit], kind: isRedSuit(n.suit) ? 'red' : 'black' });
          } else if (n.type === 'penaltyAdded') {
            bits.push(`+${n.total} to pick up`);
            callout = { text: `+${n.total}`, kind: 'danger' };
          } else if (n.type === 'penaltyCancelled') {
            bits.push('penalty cancelled');
            setCallout({ text: 'CANCELLED', kind: 'good' });
          } else if (n.type === 'jakkDeclared') {
            bits.push('JAKK!');
            setCallout({ text: 'JAKK!', kind: 'good' });
          } else if (n.type === 'turn' && n.playerId === actor) {
            bits.push(actor === me ? 'you go again' : 'goes again');
            if (!callout) setCallout({ text: 'GO AGAIN', kind: 'info' });
          } else break;
        }
        i = j - 1;
        if (e.cards[e.cards.length - 1].rank === 'Q' && view.rules.queenAcceptsAny) {
          bits.push('play anything');
          setCallout({ text: 'ANY CARD', kind: 'info' });
        }
        const flights: Flight[] = [];
        const to = discardRect;
        const seat = actor === me ? null : rectOf(`[data-anchor="seat-${actor}"]`);
        e.cards.forEach((c, k) => {
          let from: Rect | null;
          if (actor === me) from = rectOf(`[data-hand-card="${c.id}"]`);
          else from = seat ? centred(seat, (discardRect?.w ?? 60) * 0.6, (discardRect?.h ?? 84) * 0.6) : null;
          if (from && to) flights.push({ id: idc++, card: c, from, to, delay: k * 90, dur: FLIGHT, rot: (k % 2 ? 1 : -1) * (3 + k * 2) });
        });
        steps.push({
          text: `${nameOf(actor)} played ${e.cards.map(cardLabel).join(' ')}${bits.length ? ' - ' + bits.join(', ') : ''}`,
          callout,
          flights,
          sfx: 'flick',
          landTop: e.cards[e.cards.length - 1],
          landSuit,
          dur: STEP + Math.max(0, e.cards.length - 1) * 90,
        });
        break;
      }
      case 'jakkMissed': {
        const next = events[i + 1];
        const count = next && next.type === 'drew' && next.reason === 'jakkMiss' ? next.count : view.rules.jakkMissPenalty;
        if (next && next.type === 'drew' && next.reason === 'jakkMiss') i++;
        steps.push({
          text: `${nameOf(e.playerId)} forgot to call JAKK: +${count}`,
          callout: { text: 'MISSED JAKK', kind: 'danger' },
          flights: flightsDraw(e.playerId, count),
          sfx: 'alert',
          dur: STEP + 120,
        });
        break;
      }
      case 'drew': {
        const penalty = e.reason === 'penalty';
        const text = e.count === 1 && !penalty ? `${nameOf(e.playerId)} ${verb(e.playerId, 'draw', 'draws')} a card` : `${nameOf(e.playerId)} ${verb(e.playerId, 'pick up', 'picks up')} ${e.count}`;
        steps.push({
          text: (pendingReshuffle ? 'Pile reshuffled - ' : '') + text,
          callout: penalty && e.count > 1 ? { text: `+${e.count}`, kind: 'danger' } : undefined,
          flights: flightsDraw(e.playerId, e.count),
          sfx: 'draw',
          dur: STEP,
        });
        pendingReshuffle = false;
        break;
      }
      case 'jakkDeclared':
        steps.push({ text: `${nameOf(e.playerId)} called JAKK!`, callout: { text: 'JAKK!', kind: 'good' }, flights: [], sfx: 'pop', dur: 260 });
        break;
      case 'won':
        steps.push({ text: `${nameOf(e.playerId)} ${verb(e.playerId, 'win', 'wins')}!`, flights: [], dur: 200 });
        break;
      default:
        break; // turn, penaltyTaken (folded into drew), leftovers
    }
  }
  if (pendingReshuffle && steps.length === 0) steps.push({ text: 'Discard pile reshuffled', flights: [], dur: 200 });

  // Cards I drew arrive in my hand just after their flight lands.
  const freshDelay: Record<string, number> = {};
  if (!reduced) {
    let t = 0;
    for (const e of events) {
      if (e.type === 'drew' && e.playerId === me && e.cards) {
        for (const c of e.cards) freshDelay[c.id] = t + FLIGHT - 60;
      }
      if (e.type === 'played' || e.type === 'drew' || e.type === 'jakkMissed') t += STEP;
    }
  }

  return () => {
    cancelFx();
    const hasPlay = steps.some((s) => s.landTop);
    if (hasPlay && prev && !reduced) patch({ topOverride: prev.topDiscard, suitOverride: prev.activeSuit });
    if (Object.keys(freshDelay).length) {
      patch({ freshDelay });
      later(2200, () => patch({ freshDelay: {} }));
    }
    let t = 0;
    steps.forEach((s, idx) => {
      later(t, () => {
        const cid = idc++;
        patch({
          feed: { id: cid, text: s.text },
          callout: s.callout ? { id: cid, ...s.callout } : getState().callout,
          flights: reduced ? getState().flights : [...getState().flights, ...s.flights],
        });
        if (s.sfx) playSfx(s.sfx);
        if (s.callout) {
          later(1000, () => {
            if (getState().callout?.id === cid) patch({ callout: null });
          });
        }
        if (s.landTop && !reduced) {
          const card = s.landTop;
          const suit = s.landSuit ?? card.suit;
          later(FLIGHT, () => patch({ topOverride: card, suitOverride: suit }));
        }
      });
      t += s.dur;
      if (idx === steps.length - 1) later(t - 30, () => patch({ topOverride: null, suitOverride: null }));
    });
  };
}

export function removeFlight(id: number): void {
  patch({ flights: getState().flights.filter((f) => f.id !== id) });
}
