# Crypto Jakk - Rulebook (as implemented)

> Source: the owner's proposed rulebook, `docs/source/owner-rules-2026-11-18.md` (197 numbered rules, referred to below as R1-R197).
> This document describes what the engine (`shared/engine`) actually does. Every number and toggle is a field of
> `RulesConfig` in `shared/engine/rules.ts`; house rules are chosen by the room host (see below). The server always starts from
> `DEFAULT_RULES` plus the host's house rules. Items marked **Implementation decision - confirm with client** are where the
> owner's text was open and the team chose; each is a config field or isolated rule so it can change later.

UK-style Blackjack: a card-**shedding** game (like Crazy Eights / Switch). It is not casino blackjack.

**Changelog**

* Owner decision: 8 skips, King reverses, 7 ordinary - supersedes the PRD's "8 reverses". (`skipRank: '8'`, `reverseRank: 'K'`; the 7 has no effect.)
* 2026-11-18 owner rulebook implemented: 2-6 players, runs and same-rank sequences, Queen cover, mixed-stacking / Bring Backs / First Card Active / finish-on-power house rules,
  JAKK declared **before** the finishing turn (the old "say JAKK on one card, +2 if you forget" model is removed), deck-exhaustion sit-out, hands-to-win matches,
  dealer rotation, turn timer, late joiners and a move history.
* Withdrawn: the interim idea that "anything may be played on a Queen"; a Queen must now be covered (flexible cover is a house rule, on by default, which reproduces "everything can go on the Queen" as a cover).

## Setup (R1-R12)

| Rule | Default | `RulesConfig` / where |
|---|---|---|
| Players | 2-6 | `minPlayers`, `maxPlayers` (solo games: 1-5 bots) |
| Deck / hand | one 52-card deck, 7 cards each | `handSize` |
| Opening card | the next card is flipped face up; **nothing is buried** - it is neutral unless First Card Active is on | `firstCardActive` |
| Dealer | first hand random, then rotates clockwise each hand | room (`createGame(..., {dealer})`) |
| First player | the seat after the dealer; play starts clockwise (seat order = `players` order, `direction = 1`) | - |
| Goal | first to empty their hand legally wins the hand (see Winning) | - |
| Hidden hands | each player sees only their own cards + opponents' counts | `toPlayerView` |

## Playing cards (R13-R20)

A turn is **one action**: `play` a sequence, `draw`, or `takePenalty`. (R75 "explicitly ends the turn": the client builds the sequence and sends it with Play.)

* The **first card** must match the active suit or the rank of the top discard. An Ace is wild as a first card unless a pickup is pending.
* No legal move (or by choice): `draw` 1 card (`drawCount`) and the turn ends.
* The **last card** played becomes the top discard and sets the active suit. If the last card is an Ace the player names the suit; an Ace earlier in a sequence is just a rank-1 card and needs no nomination.

### Sequences (R19, R66-R77) - Implementation decision, confirm with client

Every card after the first must **connect to the card before it** by either:

* **same rank** (any suit), or
* **same suit, rank exactly one higher or lower** (runs may change direction; Ace is rank 1, adjacent to 2 only - **no King-Ace wrap**).

The Queen cover (below) is the only exception to this rule. Under a pickup penalty the whole sequence may contain **only defence cards** (R86).
Special effects resolve over the whole sequence in order (R71): every 8 skips one more seat, every King flips the direction once, pickups are tallied as below.

### Pickups (R21-R40, R78-R88)

| Card | Effect |
|---|---|
| 2 | adds 2 (`twoPenalty`) |
| black Jack (J♠ J♣) | adds 5 (`blackJackPenalty`) |
| red Jack (J♥ J♦) | cancels **any** pickup, from 2s, black Jacks or mixed (sets it to 0). Creates nothing; with no pickup it is an ordinary card. Owner decision 2026-11-19: no longer depends on `mixedStacking` |

The pickup total is **walked card by card** over the sequence, starting from the incoming penalty (R87): a 2 adds 2, a black Jack adds 5, an eligible red Jack sets it to 0,
and **any other card played after pickup cards in the same turn clears what this turn added** (R77: 2♥ 3♥ 4♥ 5♥ leaves no pickup; 3♥ 2♥ keeps +2).
The penalty carries a **cause** for display (R88): `two`, `jack`, or `mixed`.

The next player must answer with an eligible defence sequence or **take the penalty** (draw the full total; the turn ends; `draw` is rejected with `PENALTY_PENDING`).

| House rule `mixedStacking` | Penalty is a 2-pickup | Penalty is a Jack pickup |
|---|---|---|
| **OFF (default)** | 2s stack; a red Jack cancels it; black Jacks do **not** stack | black Jacks stack, red Jacks cancel; 2s do **not** stack |
| ON | 2s and black Jacks stack on each other (cause becomes `mixed`); a red Jack cancels | same |

### 8 skips, King reverses, 7 is ordinary (R41-R52)

* **8**: skips the next player. n eights skip n seats, counted in the current direction and cycling round the table (3 players, three 8s: B, C, A skipped; B plays).
* **King**: reverses direction; each King flips once (two Kings = net no change; three = reversed). The direction change is an event (`reversed`).
* **2 players**: any number of 8s / Kings means the same player goes again (once). They must play or draw as normal.
* **7**: no effect.
* `skipRank` / `reverseRank` (`null` = off) are configuration.

### Queens (R59-R65)

A Queen must be **covered by the next card of the same sequence** (the cover is an exception to the connection rule; cards after the cover connect to the cover normally).

| House rule `flexibleQueenCover` | Who covers a Queen |
|---|---|
| **ON (default)** | any card; another Queen covers a Queen and then needs its own cover |
| OFF (strict) | same suit, or another Queen (which needs its own cover) |

* A sequence that **ends on a Queen** is accepted, but the player immediately draws 1 (`uncoveredQueenPenalty`; events `queenUncovered` + `drew` reason `queenPenalty`).
* A Queen can **never be the winning card**, even with JAKK declared: the play stands, the player draws 1 and stays in (`finishBlocked` reason `queen`).

### Aces (R53-R58)

Wild to start a turn when no pickup is pending (Ace-on-anything). Usable inside a sequence as rank 1. If the sequence ends on an Ace the player nominates the suit (`suitChosen`), visible to everybody.

## JAKK (R89-R99) - CHANGED MODEL

* A player declares JAKK **before the turn on which they finish**: with `declareJakk` while it is **not** their turn, or as a flag on the move that ends their previous turn (`play` / `draw` / `takePenalty` with `declareJakk: true`). Any hand size may declare (R92).
* A declaration covers the player's **next turn only** (a 2-player go-again or a skip that cycles back to you is the same turn); if they do not finish on it, it expires (`jakkExpired`) and must be re-declared (R93-R94).
* A standalone `declareJakk` during your own turn is rejected (`JAKK_NOT_ALLOWED`). The flag on the finishing move itself does not count.
* Emptying the hand **without** a live declaration: the cards stay discarded (R96), the player draws 1 (`finishPenalty`), stays in (R97), and the event `finishBlocked` (`reason: "noJakk"`, with a `message`) explains it (R98). Applies equally to humans, bots and multiplayer (R99).
* `jakkEnabled: false` removes JAKK entirely.

## Winning and ending a hand (R100-R111)

A play that empties the hand wins when **all** of these hold, otherwise the player draws 1 and stays in (events explain which):

1. the sequence does not end on a Queen (`queen`);
2. in a **2-player** hand it does not end on a King or an 8 (`kingEight`, R105-R106; "accepted, draw one, continue");
3. JAKK was declared for this turn (`noJakk`);
4. House rule `finishOnPower` (below) is not violated - this one is a **rejection** (`CANNOT_FINISH_ON_POWER`), not a penalty.

The winner is shown and the hand ends (`won`, `handEnded`). With `bringBacks` see below.

### Matches (R160-R162) - Implementation decision, confirm with client

Room option `handsToWin` = 1 (default), 3 or 5. Hand wins are tracked per player; the dealer rotates; after each hand the host deals the next one (`nextHand`) until someone reaches the target, who wins the match. A hand with **no winner awards nothing**. **Rematch keeps the room's settings** and restarts the score.

## Running out of cards (R129-R137) - Implementation decision, confirm with client

1. When the draw pile is empty, the discard pile **under its top card** is shuffled into a new draw pile (`reshuffled`); the top card stays.
2. If a required draw still cannot be met (every card is in a hand): the player **holding the most cards** sits out the rest of the hand and their cards are shuffled into the draw pile (`satOut`); the draw continues (repeat if needed). Sitters are skipped in the turn order and rejoin next hand.
3. If **two or more players tie for most cards**, the hand ends with **no winner** (`deckExhausted`).
4. If only one player remains in the hand, they win (`lastStanding`).
5. Safety cap: a hand that passes 3000 turn-ending actions ends with no winner (`turnCap`).

## Starting card (R112-R121) - house rule `firstCardActive`

* **OFF (default)**: the opening discard is neutral whatever it is (never buried). Its suit / rank must be matched as normal; an opening Queen needs no cover.
* **ON** - **Implementation decision, confirm with client**: the opening card acts as if the **dealer had just played it**:
  2 = pickup 2 for the first player; black Jack = pickup 5; red Jack = nothing; Ace = the first player names the suit first (`awaitingSuit`, action `chooseSuit`);
  King = direction reversed, so play starts with the seat **before** the dealer; 8 = the first seat is skipped (second seat starts); 2 players: King/8 mean the dealer goes first;
  Queen = the first card of the first play must cover it (flexible: any card; strict: same suit or a Queen) (`coverNeeded`; drawing instead clears it).

## House rules (R122-R128)

Set by the host in the lobby / rematch lobby only (never mid-hand or mid-match; the server validates and enforces them; they are part of the room state so everyone sees them before the match; guests must re-ready after a change). The CPU players obey all of them.

| House rule | Default | Meaning |
|---|---|---|
| `flexibleQueenCover` | **ON** | any card covers a Queen; OFF = same suit or another Queen |
| `mixedStacking` | OFF | 2s and black Jacks stack on each other (a red Jack cancels any penalty regardless) |
| `bringBacks` | OFF | a finisher who leaves a live pickup is only provisionally out (below) |
| `finishOnPower` | **ON** | OFF = a play that would empty the hand ending on A, 2, 8, J or K is rejected |
| `firstCardActive` | OFF | opening card effects apply (above) |
| `handsToWin` | 1 | match length: 1 / 3 / 5 hands |
| `turnSeconds` | 0 (off) | turn timer: 0 / 20 / 30 / 45 / 60 |

### Bring Backs (R107-R109) - Implementation decision, confirm with client

* OFF: a legal finish ends the hand at once (even if the last card left a pickup).
* ON: a finisher who leaves a live pickup is only **provisionally** out (`provisionalFinish`). If the pickup is **absorbed or cancelled** before it reaches their seat, the win is confirmed (`won`). If it **travels back to their seat**, they take it (`broughtBack`) and are back in with cards. An earlier provisional finisher wins if a later player's play also finishes.

## Turn timer (R163-R170) - Implementation decision, confirm with client

Room option `turnSeconds`. The server owns the clock: each human turn gets an absolute `deadline` (sent as `timer` with every `state`, with the server time so clients can render a countdown). Reconnecting never resets it. On expiry the server plays the legal default - **take the pending penalty, else draw 1** - and the events start with `timedOut`. Not used in solo games, or for bots. Disconnected humans' turns are also taken by the bot logic after 15 s.

## Multiplayer (R148-R162) - Implementation decision, confirm with client

Up to 6 seats; rooms by code / link; host starts. A **late joiner** during a hand joins as a *waiting* participant: public information only (no hands), and is dealt in from the next hand (a full room still rejects). Mid-match leavers are replaced by bots. Reconnecting resumes the seat in the active hand.

## Invalid moves (R138-R147)

Invalid moves change nothing and are rejected with a short reason (R139-R140): out-of-turn (`NOT_YOUR_TURN`), cards not in hand, duplicates, unmatched cards, bad sequences, wrong defence. Stale / duplicate submissions are rejected by version (`STALE_VERSION`). The optional "invalid play costs 2 + the pickup" variant (R141-R142) is **not implemented**; rejections only explain.

## Move history (R197)

The room keeps an ordered, public log of the current hand (deal, every applied action with its events, timeouts, bot moves) retrievable with `requestHistory`; hidden cards are never included.

## CPU opponents (R171-R180)

Bots see only their own view; legal moves only; they defend pickups (red Jack first), build same-rank groups and runs, use 8 / King against a nearly-out neighbour, avoid leaving a Queen uncovered, avoid emptying the hand without a live JAKK, declare JAKK (~90% of the time, when their remaining cards could plausibly finish next turn), name the best suit for an Ace, and obey every house rule. Moves are paced 900-1600 ms.

## Approval checklist - what was built

| Question | Built as |
|---|---|
| Does 8 skip or reverse? | **8 skips** (owner decision). |
| Does King reverse? | Yes. |
| Must Queens be covered? | Yes; flexible cover (any card) by default, strict (same suit / Queen) as a house rule. Uncovered = draw 1; never the winning card. |
| Can a player finish on a power card? | Yes by default (`finishOnPower` ON); host can forbid A, 2, 8, J, K. In 2-player, King/8 never win. |
| Can 2s and Black Jacks stack together? | Not by default; `mixedStacking` house rule. |
| Room capacity 2-4 or 2-6? | 2-6. |
| House rules configurable or fixed? | Configurable by the host before a match, visible to all. |
| Runs and same-rank combinations exactly as proposed? | Yes: same rank, or same suit +/-1, Ace low only (no K-A wrap) - flagged for confirmation. |
| Invalid-play penalty and timeout action? | No invalid-play penalty (variant not built); timeout = take pending penalty, else draw 1. |
| Definitive deck-exhaustion procedure? | Reshuffle under the top; else most cards sits out (cards recycled); tie = no-winner hand; last one standing wins; 3000-turn safety cap. |

## Example turns

Each numbered example is mirrored by a test named `Example N` in `tests/rulebook.test.ts` (R = owner rule number). Notation: `5♥` = top discard (active suit ♥ unless noted); A/B/C/... are seats in order.

| # | Setup | Action | Expected result |
|---|---|---|---|
| 1 | top 5♥; A holds 9♥ | A plays 9♥ | Accepted (suit match). Active ♥, turn B, `played` + `turn` events. |
| 2 | top 5♥; A holds 5♣ | A plays 5♣ | Accepted (rank match). Active suit becomes ♣. |
| 3 | top 5♥; A holds 9♠ | A plays 9♠ | Rejected `ILLEGAL_CARD` "Must match ♥ or a 5"; state unchanged. |
| 4 | no legal card | A draws | A gains 1 card (only A sees it), turn B. |
| 5 | A holds 9♥ 9♠ 9♣ | A plays [9♥, 9♠] | Accepted; top 9♠, active ♠; A keeps 9♣. |
| 6 | A holds 9♥ 10♥ 10♠ 9♠ ... | [9♥,10♥] / [4♥,3♥] / [9♥,10♥,10♠,9♠] | Ascending, descending, and direction-changing runs accepted. |
| 7 | A holds 9♠ 10♠ / 9♥ 4♠ / 9♥ J♥ | those sequences | First card must be legal (`ILLEGAL_CARD`); non-connecting card `BAD_SEQUENCE`; two apart does not connect. |
| 8 | A holds A♥ 2♥ / K♥ A♥ | [A♥,2♥] / [K♥,A♥] | A then 2 connects (+2 pickup, active ♥); no K-A wrap. |
| 9 | A holds A♠ A♦ | [A♠,A♦] without / with `suit: C` | `SUIT_REQUIRED`; with suit, active ♣ (`suitChosen`). An Ace earlier in a run needs none. |
| 10 | A holds 9♥ 10♥ 9♠ 4♠ 3♣ | helpers | Legal starts 9♥ 10♥; after 9♥ the addable cards are 10♥ 9♠. |
| 11 | A plays 2♥ | B tries to draw | Pickup `{two, 2}`; `draw` rejected "Play a 2 or pick up 2". |
| 12 | pickup 2; B holds 2♠ 2♦ | [2♠] / [2♠,2♦] | 4 / 6 (2+2+2); turn C. |
| 13 | pickup 4; A holds 9♣ | A plays 9♣ / takes | Rejected "Play a 2 or pick up 4"; taking draws 4, ends the turn, top card unchanged. |
| 14 | A plays J♠; B holds J♣ 9♠ | B plays J♣ / 9♠ | Pickup 5, then 10; 9♠ rejected "Play a Jack or pick up 5". |
| 15 | Jack pickup 10; A holds J♥ | A plays J♥ | Cancelled (`penaltyCancelled`), nobody draws. A red Jack with no pickup is ordinary. |
| 16 | A holds J♠ J♥ / J♠ J♣ | [J♠,J♥] / [J♠,J♣] | No pickup (cancelled earlier in the same turn) / pickup 10. |
| 17 | `mixedStacking` OFF; 2-pickup, A holds J♥ J♠; Jack pickup, A holds 2♠ | those plays | All rejected `MUST_ANSWER_PENALTY`. |
| 18 | `mixedStacking` ON | J♠ on a 2-pickup; 2♠ on a Jack pickup; J♥ on a 2-pickup | Pickup 7 cause `mixed`; 7 `mixed`; cancelled. |
| 19 | A holds 2♥ 3♥ 4♥ 6♥ | [2♥,3♥,4♥] / [3♥,2♥] | No pickup (R77); ending on the 2 keeps +2. |
| 20 | 2-pickup; A holds 2♠ 4♠ 2♦ | [2♠,4♠] / [2♠,2♦] | Rejected (every card must defend) / pickup 6. |
| 21 | A holds 8♥ | A plays it (3, 4, 6 players) | B skipped; turn C; direction unchanged. |
| 22 | 2 players; A holds 8♥ | A plays it | Turn stays with A; A cannot play 9♣ ("Must match ♥ or an 8") and must draw. |
| 23 | A holds 8♥ 8♠ (4p) / 8♥ 8♠ 8♣ (3p) / 8♥ 8♠ (2p) | all together | B, C skipped -> D; B, C, A skipped -> B; A again once. |
| 24 | 4p, direction -1; A holds 8♥ | A plays it | D skipped; turn C. |
| 25 | A holds K♥ (2, 3, 4, 6 players) | A plays it | Direction -1; turn = previous seat; 2 players: A goes again. No `skipped`. |
| 26 | A holds K♥ K♠ (3-6) / three Kings / 2p | together | Reversed twice, net no change, turn B / once reversed / 2p: A again, direction unchanged. |
| 27 | A holds 7♥ | A plays it | Ordinary: `played` + `turn` only (2, 3, 4 players). |
| 28 | `skipRank`/`reverseRank` null or moved | 8♥ K♥ / 7♥ | No effect when off; 7 skips when `skipRank: '7'`. |
| 29 | A holds 7♥ 8♥ 8♠ 9♠ / Q♥ K♥ | those runs | Two 8s skip B, C -> D; Q then K reverses. |
| 30 | flexible cover; A holds Q♥ 9♠ | [Q♥,9♠] | Accepted; no `queenUncovered`. |
| 31 | strict cover | [Q♥,9♠] / [Q♥,9♥] / [Q♥,Q♠,9♠] / [Q♥,Q♠,9♥] | Rejected / ok / ok / rejected (a second Queen needs its own cover). |
| 32 | A holds Q♥ ... | A plays Q♥ alone | `queenUncovered`; A draws 1 (`queenPenalty`); turn B. `previewPlay` shows it first. |
| 33 | A holds only Q♥, JAKK declared | A plays it | Not a win: draws 1, stays in. [Q♥,9♥] as the whole hand wins. |
| 34 | A holds Q♥ 9♠ 9♦ / 9♠ 10♥ | runs | Cover is the exception; later cards connect to the cover (10♥ after 9♠ rejected). |
| 35 | A holds 9♥ 9♠, JAKK declared | plays both | Win: `won`, `handEnded`; later actions `GAME_OVER`. |
| 36 | A holds 9♥ only, no JAKK | plays it | Card stays played; A draws 1 (`finishBlocked` `noJakk`), stays in. |
| 37 | B off-turn | B sends `declareJakk` | `jakkDeclared`; version +1; turn unchanged; a second declare is `JAKK_ALREADY_DECLARED`. |
| 38 | A's turn | A sends `declareJakk` / plays with `declareJakk: true` | Rejected `JAKK_NOT_ALLOWED` / accepted (covers the next turn). The flag on a finishing move does not make it a win. |
| 39 | A declared; A plays a non-finishing card or draws | - | `jakkExpired`. |
| 40 | 2 players; A declared; plays 8♥ | then 9♥ | The declaration survives the go-again; 9♥ wins. |
| 41 | `jakkEnabled: false` | A finishes | Wins with no declaration. |
| 42 | `finishOnPower` ON | finish on 2, A, 8, K, J (3+ players) | All win. |
| 43 | `finishOnPower` OFF | would-be finishing 2, 8, K, J, A | `CANNOT_FINISH_ON_POWER`; ordinary finishes and non-emptying power plays fine. |
| 44 | 2 players, JAKK declared, last card K or 8 | A plays it | Accepted, A draws 1 (`kingEight`), goes again. |
| 45 | `bringBacks` OFF; last card 2♥ | A plays it | A wins immediately. |
| 46 | `bringBacks` ON; last card 2♥ | A plays it; B takes the pickup | `provisionalFinish`; B absorbs -> A's win confirmed. |
| 47 | `bringBacks` ON; last card J♠; B holds J♥ | B cancels | A's win confirmed. |
| 48 | `bringBacks` ON, 2 players; last card 2♥; B stacks 2♠ | pickup returns to A | `broughtBack`: A draws 4 and is back in. |
| 49 | `firstCardActive` OFF | new hands | Opening card never changes anything; an opening Queen needs no cover. |
| 50 | `firstCardActive` ON | opening 2 / black Jack / red Jack | Pickup 2 / pickup 5 / nothing for the first player. |
| 51 | `firstCardActive` ON, opening Ace | first player acts | Must `chooseSuit` first (`MUST_CHOOSE_SUIT`), then plays. |
| 52 | `firstCardActive` ON | opening King / 8 | King: reversed, play starts before the dealer; 8: first seat skipped; 2p: dealer first. |
| 53 | `firstCardActive` ON, opening Queen | first play | First card covers it (flexible any / strict same suit or Queen); drawing clears it. |
| 54 | draw pile empty | A draws | Discard under the top reshuffled (`reshuffled`), top stays. |
| 55 | nothing left to draw; B holds the most cards | A takes a pickup | B sits out (`satOut`), cards recycled; B skipped and cannot act (`SITTING_OUT`). |
| 56 | tie for most cards | a draw cannot be met | Hand ends with no winner (`deckExhausted`). |
| 57 | everyone else sat out | - | Last player standing wins (`lastStanding`). |
| 58 | wrong turn, duplicate, foreign card | - | `NOT_YOUR_TURN`, `DUPLICATE_CARD`, `CARD_NOT_IN_HAND`, ...; input state never mutated. |
| 59 | new hand, 2-6 players | `createGame` | 7 each, 52 unique cards, first player = seat after dealer, clockwise. |
| 60 | many seeds | opening card | Any card, including K, Q, 8 (nothing buried). |

Room-level behaviours (house-rule validation, `handsToWin` matches, dealer rotation, timer with fake clock, late joiners, history, save versioning) are covered in `tests/match.test.ts`, `tests/local.test.ts` and `tests/server.test.ts`.

## Not implemented / open

* R141-R142 optional invalid-play penalty variant (not built).
* Ace as an opening-Queen cover under strict covering obeys the cover rule (not wild) - **confirm with client**.
* When one 8-skip count exceeds the table it keeps cycling (three 8s with 3 players skip everybody including the player) - **confirm with client**.
