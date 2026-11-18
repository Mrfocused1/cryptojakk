import { describe, expect, it } from 'vitest';
import { chooseBotAction } from '../shared/ai';
import { DEFAULT_RULES, applyAction, createGame, toPlayerView, withRules, type GameState, type RulesConfig } from '../shared/engine';
import { assertConserved, seededRng } from './helpers';

function simulate(n: number, seed: number, rules: RulesConfig = DEFAULT_RULES) {
  const rng = seededRng(seed);
  const ids = ['P1', 'P2', 'P3', 'P4'].slice(0, n);
  let s: GameState = createGame(ids, rules, rng);
  let steps = 0;
  let sawJakkMiss = false;
  while (!s.winner) {
    if (++steps > 5000) throw new Error(`game ${seed} did not terminate`);
    const pid = s.players[s.turn];
    const move = chooseBotAction(toPlayerView(s, pid), { declareJakk: rng() < 0.9 });
    if (!move) throw new Error('bot returned no move on its own turn');
    const r = applyAction(s, { ...move, playerId: pid }, rng);
    if (!r.ok) throw new Error(`bot made an illegal move: ${r.code} ${r.reason} ${JSON.stringify(move)}`);
    if (r.events.some((e) => e.type === 'jakkMissed')) sawJakkMiss = true;
    // Fuzz invariants: an accepted first card matches the active suit / top rank unless it is an Ace, answers a
    // penalty, or goes on a Queen; and the active suit is always the top card's suit unless an Ace nominated one.
    const played = r.events.find((e) => e.type === 'played');
    if (played && played.type === 'played') {
      const first = played.cards[0];
      const top = s.discard[s.discard.length - 1];
      const free = first.rank === 'A' || s.penalty !== null || (rules.queenAcceptsAny && top.rank === 'Q');
      if (!free) expect(first.suit === s.activeSuit || first.rank === top.rank, `illegal first card ${first.id} on ${top.id}/${s.activeSuit}`).toBe(true);
      expect(new Set(played.cards.map((c) => c.rank)).size).toBe(1);
      const last = played.cards[played.cards.length - 1];
      expect(r.state.discard[r.state.discard.length - 1].id).toBe(last.id); // top = LAST card played
    }
    const ntop = r.state.discard[r.state.discard.length - 1];
    expect(r.state.activeSuit === ntop.suit || ntop.rank === 'A', `active suit ${r.state.activeSuit} vs top ${ntop.id}`).toBe(true);
    s = r.state;
    assertConserved(s);
  }
  return { s, steps, sawJakkMiss };
}

describe('bot-vs-bot simulation', () => {
  for (const n of [2, 3, 4]) {
    it(`500 games terminate with a winner and conserve 52 unique cards (${n} players)`, () => {
      let miss = 0;
      for (let g = 0; g < 500; g++) {
        const { s, sawJakkMiss } = simulate(n, 1000 * n + g);
        expect(s.winner).not.toBeNull();
        expect(s.hands[s.winner!]).toHaveLength(0);
        if (sawJakkMiss) miss++;
      }
      expect(miss).toBeGreaterThan(0); // the ~10% forgetful bots do occur
    });
  }

  it('also terminates with playAfterDraw on and canFinishOnPower off', () => {
    for (let g = 0; g < 100; g++) {
      const n = 2 + (g % 3);
      const { s } = simulate(n, 77000 + g, withRules({ playAfterDraw: true, canFinishOnPower: false }));
      expect(s.winner).not.toBeNull();
    }
  });
});
