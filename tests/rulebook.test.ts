// Every "Example N" here is mirrored in docs/RULEBOOK.md (same numbers).
import { describe, expect, it } from 'vitest';
import { buildDeck, cardFromId, createGame, shuffle, withRules, DEFAULT_RULES } from '../shared/engine';
import { getLegalCardIds, toPlayerView } from '../shared/engine';
import { act, assertConserved, eventTypes, handIds, ok, play, scenario, seededRng, topId, turnId } from './helpers';

// Filler cards that are inert and legal-neutral (3s, 4s, 5s, 6s, 9s...). Keep hands >= 3 cards so nobody wins/owes JAKK by accident.
const FILL = ['3C', '4C', '6D'];

describe('Basic play', () => {
  it('Example 1: match the active suit', () => {
    const s = scenario({ hands: { A: ['9H', ...FILL], B: ['4D', '5D', '6S'], C: ['4S', '5S', '6C'] }, top: '5H', turn: 'A' });
    const r = ok(play(s, 'A', ['9H']));
    expect(topId(r.state)).toBe('9H');
    expect(r.state.activeSuit).toBe('H');
    expect(turnId(r.state)).toBe('B');
    expect(r.state.version).toBe(1);
    expect(eventTypes(r.events)).toEqual(['played', 'turn']);
  });

  it('Example 2: match the rank of the top discard (active suit changes)', () => {
    const s = scenario({ hands: { A: ['5S', ...FILL], B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A' });
    const r = ok(play(s, 'A', ['5S']));
    expect(r.state.activeSuit).toBe('S');
    expect(turnId(r.state)).toBe('B');
  });

  it('Example 3: an illegal card is rejected with a toast-ready reason', () => {
    const s = scenario({ hands: { A: ['9S', ...FILL], B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A' });
    const r = play(s, 'A', ['9S']);
    expect(r).toMatchObject({ ok: false, code: 'ILLEGAL_CARD', reason: 'Must match ♥ or a 5' });
    expect(act(s, { type: 'play', playerId: 'A', cardIds: ['8H'] })).toMatchObject({ ok: false, code: 'CARD_NOT_IN_HAND' });
  });

  it('Example 4: several same-rank cards; chosen order kept, last ends on top and sets the suit', () => {
    const s = scenario({ hands: { A: ['9H', '9S', '9D', ...FILL], B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A' });
    const r = ok(play(s, 'A', ['9H', '9S']));
    expect(topId(r.state)).toBe('9S');
    expect(r.state.activeSuit).toBe('S');
    expect(r.state.discard.slice(-3).map((c) => c.id)).toEqual(['5H', '9H', '9S']);
    expect(handIds(r.state, 'A').sort()).toEqual(['3C', '4C', '6D', '9D'].sort());
    expect(r.events[0]).toMatchObject({ type: 'played', cards: [{ id: '9H' }, { id: '9S' }] });
  });

  it('Example 5: the FIRST chosen card must be legal on its own', () => {
    const s = scenario({ hands: { A: ['9S', '9H', ...FILL], B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A' });
    expect(play(s, 'A', ['9S', '9H'])).toMatchObject({ ok: false, reason: 'Must match ♥ or a 5' });
    expect(ok(play(s, 'A', ['9H', '9S'])).state.activeSuit).toBe('S');
  });

  it('Example 6: mixed ranks are rejected', () => {
    const s = scenario({ hands: { A: ['9H', '4H', ...FILL], B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A' });
    expect(play(s, 'A', ['9H', '4H'])).toMatchObject({ ok: false, code: 'MIXED_RANKS', reason: 'Cards must be the same rank' });
  });
});

describe('Twos', () => {
  const base = () =>
    scenario({
      hands: { A: ['2H', ...FILL], B: ['2S', '2D', '9C', '4S'], C: ['4D', '5D', '6S', '8C'] },
      top: '5H',
      turn: 'A',
    });

  it('Example 7: a 2 makes the next player draw 2 (pending penalty)', () => {
    const r = ok(play(base(), 'A', ['2H']));
    expect(r.state.penalty).toEqual({ kind: 'two', amount: 2 });
    expect(turnId(r.state)).toBe('B');
    expect(r.events).toContainEqual({ type: 'penaltyAdded', playerId: 'A', kind: 'two', added: 2, total: 2 });
  });

  it('Example 8: the victim may answer with a 2; the total passes on', () => {
    const s1 = ok(play(base(), 'A', ['2H'])).state;
    const r = ok(play(s1, 'B', ['2S']));
    expect(r.state.penalty).toEqual({ kind: 'two', amount: 4 });
    expect(turnId(r.state)).toBe('C');
    expect(r.state.activeSuit).toBe('S');
  });

  it('Example 9: several 2s in one play add up', () => {
    const s1 = ok(play(base(), 'A', ['2H'])).state;
    const r = ok(play(s1, 'B', ['2S', '2D']));
    expect(r.state.penalty).toEqual({ kind: 'two', amount: 6 });
    expect(turnId(r.state)).toBe('C');
  });

  it('Example 10: only 2s answer a 2-penalty; drawing a single card is not allowed either', () => {
    const s1 = ok(play(base(), 'A', ['2H'])).state;
    expect(play(s1, 'B', ['9C'])).toMatchObject({ ok: false, code: 'MUST_ANSWER_PENALTY', reason: 'Play a 2 or pick up 2' });
    expect(act(s1, { type: 'draw', playerId: 'B' })).toMatchObject({ ok: false, code: 'PENALTY_PENDING', reason: 'Play a 2 or pick up 2' });
    const s2 = ok(play(s1, 'B', ['2S'])).state;
    expect(play(s2, 'C', ['8C'])).toMatchObject({ ok: false, reason: 'Play a 2 or pick up 4' });
  });

  it('Example 11: taking the penalty draws the full amount, clears it and passes the turn', () => {
    let s = ok(play(base(), 'A', ['2H'])).state;
    s = ok(play(s, 'B', ['2S'])).state; // 4 pending, C to move
    const before = s.hands.C.length;
    const r = ok(act(s, { type: 'takePenalty', playerId: 'C' }));
    expect(r.state.hands.C.length).toBe(before + 4);
    expect(r.state.penalty).toBeNull();
    expect(turnId(r.state)).toBe('A');
    expect(topId(r.state)).toBe('2S');
    expect(eventTypes(r.events)).toEqual(['penaltyTaken', 'drew', 'turn']);
    assertConserved(r.state);
  });
});

describe('Jacks', () => {
  const base = () =>
    scenario({
      hands: { A: ['JS', 'JC', ...FILL], B: ['JH', 'JD', '9S', '2S'], C: ['4D', '5D', '6S', '8C'] },
      top: '5S',
      turn: 'A',
    });

  it('Example 12: a black Jack makes the next player draw 5; black Jacks stack', () => {
    const s1 = ok(play(base(), 'A', ['JS'])).state;
    expect(s1.penalty).toEqual({ kind: 'jack', amount: 5 });
    // another black Jack from a different hand
    const s = scenario({ hands: { A: ['JS', ...FILL], B: ['JC', '9S', '2S'], C: ['4D', '5D', '6S'] }, top: '5S', turn: 'A' });
    const a = ok(play(s, 'A', ['JS'])).state;
    const b = ok(play(a, 'B', ['JC']));
    expect(b.state.penalty).toEqual({ kind: 'jack', amount: 10 });
    expect(turnId(b.state)).toBe('C');
  });

  it('Example 13: a red Jack on an active Jack penalty cancels it entirely; play continues normally', () => {
    const s1 = ok(play(base(), 'A', ['JS'])).state;
    const r = ok(play(s1, 'B', ['JH']));
    expect(r.state.penalty).toBeNull();
    expect(turnId(r.state)).toBe('C');
    expect(r.state.activeSuit).toBe('H');
    expect(r.events).toContainEqual({ type: 'penaltyCancelled', playerId: 'B', kind: 'jack', amount: 5 });
    expect(r.state.hands.C.length).toBe(4); // C drew nothing
  });

  it('Example 14: with no penalty active a red Jack is an ordinary card', () => {
    const s = scenario({ hands: { A: ['JH', ...FILL], B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A' });
    const r = ok(play(s, 'A', ['JH']));
    expect(r.state.penalty).toBeNull();
    expect(turnId(r.state)).toBe('B');
  });

  it('Example 15: only Jacks answer a Jack penalty', () => {
    const s1 = ok(play(base(), 'A', ['JS'])).state;
    expect(play(s1, 'B', ['2S'])).toMatchObject({ ok: false, reason: 'Play a Jack or pick up 5' });
    expect(play(s1, 'B', ['9S'])).toMatchObject({ ok: false, code: 'MUST_ANSWER_PENALTY' });
  });
});

describe('Eights (skip), Kings (reverse) and Sevens (ordinary)', () => {
  const three = (hand: string[]) =>
    scenario({ hands: { A: hand, B: ['4D', '5D', '6S'], C: ['4S', '5S', '6C'] }, top: '5H', turn: 'A' });
  const four = (hand: string[]) =>
    scenario({
      hands: { A: hand, B: ['4D', '5D', '6S'], C: ['4S', '5S', '6C'], D: ['4H', '5C', '9S'] },
      top: '5H',
      turn: 'A',
    });
  const two = (hand: string[]) => scenario({ hands: { A: hand, B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A' });
  const skippedWho = (events: ReturnType<typeof play> extends infer R ? (R extends { events: infer E } ? E : never) : never) =>
    (events as Array<{ type: string; who?: string }>).filter((e) => e.type === 'skipped').map((e) => e.who);

  it('Example 16: an 8 skips the next player (3 players); direction is unchanged', () => {
    const r = ok(play(three(['8H', ...FILL]), 'A', ['8H']));
    expect(turnId(r.state)).toBe('C');
    expect(r.state.direction).toBe(1);
    expect(r.events).toContainEqual({ type: 'skipped', playerId: 'A', who: 'B' });
    expect(eventTypes(r.events)).toEqual(['played', 'skipped', 'turn']);
  });

  it('Example 17: an 8 skips the next player (4 players); play carries on the same way', () => {
    const r = ok(play(four(['8H', ...FILL]), 'A', ['8H']));
    expect(turnId(r.state)).toBe('C');
    expect(r.state.direction).toBe(1);
    expect(skippedWho(r.events)).toEqual(['B']);
    expect(turnId(ok(act(r.state, { type: 'draw', playerId: 'C' })).state)).toBe('D');
  });

  it('Example 17b: an 8 skips in the current direction when play is reversed (4 players)', () => {
    const s = { ...four(['8H', ...FILL]), direction: -1 as const };
    const r = ok(play(s, 'A', ['8H']));
    expect(skippedWho(r.events)).toEqual(['D']);
    expect(turnId(r.state)).toBe('C');
  });

  it('Example 18: with 2 players an 8 returns the turn to the player; if they cannot play they must draw', () => {
    const r = ok(play(two(['8H', '9C', '4C', '3C']), 'A', ['8H']));
    expect(turnId(r.state)).toBe('A');
    expect(r.state.direction).toBe(1);
    expect(r.events).toContainEqual({ type: 'skipped', playerId: 'A', who: 'B' });
    // 9C/4C/3C do not match 8H / hearts: A must draw
    expect(play(r.state, 'A', ['9C'])).toMatchObject({ ok: false, reason: 'Must match ♥ or an 8' });
    const d = ok(act(r.state, { type: 'draw', playerId: 'A' }));
    expect(turnId(d.state)).toBe('B');
  });

  it('Example 19: n eights skip n players (two 8s with 4 players skip B and C)', () => {
    const r = ok(play(four(['8H', '8S', ...FILL]), 'A', ['8H', '8S']));
    expect(turnId(r.state)).toBe('D');
    expect(skippedWho(r.events)).toEqual(['B', 'C']);
    expect(r.state.direction).toBe(1);
  });

  it('Example 20: two 8s with 3 players skip both opponents and the player goes again; with 2 players too (once)', () => {
    const r3 = ok(play(three(['8H', '8S', ...FILL]), 'A', ['8H', '8S']));
    expect(skippedWho(r3.events)).toEqual(['B', 'C']);
    expect(turnId(r3.state)).toBe('A');
    const r2 = ok(play(two(['8H', '8S', '9C', '4C']), 'A', ['8H', '8S']));
    expect(turnId(r2.state)).toBe('A');
    expect(r2.state.direction).toBe(1);
  });

  it('Example 21: a King reverses direction (3 players)', () => {
    const r = ok(play(three(['KH', ...FILL]), 'A', ['KH']));
    expect(r.state.direction).toBe(-1);
    expect(turnId(r.state)).toBe('C');
    expect(r.events).toContainEqual({ type: 'reversed', playerId: 'A', direction: -1 });
    expect(r.events.some((e) => e.type === 'skipped')).toBe(false);
  });

  it('Example 22: a King reverses direction (4 players); play then continues the other way', () => {
    const r = ok(play(four(['KH', ...FILL]), 'A', ['KH']));
    expect(r.state.direction).toBe(-1);
    expect(turnId(r.state)).toBe('D');
    const r2 = ok(play(r.state, 'D', ['4H']));
    expect(turnId(r2.state)).toBe('C');
  });

  it('Example 23: with 2 players a King returns the turn to the player (and flips the direction)', () => {
    const r = ok(play(two(['KH', '9H', '4C', '3C']), 'A', ['KH']));
    expect(turnId(r.state)).toBe('A');
    expect(r.state.direction).toBe(-1);
    expect(r.events.some((e) => e.type === 'skipped')).toBe(false);
    expect(play(r.state, 'A', ['9H']).ok).toBe(true);
  });

  it('Example 40: two Kings together reverse twice: net no change with 3-4 players', () => {
    for (const mk of [three, four]) {
      const r = ok(play(mk(['KH', 'KS', ...FILL]), 'A', ['KH', 'KS']));
      expect(r.state.direction).toBe(1);
      expect(turnId(r.state)).toBe('B');
      expect(r.events.filter((e) => e.type === 'reversed')).toHaveLength(2);
    }
  });

  it('Example 41: two Kings with 2 players: the player still goes again', () => {
    const r = ok(play(two(['KH', 'KS', '9C', '4C']), 'A', ['KH', 'KS']));
    expect(turnId(r.state)).toBe('A');
    expect(r.state.direction).toBe(1);
  });

  it('Example 42: a 7 is an ordinary card: no skip, no reverse (2, 3 and 4 players)', () => {
    for (const [mk, next] of [[two, 'B'], [three, 'B'], [four, 'B']] as const) {
      const r = ok(play(mk(['7H', ...FILL]), 'A', ['7H']));
      expect(turnId(r.state)).toBe(next);
      expect(r.state.direction).toBe(1);
      expect(eventTypes(r.events)).toEqual(['played', 'turn']);
    }
  });

  it('a King and an 8 together are not a same-rank play', () => {
    expect(play(three(['KH', '8H', ...FILL]), 'A', ['KH', '8H'])).toMatchObject({ ok: false, code: 'MIXED_RANKS' });
  });

  it('a reversal then a skip: the skip follows the new direction (8 after King on separate turns)', () => {
    const s1 = ok(play(four(['KH', ...FILL]), 'A', ['KH'])).state; // D to move, direction -1
    const s2 = scenario({ hands: { A: ['4C', '5C', '6D'], B: ['4D', '5D', '6S'], C: ['4S', '5S', '6C'], D: ['8H', '3H', '9S'] }, top: '5H', turn: 'D', direction: s1.direction });
    const r = ok(play(s2, 'D', ['8H']));
    expect(skippedWho(r.events)).toEqual(['C']);
    expect(turnId(r.state)).toBe('B');
  });
});

describe('Queens: anything can be put on a Queen', () => {
  const mk = (n: number, hand: string[], opts: { top?: string; suit?: 'S' | 'H' | 'D' | 'C'; penalty?: any } = {}) => {
    const hands: Record<string, string[]> = { A: hand, B: ['3D', '5D', '6H'], C: ['3S', '5S', '6C'], D: ['3H', '5C', '10C'] };
    const keep = Object.fromEntries(Object.entries(hands).slice(0, n));
    return scenario({ hands: keep, top: opts.top ?? 'QH', turn: 'A', suit: opts.suit, penalty: opts.penalty });
  };

  it('Example 43: with a Queen on top any card is accepted (2, 3 and 4 players)', () => {
    for (const n of [2, 3, 4]) {
      const r = ok(play(mk(n, ['9S', ...FILL]), 'A', ['9S'])); // off-suit, off-rank
      expect(topId(r.state)).toBe('9S');
      expect(r.state.activeSuit).toBe('S');
      expect(turnId(r.state)).toBe('B');
    }
  });

  it('Example 44: a Queen itself follows the normal rule (suit or rank, or on another Queen)', () => {
    const s = scenario({ hands: { A: ['QS', ...FILL], B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A' });
    expect(play(s, 'A', ['QS'])).toMatchObject({ ok: false, code: 'ILLEGAL_CARD', reason: 'Must match ♥ or a 5' });
    expect(play(scenario({ hands: { A: ['QS', ...FILL], B: ['4D', '5D', '6S'] }, top: 'QH', turn: 'A' }), 'A', ['QS']).ok).toBe(true);
    expect(play(scenario({ hands: { A: ['QH', ...FILL], B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A' }), 'A', ['QH']).ok).toBe(true);
  });

  it('Example 45: Queen + Queen together; and several same-rank cards on a Queen (the rest must still share a rank)', () => {
    const q2 = ok(play(scenario({ hands: { A: ['QH', 'QS', ...FILL], B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A' }), 'A', ['QH', 'QS']));
    expect(topId(q2.state)).toBe('QS');
    expect(q2.state.activeSuit).toBe('S');
    const pair = ok(play(mk(3, ['9S', '9D', ...FILL]), 'A', ['9S', '9D']));
    expect(topId(pair.state)).toBe('9D');
    expect(play(mk(3, ['9S', '4D', ...FILL]), 'A', ['9S', '4D'])).toMatchObject({ ok: false, code: 'MIXED_RANKS' });
  });

  it('Example 46: cards played on a Queen keep their own effect (2, black Jack, 8, King, Ace, 7)', () => {
    const two = ok(play(mk(3, ['2S', ...FILL]), 'A', ['2S']));
    expect(two.state.penalty).toEqual({ kind: 'two', amount: 2 });
    const jack = ok(play(mk(3, ['JC', ...FILL]), 'A', ['JC']));
    expect(jack.state.penalty).toEqual({ kind: 'jack', amount: 5 });
    const eight = ok(play(mk(3, ['8S', ...FILL]), 'A', ['8S']));
    expect(turnId(eight.state)).toBe('C');
    const king = ok(play(mk(3, ['KS', ...FILL]), 'A', ['KS']));
    expect(king.state.direction).toBe(-1);
    expect(turnId(king.state)).toBe('C');
    const ace = ok(play(mk(3, ['AS', ...FILL]), 'A', ['AS'], { suit: 'D' }));
    expect(ace.state.activeSuit).toBe('D');
    const seven = ok(play(mk(3, ['7S', ...FILL]), 'A', ['7S']));
    expect(turnId(seven.state)).toBe('B');
  });

  it('Example 47: a pending penalty still restricts the answer (a Queen cannot be on top of a penalty by play, so it is forced here)', () => {
    const s = mk(3, ['9S', '2D', ...FILL], { penalty: { kind: 'two', amount: 2 } });
    expect(play(s, 'A', ['9S'])).toMatchObject({ ok: false, code: 'MUST_ANSWER_PENALTY', reason: 'Play a 2 or pick up 2' });
    expect(play(s, 'A', ['2D']).ok).toBe(true);
  });

  it('Example 48: legality helpers agree: with a Queen on top every card is a legal start; with the toggle off none is', () => {
    const s = mk(3, ['9S', '4D', '7C', 'KS']);
    expect(getLegalCardIds(toPlayerView(s, 'A')).sort()).toEqual(['4D', '7C', '9S', 'KS']);
    const off = scenario({ hands: { A: ['9S', '4D'], B: ['5D', '6S', '3S'] }, top: 'QH', turn: 'A', rules: { queenAcceptsAny: false } });
    expect(getLegalCardIds(toPlayerView(off, 'A'))).toEqual([]);
    expect(play(off, 'A', ['9S'])).toMatchObject({ ok: false, code: 'ILLEGAL_CARD', reason: 'Must match ♥ or a Queen' });
  });

  it('active suit after a multi-card play is the LAST card, top is the last card, in played order (J♣ then J♦ and J♦ then J♣)', () => {
    for (const order of [['JC', 'JD'], ['JD', 'JC']]) {
      const s = scenario({ hands: { A: [...order, ...FILL], B: ['4D', '5D', '6S'] }, top: 'JH', turn: 'A' });
      const r = ok(play(s, 'A', order));
      expect(topId(r.state)).toBe(order[1]);
      expect(r.state.activeSuit).toBe(order[1][1]);
      expect((r.events[0] as any).cards.map((c: any) => c.id)).toEqual(order);
    }
  });
});

describe('Aces', () => {
  const base = () =>
    scenario({ hands: { A: ['AS', 'AD', ...FILL], B: ['4D', '5D', '6S', '2C'], C: ['4S', '5S', '6C'] }, top: '5H', turn: 'A' });

  it('Example 24: an Ace is wild and the player nominates the active suit', () => {
    const r = ok(play(base(), 'A', ['AS'], { suit: 'D' }));
    expect(r.state.activeSuit).toBe('D');
    expect(topId(r.state)).toBe('AS');
    expect(r.events).toContainEqual({ type: 'suitChosen', playerId: 'A', suit: 'D' });
    // several Aces: one nomination
    const m = ok(play(base(), 'A', ['AS', 'AD'], { suit: 'C' }));
    expect(m.state.activeSuit).toBe('C');
    expect(m.events.filter((e) => e.type === 'suitChosen')).toHaveLength(1);
  });

  it('Example 25: playing an Ace without a suit is rejected', () => {
    expect(play(base(), 'A', ['AS'])).toMatchObject({ ok: false, code: 'SUIT_REQUIRED', reason: 'Choose a suit for your Ace' });
  });

  it('Example 26: an Ace cannot answer a penalty', () => {
    const s = ok(play(scenario({ hands: { A: ['2H', ...FILL], B: ['AS', '9C', '4S'], C: ['4D', '5D', '6S'] }, top: '5H', turn: 'A' }), 'A', ['2H'])).state;
    expect(play(s, 'B', ['AS'], { suit: 'S' })).toMatchObject({ ok: false, reason: 'Play a 2 or pick up 2' });
  });
});

describe('Drawing and the deck', () => {
  it('Example 27: you may always draw 1 card instead of playing; the turn then ends', () => {
    const s = scenario({ hands: { A: ['9H', ...FILL], B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A', draw: ['KC'] });
    const r = ok(act(s, { type: 'draw', playerId: 'A' }));
    expect(handIds(r.state, 'A')).toContain('KC');
    expect(r.state.hands.A).toHaveLength(5);
    expect(turnId(r.state)).toBe('B');
    expect(r.events[0]).toMatchObject({ type: 'drew', playerId: 'A', count: 1, cards: [{ id: 'KC' }] });
  });

  it('Example 28: empty draw pile -> the discard (except its top) is reshuffled', () => {
    const s = scenario({
      hands: { A: ['9H', ...FILL], B: ['4D', '5D', '6S'] },
      top: '5H',
      turn: 'A',
      draw: [],
      rest: 'discard',
    });
    expect(s.drawPile).toHaveLength(0);
    const before = s.discard.length;
    const r = ok(act(s, { type: 'draw', playerId: 'A' }, seededRng(3)));
    expect(eventTypes(r.events).slice(0, 2)).toEqual(['reshuffled', 'drew']);
    expect(topId(r.state)).toBe('5H');
    expect(r.state.discard).toHaveLength(1);
    expect(r.state.drawPile).toHaveLength(before - 1 - 1);
    expect(r.state.hands.A).toHaveLength(5);
    assertConserved(r.state);
  });

  it('Example 29: if there are still not enough cards, draw as many as exist', () => {
    // 2 cards exist outside hands: the top discard (stays) and one draw card; A owes 4.
    const hands = { A: ['9H', '4C', '6D'], B: ['4D', '5D', '6S'] } as Record<string, string[]>;
    const used = new Set([...Object.values(hands).flat(), '5H', 'KC']);
    const everything = [...cardFromIds()].filter((id) => !used.has(id));
    hands.C = everything.slice(0, 20);
    hands.D = everything.slice(20);
    const s = scenario({ hands, top: '5H', turn: 'A', draw: ['KC'], rest: 'draw', penalty: { kind: 'two', amount: 4 } });
    const r = ok(act(s, { type: 'takePenalty', playerId: 'A' }));
    expect(r.state.hands.A).toHaveLength(4); // 3 + the one card that existed
    expect(r.state.penalty).toBeNull();
    assertConserved(r.state);
  });
});

function cardFromIds(): string[] {
  const out: string[] = [];
  for (const s of ['S', 'H', 'D', 'C']) for (const r of ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']) out.push(r + s);
  return out;
}

describe('JAKK', () => {
  const twoCards = () =>
    scenario({ hands: { A: ['9H', '9S', '3C'], B: ['4D', '5D', '6S', '7C'], C: ['4S', '5S', '6C', '8D'] }, top: '5H', turn: 'A' });

  it('Example 30: JAKK declared as part of the play action', () => {
    const r = ok(play(twoCards(), 'A', ['9H', '9S'], { declareJakk: true }));
    expect(r.state.hands.A).toHaveLength(1);
    expect(r.state.jakkOwed).toBeNull();
    expect(eventTypes(r.events)).toEqual(['played', 'jakkDeclared', 'turn']);
  });

  it('Example 31: JAKK declared late, before the next action, with a separate action', () => {
    const s1 = ok(play(twoCards(), 'A', ['9H', '9S'])).state;
    expect(s1.jakkOwed).toBe('A');
    const r = ok(act(s1, { type: 'declareJakk', playerId: 'A' }));
    expect(r.state.jakkOwed).toBeNull();
    expect(r.events).toEqual([{ type: 'jakkDeclared', playerId: 'A' }]);
    expect(r.state.version).toBe(s1.version + 1);
    expect(turnId(r.state)).toBe('B'); // declaring does not change whose turn it is
    // and B's next action has no side effect on A
    const b = ok(act(r.state, { type: 'draw', playerId: 'B' }));
    expect(b.state.hands.A).toHaveLength(1);
  });

  it('Example 32: another player acts before the declaration -> 2 penalty cards first, then their action resolves', () => {
    const s1 = ok(play(twoCards(), 'A', ['9H', '9S'])).state;
    const r = ok(act(s1, { type: 'draw', playerId: 'B' }));
    expect(eventTypes(r.events)).toEqual(['jakkMissed', 'drew', 'drew', 'turn']);
    expect(r.events[0]).toEqual({ type: 'jakkMissed', playerId: 'A' });
    expect(r.state.hands.A).toHaveLength(3);
    expect(r.state.hands.B).toHaveLength(5);
    expect(r.state.jakkOwed).toBeNull();
    // too late to declare now
    expect(act(r.state, { type: 'declareJakk', playerId: 'A' })).toMatchObject({ ok: false, code: 'JAKK_NOT_NEEDED' });
  });

  it('Example 33: 2 players, 8 leaves you on one card and you act again without declaring -> penalty before the action', () => {
    const s = scenario({ hands: { A: ['8H', '9H'], B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A' });
    const s1 = ok(play(s, 'A', ['8H'])).state;
    expect(turnId(s1)).toBe('A');
    expect(s1.jakkOwed).toBe('A');
    const r = ok(play(s1, 'A', ['9H']));
    expect(eventTypes(r.events)).toEqual(['jakkMissed', 'drew', 'played', 'turn']);
    expect(r.state.hands.A).toHaveLength(2); // 1 + 2 penalty - 1 played
    expect(r.state.winner).toBeNull();
  });

  it('Example 34: declaring when it is not required is a harmless rejected no-op', () => {
    const s = twoCards();
    const r = act(s, { type: 'declareJakk', playerId: 'B' });
    expect(r).toMatchObject({ ok: false, code: 'JAKK_NOT_NEEDED' });
    // no state change possible (state is returned only on success)
    expect(s.version).toBe(0);
  });

  it('a rejected action does not trigger the JAKK penalty', () => {
    const s1 = ok(play(twoCards(), 'A', ['9H', '9S'])).state;
    expect(play(s1, 'B', ['9C'])).toMatchObject({ ok: false });
    expect(act(s1, { type: 'draw', playerId: 'C' })).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(s1.jakkOwed).toBe('A');
  });
});

describe('Winning', () => {
  it('Example 35: first to empty their hand wins immediately; nothing more is accepted', () => {
    const s = scenario({ hands: { A: ['9H'], B: ['4D', '5D', '6S'], C: ['4S', '5S', '6C'] }, top: '5H', turn: 'A' });
    const r = ok(play(s, 'A', ['9H']));
    expect(r.state.winner).toBe('A');
    expect(r.events.at(-1)).toEqual({ type: 'won', playerId: 'A' });
    expect(act(r.state, { type: 'draw', playerId: 'B' })).toMatchObject({ ok: false, code: 'GAME_OVER' });
    expect(r.state.jakkOwed).toBeNull();
  });

  it('Example 36: finishing on a power card (even a penalty card) wins', () => {
    const s = scenario({ hands: { A: ['2H'], B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A' });
    expect(ok(play(s, 'A', ['2H'])).state.winner).toBe('A');
    const ace = scenario({ hands: { A: ['AS'], B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A' });
    expect(ok(play(ace, 'A', ['AS'], { suit: 'H' })).state.winner).toBe('A');
  });

  it('Example 37: canFinishOnPower = false rejects a power finishing card', () => {
    const s = scenario({ hands: { A: ['2H'], B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A', rules: { canFinishOnPower: false } });
    expect(play(s, 'A', ['2H'])).toMatchObject({ ok: false, code: 'CANNOT_FINISH_ON_POWER' });
  });
});

describe('Turn order, stale and duplicate actions', () => {
  it('Example 38: wrong turn is rejected; an identical resubmit after it was applied is rejected, not double-applied', () => {
    const s = scenario({ hands: { A: ['9H', ...FILL], B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A' });
    expect(play(s, 'B', ['4D'])).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN', reason: 'Not your turn' });
    const r = ok(play(s, 'A', ['9H']));
    expect(play(r.state, 'A', ['9H'])).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(r.state.hands.A).toHaveLength(3);
  });

  it('Example 39: the start card is never a power card (2, 8, Jack, Queen, King, Ace) and all 52 cards are dealt/conserved', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const g = createGame(['A', 'B', 'C', 'D'].slice(0, 2 + (seed % 3)), DEFAULT_RULES, seededRng(seed));
      expect(['2', '8', 'J', 'Q', 'K', 'A']).not.toContain(g.discard[0].rank);
      expect(g.activeSuit).toBe(g.discard[0].suit);
      for (const p of g.players) expect(g.hands[p]).toHaveLength(7);
      assertConserved(g);
    }
  });

  it('Example 39b: a King, Queen or 8 flipped as the start card is buried at the bottom; a 7 is accepted as the start card', () => {
    // Re-create the first flip of createGame (same shuffle, 7 cards each) to find seeds that flip each rank.
    const firstFlip = (seed: number, players: number) => {
      const deck = shuffle(buildDeck(), seededRng(seed));
      deck.length -= 7 * players;
      return deck[deck.length - 1];
    };
    const seen: Record<string, number> = { K: 0, Q: 0, '8': 0, '7': 0 };
    for (let seed = 1; seed <= 600; seed++) {
      const players = 2 + (seed % 3);
      const flip = firstFlip(seed, players);
      if (!(flip.rank in seen)) continue;
      seen[flip.rank]++;
      const g = createGame(['A', 'B', 'C', 'D'].slice(0, players), DEFAULT_RULES, seededRng(seed));
      if (flip.rank === '7') {
        expect(g.discard[0].id).toBe(flip.id);
        expect(g.activeSuit).toBe(flip.suit);
      } else {
        expect(g.discard[0].id).not.toBe(flip.id);
        expect(['K', 'Q', '8']).not.toContain(g.discard[0].rank);
        expect(g.drawPile.slice(0, 15).map((c) => c.id)).toContain(flip.id); // buried at the bottom (with any other power cards flipped in a row)
      }
      assertConserved(g);
    }
    expect(seen.K).toBeGreaterThan(5);
    expect(seen.Q).toBeGreaterThan(5);
    expect(seen['8']).toBeGreaterThan(5);
    expect(seen['7']).toBeGreaterThan(5);
  });

  it('the input state is never mutated', () => {
    const s = scenario({ hands: { A: ['9H', ...FILL], B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A' });
    const snap = JSON.stringify(s);
    ok(play(s, 'A', ['9H']));
    act(s, { type: 'draw', playerId: 'A' });
    expect(JSON.stringify(s)).toBe(snap);
  });

  it('rules are configurable (skipRank / reverseRank can be switched off or moved)', () => {
    const hands = { A: ['8H', 'KH', '7H', ...FILL], B: ['4D', '5D', '6S'], C: ['4S', '5S', '6C'] };
    const off = scenario({ hands, top: '5H', turn: 'A', rules: withRules({ skipRank: null, reverseRank: null }) });
    expect(turnId(ok(play(off, 'A', ['8H'])).state)).toBe('B');
    const k = ok(play(off, 'A', ['KH']));
    expect(turnId(k.state)).toBe('B');
    expect(k.state.direction).toBe(1);
    const moved = scenario({ hands, top: '5H', turn: 'A', rules: withRules({ skipRank: '7' }) });
    expect(turnId(ok(play(moved, 'A', ['7H'])).state)).toBe('C');
    expect(turnId(ok(play(moved, 'A', ['8H'])).state)).toBe('B');
  });

  it('defaults: 8 skips, King reverses, power ranks are 2, 8, J, Q, K, A', () => {
    expect(DEFAULT_RULES.skipRank).toBe('8');
    expect(DEFAULT_RULES.reverseRank).toBe('K');
    expect([...DEFAULT_RULES.powerRanks].sort()).toEqual(['2', '8', 'A', 'J', 'K', 'Q']);
  });
});
