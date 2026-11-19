// Loading screen. The traced Crypto Jakk logo (logoPaths.ts) IS the loader: the frame draws on, the lettering rises in, then
// the lockup loops  logo -> "Loading" -> logo  while the card outline carries a chasing light. Pure SVG + CSS (transform,
// opacity, stroke-dashoffset, mask); no per-frame JS. Shared glyphs travel: p turns into d, o glides, the spade flips into the "a".
import { type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import { useReduce } from './prefs';
import { type Route, navigate, useRoute } from './router';
import { SUIT_PATH } from './suitPaths';
import { type AppState, cancelConnect, useApp } from './store';
import { BBOX, CARD, CENTER, LOADING_PATHS as LP, LOGO_H, LOGO_PATHS as LG, LOGO_VIEWBOX, SHARED } from './logoPaths';
import './loading.css';

/** Never show the screen for waits shorter than this (fast connections must not flash it). */
export const SHOW_DELAY_MS = 350;
/** Fade-out when the wait is over. */
export const FADE_MS = 200;
const NAP_HINT_MS = 6000;
const PLAY_CPU_MS = 15000;
/** Intro length in seconds; the loop starts here. */
const INTRO = 2.1;

const FONT_Q = ['italic 800', 'italic 900', '800', '900'];
let fontsPromise: Promise<unknown> | null = null;
function loadFonts(): Promise<unknown> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  fontsPromise ??= Promise.race([
    Promise.all(FONT_Q.map((w) => document.fonts.load(`${w} 1em Poppins`, 'Crypto Jakk'))).catch(() => undefined),
    new Promise((r) => setTimeout(r, 4000)),
  ]);
  return fontsPromise;
}
function fontsAlready(): boolean {
  try {
    return typeof document === 'undefined' || !document.fonts || FONT_Q.every((w) => document.fonts.check(`${w} 1em Poppins`, 'Crypto Jakk'));
  } catch {
    return true;
  }
}
/** True once the self-hosted Poppins faces are usable (the app's own headings need them). Starts true when they already are. */
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

/** One path for the whole outline (outer then fold), used by the chase. */
const LOOP = CENTER.outer + CENTER.fold.slice(CENTER.fold.indexOf('C'));
const sv = (v: Record<string, string | number>) => v as CSSProperties;
type Box = readonly [number, number, number, number];
const BX = BBOX as unknown as Record<string, Box>;
/** Explicit transform origin (glyph bbox centre, viewBox px) so no browser has to resolve transform-box. */
const org = (k: string, extra: Record<string, string | number> = {}) =>
  sv({ '--ox': `${+((BX[k][0] + BX[k][2]) / 2).toFixed(1)}px`, '--oy': `${+((BX[k][1] + BX[k][3]) / 2).toFixed(1)}px`, ...extra });
const cy = (k: string) => (BX[k][1] + BX[k][3]) / 2;

// Logo-only letters [path key, loop stagger s, intro delay s]; Loading-only letters [path key, loop stagger s].
const OUT: [keyof typeof LG, number, number][] = [
  ['C', 0, 0.9],
  ['r', 0.03, 0.96],
  ['y', 0.05, 1.02],
  ['t', 0.08, 1.14],
  ['J', 0.06, 1.3],
  ['k1', 0.09, 1.5],
  ['k2', 0.1, 1.56],
];
const INN: [keyof typeof LP, number][] = [
  ['L', 0.04],
  ['i', 0.06],
  ['n', 0.08],
  ['g', 0.1],
];
/** o does not cross p or the spade on the straight line: it arcs over the top lane (centre y = LANE) and drops into its slot. */
const LANE = 272;
const rmT = (k: 'o' | 'a', home: string) => {
  const s = SHARED[k];
  const b = BX[home];
  const cx = (b[0] + b[2]) / 2;
  const c = (b[1] + b[3]) / 2;
  return `translate(${s.dx} ${s.dy}) translate(${cx} ${c}) scale(${s.s}) translate(${-cx} ${-c})`;
};
const sh = (k: 'p' | 'o' | 'a') => ({ '--dx': `${SHARED[k].dx}px`, '--dy': `${SHARED[k].dy}px`, '--s': SHARED[k].s });

/*
 * Compatibility notes (WebKit could not be tested here, so the conservative route is used):
 *  - No SVG <mask>: stroke-dashoffset is never animated inside a mask. The frame draws on as a plainly visible stroked
 *    centre-line (same ink colour), then cross-fades to the traced filled frame. The chase light is a plain stroked
 *    centre-line with a dash array, narrower than the ink band.
 *  - No `transform-box: fill-box`: every transform origin is an explicit viewBox-pixel pair (--ox / --oy).
 *  - No per-glyph <clipPath> rises: letters fade and scale (no cropped glyphs); the only clipPath left is the one-off sheen.
 */

/** The lockup. Reduced motion: static frame, the two words crossfading slowly (no travel, chase or parallax). */
function Lockup({ reduced }: { reduced: boolean }) {
  const id = useId().replace(/:/g, '');
  useEffect(watchVisibility, []);
  const u = (k: string) => `${id}${k}`;
  const sheenIds = ['frameOuter', 'frameFold', 'C', 'r', 'y', 'p', 't', 'o', 'J', 'spade', 'k1', 'k2'] as const;
  const oUp = LANE - cy('o');
  return (
    <svg className={`lg ${reduced ? 'rm' : ''}`} viewBox={LOGO_VIEWBOX} aria-hidden="true" focusable="false" style={sv({ '--T': `${INTRO}s` })}>
      <defs>
        {sheenIds.map((k) => (
          <path key={k} id={u(k)} d={LG[k]} />
        ))}
        <clipPath id={u('sh')}>
          {sheenIds.map((k) => (
            <use key={k} href={`#${u(k)}`} />
          ))}
        </clipPath>
        <linearGradient id={u('sg')} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#baffd2" stopOpacity="0" />
          <stop offset="0.5" stopColor="#c8ffe0" stopOpacity="0.95" />
          <stop offset="1" stopColor="#baffd2" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="card" d={CARD} />
      <g className="ink fill">
        <use href={`#${u('frameOuter')}`} />
        <use href={`#${u('frameFold')}`} />
      </g>
      {reduced ? (
        <g className="ink">
          <g className="rm-a">
            {OUT.map(([k]) => (
              <use key={k} href={`#${u(k)}`} />
            ))}
            <use href={`#${u('p')}`} />
            <use href={`#${u('o')}`} />
            <use href={`#${u('spade')}`} />
          </g>
          <g className="rm-b">
            <path d={LP.dClean} />
            <path d={LP.L} />
            <path d={LP.i} />
            <path d={LP.n} />
            <path d={LP.g} />
            <use href={`#${u('o')}`} transform={rmT('o', 'o')} />
            <use href={`#${u('spade')}`} transform={rmT('a', 'spade')} />
          </g>
        </g>
      ) : (
        <>
          <g className="draw" aria-hidden="true">
            <path className="dr dr0" d={CENTER.outer} pathLength={1} />
            <path className="dr dr1" d={CENTER.fold} pathLength={1} />
          </g>
          <g className="glint">
            <path className="gl0" d={CENTER.outer} pathLength={1} />
            <path className="gl1" d={CENTER.fold} pathLength={1} />
          </g>
          <g className="chase" aria-hidden="true">
            <path className="ch glow" d={LOOP} pathLength={1} style={sv({ '--l': 0.2 })} />
            <path className="ch core" d={LOOP} pathLength={1} style={sv({ '--l': 0.12 })} />
            <path className="ch head" d={LOOP} pathLength={1} style={sv({ '--l': 0.035 })} />
          </g>
          <g className="ink intro">
            {[...OUT.map((o) => [o[0] as string, o[2]] as const), ['p', 1.08] as const, ['o', 1.2] as const, ['spade', 1.4] as const].map(([k, d]) => (
              <use key={k} className={k === 'spade' ? 'pop' : 'ri'} href={`#${u(k)}`} style={org(k, { '--i': `${d}s` })} />
            ))}
          </g>
          <g className="ink loopl">
            {OUT.map(([k, d]) => (
              <path key={k} className="lo out" d={LG[k]} style={org(k, { '--d': `${d}s` })} />
            ))}
            {INN.map(([k, d]) => (
              <path key={k} className="lo inn" d={LP[k]} style={org(k, { '--d': `${d}s` })} />
            ))}
            <path className="lo tp" d={LG.p} style={org('p', sh('p'))} />
            <path className="lo dcl" d={LP.dClean} />
            <path className="lo sp" d={LG.spade} style={org('spade', sh('a'))} />
            <g className="lo ax" style={sv({ '--dx': `${SHARED.o.dx}px` })}>
              <path className="lo ay" d={LG.o} style={org('o', { ...sh('o'), '--up': `${+oUp.toFixed(1)}px` })} />
            </g>
          </g>
          <g clipPath={`url(#${u('sh')})`} className="sheen">
            <rect className="sw" x={-260} y={-60} width={260} height={LOGO_H + 120} fill={`url(#${u('sg')})`} />
          </g>
        </>
      )}
    </svg>
  );
}

const PIPS: { s: 'S' | 'H' | 'D' | 'C'; x: number; y: number; z: number; t: number; o: number }[] = [
  { s: 'S', x: 9, y: 16, z: 26, t: 23, o: 0.07 },
  { s: 'H', x: 84, y: 12, z: 20, t: 29, o: 0.06 },
  { s: 'D', x: 90, y: 66, z: 30, t: 26, o: 0.06 },
  { s: 'C', x: 6, y: 74, z: 22, t: 31, o: 0.07 },
  { s: 'S', x: 70, y: 88, z: 18, t: 21, o: 0.05 },
];

/** Compact inline loader (buttons, panels): the traced spade doing a coin flip. size = height in px. Takes the text colour. */
export function LogoLoader({ size = 14, className = '' }: { size?: number; className?: string }) {
  const reduced = useReducedMotion();
  useEffect(watchVisibility, []);
  const [x0, y0, x1, y1] = BX.spade;
  return (
    <span className={`lj-mini ${reduced ? 'rm' : ''} ${className}`} role="status" aria-label="Loading" style={{ width: size * 1.3, height: size * 1.3 }}>
      <svg viewBox={`${x0 - 4} ${y0 - 4} ${x1 - x0 + 8} ${y1 - y0 + 8}`} aria-hidden="true" focusable="false">
        <path d={LG.spade} fillRule="evenodd" />
      </svg>
    </span>
  );
}

export interface LoadingScreenProps {
  /** Optional calm line under the logo from the start. */
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
  const [t, setT] = useState(elapsed * 1000);
  const par = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t0 = Date.now() - elapsed * 1000;
    const ids = [NAP_HINT_MS, PLAY_CPU_MS].map((ms) => setTimeout(() => setT(Date.now() - t0), Math.max(0, ms - elapsed * 1000)));
    return () => ids.forEach(clearTimeout);
  }, [elapsed]);
  // Tiny pointer parallax (fine pointers only; event driven, writes two CSS variables).
  useEffect(() => {
    const el = par.current;
    if (!el || reduced || typeof matchMedia === 'undefined' || !matchMedia('(pointer: fine)').matches) return;
    const on = (e: PointerEvent) => {
      el.style.setProperty('--px', ((e.clientX / innerWidth - 0.5) * 2).toFixed(3));
      el.style.setProperty('--py', ((e.clientY / innerHeight - 0.5) * 2).toFixed(3));
    };
    addEventListener('pointermove', on, { passive: true });
    return () => removeEventListener('pointermove', on);
  }, [reduced]);
  const line = t >= PLAY_CPU_MS ? 'Free servers nap when idle — this can take up to 30 seconds' : t >= NAP_HINT_MS ? 'Waking the game server…' : message;
  return (
    <div className={`lscr ${leaving ? 'leaving' : ''} ${reduced ? 'rm' : ''}`} data-testid="loading-screen">
      <div className="lscr-bg" aria-hidden="true">
        <div className="lscr-bloom" />
        {PIPS.map((p, i) => (
          <svg key={i} className="pip" viewBox="0 0 24 24" style={sv({ left: `${p.x}%`, top: `${p.y}%`, width: p.z, height: p.z, opacity: p.o, '--t': `${p.t}s`, '--k': i % 2 ? 1 : -1 })}>
            {SUIT_PATH[p.s]}
          </svg>
        ))}
      </div>
      <div className="lscr-mid">
        <div className="lg-par" ref={par}>
          <div className="lg-floor" aria-hidden="true" />
          <div className="lg-shadow" aria-hidden="true" />
          <div className="lg-breathe">
            <Lockup reduced={reduced} />
          </div>
        </div>
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
