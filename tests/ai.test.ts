import { describe, expect, it } from 'vitest';
import { chooseBotAction } from '../shared/ai';
import { applyAction, getAddableCardIds, getLegalCardIds, needsSuitChoice, previewPlay, toPlayerView } from '../shared/engine';
import { normalizeRoomCode, sanitizeName, validateAvatar, ROOM_CODE_ALPHABET } from '../shared/protocol';
import { act, ok, scenario, seededRng } from './helpers';

const view = (s: ReturnType<typeof scenario>, p: string) => toPlayerView(s, p);
const FILL = ['3C', '4C', '6D'];

describe('bot chooser', () => {
  it('answers a penalty when able, takes it otherwise', () => {
    const s = scenario({ hands: { A: ['2S', '2D', '9C', '4S'], B: ['4D', '5D', '6S'] }, top: '2H', turn: 'A', penalty: { kind: 'two', amount: 2 } });
    expect(chooseBotAction(view(s, 'A'), { declareJakk: true })).toMatchObject({ type: 'play', cardIds: expect.arrayContaining(['2S', '2D']) });
    const t = scenario({ hands: { A: ['9C', '4S'], B: ['4D', '5D', '6S'] }, top: '2H', turn: 'A', penalty: { kind: 'two', amount: 2 } });
    expect(chooseBotAction(view(t, 'A'), { declareJakk: true })).toEqual({ type: 'takePenalty' });
  });

  it('prefers red Jacks to cancel a Jack penalty', () => {
    const s = scenario({ hands: { A: ['JS', 'JH', '9C', '4S'], B: ['4D', '5D', '6S'] }, top: 'JC', turn: 'A', penalty: { kind: 'jack', amount: 5 } });
    expect(chooseBotAction(view(s, 'A'), { declareJakk: true })).toMatchObject({ type: 'play', cardIds: ['JH'] });
  });

  it('prefers the largest same-rank set and holds Aces', () => {
    const s = scenario({ hands: { A: ['AS', '9H', '9S', '4H', '6C'], B: ['4D', '5D', '6S', '3D'] }, top: '5H', turn: 'A' });
    const m = chooseBotAction(view(s, 'A'), { declareJakk: true })!;
    expect(m).toMatchObject({ type: 'play' });
    expect((m as any).cardIds.sort()).toEqual(['9H', '9S']);
    const aces = scenario({ hands: { A: ['AS', '9D', '6C'], B: ['4D', '5D', '6S', '3D'] }, top: '5H', turn: 'A' });
    expect(chooseBotAction(view(aces, 'A'), { declareJakk: true })).toMatchObject({ type: 'play', cardIds: ['AS'], suit: expect.any(String) });
  });

  it('nominates its most-held suit with an Ace', () => {
    const s = scenario({ hands: { A: ['AS', '9D', '4D', '6D', '3C'], B: ['7D', '5D', '6S', '3D'] }, top: '5H', turn: 'A' });
    // the 9D/4D/6D cannot be played (hearts/5) so only the Ace is legal
    expect(chooseBotAction(view(s, 'A'), { declareJakk: true })).toMatchObject({ cardIds: ['AS'], suit: 'D' });
  });

  it('prefers attack cards when the next opponent is nearly out', () => {
    const s = scenario({ hands: { A: ['2H', '9H', '4H', '6C'], B: ['4D', '5D'], C: ['4S', '5S', '6S'] }, top: '5H', turn: 'A' });
    expect(chooseBotAction(view(s, 'A'), { declareJakk: true })).toMatchObject({ cardIds: ['2H'] });
  });

  it('declares JAKK in the action only when told to and left with one card', () => {
    const s = scenario({ hands: { A: ['9H', '4H'], B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A' });
    expect(chooseBotAction(view(s, 'A'), { declareJakk: true })).toMatchObject({ declareJakk: true });
    expect(chooseBotAction(view(s, 'A'), { declareJakk: false })).toMatchObject({ declareJakk: false });
  });

  it('draws when nothing is playable and returns null when it is not its turn', () => {
    const s = scenario({ hands: { A: ['9S', '4S'], B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A' });
    expect(chooseBotAction(view(s, 'A'), { declareJakk: true })).toEqual({ type: 'draw' });
    expect(chooseBotAction(view(s, 'B'), { declareJakk: true })).toBeNull();
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
});

describe('playAfterDraw toggle', () => {
  it('lets the player play only the drawn card, or pass', () => {
    const s = scenario({ hands: { A: ['9S', '4S', '6C'], B: ['4D', '5D', '6S'] }, top: '5H', turn: 'A', draw: ['KH'], rules: { playAfterDraw: true } });
    const d = ok(act(s, { type: 'draw', playerId: 'A' }));
    expect(d.state.players[d.state.turn]).toBe('A');
    expect(d.state.drewCardId).toBe('KH');
    const va = toPlayerView(d.state, 'A');
    expect(getLegalCardIds(va)).toEqual(['KH']);
    expect(toPlayerView(d.state, 'B').drewCardId).toBeNull();
    expect(act(d.state, { type: 'play', playerId: 'A', cardIds: ['4S'] })).toMatchObject({ ok: false, code: 'MUST_PLAY_DRAWN' });
    expect(act(d.state, { type: 'draw', playerId: 'A' })).toMatchObject({ ok: false, code: 'ALREADY_DREW' });
    expect(ok(act(d.state, { type: 'pass', playerId: 'A' })).state.players[0]).toBe('A');
    expect(act(s, { type: 'pass', playerId: 'A' })).toMatchObject({ ok: false, code: 'CANNOT_PASS' });
    const played = ok(act(d.state, { type: 'play', playerId: 'A', cardIds: ['KH'] }));
    expect(played.state.discard.at(-1)!.id).toBe('KH');
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
void seededRng; void applyAction; void FILL;
