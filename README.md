# Crypto Jakk

Browser card game (phone, tablet and desktop): UK-style Blackjack (the card-**shedding** game, like Crazy Eights / Switch).
The repo contains a pure rules engine, the shared protocol/types, CPU opponent logic (`shared/ai.ts`), a Node WebSocket server and the React client
(`client/`, responsive phone / tablet / desktop, see "Client" below).

* Rules (the owner's 2026-11-18 rulebook as implemented: 2-6 players, sequences, 8 skips / King reverses / 7 ordinary, Queen cover, JAKK declared before the finishing turn, host house rules, matches, turn timer; all toggles in `RulesConfig`): [`docs/RULEBOOK.md`](docs/RULEBOOK.md). Source text: [`docs/source/owner-rules-2026-11-18.md`](docs/source/owner-rules-2026-11-18.md)
* Wire protocol v2 (read this first if you are building the client, including its "Changes since v1" section): [`docs/PROTOCOL.md`](docs/PROTOCOL.md)

## Setup

```bash
npm install
npm run dev        # server (tsx watch, :3001) + Vite (:5173); open http://localhost:5173
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run build:client  # vite build only -> dist/client (this is what Vercel runs)
npm run build      # vite build -> dist/client, esbuild -> dist/server.js
npm start          # node dist/server.js  (serves client + /ws + /healthz on $PORT, default 3000)
```

Node 22+ and npm. In dev, Vite proxies `/ws` (websocket) and `/healthz` to the server on port 3001.

## Environment variables

| var | default | meaning |
|---|---|---|
| `PORT` | `3000` | HTTP + WebSocket port (dev script sets 3001 for the server) |
| `PUBLIC_ORIGIN` | unset | e.g. `https://jakk.example.com`. If set, WebSocket upgrades from browsers with a different `Origin` are refused. Comma-separated list allowed (`https://jakk.vercel.app,https://jakk.example.com`) so a client hosted elsewhere can connect. |
| `VITE_WS_URL` | unset | **Client build-time** variable, e.g. `wss://game.example.com/ws`. Where the browser opens the multiplayer socket. Unset = same-origin `/ws`. |

Node does not read `.env` automatically: `node --env-file=.env dist/server.js`, or set the variables in your host.

## Layout

```
shared/engine/   pure deterministic rules engine (no Node/DOM imports; rng injected)
  cards.ts rules.ts(RulesConfig) types.ts play.ts(legality) engine.ts(createGame/applyAction) view.ts(PlayerView, redaction, client helpers)
shared/protocol.ts   every client<->server message, room/lobby types, error codes, name/room-code helpers
shared/ai.ts         bot chooser; takes ONLY a PlayerView
shared/room.ts       Room: lobby, game flow, bots, timers (Node-free; used by the server hub AND by the browser for solo games)
shared/local.ts      LocalGame: in-browser stand-in for the server (same messages in/out), used for Play Now / Play CPU
shared/rng.ts, timing.ts   crypto.getRandomValues shuffle rng, bot/room timings
server/              app.ts (express + ws upgrade) hub.ts (connections, rate limit, routing) room.ts (lobby, game, bots, timers)
                     validate.ts (input validation) rng.ts (crypto.randomInt) config.ts (timings) main.ts (entry)
client/              Vite + React + TS app (root of the Vite build), see "Client" below
tests/               rulebook examples, simulation, redaction, CPU logic, server integration
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
  Fisher-Yates shuffle; tests inject a seeded PRNG. Bot think-time and the bot JAKK-declaration roll (90%) also come from the server.
* **Bots / away players.** Bots move 900-1600 ms after their turn starts. If a disconnected
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
client/public/                logo-black/white.png (made from design/logo-source.jpg via ImageMagick), icons, manifest.webmanifest, og.png
client/src/store.ts           the single state module: solo games (LocalGame) or the lazy WebSocket (reconnect/backoff, resume), actions, toasts
client/src/fx.ts              turns `events` into an ordered presentation queue (feed line, callouts, flights, sfx)
client/src/router.ts          ~50-line History-API router (/, /friends, /ai, /how-to-play, /profile, /r/CODE, /play)
client/src/Table.tsx          game table: seats, piles, hand, action bar, suit picker, menu
client/src/{Lobby,Results,Screens,HowToPlay,components}.tsx, sound.ts (WebAudio, no files), prefs.ts, identity.ts, styles.css
```

* **Screens** are chosen from the server state first (room phase `lobby`/`rematch` -> Lobby, `playing`/`finished` -> Table) and only
  then from the URL, so reloads and rematches never pass through the home screen. `/r/CODE` opens the join flow directly.
* **Identity**: display name + avatar + a random secret session token live in `localStorage` (`cj.identity`, `cj.token`). "Play Now"
  uses the saved identity or generates a "Guest 1234" one. Sound mute is `cj.muted`.
* **Solo games run in the browser.** "Play Now" and "Play CPU" create a `LocalGame` (`shared/local.ts`) that accepts the same client
  messages and emits the same `roomState` / `state` (redacted view + events) / `error` messages as the server, driving the same `Room`,
  engine and CPU logic (CPU pacing 900-1600 ms, ~90% bot JAKK rate; shuffle uses
  `crypto.getRandomValues`). No WebSocket is opened, so solo works offline and on static hosting. The in-progress game is saved in
  `localStorage` (`cj.local`, expires after 12 h) so a reload returns to the table; leaving clears it. Saves are versioned (`RoomSave.v`, currently 2): a save made by an older version of the game (other rules / shape) or an unreadable one is discarded cleanly on load (`isCompatibleSave`), never half-restored.
* **Multiplayer connects lazily.** The socket opens only for Play Friends, a `/r/CODE` link, or a stored friends-room session
  (`cj.friendsRoom`). If the very first connection fails or takes > 7 s, the friends screens show "Multiplayer is offline right now"
  with Retry and "Play vs CPU instead" instead of a reconnect loop. Endpoint: `VITE_WS_URL` or same-origin `/ws`.
* **Connection** (friends): auto-reconnect with 0.5 s .. 5 s backoff, `hello` with the stored token, state replaced from `roomState`/`state`;
  banner for connecting / reconnecting / offline / "opened in another tab" (close code 4000, with a "Use here" button).
* **Animation**: CSS + Web Animations API only. Played/drawn cards fly between hand/seats and piles (< 350 ms each, queued in event
  order, skipped for `resync` states); `prefers-reduced-motion` removes motion and keeps fades.
* **Dev**: `npm run dev` (Vite :5173 proxies `/ws` to the server on :3001). **Prod**: `npm run build && npm start`.
* **Link previews**: `og:image` / `twitter:image` in `client/index.html` are root-relative (`/og.png`). WhatsApp and most crawlers need an
  absolute URL, so replace them with `https://your-domain/og.png` when you deploy.

### Look and feel

Casino-felt green system modelled on `design/references/` (tokens from `design/references/design-sample.html`): deep green felt with a
radial spotlight and grain, white heavy-italic Poppins headings (800/900 italic are self-hosted via `@fontsource`), glossy green pill
buttons, outlined translucent panels, a white tilted logo tile, classic white cards with red-lattice backs and a gold table arc.
The chips and cards are decoration drawn in SVG/CSS (`ChipStack`, `DecoChips` in `components.tsx`); there is no money, wallet or
betting anywhere in the game. Profile & Settings (`/profile`) holds name, avatar, sound and "reduce animation" (`cj.reduce`,
`prefs.ts`, also honours `prefers-reduced-motion`).

### Responsive breakpoints

Plain CSS media/container queries in `client/src/styles.css`, no libraries.

| width | layout |
|---|---|
| phone, up to 600px | single column, header with centred logo tile + menu, bottom-sheet dialogs |
| tablet, 601-1023px | roomier single column (bigger cards, wider table, centred content, centred modal dialogs, single-line feed) |
| desktop, 1024px+ (content up to ~1440px, centred beyond) | table fills the viewport: a rounded felt table with opponents seated around it (1 = top, 2 = top-left/right, 3 = left/top/right, 4-5 around the oval), hand fanned along the bottom with Draw / JAKK / Play beside it, and a right-hand panel (game log / move-history tabs, house-rules chips, power-card cheat-sheet, room code + invite when in a friends room, collapsible shortcut list). Landing is a top-nav hero page; Play Friends shows Create and Join side by side; the lobby is two columns; How to Play is a multi-column grid. Short laptop viewports (<= 800px high) drop the shortcut box and tighten spacing. |

### Keyboard shortcuts (at the table)

| key | action |
|---|---|
| `1`-`9`, `0` | focus and select/deselect the card at that position in your sorted hand |
| `Left` / `Right` (also `Up`/`Down`, `Home`/`End`) | move focus between cards; `Enter` / `Space` selects the focused card |
| `Backspace` | remove the last selected card from the sequence |
| `P` (or `Enter` when no card is focused) | play the selection |
| `D` | draw / pick up |
| `J` | toggle JAKK: declare it when it is not your turn, or tick it to travel with your move on your own turn |
| `Esc` | clear selection (or close a dialog) |
| `?` | how to play |
| `S` `H` `D` `C` or arrows + `Enter` | suit picker |

Shortcuts never fire while typing in an input. Key hints appear on the buttons at desktop widths only; legal cards lift on hover
(pointer cursor), illegal ones show `not-allowed`.

## Deploying

**(a) Vercel (client only, solo works out of the box).** `vercel.json` builds with `npm run build:client`, serves `dist/client`, rewrites
non-file routes to `index.html` (so `/r/CODE` works) and caches `/assets/*` forever. Import the repo, no settings needed. Play Now and
Play CPU run entirely in the browser; Play Friends shows "Multiplayer is offline right now" until a server is configured.

**(b) Add multiplayer.** Vercel cannot hold WebSockets, so run the Node server on a host that keeps a process alive (Render, Railway or
Fly.io, for example). Run exactly **one instance** (rooms live in memory): `npm ci && npm run build && npm start` (it reads `$PORT`).
Then set `VITE_WS_URL=wss://<your-server-host>/ws` in the Vercel project's environment variables and redeploy the client (it is read at
build time), and set `PUBLIC_ORIGIN=https://<your-vercel-domain>` on the server (comma-separate several origins, e.g. a custom domain
and the `*.vercel.app` one).

**(c) One host for everything.** Skip Vercel: the same Node server also serves the built client, `/ws` and `/healthz`, so
`npm ci && npm run build && npm start` on a single host is a complete deployment (leave `VITE_WS_URL` unset).

### Single Node process details

A single Node process serves everything: `npm ci && npm run build && PORT=8080 npm start`. Put it behind any TLS-terminating
proxy that forwards WebSocket upgrades on `/ws` (set `PUBLIC_ORIGIN`). `/healthz` returns `{ok, uptimeSec, rooms, connections}`.
Unknown GET paths without a file extension fall back to `index.html` so `/r/CODE` deep links work.
`dist/server.js` is bundled with `--packages=external`, so `express` and `ws` must be installed (`npm ci --omit=dev` is enough at runtime).

## Known limits

* **In-memory only - no database.** Restarting the process drops every room and game; players are returned to the home screen.
* **Single instance.** Rooms live in one process; there is no cross-instance routing or shared state. Do not scale horizontally
  without sticky routing by room code (and even then a restart loses rooms).
* Identity is a client-held secret token: no accounts, no recovery if the browser storage is cleared.
* The rules follow the owner's rulebook (`docs/RULEBOOK.md`); the server starts from `DEFAULT_RULES` plus the host's house rules (`setOptions`), validated server-side.
* A stalemate (nobody can move and no cards exist anywhere) is theoretically possible only in absurd configurations; with the
  default rules and 2-6 players, 300-hand simulations per size (and 100 per size with every house rule flipped) always finish; a hand that cannot finish ends with no winner (turn cap / deck exhaustion).

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
