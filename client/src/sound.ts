// Tiny WebAudio sound effects. No audio files. Muted flag is remembered in localStorage (default: sound on).
import { readStore, writeStore } from './storage';

const KEY = 'cj.muted';
let muted = readStore(KEY) === '1';
let ctx: AudioContext | null = null;
const muteListeners = new Set<() => void>();

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Call from a user gesture so mobile browsers allow audio later. */
export function unlockAudio(): void {
  audio();
}

export function isMuted(): boolean {
  return muted;
}
export function setMuted(m: boolean): void {
  muted = m;
  writeStore(KEY, m ? '1' : '0');
  for (const l of muteListeners) l();
}
export function subscribeMuted(l: () => void): () => void {
  muteListeners.add(l);
  return () => muteListeners.delete(l);
}

function tone(c: AudioContext, freq: number, start: number, dur: number, type: OscillatorType, gain: number, slideTo?: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + start);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + start + dur);
  g.gain.setValueAtTime(0.0001, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, c.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.02);
}

function noise(c: AudioContext, start: number, dur: number, freq: number, gain: number) {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 0.9;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(c.destination);
  src.start(c.currentTime + start);
}

export type Sfx = 'flick' | 'draw' | 'alert' | 'turn' | 'win' | 'lose' | 'pop';

export function playSfx(kind: Sfx): void {
  const c = audio();
  if (!c) return;
  try {
    switch (kind) {
      case 'flick':
        noise(c, 0, 0.09, 2600, 0.5);
        tone(c, 220, 0, 0.06, 'triangle', 0.12, 140);
        break;
      case 'draw':
        noise(c, 0, 0.07, 1800, 0.35);
        noise(c, 0.08, 0.07, 1500, 0.3);
        break;
      case 'alert':
        tone(c, 740, 0, 0.12, 'square', 0.07);
        tone(c, 520, 0.13, 0.16, 'square', 0.07);
        break;
      case 'turn':
        tone(c, 660, 0, 0.09, 'sine', 0.12);
        tone(c, 990, 0.08, 0.12, 'sine', 0.1);
        break;
      case 'pop':
        tone(c, 300, 0, 0.1, 'sine', 0.14, 600);
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => tone(c, f, i * 0.1, 0.22, 'triangle', 0.14));
        break;
      case 'lose':
        tone(c, 330, 0, 0.2, 'triangle', 0.1, 200);
        tone(c, 247, 0.2, 0.3, 'triangle', 0.1, 150);
        break;
    }
  } catch {
    /* audio is optional */
  }
}

export function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}
