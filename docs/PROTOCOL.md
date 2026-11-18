# Crypto Jakk - Client/Server Protocol (v2)

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
  | <--- state {view, events:[], resync:true, timer}   (only if a hand is playing / between hands / finished)
  |   else: client shows home screen; if the URL is /r/CODE send joinRoom.
```

* On any socket close: reconnect with exponential back-off (e.g. 0.5 s, 1 s, 2 s ... max 5 s) and send `hello` again.
  The server keeps your seat, marks it `connected:false` for the others, and after **15 s** of *your turn* (or when the turn timer expires, whichever is first) plays it with a bot
  (and repeats every turn while you are away). Reconnecting simply gives you back control.
* After `welcome` with `resumed:true` **replace** all local room/game state with the `roomState` and `state` that follow.
* `hello` may be re-sent on the same socket (same token) to change name/avatar.
* `{type:"requestState"}` re-sends `roomState` (+ `state`) at any time if the client suspects it drifted.
* A room is deleted when no human is connected for 5 minutes or after 30 minutes without activity -> `roomClosed`
  (if connected) and later `joinRoom` returns `ROOM_NOT_FOUND`.

## Changes since v1 (read this first, client engineer)

`PROTOCOL_VERSION` is now **2** (`hello.protocol: 2`; a v1 client gets `UNSUPPORTED_PROTOCOL`). The rules changed completely
to the owner's rulebook (`docs/source/owner-rules-2026-11-18.md`, implemented as described in `docs/RULEBOOK.md`).

**Rules / gameplay**
* 2-6 players (`maxPlayers: 6`); solo games 1-5 bots (`MAX_BOTS_AI_MODE = 5`).
* A `play` is a **sequence**: same rank, or same suit one rank up/down; the order of `cardIds` is the order played. Use
  `getLegalCardIds` (legal first card), `getAddableCardIds(view, selection)` (cards that may come next) and
  `previewPlay(view, ids, suit)` (verdict **plus** `outcome`: projected pickup, skips, reversals, `endsOnQueen`, `wins`,
  `blocked`, `drawAfter`, `goAgain`, `needsSuit`, resulting `suit`). `needsSuitChoice` is true only when the **last** selected card is an Ace.
* 8 skips, King reverses, 7 is ordinary. Queens must be covered inside the same sequence (an uncovered Queen costs 1 card; a
  Queen can never be the last card). Pickups are `Penalty {kind: "two"|"jack"|"mixed", amount}`.
* **JAKK is declared BEFORE the finishing turn**: `{type:"declareJakk"}` (standalone, only while it is not your turn) or
  `declareJakk:true` on your `play` / `draw` / `takePenalty` (covers your NEXT turn). Finishing without it: the cards stay
  played, you draw 1 and stay in (`finishBlocked`). The old "owed JAKK / +2 miss" model is gone: `view.jakkOwed`, the
  `jakkMissed` event, `JAKK_NOT_NEEDED`, `rules.jakkMissPenalty` no longer exist.
* Removed: `pass` action, `playAfterDraw`, `hasDrawn`, `drewCardId`, `MIXED_RANKS`, `MULTI_DISABLED`, `MUST_PLAY_DRAWN`,
  `ALREADY_DREW`, `CANNOT_PASS`, `rules.powerRanks/canFinishOnPower/multiPlay/aceWild/stackTwos/...`, `skipRank/reverseRank` stay.
* New action `{type:"chooseSuit", suit}`: only when `view.awaitingSuit` (opening Ace with First Card Active) and it is your turn.

**Rooms / matches**
* House rules (`flexibleQueenCover`, `mixedStacking`, `bringBacks`, `finishOnPower`, `firstCardActive`) and match options
  (`handsToWin` 1/3/5, `turnSeconds` 0/20/30/45/60) live in `RoomSnapshot.houseRules` / `.options` (and the effective `.rules`).
  Host sets them with `setOptions` (lobby / rematch phase only; guests are un-readied by a change) or in `createRoom`.
* New phase `handOver` (a hand ended, nobody reached `handsToWin`): host sends `nextHand`. `finished` = match over
  (`RoomSnapshot.matchWinner`); `rematch` keeps settings and resets `scores`. A hand with no winner (`view.handOver.winner === null`) awards nothing.
* Dealer rotates each hand (`view.dealer`); the first player is the seat after the dealer.
* Late joiners: `joinRoom` into a running friends room succeeds with `LobbyPlayer.waiting: true`; they receive a spectator view
  (`view.spectator: true`, `hand: []`, `you` not in `players`) and are dealt in next hand. `ROOM_FULL` still applies. `ai` rooms still answer `GAME_IN_PROGRESS`.
* `state` messages now carry `timer` (turn clock) and there is a `history` message (below).

## Types you will use

```ts
type Avatar = { emoji?: string; icon?: string; color: string }   // at least one of emoji/icon; color "#rrggbb"
type Card = { id: string; rank: Rank; suit: 'S'|'H'|'D'|'C' }       // id e.g. "7H", "10S", "AC"
type RoomPhase = 'lobby' | 'rematch' | 'playing' | 'handOver' | 'finished'
type PlayerAction =
  | { type: 'play'; cardIds: string[]; suit?: Suit; declareJakk?: boolean }   // suit required when the LAST card is an Ace
  | { type: 'draw'; declareJakk?: boolean } | { type: 'takePenalty'; declareJakk?: boolean }
  | { type: 'declareJakk' }                                                   // only while it is not your turn
  | { type: 'chooseSuit'; suit: Suit }                                        // opening Ace (firstCardActive)
type HouseRules = { flexibleQueenCover; mixedStacking; bringBacks; finishOnPower; firstCardActive: boolean }
type MatchOptions = { handsToWin: 1 | 3 | 5; turnSeconds: 0 | 20 | 30 | 45 | 60 }
type TurnTimer = { playerId: string; deadline: number /* absolute ms */; serverTime: number; seconds: number }
type HistoryEntry = { seq; hand; version; playerId: string | null; kind: 'deal'|'play'|'draw'|'takePenalty'|'declareJakk'|'chooseSuit'|'timeout'|'bot'; events: GameEvent[] }
```

`RoomSnapshot` = `{ code, mode, phase, hostId, players: LobbyPlayer[], minPlayers, maxPlayers, canStart, rules, houseRules, options, scores, handNumber, matchWinner }`,
`LobbyPlayer` = `{ playerId, name, avatar, isHost, isBot, ready, connected, waiting }`. `players` is seat order == turn order
(waiting participants are listed too, at the end). `scores` = hands won per playerId in this match.

## Client -> server messages

| type | fields | notes |
|---|---|---|
| `hello` | `sessionToken`, `name`, `avatar`, `protocol?` | Must be first. `name` is trimmed, control chars stripped, 1-16 chars (shared helper `sanitizeName`). |
| `createRoom` | `mode: "friends"\|"ai"`, `botCount?: 1-5`, `houseRules?`, `options?` | `ai`: creator + `botCount` (default 1) bots, match starts at once (`turnSeconds` is always 0 there). `friends`: private lobby. Bad values: `INVALID_OPTIONS`. |
| `joinRoom` | `code` | Case-insensitive. Also used to rejoin a room you hold a seat in. Mid-hand = waiting spectator. |
| `leave` | - | Lobby: seat freed. Mid-match: a bot takes your seat (a waiting spectator just disappears). Host leaving promotes the next human. |
| `setReady` | `ready: boolean` | Lobby / rematch only. |
| `setOptions` | `houseRules?: Partial<HouseRules>`, `options?: Partial<MatchOptions>` | Host only, lobby / rematch only (`HAND_IN_PROGRESS` otherwise). Validated server-side; unknown keys / values: `INVALID_OPTIONS`. |
| `addBot` / `removeBot` | - / `playerId` | Host only, lobby / rematch only, `friends` mode. |
| `startGame` | - | Host only. Needs >= 2 seats and every non-host human ready. |
| `action` | `version`, `action: PlayerAction` | `version` = `view.version` of the view you acted on. |
| `nextHand` | - | Host only, phase `handOver`: deal the next hand. |
| `rematch` | - | After `phase:"finished"`. |
| `requestHistory` | - | Replies `history` (any seated participant, including waiting ones). |
| `requestState` | - | Ask for `roomState` + `state` again. |
| `ping` | `t?: number` | Replies `pong`. |

Examples:

```json
{"type":"hello","protocol":2,"sessionToken":"k3J9x...32+chars...","name":"Alice","avatar":{"emoji":"🦊","color":"#ff8800"},"reqId":"1"}
{"type":"createRoom","mode":"friends","houseRules":{"bringBacks":true},"options":{"handsToWin":3,"turnSeconds":30}}
{"type":"createRoom","mode":"ai","botCount":2}
{"type":"setOptions","houseRules":{"flexibleQueenCover":false}}
{"type":"joinRoom","code":"K7M2Q"}
{"type":"action","version":12,"action":{"type":"play","cardIds":["9H","9S","10S"],"declareJakk":true}}
{"type":"action","version":12,"action":{"type":"play","cardIds":["AD"],"suit":"S"}}
{"type":"action","version":12,"action":{"type":"draw"}}
{"type":"action","version":13,"action":{"type":"takePenalty"}}
{"type":"action","version":13,"action":{"type":"declareJakk"}}
{"type":"action","version":0,"action":{"type":"chooseSuit","suit":"H"}}
{"type":"nextHand"}  {"type":"requestHistory"}  {"type":"leave"}  {"type":"startGame"}  {"type":"rematch"}  {"type":"requestState"}
```

## Server -> client messages

### `welcome`
```json
{"type":"welcome","protocol":2,"playerId":"p_9-ZWi8_YFGiX","resumed":false,"roomCode":null}
```

### `roomState`
Sent on every lobby change (join/leave/ready/bot/host/options/connection flag/phase/score). Always the **full** snapshot - replace, don't merge.
```json
{"type":"roomState","room":{"code":"K7M2Q","mode":"friends","phase":"lobby","hostId":"p_9-ZWi8_YFGiX",
 "players":[{"playerId":"p_9-ZWi8_YFGiX","name":"Alice","avatar":{"emoji":"🦊","color":"#ff8800"},"isHost":true,"isBot":false,"ready":false,"connected":true,"waiting":false}],
 "minPlayers":2,"maxPlayers":6,"canStart":false,
 "rules":{"...":"effective RulesConfig"},
 "houseRules":{"flexibleQueenCover":true,"mixedStacking":false,"bringBacks":false,"finishOnPower":true,"firstCardActive":false},
 "options":{"handsToWin":1,"turnSeconds":0},"scores":{},"handNumber":0,"matchWinner":null}}
```
Phases: `lobby` -> `playing` (a hand) -> `handOver` (hand ended, match goes on; host `nextHand` -> `playing`) ... -> `finished`
(match won: `matchWinner`) -> (`friends`) `rematch` (lobby again, same code, ready flags reset except the requester, settings kept) -> `playing`.
In `ai` mode `finished` -> `playing` directly on `rematch`.
**When `phase` is `lobby` or `rematch`, discard any old game view.** A phase change to `playing` is always followed by a `state`.

### `state`
After every applied action, to every connected seat (players **and** waiting spectators), each with *their own* view:
```json
{"type":"state","resync":false,"timer":{"playerId":"p_bob","deadline":1731900020000,"serverTime":1731900000000,"seconds":20},
 "view":{"version":1,"you":"p_alice","spectator":false,"players":["p_alice","p_bob"],"handCounts":{"p_alice":2,"p_bob":4},
   "hand":[{"id":"2S","rank":"2","suit":"S"},{"id":"AD","rank":"A","suit":"D"}],
   "topDiscard":{"id":"9H","rank":"9","suit":"H"},"discardCount":2,"drawCount":44,"activeSuit":"H","direction":1,
   "turn":"p_bob","dealer":"p_alice","penalty":null,"jakk":{"p_alice":true},"out":[],"provisional":[],
   "awaitingSuit":false,"coverNeeded":false,"opening":null,"winner":null,"handOver":null,"rules":{"...":"RulesConfig"}},
 "events":[{"type":"played","playerId":"p_alice","cards":[{"id":"9H","rank":"9","suit":"H"}]},{"type":"turn","playerId":"p_bob"}]}
```
* `view` is the **whole truth** - replace local state with it. `events` only drive the feed / animations.
* `resync:true` means a re-send (reconnect, `requestState`, stale/wrong-turn rejection): `events` is `[]`; do not animate.
* `view.hand` contains only your cards (empty for spectators). Others: `handCounts`. Deck: `drawCount`. Discard: `topDiscard` + `discardCount`.
* `view.penalty` = `{kind:"two"|"jack"|"mixed", amount}` or null (show amount and cause). `view.jakk[playerId]` = declared for their next /
  current turn (public; show it on seats). `view.out` = seats that sat out the rest of the hand (deck exhaustion); `view.provisional` =
  Bring Backs finishers whose win is not confirmed. `view.awaitingSuit` = the turn player must send `chooseSuit`. `view.coverNeeded` = the
  opening Queen must be covered by the first card played. `view.opening` = which opening effect applied (display only, until the first move).
* `view.handOver` = `{winner: string|null, reason: "finished"|"deckExhausted"|"lastStanding"|"turnCap"}` when the hand ended (`view.winner` mirrors `winner`).
* `timer` (top level, not in the view): the turn clock of the player to move, or `null` (no timer, or a bot is to move). Render
  `remaining = deadline - (Date.now() + (serverTime - receivedAt))`. A reconnect/resync re-sends the **same** deadline. On expiry the
  server plays the default for them (take the pending penalty, else draw 1) and the events start with `{type:"timedOut"}`.
* `version` increases by exactly 1 per applied action (including a standalone `declareJakk` / `chooseSuit`). It restarts at 0 each hand.

### `history`
```json
{"type":"history","entries":[{"seq":0,"hand":1,"version":0,"playerId":null,"kind":"deal","events":[]},
  {"seq":1,"hand":1,"version":1,"playerId":"p_alice","kind":"play","events":[{"type":"played","playerId":"p_alice","cards":[...]}]}]}
```
Ordered log of the **current hand** (reset at each deal, capped at 600 entries). `events` are the public form: a drawer's `cards` are never included.
`kind: "bot"` = a bot / away-player move, `"timeout"` = the timer's default move.

### Events (`GameEvent`)
`playerId` is the actor/subject. Exceptions: `skipped` (`playerId` = who played the 8, `who` = skipped player), `turn` (`playerId` = whose turn it is now).

```json
{"type":"played","playerId":"p_a","cards":[{"id":"9H","rank":"9","suit":"H"},{"id":"10H","rank":"10","suit":"H"}]}  // in play order; last = top
{"type":"drew","playerId":"p_b","count":2,"reason":"penalty","cards":[...]}   // reason: draw | penalty | queenPenalty | finishPenalty. `cards` ONLY for the drawer
{"type":"drew","playerId":"p_b","count":2,"reason":"penalty"}                  // what everybody else receives
{"type":"penaltyAdded","playerId":"p_a","kind":"two","added":2,"total":4}       // kind: two | jack | mixed
{"type":"penaltyTaken","playerId":"p_b","kind":"two","amount":4}
{"type":"penaltyCancelled","playerId":"p_b","kind":"jack","amount":5}
{"type":"reversed","playerId":"p_a","direction":-1}                               // one per King
{"type":"skipped","playerId":"p_a","who":"p_b"}                                   // one per 8 (2 players: who = the other player, p_a goes again)
{"type":"suitChosen","playerId":"p_a","suit":"D"}
{"type":"jakkDeclared","playerId":"p_a"}   {"type":"jakkExpired","playerId":"p_a"}
{"type":"finishBlocked","playerId":"p_a","reason":"queen|kingEight|noJakk","count":1,"message":"You must declare JAKK before the turn you finish on"}
{"type":"queenUncovered","playerId":"p_a","count":1,"wouldHaveWon":false}
{"type":"provisionalFinish","playerId":"p_a","pending":5}   {"type":"broughtBack","playerId":"p_a","amount":5}
{"type":"reshuffled","playerId":"p_b","count":31}
{"type":"satOut","playerId":"p_c","cards":9}                                       // deck exhaustion: most cards -> sits out, cards back in the draw pile
{"type":"timedOut","playerId":"p_b"}
{"type":"turn","playerId":"p_c"}
{"type":"won","playerId":"p_a"}   {"type":"handEnded","winner":"p_a","reason":"finished"}   // winner may be null
```
Typical ordering inside one `events` array for a `play`: `played`, `suitChosen`, `penaltyAdded`/`penaltyCancelled`, `reversed`*, `provisionalFinish`,
`queenUncovered`/`finishBlocked`, `drew` (that penalty), `skipped`*, `turn` (then `jakkExpired` / `jakkDeclared`), or `won` + `handEnded` for a winning play (no `turn`).
`reshuffled` precedes the `drew` it enabled. A `broughtBack` is followed by `penaltyTaken`, `drew`, `turn`.

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
| `INVALID_OPTIONS` | unknown house rule / bad `handsToWin` / `turnSeconds` |
| `UNSUPPORTED_PROTOCOL` | `hello.protocol` != server's (2) |
| `ROOM_NOT_FOUND` | unknown, malformed or expired code ("Room not found or expired") |
| `ROOM_FULL` | 6 seats taken (also `addBot`) |
| `GAME_IN_PROGRESS` | joining an `ai` room. (Friends rooms accept late joiners as waiting spectators.) |
| `ALREADY_IN_ROOM` | `createRoom`/`joinRoom` while seated in another room (send `leave` first) |
| `NOT_IN_ROOM` | room-scoped message without a seat |
| `NOT_HOST` | host-only message from a non-host |
| `NOT_ALL_READY` / `NOT_ENOUGH_PLAYERS` | `startGame` preconditions |
| `WRONG_PHASE` | e.g. `action` in a lobby, `setReady` mid-game, `startGame` twice, `nextHand` outside `handOver` |
| `HAND_IN_PROGRESS` | `setOptions` outside lobby / rematch |
| `NOT_A_BOT` | `removeBot` of something that is not a bot |
| `SERVER_BUSY` | room cap reached |
| `STALE_VERSION` | `action.version` != current version. The current view follows (`state`, `resync:true`). |

Engine rejections (`RejectionCode`, returned as `error.code` for `action`):

| code | example `message` |
|---|---|
| `NOT_YOUR_TURN` | "Not your turn" (view re-sent); also a waiting spectator trying to act |
| `ILLEGAL_CARD` | "Must match ♥ or a 9" / "Cover the Queen with a ♥ or another Queen" (opening Queen) |
| `BAD_SEQUENCE` | "4♠ doesn't follow 9♥: same rank, or same suit one up or down" / Queen cover |
| `MUST_ANSWER_PENALTY` | "Play a 2 or pick up 4" / "Play a Jack or pick up 5" (every card of the sequence must be a defence card) |
| `PENALTY_PENDING` | `draw` while a penalty is pending (same text) |
| `NO_PENALTY` | `takePenalty` with none pending |
| `SUIT_REQUIRED` | "Choose a suit for your Ace" (last card is an Ace) |
| `MUST_CHOOSE_SUIT` / `NO_SUIT_CHOICE` | opening-Ace suit choice pending / not pending |
| `CANNOT_FINISH_ON_POWER` | `finishOnPower` is off and the play would empty the hand ending on A, 2, 8, J or K |
| `JAKK_NOT_ALLOWED` | standalone `declareJakk` on your own turn (declare before your turn, or with your move) |
| `JAKK_ALREADY_DECLARED` / `JAKK_DISABLED` | harmless / `jakkEnabled` off |
| `CARD_NOT_IN_HAND`, `DUPLICATE_CARD`, `EMPTY_PLAY` | validation |
| `SITTING_OUT` | you sat out the rest of this hand (deck exhaustion) |
| `GAME_OVER`, `UNKNOWN_PLAYER`, `INVALID_ACTION` | misc |

## Room lifecycle summary

* `friends`: `createRoom` -> host gets `roomState`; share `/r/CODE`; friends `joinRoom` -> everyone gets `roomState`;
  non-host humans `setReady`; host `setOptions` / `addBot` / `removeBot`; host `startGame` -> `roomState{phase:"playing"}` then `state` (version 0).
* `ai`: `createRoom{mode:"ai"}` -> `roomState{phase:"playing"}` then `state` immediately. No lobby.
* Hand over: final `state` (`view.handOver` set, `events` end with `won`?/`handEnded`), then `roomState{phase:"handOver"|"finished"}` with updated `scores`.
* `handOver` -> host `nextHand` -> `roomState{playing}` + `state` (version 0, next dealer). `finished` -> `rematch`.
* `rematch`: `ai` -> new `roomState{playing}` + `state` (version 0) at once. `friends` -> `roomState{phase:"rematch"}`; others `setReady`
  (the requester is auto-ready), host `startGame`. Settings are kept, `scores` restart.
* `leave` -> `left`. Leaving the last human seat deletes the room.
* Bots act 900-1600 ms after their turn starts.

## Things the client can easily get wrong

1. **Always send `version`, and treat `STALE_VERSION` as normal.** Double taps and races produce it. Don't toast it
   loudly; the corrected `state` (`resync:true`) arrives right after - just re-render. Never queue/retry the same action blindly.
2. **The `view` is authoritative; `events` are cosmetic.** Never derive game state by replaying events (opponent `drew`
   events carry no cards, reconnects send no events).
3. **Card order in `cardIds` matters**: the first must be legal alone, each next must follow the previous (`getAddableCardIds`),
   the last ends on top. Under a pickup the whole sequence must be defence cards. Build the array in tap order.
4. **Suit nomination** is needed only when the LAST card is an Ace (`needsSuitChoice`). An Ace earlier in the run is just rank 1.
5. **Explain penalties before the player commits**: `previewPlay(...).outcome` says `endsOnQueen` (+1 card), `blocked` (`noJakk` / `queen` /
   `kingEight`: cards stay played, +1 card, no win) and `wins`. Warn with `message` text from the events afterwards.
6. **JAKK**: the button must be usable while it is NOT your turn (standalone `declareJakk`) and as a toggle on your move
   (`declareJakk:true` on `play`/`draw`/`takePenalty`). `view.jakk[you]` shows it is armed; it expires after your next turn.
7. **Same player can move twice**: in 2-player games an 8 or a King leaves `view.turn` unchanged. Don't assume `turn` alternates.
   With more players a run of 8s can also come round to the player (`skipped.who` can be the actor).
8. **Direction** (`view.direction`, `1` = in `players` order) matters for drawing the table.
9. **Penalty turn**: when `view.penalty` is set and it is your turn, valid actions are defence sequences or `takePenalty` (`draw` is rejected).
10. **Bots are `isBot:true` seats** and mid-match leavers become bots with their old `playerId`/name. Disconnected humans keep
    `isBot:false, connected:false`.
11. **Reconnect = replace state.** After `welcome{resumed:true}` expect `roomState` then `state` (with the same `timer.deadline`).
12. **Close code 4000** = another tab/device took the seat; don't fight it with auto-reconnect.
13. `roomState.phase === "lobby" | "rematch"` means *there is no hand*; clear the table. `handOver` / `finished` keep the last view for the results screen.
14. A waiting spectator gets `view.spectator === true`: no hand, no actions; show "dealt in next hand".
15. Room codes: call `normalizeRoomCode` (upper-cases, validates the 32-symbol alphabet without `0 O 1 I`) on pasted/URL input.
16. Saved solo games (`cj.local`) carry `RoomSave.v === 2`; `isCompatibleSave(save)` (from `@shared/room`) must be checked before `LocalGame.restore` (it throws on older saves, which must then be discarded).
