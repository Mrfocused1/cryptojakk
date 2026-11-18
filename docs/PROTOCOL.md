# Crypto Jakk - Client/Server Protocol (v1)

Source of truth: `shared/protocol.ts` (messages, room types, error codes), `shared/engine/*` (game types,
events, `PlayerView`, legality helpers). **Import those types; do not re-declare them.**
In the Vite client: `import type { ClientMessage, ServerMessage } from '@shared/protocol'` and
`import { getLegalCardIds, getAddableCardIds, previewPlay } from '@shared/engine'`.

## Transport

* One WebSocket per tab at `ws(s)://<host>/ws`. Text frames, one JSON object per frame (max 4096 bytes - bigger frames
  close the socket with code 1009).
* The browser client only opens this socket for friends rooms (the endpoint is `VITE_WS_URL` or same-origin `/ws`). Solo bot games
  are played in the browser by `shared/local.ts`, which speaks these same messages in-process (no socket). The server still supports
  `createRoom` with `mode: "ai"`.
* If `PUBLIC_ORIGIN` is set (comma-separated list allowed), upgrades from other browser `Origin`s get HTTP 403.
* Per-socket rate limit (burst 30, 15 msg/s sustained). Excess messages get `RATE_LIMITED`; persistent abuse closes the socket (1008).
* The server sends WebSocket-level pings every 30 s; browsers answer automatically. A socket that does not answer is dropped.
  `{type:"ping"}` / `{type:"pong"}` also exist for latency display and keep-alive.
* Optional `reqId` (string, <= 64 chars) on any client message is echoed on an `error` reply to that message. Successful
  requests have no ack: the effect arrives as `roomState` / `state`.
* All server messages carry a string `type`. Ignore unknown types (forward compatibility).

## Identity

* The client generates a random **secret** `sessionToken` once (16-128 chars of `[A-Za-z0-9_-]`, e.g. 32 random bytes base64url)
  and keeps it in `localStorage`. It never leaves the device except in `hello`.
* The server derives a public `playerId` (`"p_" + 12 chars`) from it and returns it in `welcome`. Tokens are never broadcast.
  `playerId` is what appears in rooms, views and events (`you`, `turn`, `winner`, ...).
* The same token on a new socket **replaces** the old socket (old one is closed with code `4000`) and resumes the same seat.
  Do not auto-reconnect on close code 4000 (another tab took over).

## Connection / reconnect sequence

```
client                                   server
  | ---- open ws /ws ------------------>  |
  | ---- hello {token,name,avatar} ----->  |
  | <--- welcome {playerId, resumed,       |
  |               roomCode}                |
  |   if resumed (token has a live seat):  |
  | <--- roomState {room}                  |
  | <--- state {view, events:[], resync:true}   (only if a game is playing / finished)
  |   else: client shows home screen; if the URL is /r/CODE send joinRoom.
```

* On any socket close: reconnect with exponential back-off (e.g. 0.5 s, 1 s, 2 s ... max 5 s) and send `hello` again.
  The server keeps your seat, marks it `connected:false` for the others, and after **15 s** of *your turn* plays it with a bot
  (and repeats every turn while you are away). Reconnecting simply gives you back control.
* After `welcome` with `resumed:true` **replace** all local room/game state with the `roomState` and `state` that follow.
* `hello` may be re-sent on the same socket (same token) to change name/avatar.
* `{type:"requestState"}` re-sends `roomState` (+ `state`) at any time if the client suspects it drifted.
* A room is deleted when no human is connected for 5 minutes or after 30 minutes without activity -> `roomClosed`
  (if connected) and later `joinRoom` returns `ROOM_NOT_FOUND`.

## Types you will use

```ts
type Avatar = { emoji?: string; icon?: string; color: string }   // at least one of emoji/icon; color "#rrggbb"
type Card = { id: string; rank: Rank; suit: 'S'|'H'|'D'|'C' }       // id e.g. "7H", "10S", "AC"
type RoomPhase = 'lobby' | 'rematch' | 'playing' | 'finished'
type PlayerAction =
  | { type: 'play'; cardIds: string[]; suit?: Suit; declareJakk?: boolean }
  | { type: 'draw' } | { type: 'takePenalty' } | { type: 'declareJakk' }
  | { type: 'pass' }                                               // only if rules.playAfterDraw
```

`RoomSnapshot` = `{ code, mode, phase, hostId, players: LobbyPlayer[], minPlayers, maxPlayers, canStart, rules }`,
`LobbyPlayer` = `{ playerId, name, avatar, isHost, isBot, ready, connected }`. `players` is seat order == turn order.

## Client -> server messages

| type | fields | notes |
|---|---|---|
| `hello` | `sessionToken`, `name`, `avatar`, `protocol?` | Must be first. `name` is trimmed, control chars stripped, 1-16 chars (shared helper `sanitizeName`). |
| `createRoom` | `mode: "friends"\|"ai"`, `botCount?: 1-3` | `ai`: creator + `botCount` (default 1) bots, game starts at once. `friends`: private lobby. |
| `joinRoom` | `code` | Case-insensitive. Also used to rejoin a room you hold a seat in. |
| `leave` | - | Lobby: seat freed. Mid-game: a bot takes your seat. Host leaving promotes the next human. |
| `setReady` | `ready: boolean` | Lobby / rematch only. |
| `addBot` / `removeBot` | - / `playerId` | Host only, lobby / rematch only, `friends` mode. |
| `startGame` | - | Host only. Needs >= 2 seats and every non-host human ready. |
| `action` | `version`, `action: PlayerAction` | `version` = `view.version` of the view you acted on. |
| `rematch` | - | After `phase:"finished"`. |
| `requestState` | - | Ask for `roomState` + `state` again. |
| `ping` | `t?: number` | Replies `pong`. |

Examples:

```json
{"type":"hello","protocol":1,"sessionToken":"k3J9x...32+chars...","name":"Alice","avatar":{"emoji":"🦊","color":"#ff8800"},"reqId":"1"}
{"type":"createRoom","mode":"friends"}
{"type":"createRoom","mode":"ai","botCount":2}
{"type":"joinRoom","code":"K7M2Q"}
{"type":"setReady","ready":true}
{"type":"removeBot","playerId":"bot_3f9a1c0"}
{"type":"action","version":12,"action":{"type":"play","cardIds":["9H","9S"],"declareJakk":true}}
{"type":"action","version":12,"action":{"type":"play","cardIds":["AD"],"suit":"S"}}
{"type":"action","version":12,"action":{"type":"draw"}}
{"type":"action","version":13,"action":{"type":"takePenalty"}}
{"type":"action","version":13,"action":{"type":"declareJakk"}}
{"type":"leave"}  {"type":"startGame"}  {"type":"rematch"}  {"type":"requestState"}  {"type":"ping","t":1731900000000}
```

## Server -> client messages

### `welcome`
```json
{"type":"welcome","protocol":1,"playerId":"p_9-ZWi8_YFGiX","resumed":false,"roomCode":null}
```

### `roomState`
Sent on every lobby change (join/leave/ready/bot/host/connection flag/phase). Always the **full** snapshot - replace, don't merge.
```json
{"type":"roomState","room":{"code":"K7M2Q","mode":"friends","phase":"lobby","hostId":"p_9-ZWi8_YFGiX",
 "players":[{"playerId":"p_9-ZWi8_YFGiX","name":"Alice","avatar":{"emoji":"🦊","color":"#ff8800"},"isHost":true,"isBot":false,"ready":false,"connected":true},
            {"playerId":"bot_1k2m3n1","name":"Ada","avatar":{"emoji":"🤖","color":"#f59e0b"},"isHost":false,"isBot":true,"ready":true,"connected":true}],
 "minPlayers":2,"maxPlayers":4,"canStart":true,"rules":{"minPlayers":2,"maxPlayers":4,"handSize":7,"multiPlay":true,"drawCount":1,"playAfterDraw":false,"powerRanks":["2","7","8","J","A"],"canFinishOnPower":true,"twoPenalty":2,"stackTwos":true,"blackJackPenalty":5,"stackBlackJacks":true,"redJackCancels":true,"eightReverses":true,"sevenSkips":true,"aceWild":true,"jakkEnabled":true,"jakkMissPenalty":2}}}
```
Phases: `lobby` (waiting, first game) -> `playing` -> `finished` -> (`friends`) `rematch` (lobby again, same code, ready flags reset
except the requester) -> `playing` ... In `ai` mode `finished` -> `playing` directly on `rematch`.
**When `phase` is `lobby` or `rematch`, discard any old game view.** A phase change to `playing` is always followed by a `state`.

### `state`
After every applied action, to every connected human, each with *their own* view:
```json
{"type":"state","resync":false,
 "view":{"version":1,"you":"p_alice","players":["p_alice","p_bob"],"handCounts":{"p_alice":2,"p_bob":4},
   "hand":[{"id":"2S","rank":"2","suit":"S"},{"id":"AD","rank":"A","suit":"D"}],
   "topDiscard":{"id":"9H","rank":"9","suit":"H"},"discardCount":2,"drawCount":44,"activeSuit":"H","direction":1,
   "turn":"p_bob","penalty":null,"jakkOwed":null,"winner":null,"hasDrawn":false,"drewCardId":null,"rules":{"...":"RulesConfig"}},
 "events":[{"type":"played","playerId":"p_alice","cards":[{"id":"9H","rank":"9","suit":"H"}]},{"type":"turn","playerId":"p_bob"}]}
```
* `view` is the **whole truth** - replace local state with it. `events` only drive the feed / animations.
* `resync:true` means a re-send (reconnect, `requestState`, stale/wrong-turn rejection): `events` is `[]`; do not animate.
* `view.hand` contains only your cards. Others: `handCounts`. Deck: `drawCount`. Discard: `topDiscard` + `discardCount`.
* `view.penalty` = `{kind:"two"|"jack", amount}` or null. `view.jakkOwed` = playerId who still has to say JAKK (show a button
  to that player; show a warning for the others). `view.winner` set => game over.
* `version` increases by exactly 1 per applied action (including a late `declareJakk`). It is unique per game; a rematch restarts at 0.

### Events (`GameEvent`)
`playerId` is the actor/subject. Exceptions: `skipped` (`playerId` = player who played the 7, `who` = skipped player),
`turn` (`playerId` = whose turn it is now), `jakkMissed` (`playerId` = the forgetful player).

```json
{"type":"played","playerId":"p_a","cards":[{"id":"9H","rank":"9","suit":"H"},{"id":"9S","rank":"9","suit":"S"}]}  // in play order; last = top
{"type":"drew","playerId":"p_b","count":2,"reason":"penalty","cards":[...]}   // reason: draw | penalty | jakkMiss. `cards` ONLY for the drawer
{"type":"drew","playerId":"p_b","count":2,"reason":"penalty"}                  // what everybody else receives
{"type":"penaltyAdded","playerId":"p_a","kind":"two","added":2,"total":4}
{"type":"penaltyTaken","playerId":"p_b","kind":"two","amount":4}
{"type":"penaltyCancelled","playerId":"p_b","kind":"jack","amount":5}
{"type":"reversed","playerId":"p_a","direction":-1}
{"type":"skipped","playerId":"p_a","who":"p_b"}
{"type":"suitChosen","playerId":"p_a","suit":"D"}
{"type":"jakkDeclared","playerId":"p_a"}
{"type":"jakkMissed","playerId":"p_a"}
{"type":"reshuffled","playerId":"p_b","count":31}
{"type":"turn","playerId":"p_c"}
{"type":"won","playerId":"p_a"}
```
Typical ordering inside one `events` array: `jakkMissed`, `drew` (miss penalty) first if a JAKK was missed; then
`penaltyTaken`/`drew`, or `played` (+ `suitChosen`, `penaltyAdded`/`penaltyCancelled`, `reversed`, `skipped`, `jakkDeclared`), then `turn` (or `won`).
`reshuffled` precedes the `drew` it enabled. A winning play has no `turn` event.

### `error`
```json
{"type":"error","code":"MUST_ANSWER_PENALTY","message":"Play a 2 or pick up 4","reqId":"7"}
```
`message` is short and toast-ready. Switch on `code`, show `message`. See the table below.

### `left`, `roomClosed`, `pong`
```json
{"type":"left"}
{"type":"roomClosed","code":"K7M2Q","reason":"idle"}     // expired | idle | empty
{"type":"pong","t":1731900000000,"serverTime":1731900000123}
```

## Error codes

Server / room errors (`ServerErrorCode`):

| code | when |
|---|---|
| `BAD_MESSAGE` | not JSON, unknown type, failed validation, binary frame, internal error |
| `RATE_LIMITED` | too many messages on this socket |
| `NOT_AUTHENTICATED` | anything but `hello`/`ping` before `hello` |
| `INVALID_TOKEN` / `INVALID_NAME` / `INVALID_AVATAR` | `hello` validation |
| `UNSUPPORTED_PROTOCOL` | `hello.protocol` != server's |
| `ROOM_NOT_FOUND` | unknown, malformed or expired code ("Room not found or expired") |
| `ROOM_FULL` | 4 seats taken (also `addBot`) |
| `GAME_IN_PROGRESS` | newcomer joining a room that is playing/finished, or any `ai` room. A returning seat holder is *not* rejected. |
| `ALREADY_IN_ROOM` | `createRoom`/`joinRoom` while seated in another room (send `leave` first) |
| `NOT_IN_ROOM` | room-scoped message without a seat |
| `NOT_HOST` | host-only message from a non-host |
| `NOT_ALL_READY` / `NOT_ENOUGH_PLAYERS` | `startGame` preconditions |
| `WRONG_PHASE` | e.g. `action` in a lobby, `setReady` mid-game, `startGame` twice |
| `NOT_A_BOT` | `removeBot` of something that is not a bot |
| `SERVER_BUSY` | room cap reached |
| `STALE_VERSION` | `action.version` != current version. The current view follows (`state`, `resync:true`). |

Engine rejections (`RejectionCode`, returned as `error.code` for `action`):

| code | example `message` |
|---|---|
| `NOT_YOUR_TURN` | "Not your turn" (view re-sent) |
| `ILLEGAL_CARD` | "Must match ♥ or a 9" |
| `MUST_ANSWER_PENALTY` | "Play a 2 or pick up 4" / "Play a Jack or pick up 5" |
| `PENALTY_PENDING` | `draw` while a penalty is pending (same text) |
| `NO_PENALTY` | `takePenalty` with none pending |
| `MIXED_RANKS` | "Cards must be the same rank" |
| `SUIT_REQUIRED` | "Choose a suit for your Ace" |
| `CARD_NOT_IN_HAND`, `DUPLICATE_CARD`, `EMPTY_PLAY`, `MULTI_DISABLED` | validation |
| `CANNOT_FINISH_ON_POWER` | only if the rule is disabled |
| `JAKK_NOT_NEEDED` | "No JAKK needed right now" (harmless) |
| `MUST_PLAY_DRAWN`, `ALREADY_DREW`, `CANNOT_PASS` | only with `playAfterDraw` |
| `GAME_OVER`, `UNKNOWN_PLAYER`, `INVALID_ACTION` | misc |

## Room lifecycle summary

* `friends`: `createRoom` -> host gets `roomState`; share `/r/CODE`; friends `joinRoom` -> everyone gets `roomState`;
  non-host humans `setReady`; host `addBot`/`removeBot`; host `startGame` -> `roomState{phase:"playing"}` then `state` (version 0).
* `ai`: `createRoom{mode:"ai"}` -> `roomState{phase:"playing"}` then `state` immediately. No lobby.
* Game over: final `state` (`view.winner` set, `events` end with `won`), then `roomState{phase:"finished"}`.
* `rematch`: `ai` -> new `roomState{playing}` + `state` (version 0) at once. `friends` -> `roomState{phase:"rematch"}`; others `setReady`
  (the requester is auto-ready), host `startGame`.
* `leave` -> `left`. Leaving the last human seat deletes the room.
* Bots act 900-1600 ms after their turn starts (>= 3000 ms while a *human* owes JAKK).

## Things the client can easily get wrong

1. **Always send `version`, and treat `STALE_VERSION` as normal.** Double taps and races produce it. Don't toast it
   loudly; the corrected `state` (`resync:true`) arrives right after - just re-render. Never queue/retry the same action blindly.
2. **The `view` is authoritative; `events` are cosmetic.** Never derive game state by replaying events (opponent `drew`
   events carry no cards, reconnects send no events).
3. **Card order in `cardIds` matters**: the first must be legal alone, the last ends on top. Build the array in tap order
   (use `getAddableCardIds(view, selection)`).
4. **Aces need `suit`** whenever any selected card is an Ace (`needsSuitChoice(view, selection)`); several Aces = one `suit`.
5. **JAKK window**: after your play leaves you with 1 card, `view.jakkOwed === view.you` until you send `{type:"declareJakk"}`
   (or you passed `declareJakk:true` in the play). It is a separate action with the **current** version, allowed when it is not
   your turn. The moment *anybody's* next action is applied you draw 2. Declaring needlessly gives `JAKK_NOT_NEEDED` (ignore it).
   The version bumps on a successful declare, so `view.version` changes with no turn change.
6. **Same player can move twice**: in 2-player games an 8 or 7 leaves `view.turn` unchanged. Don't assume `turn` alternates.
7. **Direction** (`view.direction`, `1` = in `players` order) matters for drawing the table; 2-player games reverse too (cosmetic).
8. **Penalty turn**: when `view.penalty` is set and it is your turn, the only valid actions are answering cards or `takePenalty`
   (`draw` is rejected). `getLegalCardIds` already returns just the answering cards.
9. **Bots are `isBot:true` seats** and mid-game leavers become bots with their old `playerId`/name. Disconnected humans keep
   `isBot:false, connected:false`.
10. **Reconnect = replace state.** After `welcome{resumed:true}` expect `roomState` then `state`; if the game finished while you were
    away you get `phase:"finished"` and the final view. After the room is gone you get `welcome{resumed:false}`.
11. **Close code 4000** = another tab/device took the seat; don't fight it with auto-reconnect.
12. `roomState.phase === "lobby" | "rematch"` means *there is no game*; clear the table.
13. Room codes: call `normalizeRoomCode` (upper-cases, validates the 32-symbol alphabet without `0 O 1 I`) on pasted/URL input.
14. `drewCardId`/`hasDrawn` are only used when `rules.playAfterDraw` is on (default off) - safe to ignore for now.
