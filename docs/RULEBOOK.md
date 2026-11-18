# Crypto Jakk - Rulebook

> **PROVISIONAL - pending client sign-off.** Every number and toggle below is a field of the
> `RulesConfig` object in `shared/engine/rules.ts` (defaults shown). Changing a rule means changing
> a default (or a field) there - not rewriting engine code. The server always plays with `DEFAULT_RULES`.

**Changelog**

* Owner decision: 8 skips, King reverses, 7 ordinary - supersedes the PRD's "8 reverses". (`skipRank: '8'`, `reverseRank: 'K'`; the 7 has no effect and is no longer a power card. These replace the old `eightReverses` / `sevenSkips` toggles.)
* Owner decision: everything can be put on a Queen - with a Queen on top (and no penalty pending) the next play may start with any card (`queenAcceptsAny`). The Queen is a power card for start-card burial.

UK-style Blackjack: a card-**shedding** game (like Crazy Eights / Switch). It is not casino blackjack.

## Setup and goal

| Rule | Default | `RulesConfig` field |
|---|---|---|
| Players | 2-4 | `minPlayers`, `maxPlayers` |
| Deck | one standard 52-card deck | - |
| Hand size | 7 | `handSize` |
| Start card | flip one to the discard pile; if it is a power card (2, 8, J, Q, K, A) bury it at the bottom of the draw pile and flip again | `powerRanks` |
| Starting player | random | - |
| Goal | first to empty their hand wins; the game ends **immediately** | - |
| Finish on a power card | allowed (even a penalty card) | `canFinishOnPower` (`false` rejects such a play with `CANNOT_FINISH_ON_POWER`) |

## Playing a card

The first card you play must match the **active suit** or the **rank** of the top discard.
The active suit is normally the suit of the top discard; an Ace changes it.
Exception: **a Queen on top accepts any card** as the first card of the next play (see the matrix); a pending penalty always wins over that.

**Multi-card play** (`multiPlay: true`): you may play several cards of the **same rank** in one turn.

* The first card (in the order you chose) must be legal on its own.
* The order is kept; the **last** card ends on top and its suit becomes active (unless an Ace was played).
* Effects resolve card by card, in order.
* Mixed ranks are rejected: "Cards must be the same rank".

## Card-effect matrix

| Card | Effect | Config |
|---|---|---|
| 2 | Next player must draw 2. Stackable: the victim may play a 2 (or several) instead, passing the summed penalty on. **Only 2s answer a 2-penalty.** | `twoPenalty`, `stackTwos` |
| J♠, J♣ (black Jacks) | Next player must draw 5. Stackable with another black Jack. | `blackJackPenalty`, `stackBlackJacks` |
| J♥, J♦ (red Jacks) | On an active **Jack** penalty: cancels it entirely (penalty becomes 0, play continues normally to the next player). With no penalty active: an ordinary card. **Only Jacks answer a Jack penalty.** | `redJackCancels` |
| 8 | **Skip**: the next player misses their turn. Several 8s in one play skip that many players. | `skipRank` (`'8'`; `null` = no skip card) |
| King | **Reverse**: play direction flips. Several Kings in one play reverse once each. | `reverseRank` (`'K'`; `null` = no reverse card) |
| Queen | **Anything goes on it**: while a Queen is the top card and no penalty is pending, the next play may start with any card (any suit, any rank; the rest of a multi-card play must still share that card's rank, and every card keeps its own effect, e.g. a 2 on a Queen still starts +2). A Queen itself is played under the normal rule (suit or rank, or on another Queen). A Queen cannot answer a penalty. | `queenAcceptsAny` |
| 7 | No effect: an ordinary card (not a power card). | - |
| Ace | Wild: playable on anything when no penalty is pending. The player nominates the active suit (required with the action; several Aces = one nomination). An Ace can **not** answer a penalty. | `aceWild` |
| everything else | no effect | - |

### While a penalty is pending

The player to move may **only** answer it with a valid card (see above) or **take the penalty**: draw the
full amount, the penalty clears and the turn passes. Drawing a single card (`draw`) is rejected with
`PENALTY_PENDING`, e.g. "Play a 2 or pick up 4". The reason text is built for a toast.

## Turn order

Seating order is clockwise (`direction = 1`). After a normal play the turn goes to the next seat in the
current direction.

| Situation | 2 players | 3-4 players |
|---|---|---|
| 8 | the player who played it **goes again** (if they cannot play they must draw) | next player is skipped; direction unchanged |
| n eights together | player goes again (once, however many) | n players are skipped (modulo the table), in the current direction |
| King | the player who played it **goes again**; direction flips (cosmetic with 2 players) | direction flips; next player in the new direction |
| two Kings together | player still goes again | reverses twice = net no change; next player as normal |
| 7 | ordinary card: next player as normal | ordinary card: next player as normal |

(A card played on a Queen resolves exactly as it would anywhere else. An 8 or King in a 2-player game still emits the normal `skipped` / `reversed` events so the client can animate them.)

## Drawing

* On your turn with no penalty pending you may **always** draw 1 card (`drawCount`) instead of playing.
  It is mandatory (the only move) when you have no legal card.
* The turn then ends - no play-after-draw. Toggle `playAfterDraw: true` to let the player play *only the drawn card* or `pass`.
* **Deck exhaustion:** if the draw pile runs out, the discard pile except its top card is reshuffled into the draw pile
  (`reshuffled` event). If there are still not enough cards, the player draws as many as exist.

## JAKK

When a play leaves a player with **exactly one card** they must declare "JAKK".

* Declare as part of the play: `play` with `declareJakk: true`.
* Or afterwards with a separate `declareJakk` action - any time before the **next action by any other player is applied**.
* If another player's action (`play` / `draw` / `takePenalty`) is applied while the declaration is still missing, the forgetful
  player immediately draws 2 penalty cards (`jakkMissed` + `drew`, `jakkMissPenalty`), then that action resolves normally.
* In the 2-player 8 / King case the same player moves again: if they act again without declaring, the same penalty is applied
  *before* their action.
* Declaring when it is not required is a harmless no-op: rejected with `JAKK_NOT_NEEDED`, no penalty, no version bump.
* A *rejected* action never triggers the penalty. Only applied actions do.
* Toggle: `jakkEnabled`.

## Example turns

Numbered examples. Each is mirrored by a test named `Example N` in `tests/rulebook.test.ts`.
Notation: `5♥` = top discard (active suit ♥ unless noted); A/B/C/D are seats in order; hands are abbreviated to the relevant cards.

| # | Setup | Action | Expected result |
|---|---|---|---|
| 1 | top 5♥; A holds 9♥ | A plays 9♥ | Accepted (suit match). Top 9♥, active ♥, turn B. |
| 2 | top 5♥; A holds 5♠ | A plays 5♠ | Accepted (rank match). Active suit becomes ♠. |
| 3 | top 5♥; A holds 9♠ | A plays 9♠ | Rejected `ILLEGAL_CARD`: "Must match ♥ or a 5". |
| 4 | top 5♥; A holds 9♥ 9♠ 9♦ | A plays [9♥, 9♠] | Accepted. Discard order 5♥, 9♥, 9♠; top 9♠, active ♠; A keeps 9♦. |
| 5 | top 5♥; A holds 9♠ 9♥ | A plays [9♠, 9♥] | Rejected "Must match ♥ or a 5" (first card must be legal). [9♥, 9♠] is accepted. |
| 6 | top 5♥; A holds 9♥ 4♥ | A plays [9♥, 4♥] | Rejected `MIXED_RANKS`: "Cards must be the same rank". |
| 7 | top 5♥; A holds 2♥ | A plays 2♥ | Penalty `{two, 2}` pending; turn B. |
| 8 | Example 7, B holds 2♠ | B plays 2♠ | Accepted. Penalty `{two, 4}`; turn C; active suit ♠. |
| 9 | Example 7, B holds 2♠ 2♦ | B plays [2♠, 2♦] | Penalty `{two, 6}` (2 + 2 + 2); turn C. |
| 10 | Penalty `{two, 2}`, B holds 9♣ | B plays 9♣ / B draws | Rejected `MUST_ANSWER_PENALTY` / `PENALTY_PENDING`: "Play a 2 or pick up 2". |
| 11 | Penalty `{two, 4}`, C to move | C takes the penalty | C draws 4, penalty cleared, turn passes to A; top card unchanged. |
| 12 | A holds J♠, B holds J♣, top 5♠ | A plays J♠, then B plays J♣ | Penalty `{jack, 5}` then `{jack, 10}`; turn C. |
| 13 | Penalty `{jack, 5}` after A's J♠; B holds J♥ | B plays J♥ | Penalty cancelled (`penaltyCancelled`), nobody draws, turn C, active suit ♥. |
| 14 | No penalty, top 5♥; A holds J♥ | A plays J♥ | Ordinary card: no penalty, turn B. |
| 15 | Penalty `{jack, 5}`, B holds 2♠ and 9♠ | B plays 2♠ or 9♠ | Rejected: "Play a Jack or pick up 5". |
| 16 | 3 players; A holds 8♥ | A plays 8♥ | `skipped` B; direction unchanged; turn goes to **C**. |
| 17 | 4 players; A holds 8♥ | A plays 8♥ | `skipped` B; turn C; direction unchanged, so play then continues C to D. (17b: with direction -1 the same 8♥ skips D and the turn goes to C.) |
| 18 | 2 players; A holds 8♥ and cards that cannot follow | A plays 8♥ | `skipped` B; turn stays with A. A cannot play 9♣ ("Must match ♥ or an 8") so A must draw; then B. |
| 19 | 4 players; A holds 8♥ 8♠ | A plays [8♥, 8♠] | B and C skipped (two `skipped` events); turn D. |
| 20 | 3 players, or 2 players; A holds 8♥ 8♠ | A plays [8♥, 8♠] | 3 players: B and C skipped, turn returns to A. 2 players: turn stays with A (once). Direction unchanged in both. |
| 21 | 3 players; A holds K♥ | A plays K♥ | Direction becomes -1 (`reversed`); turn goes to **C** (A's other neighbour). No `skipped`. |
| 22 | 4 players; A holds K♥ | A plays K♥ | Direction -1; turn D; afterwards D to C. |
| 23 | 2 players; A holds K♥ 9♥ | A plays K♥ | Turn stays with A (direction flips, cosmetic), who may play 9♥. |
| 24 | top 5♥; A holds A♠ A♦ | A plays A♠ with `suit: "D"`; or [A♠, A♦] with `suit: "C"` | Accepted; `suitChosen`; active suit as nominated (one nomination for several Aces). |
| 25 | as 24 | A plays A♠ without `suit` | Rejected `SUIT_REQUIRED`: "Choose a suit for your Ace". |
| 26 | Penalty `{two, 2}`, B holds A♠ | B plays A♠ | Rejected: "Play a 2 or pick up 2". |
| 27 | A has a playable card and draws; next draw card K♣ | A draws | A gains K♣ (only A sees it), turn B. |
| 28 | Draw pile empty, discard has several cards | A draws | `reshuffled` then `drew`; top discard stays, the rest becomes the draw pile. |
| 29 | Only 1 card exists outside hands besides the top discard; A owes 4 | A takes the penalty | A draws the 1 card that exists, penalty clears, game continues. |
| 30 | A holds 3 cards | A plays 2 with `declareJakk: true` | `jakkDeclared` right after `played`; nothing owed. |
| 31 | as 30 without `declareJakk` | A then sends `declareJakk` before anyone else acts | `jakkDeclared`; turn unchanged; no penalty later. |
| 32 | as 31, B acts first (e.g. draws) | B's action is applied | `jakkMissed` (A), A draws 2, then B's action resolves. A can no longer declare (`JAKK_NOT_NEEDED`). |
| 33 | 2 players; A holds 8♥ 9♥ | A plays 8♥ (no declare), then plays 9♥ | After the 8 it is still A's turn and A owes JAKK. A's next action first draws 2 (`jakkMissed`), then 9♥ is played; A ends with 2 cards. |
| 34 | nobody owes JAKK | B sends `declareJakk` | Rejected `JAKK_NOT_NEEDED`; no penalty. |
| 35 | A holds one card, legal | A plays it | `won` event; `winner = A`; every later action is rejected `GAME_OVER`. |
| 36 | A's last card is 2♥ (or an Ace) | A plays it | A wins; the penalty is irrelevant. |
| 37 | `canFinishOnPower: false`; A's last card is 2♥ | A plays it | Rejected `CANNOT_FINISH_ON_POWER`. |
| 38 | A's turn | B acts / A's already-applied action is submitted again | `NOT_YOUR_TURN` ("Not your turn"). (The server also rejects identical resubmits as `STALE_VERSION` before they reach the engine.) |
| 39 | New game | `createGame` | 7 cards each; the start card is never a 2/8/J/K/A; all 52 cards accounted for. |
| 39b | New game; the first flip is a King or an 8 / is a 7 | `createGame` | King or 8: buried at the bottom of the draw pile and another card is flipped. 7: accepted as the start card (it is an ordinary card). |
| 40 | 3 or 4 players; A holds K♥ K♠ | A plays [K♥, K♠] | Two `reversed` events, direction unchanged, turn B. |
| 41 | 2 players; A holds K♥ K♠ | A plays [K♥, K♠] | Turn stays with A; direction unchanged (flipped twice). |
| 42 | 2, 3 or 4 players; A holds 7♥ | A plays 7♥ | Ordinary play: no `skipped`, no `reversed`; turn goes to B. |
| 43 | top Q♥, no penalty; A holds 9♠ | A plays 9♠ (2, 3 or 4 players) | Accepted although it matches neither suit nor rank. Top 9♠, active ♠, turn B. |
| 44 | top 5♥; A holds Q♠ / top Q♥, A holds Q♠ / top 5♥, A holds Q♥ | A plays the Queen | Q♠ on 5♥: rejected "Must match ♥ or a 5". Q♠ on Q♥ and Q♥ on 5♥: accepted. |
| 45 | top 5♥; A holds Q♥ Q♠ / top Q♥, A holds 9♠ 9♦ 4♦ | A plays [Q♥, Q♠] / [9♠, 9♦] / [9♠, 4♦] | Queens together: accepted, top Q♠, active ♠. 9♠ 9♦ on the Queen: accepted, top 9♦. [9♠, 4♦]: rejected `MIXED_RANKS`. |
| 46 | top Q♥; A holds one of 2♠, J♣, 8♠, K♠, A♠, 7♠ | A plays it | Normal effect: +2 penalty, +5 penalty, skip B, reverse, Ace nomination, nothing (7). |
| 47 | Penalty `{two, 2}` pending; A holds 9♠ 2♦ | A plays 9♠ / 2♦ | A Queen can never be on top of a penalty by play, but if forced: 9♠ rejected "Play a 2 or pick up 2", 2♦ accepted. |
| 48 | top Q♥; A holds 9♠ 4♦ 7♣ K♠ | legal-card helper | All four are legal starts. With `queenAcceptsAny: false` none is, and the rejection reads "Must match ♥ or a Queen". |

## Things deliberately left to the client engineer / sign-off

* Whether a pending JAKK should be declared with a dedicated button or automatically on the last-but-one play.
* Whether to show the bot's JAKK-miss as a toast ("Ada forgot to say JAKK! +2").
* Any rule you want to change: edit `DEFAULT_RULES` (and this document).
