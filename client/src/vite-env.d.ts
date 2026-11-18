/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Multiplayer WebSocket endpoint, e.g. wss://game.example.com/ws. Unset = same-origin /ws. */
  readonly VITE_WS_URL?: string;
}
