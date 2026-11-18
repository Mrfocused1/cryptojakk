// Single connection + state module. React reads it through useApp()/useSel(); components call the exported actions.
import { useSyncExternalStore } from 'react';
import type { Card, PlayerAction, PlayerView } from '@shared/engine';
import {
  type Avatar,
  type ClientMessage,
  type ErrorCode,
  PROTOCOL_VERSION,
  type RoomSnapshot,
  type ServerMessage,
  normalizeRoomCode,
} from '@shared/protocol';
import { cancelFx, planEvents } from './fx';
import { type Identity, getToken, loadIdentity, randomGuest, saveIdentity } from './identity';
import { navigate } from './router';
import { playSfx, vibrate } from './sound';

export type ConnStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'taken';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Flight {
  id: number;
  card: Card | null; // null = card back
  from: Rect;
  to: Rect;
  delay: number;
  dur: number;
  rot: number;
}
export interface Callout {
  id: number;
  text: string;
  kind: 'info' | 'danger' | 'good' | 'red' | 'black';
}
export interface Toast {
  id: number;
  text: string;
}
export interface JoinError {
  code: ErrorCode;
  message: string;
}

export interface AppState {
  identity: Identity | null;
  conn: ConnStatus;
  online: boolean;
  playerId: string | null;
  room: RoomSnapshot | null;
  view: PlayerView | null;
  joinError: JoinError | null;
  joining: boolean;
  toast: Toast | null;
  // presentation (cosmetic only)
  feed: { id: number; text: string } | null;
  callout: Callout | null;
  topOverride: Card | null;
  freshDelay: Record<string, number>;
  flights: Flight[];
  dealKey: number;
  dealing: boolean;
  rematchRequested: boolean;
}

let state: AppState = {
  identity: loadIdentity(),
  conn: 'idle',
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  playerId: null,
  room: null,
  view: null,
  joinError: null,
  joining: false,
  toast: null,
  feed: null,
  callout: null,
  topOverride: null,
  freshDelay: {},
  flights: [],
  dealKey: 0,
  dealing: false,
  rematchRequested: false,
};

const listeners = new Set<() => void>();
export function getState(): AppState {
  return state;
}
export function patch(p: Partial<AppState>): void {
  state = { ...state, ...p };
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function useApp(): AppState {
  return useSyncExternalStore(subscribe, getState, getState);
}
export function useSel<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state), () => sel(state));
}

// ------------------------------------------------------------------ toast

let toastId = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string): void {
  const id = ++toastId;
  patch({ toast: { id, text } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (state.toast?.id === id) patch({ toast: null });
  }, 2600);
}

// ------------------------------------------------------------------ connection

let ws: WebSocket | null = null;
let attempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let wantConnect = false;
let welcomed = false;
let everWelcomed = false;
const readyQueue: Array<() => void> = [];
let reqCounter = 0;

function sendRaw(msg: ClientMessage): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(msg));
  return true;
}

export function send(msg: ClientMessage): boolean {
  if (!welcomed) return false;
  return sendRaw(msg);
}

function sendHello(): void {
  const id = state.identity;
  if (!id) return;
  sendRaw({ type: 'hello', protocol: PROTOCOL_VERSION, sessionToken: getToken(), name: id.name, avatar: id.avatar });
}

export function connect(): void {
  if (!state.identity) return;
  wantConnect = true;
  clearTimeout(reconnectTimer);
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  patch({ conn: everWelcomed ? 'reconnecting' : 'connecting' });
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let sock: WebSocket;
  try {
    sock = new WebSocket(`${proto}://${location.host}/ws`);
  } catch {
    scheduleReconnect();
    return;
  }
  ws = sock;
  sock.onopen = () => {
    if (ws === sock) sendHello();
  };
  sock.onmessage = (ev) => {
    if (ws !== sock) return;
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(ev.data)) as ServerMessage;
    } catch {
      return;
    }
    handle(msg);
  };
  sock.onclose = (ev) => {
    if (ws !== sock) return;
    ws = null;
    welcomed = false;
    if (ev.code === 4000) {
      wantConnect = false;
      patch({ conn: 'taken' });
      return;
    }
    scheduleReconnect();
  };
  sock.onerror = () => {
    /* close follows */
  };
}

function scheduleReconnect(): void {
  if (!wantConnect) return;
  patch({ conn: everWelcomed ? 'reconnecting' : 'connecting' });
  const delay = Math.min(5000, 500 * 2 ** attempt);
  attempt++;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, delay);
}

/** "Use here" after another tab took the seat. */
export function takeOver(): void {
  attempt = 0;
  connect();
}

function whenReady(fn: () => void): void {
  if (welcomed) fn();
  else {
    readyQueue.push(fn);
    connect();
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    patch({ online: true });
    if (wantConnect && !ws) {
      attempt = 0;
      connect();
    }
  });
  window.addEventListener('offline', () => patch({ online: false }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !wantConnect) return;
    if (!ws || ws.readyState > WebSocket.OPEN) {
      attempt = 0;
      connect();
    } else if (welcomed) sendRaw({ type: 'requestState' });
  });
}

// ------------------------------------------------------------------ incoming

function clearGame(): void {
  cancelFx();
  patch({ view: null, flights: [], feed: null, callout: null, topOverride: null, freshDelay: {}, dealing: false });
}

function leaveRoomLocally(): void {
  clearGame();
  patch({ room: null, rematchRequested: false });
  navigate('/', { replace: true });
}

function handle(msg: ServerMessage): void {
  switch (msg.type) {
    case 'welcome': {
      welcomed = true;
      everWelcomed = true;
      attempt = 0;
      const hadRoom = state.room !== null;
      patch({ conn: 'open', playerId: msg.playerId });
      if (msg.resumed) {
        readyQueue.length = 0;
        const wantCode = /^\/r\/([^/]+)/i.exec(location.pathname)?.[1];
        const norm = wantCode ? normalizeRoomCode(wantCode) : null;
        if (norm && msg.roomCode && norm !== msg.roomCode) toast(`You are still in room ${msg.roomCode}. Leave it to join another.`);
      } else {
        if (hadRoom) {
          leaveRoomLocally();
          toast('That game is no longer running');
        }
        const q = readyQueue.splice(0);
        for (const fn of q) fn();
      }
      return;
    }
    case 'roomState': {
      const room = msg.room;
      const was = state.room;
      patch({ room, joining: false, joinError: null });
      if (room.phase === 'lobby' || room.phase === 'rematch') {
        clearGame();
        if (room.phase === 'lobby' || room.phase === 'rematch') patch({ rematchRequested: false });
      }
      if (!was || was.code !== room.code) {
        navigate(room.mode === 'friends' ? `/r/${room.code}` : '/play', { replace: true });
      }
      return;
    }
    case 'state': {
      busyVersion = -1;
      const prev = state.view;
      // Capture DOM geometry for animations BEFORE the new view is rendered.
      const start = msg.resync ? null : planEvents(msg.events, prev, msg.view, state.room);
      patch({ view: msg.view });
      if (start) {
        if (msg.view.version === 0) {
          patch({ dealKey: state.dealKey + 1, dealing: true });
          setTimeout(() => patch({ dealing: false }), 1700);
        }
        start();
      } else {
        cancelFx();
        patch({ topOverride: null, feed: null });
      }
      noteTurn(prev, msg.view, msg.resync);
      return;
    }
    case 'error':
      handleError(msg.code, msg.message, msg.reqId);
      return;
    case 'left':
      leaveRoomLocally();
      return;
    case 'roomClosed':
      leaveRoomLocally();
      toast(msg.reason === 'expired' ? 'That room expired' : 'The room was closed');
      return;
    default:
      return; // pong + unknown types: ignore
  }
}

function noteTurn(prev: PlayerView | null, view: PlayerView, resync: boolean): void {
  const mine = view.turn === view.you && !view.winner;
  const wasMine = prev ? prev.turn === prev.you && !prev.winner : false;
  if (mine && !wasMine && !resync) {
    vibrate(40);
    setTimeout(() => playSfx('turn'), 380);
  }
}

function handleError(code: ErrorCode, message: string, reqId?: string): void {
  busyVersion = -1;
  switch (code) {
    case 'STALE_VERSION':
    case 'JAKK_NOT_NEEDED':
    case 'NOT_YOUR_TURN':
      return; // normal races; the corrected state follows
    case 'ROOM_NOT_FOUND':
    case 'ROOM_FULL':
    case 'GAME_IN_PROGRESS':
      if (reqId === 'join' || state.joining) {
        patch({ joinError: { code, message }, joining: false });
        return;
      }
      toast(message);
      return;
    case 'ALREADY_IN_ROOM':
      sendRaw({ type: 'requestState' });
      return;
    default:
      toast(message);
  }
}

// ------------------------------------------------------------------ outgoing actions

let busyVersion = -1;
let busyTimer: ReturnType<typeof setTimeout> | undefined;

/** Send a game action against the current view version. Ignores double taps on the same version. */
export function act(action: PlayerAction): boolean {
  const view = state.view;
  if (!view || view.winner) return false;
  if (busyVersion === view.version && action.type !== 'declareJakk') return false;
  const ok = send({ type: 'action', version: view.version, action, reqId: `a${++reqCounter}` });
  if (!ok) {
    toast('Reconnecting... try again in a moment');
    return false;
  }
  busyVersion = view.version;
  clearTimeout(busyTimer);
  busyTimer = setTimeout(() => (busyVersion = -1), 1500);
  return true;
}

function ensureIdentity(): Identity {
  if (!state.identity) {
    const id = randomGuest();
    saveIdentity(id);
    patch({ identity: id });
  }
  return state.identity as Identity;
}

export function setIdentity(id: Identity): void {
  saveIdentity(id);
  patch({ identity: id });
  if (welcomed) sendHello();
  else connect();
}

export function playNow(): void {
  ensureIdentity();
  whenReady(() => send({ type: 'createRoom', mode: 'ai', botCount: 1 }));
}

export function playAI(botCount: number): void {
  ensureIdentity();
  whenReady(() => send({ type: 'createRoom', mode: 'ai', botCount }));
}

export function createFriendsRoom(): void {
  patch({ joinError: null });
  whenReady(() => send({ type: 'createRoom', mode: 'friends' }));
}

export function joinCode(raw: string): void {
  const code = normalizeRoomCode(raw);
  if (!code) {
    patch({ joinError: { code: 'ROOM_NOT_FOUND', message: 'That code does not look right. Codes have 5 letters or numbers.' }, joining: false });
    return;
  }
  patch({ joinError: null, joining: true });
  whenReady(() => send({ type: 'joinRoom', code, reqId: 'join' }));
}

export function clearJoinError(): void {
  if (state.joinError || state.joining) patch({ joinError: null, joining: false });
}

export function leaveRoom(): void {
  if (!send({ type: 'leave' })) leaveRoomLocally();
}

export function setReady(ready: boolean): void {
  send({ type: 'setReady', ready });
}
export function addBot(): void {
  send({ type: 'addBot' });
}
export function removeBot(playerId: string): void {
  send({ type: 'removeBot', playerId });
}
export function startGame(): void {
  send({ type: 'startGame' });
}
export function rematch(): void {
  if (send({ type: 'rematch' })) patch({ rematchRequested: true });
}

export function boot(): void {
  if (state.identity) connect();
}

export type { Avatar };
