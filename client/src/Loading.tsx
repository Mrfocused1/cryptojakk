// Loading screen: the Crypto Jakk wordmark morphs "Crypto Jakk" <-> "Loading" while the player waits for the server.
// Glyphs are absolutely placed text spans (measured Poppins 900 italic, em units) animated with CSS keyframes only:
// transform/opacity, no per-frame JS. The spade is the "a" of Jakk and Loading and flips between the two slots.
import { type CSSProperties, useEffect, useState } from 'react';
import { useReduce } from './prefs';
import { type Route, navigate, useRoute } from './router';
import { SUIT_PATH } from './suitPaths';
import { type AppState, cancelConnect, useApp } from './store';
import './loading.css';

/** Never show the screen for waits shorter than this (fast connections must not flash it). */
export const SHOW_DELAY_MS = 350;
/** Fade-out when the wait is over. */
export const FADE_MS = 200;
const NAP_HINT_MS = 6000;
const PLAY_CPU_MS = 15000;

type Glyph = { c: string; x: number; k: 'out' | 'in' | 'sh'; d: number; to?: number };
// x = left edge in em inside the stage (PAD included). out = only in "Crypto Jakk", in = only in "Loading", sh = shared (travels).
const PAD = 0.22;
const LOGO: Glyph[] = [
  { c: 'C', x: 0, k: 'out', d: 0 },
  { c: 'r', x: 0.718, k: 'out', d: 0.02 },
  { c: 'y', x: 1.15, k: 'out', d: 0.04 },
  { c: 'p', x: 1.792, k: 'out', d: 0.06 },
  { c: 't', x: 2.437, k: 'out', d: 0.08 },
  { c: 'o', x: 2.838, k: 'sh', d: 0.06, to: 1.496 },
  { c: 'J', x: 3.574, k: 'out', d: 0.1 },
  { c: 'k', x: 4.774, k: 'out', d: 0.12 },
  { c: 'k', x: 5.415, k: 'out', d: 0.14 },
];
const LOADING: Glyph[] = [
  { c: 'L', x: 1.025, k: 'in', d: 0 },
  { c: 'd', x: 2.742, k: 'in', d: 0.04 },
  { c: 'ı', x: 3.387, k: 'in', d: 0.06 },
  { c: 'n', x: 3.724, k: 'in', d: 0.08 },
  { c: 'g', x: 4.386, k: 'in', d: 0.1 },
];
// Spade "a": centre x in the logo slot and in the Loading slot.
const SP_FROM = 4.451;
const SP_TO = 2.419;
const SP_W = 0.7;

const FONT_Q = ['italic 800', 'italic 900', '800', '900'];
let fontsPromise: Promise<unknown> | null = null;
function loadFonts(): Promise<unknown> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  fontsPromise ??= Promise.race([
    Promise.all(FONT_Q.map((w) => document.fonts.load(`${w} 1em Poppins`, 'Crypto Jakk Loadıng'))).catch(() => undefined),
    new Promise((r) => setTimeout(r, 4000)),
  ]);
  return fontsPromise;
}
function fontsAlready(): boolean {
  try {
    return typeof document === 'undefined' || !document.fonts || FONT_Q.every((w) => document.fonts.check(`${w} 1em Poppins`, 'Crypto Jakk Loadıng'));
  } catch {
    return true;
  }
}
/** True once the self-hosted Poppins faces are usable. Starts true when they already are (no state flip, no splash). */
function useFontsReady(): boolean {
  const [ok, setOk] = useState(fontsAlready);
  useEffect(() => {
    if (ok) return;
    let live = true;
    void loadFonts().then(() => live && setOk(true));
    return () => {
      live = false;
    };
  }, [ok]);
  return ok;
}

const MQ = '(prefers-reduced-motion: reduce)';
/** The OS preference or the app's own "reduce animation" setting. */
function useReducedMotion(): boolean {
  const setting = useReduce();
  const [os, setOs] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(MQ).matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const m = matchMedia(MQ);
    const f = () => setOs(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return setting || os;
}

let watching = false;
/** Pause every loader animation while the tab is hidden. */
function watchVisibility(): void {
  if (watching || typeof document === 'undefined') return;
  watching = true;
  const f = () => {
    document.documentElement.dataset.ljHidden = document.hidden ? '1' : '0';
  };
  document.addEventListener('visibilitychange', f);
  f();
}

const em = (n: number) => `${+(n + PAD).toFixed(3)}em`;
const style = (v: Record<string, string | number>) => v as CSSProperties;

function Spade({ cls = '', st }: { cls?: string; st?: CSSProperties }) {
  return (
    <svg className={cls} style={st} viewBox="3.4 1.4 17.2 21" fill="currentColor" aria-hidden="true" focusable="false">
      {SUIT_PATH.S}
    </svg>
  );
}

function Word({ glyphs, spadeAt, cls }: { glyphs: Glyph[]; spadeAt: number; cls: string }) {
  return (
    <span className={`wm-layer ${cls}`}>
      {glyphs.map((g, i) => (
        <span key={i} className="g" style={style({ '--x': em(g.x) })}>
          {g.c}
        </span>
      ))}
      <Spade cls="sp" st={style({ '--x': em(spadeAt - SP_W / 2) })} />
    </span>
  );
}

/** The animated wordmark. Size it with font-size on a parent (stage width is 6.5em). */
function Wordmark({ reduced }: { reduced: boolean }) {
  useEffect(watchVisibility, []);
  if (reduced) {
    // Reduced motion: two static words crossfading slowly. No movement, no shine.
    return (
      <span className="wm rm" aria-hidden="true">
        <Word glyphs={LOGO.map((g) => ({ ...g, x: g.x }))} spadeAt={SP_FROM} cls="rm-a" />
        <Word glyphs={[LOADING[0], { c: 'o', x: 1.496, k: 'sh', d: 0 }, ...LOADING.slice(1)]} spadeAt={SP_TO} cls="rm-b" />
      </span>
    );
  }
  return (
    <span className="wm" aria-hidden="true">
      {[...LOGO, ...LOADING].map((g, i) => (
        <span
          key={i}
          className={`g ${g.k}`}
          style={style({ '--x': em(g.x), '--d': `${g.d}s`, ...(g.to !== undefined ? { '--dx': `${+(g.to - g.x).toFixed(3)}em` } : {}) })}
        >
          {g.c}
        </span>
      ))}
      <Spade cls="g sp sh" st={style({ '--x': em(SP_FROM - SP_W / 2), '--dx': `${+(SP_TO - SP_FROM).toFixed(3)}em`, '--d': '0.1s' })} />
      <Spade cls="g tit" st={style({ '--x': em(3.5) })} />
    </span>
  );
}

/** Tiny inline version of the same morph for buttons and panels. size = font-size in px (wordmark is 6.5 x that wide). */
export function LogoLoader({ size = 14, className = '' }: { size?: number; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <span className={`lj-mini ${className}`} role="status" aria-label="Loading" style={{ fontSize: size }}>
      <Wordmark reduced={reduced} />
    </span>
  );
}

export interface LoadingScreenProps {
  /** Optional calm line under the wordmark from the start. */
  message?: string;
  /** Offers "Play vs CPU instead" after ~15 s so the player is never trapped. */
  onPlayAI?: () => void;
  /** Fading out (the wait is over). */
  leaving?: boolean;
  /** Preview/testing only: pretend this many seconds have already passed. */
  elapsed?: number;
}

export function LoadingScreen({ message, onPlayAI, leaving = false, elapsed = 0 }: LoadingScreenProps) {
  const reduced = useReducedMotion();
  const ready = useFontsReady();
  const [t, setT] = useState(elapsed * 1000);
  useEffect(() => {
    const t0 = Date.now() - elapsed * 1000;
    const ids = [NAP_HINT_MS, PLAY_CPU_MS].map((ms) => setTimeout(() => setT(Date.now() - t0), Math.max(0, ms - elapsed * 1000)));
    return () => ids.forEach(clearTimeout);
  }, [elapsed]);
  const line = t >= PLAY_CPU_MS ? 'Free servers nap when idle — this can take up to 30 seconds' : t >= NAP_HINT_MS ? 'Waking the game server…' : message;
  return (
    <div className={`lscr ${leaving ? 'leaving' : ''} ${ready ? '' : 'nofont'}`} data-testid="loading-screen">
      <div className="lscr-glow" aria-hidden="true" />
      <div className="lscr-mid">
        <Wordmark reduced={reduced} />
      </div>
      <div className="lscr-low">
        <div role="status" aria-live="polite" className="lscr-live">
          <span className="sr-only">Loading</span>
          {line && (
            <p className="lscr-msg" key={line} data-testid="loading-msg">
              {line}
            </p>
          )}
        </div>
        {onPlayAI && t >= PLAY_CPU_MS && (
          <button className="pill secondary lscr-btn" data-testid="loading-play-ai" onClick={onPlayAI}>
            Play vs CPU instead
          </button>
        )}
      </div>
    </div>
  );
}

/** Does the app currently wait on the multiplayer server with nothing else to show? Pure, so it is easy to test. */
export function shouldWait(s: Pick<AppState, 'unsupported' | 'room' | 'conn' | 'resuming' | 'joining'>, route: Route): boolean {
  if (s.unsupported || s.room) return false;
  if (!(route.name === 'friends' || route.name === 'join' || s.resuming)) return false;
  if (s.conn === 'connecting' || s.conn === 'reconnecting') return true;
  if (s.conn === 'open') return s.resuming || (route.name === 'join' && s.joining);
  return false;
}

/** Mounted once in App: waits SHOW_DELAY_MS before showing (so quick connections never flash it) and fades out. */
export function LoadingGate() {
  const app = useApp();
  const route = useRoute();
  const fontsReady = useFontsReady();
  const want = !fontsReady || shouldWait(app, route);
  const [phase, setPhase] = useState<'off' | 'on' | 'out'>('off');
  useEffect(() => {
    if (want) {
      if (phase === 'out') setPhase('on');
      if (phase !== 'off') return;
      const id = setTimeout(() => setPhase('on'), SHOW_DELAY_MS);
      return () => clearTimeout(id);
    }
    if (phase === 'on') setPhase('out');
  }, [want]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (phase !== 'out') return;
    const id = setTimeout(() => setPhase('off'), FADE_MS);
    return () => clearTimeout(id);
  }, [phase]);
  if (phase === 'off') return null;
  const mp = shouldWait(app, route);
  return (
    <LoadingScreen
      leaving={phase === 'out'}
      onPlayAI={
        mp
          ? () => {
              cancelConnect();
              navigate('/ai');
            }
          : undefined
      }
    />
  );
}
