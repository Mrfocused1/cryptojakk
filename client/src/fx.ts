// Turns the server's `events` into a short, ordered presentation queue: feed line, centre-stage callout,
// card flights and sounds. Purely cosmetic: the authoritative `view` is already rendered when this runs.
import { type Card, type GameEvent, type PlayerView, type Suit, SUIT_SYMBOL } from '@shared/engine';
import type { RoomSnapshot } from '@shared/protocol';
import { type NameCtx, describeGroup, groupEvents } from './describe';
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
  const drawRect = rectOf('[data-anchor="draw"]');
  const discardRect = rectOf('[data-anchor="discard"]');
  const handRect = rectOf('[data-anchor="hand"]');

  const steps: Step[] = [];
  let pendingReshuffle = false;
  const ctx: NameCtx = { me, nameOf: (id) => room?.players.find((p) => p.playerId === id)?.name ?? 'Player' };

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

  const groups = groupEvents(events);
  for (const g of groups) {
    const e = g.e;
    const line = describeGroup(g, ctx);
    switch (e.type) {
      case 'reshuffled':
        pendingReshuffle = true;
        break;
      case 'played': {
        const actor = e.playerId;
        const last = e.cards[e.cards.length - 1];
        let landSuit: Suit = last.suit;
        for (const x of g.extras) if (x.type === 'suitChosen') landSuit = x.suit;
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
          text: line?.text ?? '',
          callout: line?.callout,
          flights,
          sfx: 'flick',
          landTop: last,
          landSuit,
          dur: STEP + Math.max(0, e.cards.length - 1) * 90,
        });
        break;
      }
      case 'finishBlocked':
        if (line) steps.push({ text: line.text, callout: line.callout, flights: flightsDraw(e.playerId, e.count), sfx: 'alert', dur: STEP + 120 });
        break;
      case 'queenUncovered':
        if (line && !events.some((x) => x.type === 'finishBlocked' && x.playerId === e.playerId)) {
          steps.push({ text: line.text, callout: line.callout, flights: flightsDraw(e.playerId, e.count), sfx: 'alert', dur: STEP + 120 });
        }
        break;
      case 'drew': {
        if (e.reason === 'queenPenalty' || e.reason === 'finishPenalty') break; // shown with its own step
        if (!line) break;
        steps.push({
          text: (pendingReshuffle ? 'Pile reshuffled - ' : '') + line.text,
          callout: line.callout,
          flights: flightsDraw(e.playerId, e.count),
          sfx: 'draw',
          dur: STEP,
        });
        pendingReshuffle = false;
        break;
      }
      case 'jakkDeclared':
        if (line) steps.push({ text: line.text, callout: line.callout, flights: [], sfx: 'pop', dur: 260 });
        break;
      case 'jakkExpired':
        if (line) steps.push({ text: line.text, flights: [], dur: 220 });
        break;
      case 'provisionalFinish':
      case 'broughtBack':
      case 'satOut':
      case 'timedOut':
        if (line) steps.push({ text: line.text, callout: line.callout, flights: [], sfx: e.type === 'provisionalFinish' ? 'pop' : 'alert', dur: STEP + 160 });
        break;
      case 'skipped':
      case 'reversed':
      case 'suitChosen':
        if (line) steps.push({ text: line.text, callout: line.callout, flights: [], dur: 260 });
        break;
      case 'won':
      case 'handEnded':
        if (line) steps.push({ text: line.text, callout: e.type === 'won' ? line.callout : undefined, flights: [], dur: 240 });
        break;
      default:
        break; // turn, penaltyTaken (folded into drew), leftovers
    }
  }
  if (pendingReshuffle && steps.length === 0) steps.push({ text: 'The discard pile was shuffled into the deck', flights: [], dur: 200 });

  // Cards I drew arrive in my hand just after their flight lands.
  const freshDelay: Record<string, number> = {};
  if (!reduced) {
    let t = 0;
    for (const e of events) {
      if (e.type === 'drew' && e.playerId === me && e.cards) {
        for (const c of e.cards) freshDelay[c.id] = t + FLIGHT - 60;
      }
      if (e.type === 'played' || e.type === 'drew' || e.type === 'finishBlocked') t += STEP;
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
