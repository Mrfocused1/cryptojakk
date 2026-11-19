// Turn timer: a ring around the active seat's avatar and a big number for the active human. Server clock, absolute deadline.
import { useEffect, useState } from 'react';
import { type ClientTimer, serverNow } from './store';

export const URGENT_SECONDS = 5;

/** Remaining milliseconds of `timer` (re-rendered ~5 times a second); null when there is no timer. */
export function useRemaining(timer: ClientTimer | null): number | null {
  const [, tick] = useState(0);
  const deadline = timer?.deadline ?? null;
  useEffect(() => {
    if (deadline === null) return;
    const id = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, [deadline]);
  return timer ? Math.max(0, timer.deadline - serverNow()) : null;
}

export function secondsLeft(ms: number): number {
  return Math.ceil(ms / 1000);
}

/** Ring drawn over an avatar (size px). */
export function TimerRing({ timer, size }: { timer: ClientTimer; size: number }) {
  const ms = useRemaining(timer) ?? 0;
  const frac = Math.max(0, Math.min(1, ms / (timer.seconds * 1000)));
  const r = size / 2 - 2;
  const c = 2 * Math.PI * r;
  const urgent = secondsLeft(ms) <= URGENT_SECONDS;
  return (
    <svg className={`timer-ring ${urgent ? 'urgent' : ''}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" data-testid="timer-ring">
      <circle cx={size / 2} cy={size / 2} r={r} className="tr-bg" />
      <circle cx={size / 2} cy={size / 2} r={r} className="tr-fg" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}

/** Seconds + bar for the player whose turn it is (shown in the hand zone for me, in the seat's meta for others). */
export function TimerReadout({ timer, bar = false }: { timer: ClientTimer; bar?: boolean }) {
  const ms = useRemaining(timer) ?? 0;
  const s = secondsLeft(ms);
  const urgent = s <= URGENT_SECONDS;
  const frac = Math.max(0, Math.min(1, ms / (timer.seconds * 1000)));
  return (
    <span className={`timer-read ${urgent ? 'urgent' : ''}`} data-testid="timer-readout" data-seconds={s} role="timer" aria-label={`${s} seconds left`}>
      <b>{s}</b>
      <small>s</small>
      {bar && (
        <span className="timer-bar" aria-hidden="true">
          <i style={{ transform: `scaleX(${frac})` }} />
        </span>
      )}
    </span>
  );
}
