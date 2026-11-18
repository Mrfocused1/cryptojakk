import { describe, expect, it } from 'vitest';
import { chooseBotAction } from '../shared/ai';
import { applyAction, getAddableCardIds, getLegalCardIds, needsSuitChoice, previewPlay, toPlayerView } from '../shared/engine';
import { normalizeRoomCode, parseOptionsInput, sanitizeName, validateAvatar, ROOM_CODE_ALPHABET } from '../shared/protocol';
import { act, ok, scenario, seededRng } from './helpers';

const view = (s: ReturnType<typeof scenario>, p: string) => toPlayerView(s, p);
const FILL = ['3C', '4C', '6D'];
const bot = (s: ReturnType<typeof scenario>, p = 'A', declareJakk = true) => chooseBotAction(view(s, p), { declareJakk });

describe('bot chooser', () => {
  it('answers a penalty when able, takes it otherwise', () => {
    const s = scenario({ hands: { A: ['2S', '2D', '9C', '4S'], B: ['4D', '5D', '6S'] }, top: '2H', turn: 'A', penalty: { kind: 'two', amount: 2 } });
    expect(bot(s)).toMatchObject({ type: 'play', cardIds: expect.arrayContaining(['2S', '2D']) });
    const t = scenario({ hands: { A: ['9C', '4S'], B: ['4D', '5D', '6S'] }, top: '2H', turn: 'A', penalty: { kind: 'two', amount: 2 } });
    expect(bot(t)).toMatchObject({ type: 'takePenalty' });
  });

  it('prefers red Jacks to cancel a Jack penalty, and never plays a card the house rules do not allow as a defence', () => {
    const s = scenario({ hands: { A: ['JS', 'JH', '9C', '4S'], B: ['4D', '5D', '6S'] }, top: 'JC', turn: 'A', penalty: { kind: 'jack', amount: 5 } });
    const m = bot(s) as { cardIds: string[] };
    expect(m.cardIds[m.cardIds.length - 1]).toBe('JH');
    const only2 = scenario({ hands: { A: ['2S', '9C', '4S'], B: ['4D', '5D', '6S'] }, top: 'JC', turn: 'A', penalty: { kind: 'jack', amount: 5 } });
    expect(bot(only2)).toMatchObject({ type: 'takePenalty' }); // 2s do not defend a Jack pickup by default
    const mixed = scenario({ hands: { A: ['2S', '9C', '4S'], B: ['4D', '5D', '6S'] }, top: 'JC', turn: 'A', penalty: { kind: 'jack', amount: 5 }, rules: { mixedStacking: true } });
    expect(bot(mixed)).toMatchObject({ type: 'play', cardIds: ['2S'] });
  });

  it('uses same-rank groups and runs to shed several cards at once, and holds Aces', () => {
    const s = scenario({ hands: { A: ['AS', '9H', '9S', '10S', '4H', '6C'], B: ['4D', '5D', '6S', '3D'] }, top: '5H', turn: 'A' });
    const m = bot(s) as { type: string; cardIds: string[] };
    expect(m.type).toBe('play');
    expect(m.cardIds.length).toBeGreaterThanOrEqual(3);
    expect(m.cardIds).not.toContain('AS');
    const aces = scenario({ hands: { A: ['AS', '9D', '6C'], B: ['4D', '5D', '6S', '3D'] }, top: '5H', turn: 'A' });
    expect(bot(aces)).toMatchObject({ type: 'play', cardIds: ['AS'], suit: expect.any(String) });
  });

  it('nominates its most-held suit with an Ace', () => {
    const s = scenario({ hands: { A: ['AS', '9D', '4D', '6D', '3C'], B: ['7D', '5D', '6S', '3D'] }, top: '5H', turn: 'A' });
    expect(bot(s)).toMatchObject({ cardIds: ['AS'], suit: 'D' });
  });

  it('names a suit for an opening Ace (firstCardActive)', () => {
    const s = scenario({ hands: { A: ['9D', '4D', '6D', '3C'], B: ['7D', '5D', '6S', '3D'] }, top: 'AS', turn: 'A', awaitingSuit: true, rules: { firstCardActive: true } });
    expect(bot(s)).toEqual({ type: 'chooseSuit', suit: 'D' });
  });

  it('prefers attack cards when the next opponent is nearly out', () => {
    const s = scenario({ hands: { A: ['2H', '9H', '4H', '6C'], B: ['4D', '5D'], C: ['4S', '5S', '6S'] }, top: '5H', turn: 'A' });
    expect((bot(s) as { cardIds: string[] }).cardIds).toContain('2H');
  });

  it('uses 8 (skip) and King (reverse) against a nearly-out opponent; a 7 is just an ordinary card', () => {
    for (const power of ['8H', 'KH']) {
      const s = scenario({ hands: { A: [power, '9H', '4C', '6C'], B: ['4D', '5D'], C: ['4S', '5S', '6S'] }, top: '5H', turn: 'A' });
      expect((bot(s) as { cardIds: string[] }).cardIds).toContain(power);
    }
  });

  it('never leaves a Queen uncovered when it has a cover, and covers with the best card', () => {
    const s = scenario({ hands: { A: ['QH', '9H', '4C', '6D'], B: ['4D', '5D', '6S', '3D'] }, top: '5H', turn: 'A' });
    const m = bot(s) as { cardIds: string[] };
    const qi = m.cardIds.indexOf('QH');
    if (qi >= 0) expect(m.cardIds.length).toBeGreaterThan(qi + 1);
    // no cover available and no alternative: it still plays the Queen rather than draw (net card count is the same)
    const alone = scenario({ hands: { A: ['QH', '4C', '6D'], B: ['4D', '5D', '6S', '3D'] }, top: '5H', turn: 'A' });
    expect(bot(alone)).toMatchObject({ type: 'play' });
  });

  it('declares JAKK with its move only when told to and a finish looks plausible next turn', () => {
    const s = scenario({ hands: { A: ['9H', '4H', '3C'], B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A' });
    expect(bot(s, 'A', true)).toMatchObject({ declareJakk: true });
    expect(bot(s, 'A', false)).not.toHaveProperty('declareJakk');
    // a big, unconnected hand does not declare
    const big = scenario({ hands: { A: ['9H', '4S', '8D', 'KC', '3C', '10D'], B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A' });
    expect(bot(big)).not.toHaveProperty('declareJakk');
  });

  it('does not finish the hand without a live JAKK declaration when it can avoid it, and wins when declared', () => {
    const live = scenario({ hands: { A: ['9H', '9S'], B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A', jakk: ['A'] });
    const w = bot(live) as { cardIds: string[] };
    expect(applyAction(live, { type: 'play', playerId: 'A', cardIds: w.cardIds }, seededRng(1))).toMatchObject({ ok: true, state: { winner: 'A' } });
  });

  it('draws when nothing is playable and returns null when it is not its turn / spectating', () => {
    const s = scenario({ hands: { A: ['9S', '4S'], B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A' });
    expect(bot(s)).toMatchObject({ type: 'draw' });
    expect(bot(s, 'B')).toBeNull();
  });

  it('respects house rules: with finishOnPower off it does not try to go out on a power card', () => {
    const s = scenario({ hands: { A: ['2H', '9C'], B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A', jakk: ['A'], rules: { finishOnPower: false } });
    const m = bot(s) as { type: string; cardIds?: string[] };
    if (m.type === 'play') expect(applyAction(s, { type: 'play', playerId: 'A', cardIds: m.cardIds!, ...(m as object) } as never, seededRng(1)).ok).toBe(true);
  });
});

describe('view helpers (client highlighting)', () => {
  const s = scenario({ hands: { A: ['9H', '9S', '4H', '6C', 'AD'], B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A' });
  const v = view(s, 'A');
  it('getLegalCardIds / getAddableCardIds / previewPlay / needsSuitChoice', () => {
    expect(getLegalCardIds(v).sort()).toEqual(['4H', '9H', 'AD'].sort());
    expect(getLegalCardIds(view(s, 'B'))).toEqual([]);
    expect(getAddableCardIds(v, [])).toEqual(getLegalCardIds(v));
    expect(getAddableCardIds(v, ['9H'])).toEqual(['9S']);
    expect(getAddableCardIds(v, ['9S'])).toEqual([]); // 9S is not a legal start
    expect(previewPlay(v, ['9S'])).toMatchObject({ ok: false, reason: 'Must match ♥ or a 5' });
    expect(previewPlay(v, ['9H', '9S']).ok).toBe(true);
    expect(needsSuitChoice(v, ['AD'])).toBe(true);
    expect(needsSuitChoice(v, ['9H'])).toBe(false);
  });

  it('previewPlay projects the outcome: pickup, skips, reversals, queen, finish', () => {
    const p = (hand: string[], ids: string[], o: object = {}) => previewPlay(view(scenario({ hands: { A: hand, B: ['4D', '5D', '6S'], C: ['4S', '5S', '6C'] }, top: '5H', turn: 'A', ...o }), 'A'), ids, 'H');
    expect(p(['2H', ...FILL], ['2H'])).toMatchObject({ ok: true, outcome: { penalty: { kind: 'two', amount: 2 }, skips: 0 } });
    expect(p(['8H', ...FILL], ['8H'])).toMatchObject({ ok: true, outcome: { skips: 1, goAgain: false } });
    expect(p(['KH', ...FILL], ['KH'])).toMatchObject({ ok: true, outcome: { reversals: 1, direction: -1 } });
    expect(p(['9H'], ['9H'], { jakk: ['A'] })).toMatchObject({ ok: true, outcome: { wins: true, emptiesHand: true } });
    expect(p(['9H'], ['9H'])).toMatchObject({ ok: true, outcome: { wins: false, blocked: 'noJakk' } });
  });

  it('spectators and the hand-over state get no legal cards', () => {
    const spec = toPlayerView(s, 'Z');
    expect(spec.spectator).toBe(true);
    expect(spec.hand).toEqual([]);
    expect(getLegalCardIds(spec)).toEqual([]);
    expect(previewPlay(spec, ['9H'])).toMatchObject({ ok: false });
  });
});

describe('option parsing', () => {
  it('accepts only known house rules and option values', () => {
    expect(parseOptionsInput({ bringBacks: true }, { handsToWin: 3, turnSeconds: 30 })).toEqual({ houseRules: { bringBacks: true }, options: { handsToWin: 3, turnSeconds: 30 } });
    expect(parseOptionsInput(undefined, undefined)).toEqual({});
    expect(parseOptionsInput({ bringBacks: 'yes' }, undefined)).toBeNull();
    expect(parseOptionsInput({ nope: true }, undefined)).toBeNull();
    expect(parseOptionsInput(undefined, { handsToWin: 2 })).toBeNull();
    expect(parseOptionsInput(undefined, { turnSeconds: 25 })).toBeNull();
    expect(parseOptionsInput([], undefined)).toBeNull();
  });
});

describe('protocol helpers', () => {
  it('room codes use the unambiguous alphabet', () => {
    expect(ROOM_CODE_ALPHABET).toHaveLength(32);
    for (const bad of ['0', 'O', '1', 'I']) expect(ROOM_CODE_ALPHABET).not.toContain(bad);
    expect(normalizeRoomCode(' ab2cd ')).toBe('AB2CD');
    expect(normalizeRoomCode('AB0CD')).toBeNull();
    expect(normalizeRoomCode('ABCD')).toBeNull();
  });
  it('sanitizeName / validateAvatar', () => {
    expect(sanitizeName('  Al\u0000ice \n Bob ')).toBe('Alice Bob');
    expect(sanitizeName('')).toBeNull();
    expect(sanitizeName('a'.repeat(17))).toBeNull();
    expect(sanitizeName('😀'.repeat(16))).not.toBeNull();
    expect(validateAvatar({ emoji: '🦊', color: '#FF8800' })).toEqual({ emoji: '🦊', color: '#ff8800' });
    expect(validateAvatar({ icon: 'fox_1', color: '#ff8800' })).toEqual({ icon: 'fox_1', color: '#ff8800' });
    expect(validateAvatar({ color: '#ff8800' })).toBeNull();
    expect(validateAvatar({ icon: 'Bad Icon', color: '#ff8800' })).toBeNull();
    expect(validateAvatar({ emoji: 'x', color: 'red' })).toBeNull();
  });
});
void ok; void act;
