// Every "Example N" here is mirrored in docs/RULEBOOK.md (same numbers). Rule numbers (R..) refer to
// docs/source/owner-rules-2026-11-18.md.
import { describe, expect, it } from 'vitest';
import {
  type GameState,
  DEFAULT_RULES,
  buildDeck,
  cardFromId,
  createGame,
  getAddableCardIds,
  getLegalCardIds,
  needsSuitChoice,
  previewPlay,
  shuffle,
  toPlayerView,
  withRules,
} from '../shared/engine';
import { act, assertConserved, eventTypes, handIds, ok, play, scenario, seededRng, topId, turnId } from './helpers';

const FILL = ['3C', '4C', '6D'];
const OPP: Record<string, string[]> = {
  B: ['3D', '5D', '6S'],
  C: ['3S', '5S', '6C'],
  D: ['3H', '5C', '9D'],
  E: ['4D', '4S', '7C'],
  F: ['4H', '7D', '10C'],
};
/** Scenario with the first `n` players (A + n-1 opponents); A holds `a`. */
const S = (n: number, a: string[], o: Partial<Parameters<typeof scenario>[0]> = {}): GameState => {
  const names = ['B', 'C', 'D', 'E', 'F'].slice(0, n - 1);
  const hands: Record<string, string[]> = { A: a };
  for (const nm of names) hands[nm] = OPP[nm];
  return scenario({ hands, top: '5H', turn: 'A', ...o });
};
const skippedWho = (events: Array<{ type: string; who?: string }>) => events.filter((e) => e.type === 'skipped').map((e) => e.who);

describe('Basic play (R13-R18)', () => {
  it('Example 1: match the active suit', () => {
    const r = ok(play(S(3, ['9H', ...FILL]), 'A', ['9H']));
    expect(topId(r.state)).toBe('9H');
    expect(r.state.activeSuit).toBe('H');
    expect(turnId(r.state)).toBe('B');
    expect(r.state.version).toBe(1);
    expect(eventTypes(r.events)).toEqual(['played', 'turn']);
  });

  it('Example 2: match the rank of the top discard (active suit changes)', () => {
    const r = ok(play(S(3, ['5C', ...FILL]), 'A', ['5C']));
    expect(r.state.activeSuit).toBe('C');
    expect(turnId(r.state)).toBe('B');
  });

  it('Example 3: an unrelated card is rejected with a toast-ready reason and changes nothing (R18, R139-R140)', () => {
    const s = S(3, ['9S', ...FILL]);
    const snap = JSON.stringify(s);
    expect(play(s, 'A', ['9S'])).toMatchObject({ ok: false, code: 'ILLEGAL_CARD', reason: 'Must match ♥ or a 5' });
    expect(JSON.stringify(s)).toBe(snap);
  });

  it('Example 4: no legal move (or by choice): draw 1 card and the turn ends (R17)', () => {
    const s = S(3, ['9S', ...FILL], { draw: ['KC'] });
    const r = ok(act(s, { type: 'draw', playerId: 'A' }));
    expect(handIds(r.state, 'A')).toContain('KC');
    expect(turnId(r.state)).toBe('B');
    expect(r.events[0]).toMatchObject({ type: 'drew', playerId: 'A', count: 1, reason: 'draw', cards: [{ id: 'KC' }] });
  });
});

describe('Multi-card sequences (R19, R66-R77)', () => {
  it('Example 5: same-rank cards together; the last card is on top and sets the suit', () => {
    const r = ok(play(S(3, ['9H', '9S', '9C', ...FILL.slice(0, 2)]), 'A', ['9H', '9S']));
    expect(topId(r.state)).toBe('9S');
    expect(r.state.activeSuit).toBe('S');
    expect(handIds(r.state, 'A')).toContain('9C');
    expect(r.events[0]).toMatchObject({ type: 'played', cards: [{ id: '9H' }, { id: '9S' }] });
  });

  it('Example 6: same-suit runs, ascending, descending, and changing direction', () => {
    expect(topId(ok(play(S(3, ['9H', '10H', ...FILL]), 'A', ['9H', '10H'])).state)).toBe('10H');
    expect(topId(ok(play(S(3, ['4H', '3H', ...FILL.slice(1)]), 'A', ['4H', '3H'])).state)).toBe('3H');
    const turn = ok(play(S(3, ['9H', '10H', '10S', '9S', ...FILL.slice(0, 1)]), 'A', ['9H', '10H', '10S', '9S']));
    expect(topId(turn.state)).toBe('9S');
    expect(turn.state.activeSuit).toBe('S');
  });

  it('Example 7: the first card must be legal on the pile, and every card must connect to the one before', () => {
    expect(play(S(3, ['9S', '10S', ...FILL]), 'A', ['9S', '10S'])).toMatchObject({ ok: false, code: 'ILLEGAL_CARD' });
    expect(play(S(3, ['9H', '4S', ...FILL]), 'A', ['9H', '4S'])).toMatchObject({
      ok: false,
      code: 'BAD_SEQUENCE',
      reason: "4♠ doesn't follow 9♥: same rank, or same suit one up or down",
    });
    // same suit but two apart does not connect
    expect(play(S(3, ['9H', 'JH', ...FILL]), 'A', ['9H', 'JH']).ok).toBe(false);
  });

  it('Example 8: an Ace is rank 1: A then 2 of the same suit connects, but K and A do not wrap', () => {
    const r = ok(play(S(3, ['AH', '2H', ...FILL], { top: '5C' }), 'A', ['AH', '2H']));
    expect(r.state.penalty).toEqual({ kind: 'two', amount: 2 });
    expect(r.state.activeSuit).toBe('H');
    const kh = play(S(3, ['KH', 'AH', ...FILL]), 'A', ['KH', 'AH'], { suit: 'H' });
    expect(kh).toMatchObject({ ok: false, code: 'BAD_SEQUENCE' });
  });

  it('Example 9: a sequence that ends on an Ace needs a nominated suit; an Ace earlier needs none (R55)', () => {
    const noSuit = play(S(3, ['AS', 'AD', ...FILL]), 'A', ['AS', 'AD']);
    expect(noSuit).toMatchObject({ ok: false, code: 'SUIT_REQUIRED', reason: 'Choose a suit for your Ace' });
    const r = ok(play(S(3, ['AS', 'AD', ...FILL]), 'A', ['AS', 'AD'], { suit: 'C' }));
    expect(r.state.activeSuit).toBe('C');
    expect(r.events).toContainEqual({ type: 'suitChosen', playerId: 'A', suit: 'C' });
    const earlier = ok(play(S(3, ['AH', '2H', ...FILL]), 'A', ['AH', '2H']));
    expect(earlier.events.some((e) => e.type === 'suitChosen')).toBe(false);
  });

  it('Example 10: the legal-move helpers drive selection: legal starts, then only cards that connect', () => {
    const view = toPlayerView(S(3, ['9H', '10H', '9S', '4S', '3C']), 'A');
    expect(getLegalCardIds(view).sort()).toEqual(['10H', '9H']); // 9S/4S/3C do not match ♥ or a 5
    expect(getAddableCardIds(view, ['9H']).sort()).toEqual(['10H', '9S']);
    expect(getAddableCardIds(view, ['9H', '9S'])).toEqual([]); // 9S -> 10S/8S/9x: none in hand
    expect(getAddableCardIds(view, ['9S'])).toEqual([]); // 9S is not a legal start
    expect(needsSuitChoice(toPlayerView(S(3, ['AS', ...FILL]), 'A'), ['AS'])).toBe(true);
  });
});

describe('Pickup penalties (R21-R40, R78-R88)', () => {
  it('Example 11: a 2 creates a pickup of 2; the victim cannot just draw one card', () => {
    const r = ok(play(S(3, ['2H', ...FILL]), 'A', ['2H']));
    expect(r.state.penalty).toEqual({ kind: 'two', amount: 2 });
    expect(turnId(r.state)).toBe('B');
    expect(r.events).toContainEqual({ type: 'penaltyAdded', playerId: 'A', kind: 'two', added: 2, total: 2 });
    expect(act(r.state, { type: 'draw', playerId: 'B' })).toMatchObject({ ok: false, code: 'PENALTY_PENDING', reason: 'Play a 2 or pick up 2' });
  });

  it('Example 12: 2s stack (one at a time or together): 2+2, and [2,2,2] = 6', () => {
    const s = S(3, ['2H', ...FILL], { });
    const a = ok(play(s, 'A', ['2H'])).state;
    const s2 = { ...a, hands: { ...a.hands, B: ['2S', '2D', '9C'].map(cardFromId) } };
    expect(ok(play(s2, 'B', ['2S'])).state.penalty).toEqual({ kind: 'two', amount: 4 });
    const both = ok(play(s2, 'B', ['2S', '2D']));
    expect(both.state.penalty).toEqual({ kind: 'two', amount: 6 });
    expect(turnId(both.state)).toBe('C');
  });

  it('Example 13: an unrelated card cannot answer a pickup; taking it draws the full total and ends the turn (R26, R84-R86)', () => {
    const s = scenario({ hands: { A: ['9C', ...FILL], B: ['4D', '5D', '6S'], C: ['4S', '5S', '6C'] }, top: '2H', turn: 'A', penalty: { kind: 'two', amount: 4 }, draw: ['KC', 'QC', 'JC', '8C'] });
    expect(play(s, 'A', ['9C'])).toMatchObject({ ok: false, code: 'MUST_ANSWER_PENALTY', reason: 'Play a 2 or pick up 4' });
    const r = ok(act(s, { type: 'takePenalty', playerId: 'A' }));
    expect(r.state.hands.A).toHaveLength(8);
    expect(r.state.penalty).toBeNull();
    expect(turnId(r.state)).toBe('B');
    expect(topId(r.state)).toBe('2H');
    expect(act(s, { type: 'takePenalty', playerId: 'A' }).ok).toBe(true);
    expect(act(S(3, FILL), { type: 'takePenalty', playerId: 'A' })).toMatchObject({ ok: false, code: 'NO_PENALTY' });
  });

  it('Example 14: a black Jack adds 5; black Jacks stack (J♠ then J♣ = 10)', () => {
    const a = ok(play(S(3, ['JS', ...FILL], { top: 'JD' }), 'A', ['JS']));
    expect(a.state.penalty).toEqual({ kind: 'jack', amount: 5 });
    const s2 = { ...a.state, hands: { ...a.state.hands, B: ['JC', '9S', '4D'].map(cardFromId) } };
    expect(ok(play(s2, 'B', ['JC'])).state.penalty).toEqual({ kind: 'jack', amount: 10 });
    expect(play(s2, 'B', ['9S'])).toMatchObject({ ok: false, reason: 'Play a Jack or pick up 5' });
  });

  it('Example 15: a red Jack cancels a Jack penalty: nothing is drawn (R32, R36-R39)', () => {
    const s = scenario({ hands: { A: ['JH', '9H', ...FILL], B: ['4D', '5D', '6S'], C: ['4S', '5S', '6C'] }, top: 'JS', turn: 'A', penalty: { kind: 'jack', amount: 10 } });
    const r = ok(play(s, 'A', ['JH']));
    expect(r.state.penalty).toBeNull();
    expect(r.events).toContainEqual({ type: 'penaltyCancelled', playerId: 'A', kind: 'jack', amount: 10 });
    expect(turnId(r.state)).toBe('B');
    // a red Jack with no penalty is an ordinary card (R39)
    const plain = ok(play(S(3, ['JH', ...FILL]), 'A', ['JH']));
    expect(plain.state.penalty).toBeNull();
  });

  it('Example 16: a red Jack cancels pickups made earlier in the same turn: [J♠, J♥] leaves nothing (R38, R74)', () => {
    const r = ok(play(S(3, ['JS', 'JH', ...FILL], { top: 'JD' }), 'A', ['JS', 'JH']));
    expect(r.state.penalty).toBeNull();
    const only = ok(play(S(3, ['JS', 'JC', 'JH', ...FILL], { top: 'JD' }), 'A', ['JS', 'JC']));
    expect(only.state.penalty).toEqual({ kind: 'jack', amount: 10 });
  });

  it('Example 17: mixed stacking OFF: a red Jack does not cancel a 2-penalty, and 2s and Jacks do not stack on each other (R33-R34, R40)', () => {
    const two = scenario({ hands: { A: ['JH', 'JS', '2S', ...FILL], B: OPP.B, C: OPP.C }, top: '2D', turn: 'A', penalty: { kind: 'two', amount: 2 } });
    expect(play(two, 'A', ['JH'])).toMatchObject({ ok: false, code: 'MUST_ANSWER_PENALTY' });
    expect(play(two, 'A', ['JS'])).toMatchObject({ ok: false, code: 'MUST_ANSWER_PENALTY' });
    const jack = scenario({ hands: { A: ['2S', 'JH', ...FILL], B: OPP.B, C: OPP.C }, top: 'JC', turn: 'A', penalty: { kind: 'jack', amount: 5 } });
    expect(play(jack, 'A', ['2S'])).toMatchObject({ ok: false, reason: 'Play a Jack or pick up 5' });
  });

  it('Example 18: mixed stacking ON: 2s and black Jacks stack together (mixed pickup) and a red Jack cancels any penalty', () => {
    const rules = { mixedStacking: true };
    const two = scenario({ hands: { A: ['JS', '2S', 'JH', ...FILL], B: OPP.B, C: OPP.C }, top: '2D', turn: 'A', penalty: { kind: 'two', amount: 2 }, rules });
    const bj = ok(play(two, 'A', ['JS']));
    expect(bj.state.penalty).toEqual({ kind: 'mixed', amount: 7 });
    const jackPen = scenario({ hands: { A: ['2S', ...FILL], B: OPP.B, C: OPP.C }, top: 'JC', turn: 'A', penalty: { kind: 'jack', amount: 5 }, rules });
    expect(ok(play(jackPen, 'A', ['2S'])).state.penalty).toEqual({ kind: 'mixed', amount: 7 });
    const cancel = ok(play(two, 'A', ['JH']));
    expect(cancel.state.penalty).toBeNull();
    expect(cancel.events).toContainEqual({ type: 'penaltyCancelled', playerId: 'A', kind: 'two', amount: 2 });
  });

  it('Example 19: a card played after pickup cards in the same turn clears what the turn added: 2♥ 3♥ 4♥ 5♥ leaves no pickup (R77)', () => {
    const r = ok(play(S(3, ['2H', '3H', '4H', '5H'.replace('5H', '6H'), ...FILL], { top: '5H' }), 'A', ['2H', '3H']));
    expect(r.state.penalty).toBeNull();
    expect(eventTypes(r.events)).not.toContain('penaltyAdded');
    const run = ok(play(scenario({ hands: { A: ['2H', '3H', '4H', '6H', '9C'], B: OPP.B, C: OPP.C }, top: '5H', turn: 'A' }), 'A', ['2H', '3H', '4H']));
    expect(run.state.penalty).toBeNull();
    // ending on the 2 keeps the pickup: 3♥ 2♥ (descending run) leaves 2
    const keep = ok(play(S(3, ['3H', '2H', ...FILL]), 'A', ['3H', '2H']));
    expect(keep.state.penalty).toEqual({ kind: 'two', amount: 2 });
  });

  it('Example 20: under a pickup the WHOLE sequence may contain only defence cards', () => {
    const s = scenario({ hands: { A: ['2S', '4S', '2D', ...FILL], B: OPP.B, C: OPP.C }, top: '2H', turn: 'A', penalty: { kind: 'two', amount: 2 } });
    expect(play(s, 'A', ['2S', '4S'])).toMatchObject({ ok: false, code: 'MUST_ANSWER_PENALTY', reason: 'Play a 2 or pick up 2' });
    expect(ok(play(s, 'A', ['2S', '2D'])).state.penalty).toEqual({ kind: 'two', amount: 6 });
    const view = toPlayerView(s, 'A');
    expect(getLegalCardIds(view).sort()).toEqual(['2D', '2S']);
    expect(getAddableCardIds(view, ['2S'])).toEqual(['2D']);
  });
});

describe('8 skips, King reverses, 7 is ordinary (R41-R52)', () => {
  it('Example 21: an 8 skips the next player; direction unchanged (3, 4 and 6 players)', () => {
    for (const [n, next] of [[3, 'C'], [4, 'C'], [6, 'C']] as const) {
      const r = ok(play(S(n, ['8H', ...FILL]), 'A', ['8H']));
      expect(turnId(r.state)).toBe(next);
      expect(r.state.direction).toBe(1);
      expect(skippedWho(r.events as never)).toEqual(['B']);
    }
  });

  it('Example 22: with 2 players an 8 returns the turn to the player, who must play or draw as normal (R45-R46)', () => {
    const r = ok(play(S(2, ['8H', '9C', '4C', '3C']), 'A', ['8H']));
    expect(turnId(r.state)).toBe('A');
    expect(r.events).toContainEqual({ type: 'skipped', playerId: 'A', who: 'B' });
    expect(play(r.state, 'A', ['9C'])).toMatchObject({ ok: false, reason: 'Must match ♥ or an 8' });
    expect(turnId(ok(act(r.state, { type: 'draw', playerId: 'A' })).state)).toBe('B');
  });

  it('Example 23: n eights skip n players, cycling round the table (R42-R44)', () => {
    const two = ok(play(S(4, ['8H', '8S', ...FILL]), 'A', ['8H', '8S']));
    expect(skippedWho(two.events as never)).toEqual(['B', 'C']);
    expect(turnId(two.state)).toBe('D');
    const three3p = ok(play(S(3, ['8H', '8S', '8C', ...FILL.slice(0, 1)]), 'A', ['8H', '8S', '8C']));
    expect(skippedWho(three3p.events as never)).toEqual(['B', 'C', 'A']);
    expect(turnId(three3p.state)).toBe('B');
    const two2p = ok(play(S(2, ['8H', '8S', '9C', '4C']), 'A', ['8H', '8S']));
    expect(turnId(two2p.state)).toBe('A');
    expect(two2p.state.direction).toBe(1);
  });

  it('Example 24: an 8 skips in the current direction (reversed table)', () => {
    const r = ok(play(S(4, ['8H', ...FILL], { direction: -1 }), 'A', ['8H']));
    expect(skippedWho(r.events as never)).toEqual(['D']);
    expect(turnId(r.state)).toBe('C');
  });

  it('Example 25: a King reverses direction (2, 3, 4 and 6 players)', () => {
    for (const [n, next] of [[3, 'C'], [4, 'D'], [6, 'F']] as const) {
      const r = ok(play(S(n, ['KH', ...FILL]), 'A', ['KH']));
      expect(r.state.direction).toBe(-1);
      expect(turnId(r.state)).toBe(next);
      expect(r.events).toContainEqual({ type: 'reversed', playerId: 'A', direction: -1 });
      expect(r.events.some((e) => e.type === 'skipped')).toBe(false);
    }
    const two = ok(play(S(2, ['KH', '9H', '4C', '3C']), 'A', ['KH']));
    expect(turnId(two.state)).toBe('A');
    expect(two.state.direction).toBe(-1);
    expect(play(two.state, 'A', ['9H']).ok).toBe(true);
  });

  it('Example 26: two Kings reverse twice (net no change, 3-6 players); three Kings flip once; with 2 players the player goes again (R49-R51)', () => {
    for (const n of [3, 4, 6]) {
      const r = ok(play(S(n, ['KH', 'KS', ...FILL]), 'A', ['KH', 'KS']));
      expect(r.state.direction).toBe(1);
      expect(turnId(r.state)).toBe('B');
      expect(r.events.filter((e) => e.type === 'reversed')).toHaveLength(2);
    }
    const three = ok(play(S(4, ['KH', 'KS', 'KC', ...FILL.slice(1)], { top: '5H' }), 'A', ['KH', 'KS', 'KC']));
    expect(three.state.direction).toBe(-1);
    expect(turnId(three.state)).toBe('D');
    const two = ok(play(S(2, ['KH', 'KS', '9C', '4C']), 'A', ['KH', 'KS']));
    expect(turnId(two.state)).toBe('A');
    expect(two.state.direction).toBe(1);
  });

  it('Example 27: a 7 is an ordinary card (2, 3, 4 players)', () => {
    for (const n of [2, 3, 4]) {
      const r = ok(play(S(n, ['7H', ...FILL]), 'A', ['7H']));
      expect(turnId(r.state)).toBe('B');
      expect(r.state.direction).toBe(1);
      expect(eventTypes(r.events)).toEqual(['played', 'turn']);
    }
  });

  it('Example 28: skip rank and reverse rank are configurable (null = off)', () => {
    const hands = { A: ['8H', 'KH', '7H', ...FILL], B: OPP.B, C: OPP.C };
    const off = scenario({ hands, top: '5H', turn: 'A', rules: { skipRank: null, reverseRank: null } });
    expect(turnId(ok(play(off, 'A', ['8H'])).state)).toBe('B');
    expect(ok(play(off, 'A', ['KH'])).state.direction).toBe(1);
    const moved = scenario({ hands, top: '5H', turn: 'A', rules: { skipRank: '7' } });
    expect(turnId(ok(play(moved, 'A', ['7H'])).state)).toBe('C');
  });

  it('Example 29: effects resolve over the whole sequence: two 8s inside a run skip two seats; Q then K reverses (R71)', () => {
    const run = ok(play(S(4, ['7H', '8H', '8S', '9S', ...FILL.slice(0, 1)]), 'A', ['7H', '8H', '8S', '9S']));
    expect(skippedWho(run.events as never)).toEqual(['B', 'C']);
    expect(turnId(run.state)).toBe('D');
    const qk = ok(play(S(4, ['QH', 'KH', ...FILL]), 'A', ['QH', 'KH']));
    expect(qk.state.direction).toBe(-1);
    expect(turnId(qk.state)).toBe('D');
  });
});

describe('Queens: cover required (R59-R65)', () => {
  it('Example 30: flexible covering (default): any card covers a Queen', () => {
    const r = ok(play(S(3, ['QH', '9S', ...FILL]), 'A', ['QH', '9S']));
    expect(topId(r.state)).toBe('9S');
    expect(eventTypes(r.events)).not.toContain('queenUncovered');
  });

  it('Example 31: strict covering: same suit or another Queen only (another Queen needs its own cover)', () => {
    const rules = { flexibleQueenCover: false };
    const base = (hand: string[]) => S(3, hand, { rules });
    expect(play(base(['QH', '9S', ...FILL]), 'A', ['QH', '9S'])).toMatchObject({ ok: false, code: 'BAD_SEQUENCE', reason: 'Cover the Queen with a ♥ or another Queen' });
    expect(play(base(['QH', '9H', ...FILL]), 'A', ['QH', '9H']).ok).toBe(true);
    const qq = ok(play(base(['QH', 'QS', '9S', ...FILL]), 'A', ['QH', 'QS', '9S']));
    expect(topId(qq.state)).toBe('9S');
    expect(play(base(['QH', 'QS', '9H', ...FILL]), 'A', ['QH', 'QS', '9H'])).toMatchObject({ ok: false, code: 'BAD_SEQUENCE' });
  });

  it('Example 32: a play ending on a Queen is accepted but the player immediately draws 1 (R63)', () => {
    const s = S(3, ['QH', ...FILL], { draw: ['KC'] });
    const r = ok(play(s, 'A', ['QH']));
    expect(r.events).toContainEqual({ type: 'queenUncovered', playerId: 'A', count: 1, wouldHaveWon: false });
    expect(r.events.find((e) => e.type === 'drew')).toMatchObject({ playerId: 'A', count: 1, reason: 'queenPenalty' });
    expect(r.state.hands.A).toHaveLength(4);
    expect(topId(r.state)).toBe('QH');
    expect(turnId(r.state)).toBe('B');
    expect(previewPlay(toPlayerView(s, 'A'), ['QH'])).toMatchObject({ ok: true, outcome: { endsOnQueen: true, drawAfter: 1 } });
  });

  it('Example 33: a Queen can never be the winning card, even with JAKK declared: the player draws 1 and stays in (R64-R65)', () => {
    const s = scenario({ hands: { A: ['QH'], B: OPP.B, C: OPP.C }, top: '5H', turn: 'A', jakk: ['A'], draw: ['KC'] });
    const r = ok(play(s, 'A', ['QH']));
    expect(r.state.winner).toBeNull();
    expect(r.state.hands.A).toHaveLength(1);
    expect(r.events.some((e) => e.type === 'finishBlocked' && e.reason === 'queen')).toBe(true);
    expect(topId(r.state)).toBe('QH');
    // covered: [Q♥, 9♥] as the whole hand wins
    const win = scenario({ hands: { A: ['QH', '9H'], B: OPP.B, C: OPP.C }, top: '5H', turn: 'A', jakk: ['A'] });
    expect(ok(play(win, 'A', ['QH', '9H'])).state.winner).toBe('A');
  });

  it('Example 34: the cover card is an exception to the connection rule; later cards connect to the cover', () => {
    expect(ok(play(S(3, ['QH', '9S', '9D', ...FILL.slice(0, 1)]), 'A', ['QH', '9S', '9D'])).state.discard.at(-1)!.id).toBe('9D');
    expect(play(S(3, ['QH', '9S', '10H', ...FILL.slice(0, 1)]), 'A', ['QH', '9S', '10H'])).toMatchObject({ ok: false, code: 'BAD_SEQUENCE' });
    const view = toPlayerView(S(3, ['QH', '9S', '4D', ...FILL.slice(0, 1)]), 'A');
    expect(getAddableCardIds(view, ['QH']).sort()).toEqual(['3C', '4D', '9S']);
  });
});

describe('JAKK (R89-R99)', () => {
  const finishing = (hand: string[], o: Partial<Parameters<typeof scenario>[0]> = {}) =>
    scenario({ hands: { A: hand, B: OPP.B, C: OPP.C }, top: '5H', turn: 'A', ...o });

  it('Example 35: finishing after a declaration wins; any hand size may declare (R92)', () => {
    const r = ok(play(finishing(['9H', '9S'], { jakk: ['A'] }), 'A', ['9H', '9S']));
    expect(r.state.winner).toBe('A');
    expect(r.state.handOver).toEqual({ winner: 'A', reason: 'finished' });
    expect(eventTypes(r.events)).toEqual(['played', 'won', 'handEnded']);
    expect(act(r.state, { type: 'draw', playerId: 'B' })).toMatchObject({ ok: false, code: 'GAME_OVER' });
  });

  it('Example 36: finishing WITHOUT a declaration: the cards stay played, the player draws 1 and stays in; the reason is explained (R95-R98)', () => {
    const r = ok(play(finishing(['9H'], { draw: ['KC'] }), 'A', ['9H']));
    expect(r.state.winner).toBeNull();
    expect(topId(r.state)).toBe('9H');
    expect(r.state.hands.A.map((c) => c.id)).toEqual(['KC']);
    expect(r.events).toContainEqual({ type: 'finishBlocked', playerId: 'A', reason: 'noJakk', count: 1, message: 'You must declare JAKK before the turn you finish on' });
    expect(turnId(r.state)).toBe('B');
    expect(previewPlay(toPlayerView(finishing(['9H']), 'A'), ['9H'])).toMatchObject({ ok: true, outcome: { wins: false, blocked: 'noJakk', drawAfter: 1 } });
  });

  it('Example 37: JAKK is declared while it is NOT your turn (standalone action) and covers your next turn (R89, R91)', () => {
    const s = S(3, FILL);
    const r = ok(act(s, { type: 'declareJakk', playerId: 'B' }));
    expect(r.events).toEqual([{ type: 'jakkDeclared', playerId: 'B' }]);
    expect(r.state.jakk.B).toBe(true);
    expect(r.state.version).toBe(1);
    expect(turnId(r.state)).toBe('A');
    expect(act(r.state, { type: 'declareJakk', playerId: 'B' })).toMatchObject({ ok: false, code: 'JAKK_ALREADY_DECLARED' });
  });

  it('Example 38: JAKK cannot be declared mid-turn as a standalone action; declare with your move instead (R89)', () => {
    const s = finishing(['9H', '9S', '4C'], { draw: ['KC'] });
    expect(act(s, { type: 'declareJakk', playerId: 'A' })).toMatchObject({ ok: false, code: 'JAKK_NOT_ALLOWED' });
    const r = ok(play(s, 'A', ['9H'], { declareJakk: true }));
    expect(r.state.jakk.A).toBe(true);
    expect(r.events).toContainEqual({ type: 'jakkDeclared', playerId: 'A' });
    // the finishing play itself carrying the flag does not count: it is for the NEXT turn
    const late = ok(play(finishing(['9H']), 'A', ['9H'], { declareJakk: true }));
    expect(late.state.winner).toBeNull();
  });

  it('Example 39: a declaration expires after the turn it covers and must be re-declared (R93-R94)', () => {
    const s = finishing(['9H', '9S', '4C'], { jakk: ['A'], draw: ['KC'] });
    const r = ok(play(s, 'A', ['9H']));
    expect(r.state.jakk.A).toBeUndefined();
    expect(r.events).toContainEqual({ type: 'jakkExpired', playerId: 'A' });
    const d = ok(act(s, { type: 'draw', playerId: 'A' }));
    expect(d.state.jakk.A).toBeUndefined();
  });

  it('Example 40: with 2 players an 8 / King go-again counts as the same turn: the declaration survives it (R91)', () => {
    const s = scenario({ hands: { A: ['8H', '9H'], B: OPP.B }, top: '5H', turn: 'A', jakk: ['A'] });
    const a = ok(play(s, 'A', ['8H']));
    expect(a.state.jakk.A).toBe(true);
    expect(turnId(a.state)).toBe('A');
    expect(ok(play(a.state, 'A', ['9H'])).state.winner).toBe('A');
  });

  it('Example 41: JAKK can be turned off with the jakkEnabled rule', () => {
    const s = finishing(['9H'], { rules: { jakkEnabled: false } });
    expect(ok(play(s, 'A', ['9H'])).state.winner).toBe('A');
    expect(act(S(3, FILL, { rules: { jakkEnabled: false } }), { type: 'declareJakk', playerId: 'B' })).toMatchObject({ ok: false, code: 'JAKK_DISABLED' });
  });
});

describe('Winning and power-card finishes (R100-R111)', () => {
  const fin = (hand: string[], rules: Partial<ReturnType<typeof withRules>> = {}, n = 3, top = '5H') =>
    S(n, hand, { top, jakk: ['A'], rules });

  it('Example 42: finishOnPower ON (default) allows finishing on an Ace, 2, 8, Jack or King (3+ players)', () => {
    expect(ok(play(fin(['2H']), 'A', ['2H'])).state.winner).toBe('A');
    expect(ok(play(fin(['AS']), 'A', ['AS'], { suit: 'H' })).state.winner).toBe('A');
    expect(ok(play(fin(['8H']), 'A', ['8H'])).state.winner).toBe('A');
    expect(ok(play(fin(['KH']), 'A', ['KH'])).state.winner).toBe('A');
    expect(ok(play(fin(['JH']), 'A', ['JH'])).state.winner).toBe('A');
  });

  it('Example 43: finishOnPower OFF rejects a play that would empty the hand ending on A, 2, 8, J or K', () => {
    const rules = { finishOnPower: false };
    for (const [card, extra] of [['2H', undefined], ['8H', undefined], ['KH', undefined], ['JH', undefined], ['AS', { suit: 'H' as const }]] as const) {
      expect(play(fin([card], rules), 'A', [card], extra as never)).toMatchObject({ ok: false, code: 'CANNOT_FINISH_ON_POWER' });
    }
    expect(ok(play(fin(['9H'], rules), 'A', ['9H'])).state.winner).toBe('A');
    // not emptying the hand is fine
    expect(play(fin(['2H', '9C'], rules), 'A', ['2H']).ok).toBe(true);
    // a sequence ending on an ordinary card is fine
    expect(ok(play(fin(['2H', '3H'], rules), 'A', ['2H', '3H'])).state.winner).toBe('A');
  });

  it('Example 44: in a 2-player hand a King or 8 can never be the winning last card: accepted, but the player draws 1 and continues (R105-R106)', () => {
    for (const card of ['KH', '8H']) {
      const s = scenario({ hands: { A: [card], B: OPP.B }, top: '5H', turn: 'A', jakk: ['A'], draw: ['QC'] });
      const r = ok(play(s, 'A', [card]));
      expect(r.state.winner).toBeNull();
      expect(r.state.hands.A.map((c) => c.id)).toEqual(['QC']);
      expect(r.events.some((e) => e.type === 'finishBlocked' && e.reason === 'kingEight')).toBe(true);
      expect(turnId(r.state)).toBe('A'); // go-again applies
    }
  });
});

describe('Bring Backs (R107-R109)', () => {
  const live = (rules: object, hands?: Record<string, string[]>) =>
    scenario({ hands: hands ?? { A: ['2H'], B: ['4D', '5D', '6S'], C: ['4S', '5S', '6C'] }, top: '5H', turn: 'A', jakk: ['A'], rules, draw: ['KC', 'QC', 'JC', '8C'] });

  it('Example 45: Bring Backs OFF (default): finishing on a pickup card wins immediately', () => {
    const r = ok(play(live({}), 'A', ['2H']));
    expect(r.state.winner).toBe('A');
  });

  it('Example 46: Bring Backs ON: the finish is only provisional while the pickup is live; absorbing it confirms the win (R108-R109)', () => {
    const r = ok(play(live({ bringBacks: true }), 'A', ['2H']));
    expect(r.state.winner).toBeNull();
    expect(r.state.provisional).toEqual(['A']);
    expect(r.events).toContainEqual({ type: 'provisionalFinish', playerId: 'A', pending: 2 });
    const t = ok(act(r.state, { type: 'takePenalty', playerId: 'B' }));
    expect(t.state.winner).toBe('A');
    expect(t.state.handOver).toEqual({ winner: 'A', reason: 'finished' });
    expect(eventTypes(t.events)).toContain('won');
  });

  it('Example 47: Bring Backs ON: a red Jack / cancellation also confirms the win', () => {
    const s = scenario({ hands: { A: ['JS'], B: ['JH', '5D', '6S'], C: OPP.C }, top: 'JD', turn: 'A', jakk: ['A'], rules: { bringBacks: true } });
    const a = ok(play(s, 'A', ['JS']));
    expect(a.state.provisional).toEqual(['A']);
    const b = ok(play(a.state, 'B', ['JH']));
    expect(b.state.winner).toBe('A');
  });

  it('Example 48: Bring Backs ON: if the pickup travels back to the finisher before anyone absorbs it, they take it and are back in (R108)', () => {
    const s = scenario({ hands: { A: ['2H'], B: ['2S', '5D', '6S'] }, top: '5H', turn: 'A', jakk: ['A'], rules: { bringBacks: true }, draw: ['KC', 'QC', 'JC', '8C', '9C'] });
    const a = ok(play(s, 'A', ['2H']));
    const b = ok(play(a.state, 'B', ['2S'])); // 4 goes back to A in a 2-player game
    expect(b.state.winner).toBeNull();
    expect(b.state.provisional).toEqual([]);
    expect(b.state.hands.A).toHaveLength(4);
    expect(b.events).toContainEqual({ type: 'broughtBack', playerId: 'A', amount: 4 });
    expect(b.state.penalty).toBeNull();
    expect(turnId(b.state)).toBe('B');
  });
});

describe('Starting cards (R112-R121)', () => {
  const opening = (top: string, n: number, rules: object = { firstCardActive: true }, dealer = 'C') => {
    const names = ['A', 'B', 'C', 'D'].slice(0, n);
    const hands: Record<string, string[]> = {};
    for (const nm of names) hands[nm] = nm === 'A' ? ['9H', '9S', '3C'] : nm === 'B' ? ['4D', '5D', '6S'] : nm === 'C' ? ['4S', '5S', '6C'] : ['4H', '5C', '10C'];
    const s = scenario({ hands, top, turn: names[(names.indexOf(dealer) + 1) % n], dealer, rules });
    return s;
  };

  it('Example 49: First Card Active OFF (default): the opening card is neutral, whatever it is (R113)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const g = createGame(['A', 'B', 'C'], DEFAULT_RULES, seededRng(seed));
      expect(g.penalty).toBeNull();
      expect(g.awaitingSuit).toBe(false);
      expect(g.coverNeeded).toBe(false);
      expect(g.direction).toBe(1);
      expect(g.turn).toBe((g.dealer + 1) % 3);
      expect(g.opening).toBeNull();
      assertConserved(g);
    }
    // an opening King is not buried and does nothing; an opening Queen needs no cover
    const queen = scenario({ hands: { A: ['9H', ...FILL], B: OPP.B }, top: 'QH', turn: 'A' });
    const q = ok(play(queen, 'A', ['9H']));
    expect(q.events.some((e) => e.type === 'queenUncovered')).toBe(false);
    expect(play(scenario({ hands: { A: ['9S', ...FILL], B: OPP.B }, top: 'QH', turn: 'A' }), 'A', ['9S'])).toMatchObject({ ok: false, code: 'ILLEGAL_CARD' });
  });

  it('Example 50: First Card Active ON: opening 2 creates pickup 2, opening black Jack pickup 5, red Jack nothing (R114-R115, R120)', () => {
    const find = (rank: string, black?: boolean) => {
      for (let seed = 1; seed <= 2000; seed++) {
        const g = createGame(['A', 'B', 'C'], withRules({ firstCardActive: true }), seededRng(seed));
        const t = g.discard[0];
        if (t.rank === rank && (black === undefined || (t.suit === 'S' || t.suit === 'C') === black)) return g;
      }
      throw new Error('no seed');
    };
    expect(find('2').penalty).toEqual({ kind: 'two', amount: 2 });
    expect(find('J', true).penalty).toEqual({ kind: 'jack', amount: 5 });
    expect(find('J', false).penalty).toBeNull();
    expect(find('2').opening).toBe('two');
  });

  it('Example 51: First Card Active ON: an opening Ace makes the first player name the suit before anything else (R116)', () => {
    let g: GameState | undefined;
    for (let seed = 1; seed <= 2000 && !g; seed++) {
      const c = createGame(['A', 'B', 'C'], withRules({ firstCardActive: true }), seededRng(seed));
      if (c.discard[0].rank === 'A') g = c;
    }
    const first = g!.players[g!.turn];
    expect(g!.awaitingSuit).toBe(true);
    expect(act(g!, { type: 'draw', playerId: first })).toMatchObject({ ok: false, code: 'MUST_CHOOSE_SUIT' });
    expect(act(g!, { type: 'chooseSuit', playerId: g!.players[(g!.turn + 1) % 3], suit: 'H' })).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    const r = ok(act(g!, { type: 'chooseSuit', playerId: first, suit: 'H' }));
    expect(r.state.activeSuit).toBe('H');
    expect(r.state.awaitingSuit).toBe(false);
    expect(turnId(r.state)).toBe(first);
    expect(act(r.state, { type: 'chooseSuit', playerId: first, suit: 'D' })).toMatchObject({ ok: false, code: 'NO_SUIT_CHOICE' });
  });

  it('Example 52: First Card Active ON: an opening King reverses (play starts the other way), an opening 8 skips the first seat (R117-R118)', () => {
    const find = (rank: string, n: number) => {
      for (let seed = 1; seed <= 3000; seed++) {
        const g = createGame(['A', 'B', 'C', 'D'].slice(0, n), withRules({ firstCardActive: true }), seededRng(seed));
        if (g.discard[0].rank === rank) return g;
      }
      throw new Error('no seed');
    };
    const k = find('K', 4);
    expect(k.direction).toBe(-1);
    expect(k.turn).toBe((k.dealer + 3) % 4); // the seat BEFORE the dealer
    const e = find('8', 4);
    expect(e.direction).toBe(1);
    expect(e.turn).toBe((e.dealer + 2) % 4); // first seat skipped
    const k2 = find('K', 2);
    expect(k2.turn).toBe(k2.dealer); // 2 players: the dealer "goes again", so starts
  });

  it('Example 53: First Card Active ON: an opening Queen must be covered by the first play (flexible: any card; strict: same suit or a Queen) (R119)', () => {
    const flex = scenario({ hands: { A: ['9S', ...FILL], B: OPP.B }, top: 'QH', turn: 'A', coverNeeded: true });
    expect(ok(play(flex, 'A', ['9S'])).state.coverNeeded).toBe(false);
    const strict = scenario({ hands: { A: ['9S', '9H', ...FILL.slice(0, 1)], B: OPP.B }, top: 'QH', turn: 'A', coverNeeded: true, rules: { flexibleQueenCover: false } });
    expect(play(strict, 'A', ['9S'])).toMatchObject({ ok: false, code: 'ILLEGAL_CARD', reason: 'Cover the Queen with a ♥ or another Queen' });
    expect(play(strict, 'A', ['9H']).ok).toBe(true);
    expect(getLegalCardIds(toPlayerView(strict, 'A'))).toEqual(['9H']);
    // drawing instead clears the requirement
    expect(ok(act(flex, { type: 'draw', playerId: 'A' })).state.coverNeeded).toBe(false);
  });
});

describe('Running out of cards (R129-R137)', () => {
  it('Example 54: the discard pile under the top is reshuffled into the draw pile; the top stays (R130-R132)', () => {
    const s = scenario({
      hands: { A: ['9S', ...FILL], B: OPP.B },
      top: '5H',
      turn: 'A',
      draw: [],
      rest: 'discard',
    });
    const r = ok(act(s, { type: 'draw', playerId: 'A' }));
    expect(r.events[0]).toMatchObject({ type: 'reshuffled' });
    expect(topId(r.state)).toBe('5H');
    expect(r.state.hands.A).toHaveLength(5);
    assertConserved(r.state);
  });

  it('Example 55: if a draw still cannot be met, the player holding the MOST cards sits out and their cards go back into the draw pile (R134-R135)', () => {
    const s = scenario({
      hands: { A: ['9S', ...FILL], B: ['4D', '5D', '6S', '7S', '8S', '9D'], C: OPP.C },
      top: '5H',
      turn: 'A',
      rest: 'none',
      penalty: { kind: 'two', amount: 2 },
    });
    // nothing left anywhere but the hands: A must pick up 2 -> exhaustion -> B (most cards) sits out
    const r = ok(act(s, { type: 'takePenalty', playerId: 'A' }));
    expect(r.state.out).toEqual(['B']);
    expect(r.state.hands.B).toEqual([]);
    expect(r.events.some((e) => e.type === 'satOut' && e.playerId === 'B' && e.cards === 6)).toBe(true);
    expect(r.state.hands.A.length).toBe(6); // got the 2 cards B's hand supplied
    expect(turnId(r.state)).toBe('C'); // B is skipped in the turn order
    expect(act(r.state, { type: 'draw', playerId: 'B' })).toMatchObject({ ok: false, code: 'SITTING_OUT' });
    expect(ok(act({ ...r.state, turn: 2 }, { type: 'draw', playerId: 'C' })).state.players[ok(act({ ...r.state, turn: 2 }, { type: 'draw', playerId: 'C' })).state.turn]).toBe('A');
  });

  it('Example 56: if two or more players tie for the most cards, the hand ends with no winner (R136)', () => {
    const s = scenario({
      hands: { A: ['9S', '3C', '4C', '6D', '7S'], B: ['4D', '5D', '6S', '8S', '9D'], C: ['3S', '5S'] },
      top: '5H',
      turn: 'C',
      rest: 'none',
      penalty: { kind: 'two', amount: 2 },
    });
    const r = ok(act(s, { type: 'takePenalty', playerId: 'C' }));
    expect(r.state.winner).toBeNull();
    expect(r.state.handOver).toEqual({ winner: null, reason: 'deckExhausted' });
    expect(r.events).toContainEqual({ type: 'handEnded', winner: null, reason: 'deckExhausted' });
    expect(act(r.state, { type: 'draw', playerId: 'A' })).toMatchObject({ ok: false, code: 'GAME_OVER' });
  });

  it('Example 57: when everyone else has sat out, the last player standing wins the hand', () => {
    const s = scenario({
      hands: { A: ['9S', '3C'], B: ['4D', '5D', '6S', '8S', '9D'] },
      top: '5H',
      turn: 'A',
      rest: 'none',
      penalty: { kind: 'two', amount: 2 },
    });
    const r = ok(act(s, { type: 'takePenalty', playerId: 'A' }));
    expect(r.state.out).toEqual(['B']);
    expect(r.state.handOver).toEqual({ winner: 'A', reason: 'lastStanding' });
  });
});

describe('Validation and setup (R143-R146, R4-R10)', () => {
  it('Example 58: out-of-turn, duplicate and foreign cards are rejected; the input state is never mutated (R143-R145)', () => {
    const s = S(3, ['9H', ...FILL]);
    const snap = JSON.stringify(s);
    expect(play(s, 'B', ['3D'])).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN', reason: 'Not your turn' });
    expect(play(s, 'A', ['9H', '9H'])).toMatchObject({ ok: false, code: 'DUPLICATE_CARD' });
    expect(play(s, 'A', ['8H'])).toMatchObject({ ok: false, code: 'CARD_NOT_IN_HAND' });
    expect(play(s, 'A', [])).toMatchObject({ ok: false, code: 'EMPTY_PLAY' });
    expect(act(s, { type: 'nonsense', playerId: 'A' } as never)).toMatchObject({ ok: false, code: 'INVALID_ACTION' });
    expect(act(s, { type: 'draw', playerId: 'Z' })).toMatchObject({ ok: false, code: 'UNKNOWN_PLAYER' });
    const r = ok(play(s, 'A', ['9H']));
    expect(play(r.state, 'A', ['3C'])).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(JSON.stringify(s)).toBe(snap);
  });

  it('Example 59: a new hand deals 7 each (2-6 players), conserves 52 unique cards, first player is the seat after the dealer, play starts clockwise (R3-R9)', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const n = 2 + (seed % 5);
      const ids = ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, n);
      const g = createGame(ids, DEFAULT_RULES, seededRng(seed));
      for (const p of g.players) expect(g.hands[p]).toHaveLength(7);
      expect(g.direction).toBe(1);
      expect(g.turn).toBe((g.dealer + 1) % n);
      expect(g.discard).toHaveLength(1);
      assertConserved(g);
    }
    expect(() => createGame(['A'], DEFAULT_RULES, seededRng(1))).toThrow();
    expect(() => createGame(['A', 'B', 'C', 'D', 'E', 'F', 'G'], DEFAULT_RULES, seededRng(1))).toThrow();
    const dealt = createGame(['A', 'B', 'C'], DEFAULT_RULES, seededRng(3), { dealer: 2 });
    expect(dealt.dealer).toBe(2);
    expect(dealt.turn).toBe(0);
  });

  it('Example 60: the unrestricted opening card can be anything, including a King, Queen or 8 (nothing is buried) (R7, R113)', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 400; seed++) seen.add(createGame(['A', 'B'], DEFAULT_RULES, seededRng(seed)).discard[0].rank);
    for (const r of ['K', 'Q', '8', '2', 'A', 'J', '7']) expect(seen.has(r)).toBe(true);
    // sanity: shuffle() is a permutation
    expect(new Set(shuffle(buildDeck(), seededRng(1)).map((c) => c.id)).size).toBe(52);
  });
});
