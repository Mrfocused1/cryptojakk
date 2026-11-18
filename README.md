# Crypto Jakk

Mobile-first browser card game: UK-style Blackjack (the card-**shedding** game, like Crazy Eights / Switch).
The repo contains a pure rules engine, the shared protocol/types, a bot AI, a Node WebSocket server and the React client
(`client/`, mobile-first, see "Client" below).

* Rules (PROVISIONAL, all toggles in `RulesConfig`): [`docs/RULEBOOK.md`](docs/RULEBOOK.md)
* Wire protocol (read this first if you are building the client): [`docs/PROTOCOL.md`](docs/PROTOCOL.md)

## Setup

```bash
npm install
npm run dev        # server (tsx watch, :3001) + Vite (:5173); open http://localhost:5173
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run build      # vite build -> dist/client, esbuild -> dist/server.js
npm start          # node dist/server.js  (serves client + /ws + /healthz on $PORT, default 3000)
```

Node 22+ and npm. In dev, Vite proxies `/ws` (websocket) and `/healthz` to the server on port 3001.

## Environment variables

| var | default | meaning |
|---|---|---|
| `PORT` | `3000` | HTTP + WebSocket port (dev script sets 3001 for the server) |
| `PUBLIC_ORIGIN` | unset | e.g. `https://jakk.example.com`. If set, WebSocket upgrades from browsers with a different `Origin` are refused. |

Node does not read `.env` automatically: `node --env-file=.env dist/server.js`, or set the variables in your host.

## Layout

```
shared/engine/   pure deterministic rules engine (no Node/DOM imports; rng injected)
  cards.ts rules.ts(RulesConfig) types.ts play.ts(legality) engine.ts(createGame/applyAction) view.ts(PlayerView, redaction, client helpers)
shared/protocol.ts   every client<->server message, room/lobby types, error codes, name/room-code helpers
shared/ai.ts         bot chooser; takes ONLY a PlayerView
server/              app.ts (express + ws upgrade) hub.ts (connections, rate limit, routing) room.ts (lobby, game, bots, timers)
                     validate.ts (input validation) rng.ts (crypto.randomInt) config.ts (timings) main.ts (entry)
client/              Vite + React + TS app (root of the Vite build), see "Client" below
tests/               rulebook examples, simulation, redaction, AI, server integration
docs/                RULEBOOK.md, PROTOCOL.md
```

## Architecture notes

* **Server-authoritative.** Clients send `action` + the `version` of the view they acted on. Stale versions / wrong turns are
  rejected with a typed error and the current view is re-sent; identical resubmits therefore cannot double-apply.
* **Redaction at the edge.** The server never sends `GameState`. Each player receives `toPlayerView` (own hand, opponents' card counts,
  top discard, pile counts...) and events passed through `redactEvents` (other players' drawn cards removed). A test serialises views
  and events and asserts no foreign card id appears.
* **Engine API.** `createGame(playerIds, rules, rng)`, `applyAction(state, action, rng) -> {ok, state, events} | {ok:false, code, reason}`
  (never throws on player input, never mutates its input), `toPlayerView`, `getLegalCardIds(view)`, `getAddableCardIds(view, selection)`,
  `previewPlay(view, ids, suit)`. The client uses the same helpers to highlight cards.
* **Randomness.** The engine takes an `rng: () => number`. The server injects a `crypto.randomInt`-based generator (48-bit) used by the
  Fisher-Yates shuffle; tests inject a seeded PRNG. Bot think-time and the bot "forgot JAKK" roll (10%) also come from the server.
* **Bots / away players.** Bots move 900-1600 ms after their turn starts (>= 3000 ms while a human owes a JAKK call). If a disconnected
  human's turn lasts 15 s, the bot logic plays it (repeating each turn). Mid-game `leave` converts the seat to a bot. All timings are in
  `server/config.ts` and overridable in tests.
* **Housekeeping.** Rooms with no connected human for 5 min or idle 30 min are deleted (swept every 30 s). Room cap 2000. Heartbeat
  ping/pong every 30 s, per-socket token-bucket rate limit, 4 KiB max frame, validation of every message.

## Client

`client/` is a small React + TypeScript app (no UI kit, no animation library, plain CSS). It renders the server's `PlayerView`,
sends actions with `view.version`, and uses `events` only for the feed, callouts, card flights and sounds. All legality
highlighting uses the shared engine helpers (`getLegalCardIds`, `getAddableCardIds`, `previewPlay`, `needsSuitChoice`).

```
client/index.html, main.tsx   entry, meta/OG tags, manifest link
client/public/                logo-black/white.png (from logo-source.jpg via ImageMagick), icons, manifest.webmanifest, og.png
client/src/store.ts           the single connection + state module (WebSocket, reconnect/backoff, resume, actions, toasts)
client/src/fx.ts              turns `events` into an ordered presentation queue (feed line, callouts, flights, sfx)
client/src/router.ts          ~50-line History-API router (/, /friends, /ai, /how-to-play, /profile, /r/CODE, /play)
client/src/Table.tsx          game table: seats, piles, hand, action bar, suit picker, menu
client/src/{Lobby,Results,Screens,HowToPlay,components}.tsx, sound.ts (WebAudio, no files), identity.ts, styles.css
```

* **Screens** are chosen from the server state first (room phase `lobby`/`rematch` -> Lobby, `playing`/`finished` -> Table) and only
  then from the URL, so reloads and rematches never pass through the home screen. `/r/CODE` opens the join flow directly.
* **Identity**: display name + avatar + a random secret session token live in `localStorage` (`cj.identity`, `cj.token`). "Play Now"
  uses the saved identity or generates a "Guest 1234" one. Sound mute is `cj.muted`.
* **Connection**: auto-reconnect with 0.5 s .. 5 s backoff, `hello` with the stored token, state replaced from `roomState`/`state`;
  banner for connecting / reconnecting / offline / "opened in another tab" (close code 4000, with a "Use here" button).
* **Animation**: CSS + Web Animations API only. Played/drawn cards fly between hand/seats and piles (< 350 ms each, queued in event
  order, skipped for `resync` states); `prefers-reduced-motion` removes motion and keeps fades.
* **Dev**: `npm run dev` (Vite :5173 proxies `/ws` to the server on :3001). **Prod**: `npm run build && npm start`.
* **Link previews**: `og:image` / `twitter:image` in `client/index.html` are root-relative (`/og.png`). WhatsApp and most crawlers need an
  absolute URL, so replace them with `https://your-domain/og.png` when you deploy.

## Deployment

A single Node process serves everything: `npm ci && npm run build && PORT=8080 npm start`. Put it behind any TLS-terminating
proxy that forwards WebSocket upgrades on `/ws` (set `PUBLIC_ORIGIN`). `/healthz` returns `{ok, uptimeSec, rooms, connections}`.
Unknown GET paths without a file extension fall back to `index.html` so `/r/CODE` deep links work.
`dist/server.js` is bundled with `--packages=external`, so `express` and `ws` must be installed (`npm ci --omit=dev` is enough at runtime).

## Known limits

* **In-memory only - no database.** Restarting the process drops every room and game; players are returned to the home screen.
* **Single instance.** Rooms live in one process; there is no cross-instance routing or shared state. Do not scale horizontally
  without sticky routing by room code (and even then a restart loses rooms).
* Identity is a client-held secret token: no accounts, no recovery if the browser storage is cleared.
* The rules are provisional (`docs/RULEBOOK.md`); the server always uses `DEFAULT_RULES` (not per-room configurable yet).
* A stalemate (nobody can move and no cards exist anywhere) is theoretically possible only in absurd configurations; with the
  default rules and 2-4 players 500-game simulations per size always finish.

## Third-party libraries

| library | use | licence |
|---|---|---|
| express | static files, `/healthz` | MIT |
| ws | WebSocket server | MIT |
| react, react-dom | client | MIT |
| @fontsource/poppins | self-hosted display font (weights 800/900, latin subset) | OFL-1.1 |
| vite, @vitejs/plugin-react | client build/dev | MIT |
| esbuild | server bundle | MIT |
| tsx | dev runner | MIT |
| typescript | types | Apache-2.0 |
| vitest | tests | MIT |
| concurrently, cross-env | dev scripts | MIT |
