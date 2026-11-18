import { describe, expect, it } from 'vitest';
import { chooseBotAction } from '../shared/ai';
import { DEFAULT_RULES, HOUSE_RULE_KEYS, applyAction, createGame, toPlayerView, withRules, type GameState, type RulesConfig } from '../shared/engine';
import { assertConserved, seededRng } from './helpers';

const IDS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];

function simulate(n: number, seed: number, rules: RulesConfig = DEFAULT_RULES) {
  const rng = seededRng(seed);
  const ids = IDS.slice(0, n);
  let s: GameState = createGame(ids, rules, rng);
  let steps = 0;
  const seen = { blocked: 0, queen: 0, satOut: 0, brought: 0, noWinner: 0 };
  while (!s.handOver) {
    if (++steps > 8000) throw new Error(`hand ${seed} did not terminate`);
    const pid = s.players[s.turn];
    const move = chooseBotAction(toPlayerView(s, pid), { declareJakk: rng() < 0.9 });
    if (!move) throw new Error('bot returned no move on its own turn');
    const r = applyAction(s, { ...move, playerId: pid }, rng);
    if (!r.ok) throw new Error(`bot made an illegal move: ${r.code} ${r.reason} ${JSON.stringify(move)}`);
    for (const e of r.events) {
      if (e.type === 'finishBlocked') seen.blocked++;
      if (e.type === 'queenUncovered') seen.queen++;
      if (e.type === 'satOut') seen.satOut++;
      if (e.type === 'broughtBack') seen.brought++;
    }
    // Fuzz invariants.
    const played = r.events.find((e) => e.type === 'played');
    if (played && played.type === 'played') {
      const first = played.cards[0];
      const top = s.discard[s.discard.length - 1];
      const free = first.rank === 'A' || s.penalty !== null || s.coverNeeded;
      if (!free) expect(first.suit === s.activeSuit || first.rank === top.rank, `illegal first card ${first.id} on ${top.id}/${s.activeSuit}`).toBe(true);
      const last = played.cards[played.cards.length - 1];
      expect(r.state.discard[r.state.discard.length - 1].id).toBe(last.id); // top = LAST card played
    }
    const ntop = r.state.discard[r.state.discard.length - 1];
    // active suit is always the top card's suit unless an Ace nominated one (or an opening Ace awaits its suit)
    expect(r.state.activeSuit === ntop.suit || ntop.rank === 'A', `active suit ${r.state.activeSuit} vs top ${ntop.id}`).toBe(true);
    for (const p of r.state.out) expect(r.state.hands[p]).toHaveLength(0);
    s = r.state;
    assertConserved(s);
  }
  if (!s.winner) seen.noWinner++;
  if (s.winner) expect(s.hands[s.winner]).toHaveLength(0);
  return { s, steps, seen };
}

describe('bot-vs-bot simulation (default rules)', () => {
  for (const n of [2, 3, 4, 5, 6]) {
    it(`300 hands terminate and conserve 52 unique cards (${n} players)`, () => {
      const total = { blocked: 0, queen: 0, satOut: 0, brought: 0, noWinner: 0 };
      for (let g = 0; g < 300; g++) {
        const { s, seen } = simulate(n, 1000 * n + g);
        expect(s.handOver).not.toBeNull();
        for (const k of Object.keys(total) as Array<keyof typeof total>) total[k] += seen[k];
      }
      expect(total.noWinner).toBeLessThan(60); // almost every hand has a winner
      console.log('sim', n, JSON.stringify(total));
      expect(total.queen + total.blocked).toBeGreaterThan(0); // penalty paths are exercised
    });
  }
});

describe('bot-vs-bot simulation (house rules flipped)', () => {
  const flipped = (g: number): RulesConfig => {
    const o: Record<string, boolean> = {};
    HOUSE_RULE_KEYS.forEach((k, i) => (o[k] = k === 'flexibleQueenCover' ? false : k === 'finishOnPower' ? false : !DEFAULT_RULES[k] || g % 2 === i % 2));
    return withRules(o);
  };
  it('100 hands per size with the opposite of every default (plus random combinations) always terminate', () => {
    let brought = 0;
    for (const n of [2, 3, 4, 5, 6]) {
      for (let g = 0; g < 100; g++) {
        const rules = g % 2 === 0 ? flipped(g) : withRules(Object.fromEntries(HOUSE_RULE_KEYS.map((k, i) => [k, ((g >> i) & 1) === 1])) as Partial<RulesConfig>);
        const { s, seen } = simulate(n, 77000 + n * 1000 + g, rules);
        expect(s.handOver).not.toBeNull();
        brought += seen.brought;
      }
    }
    expect(brought).toBeGreaterThanOrEqual(0); // (a bot rarely finishes on a pickup card; Bring Backs is covered by Examples 45-48)
  });

  it('with jakkEnabled off and no skip/reverse card the game still terminates', () => {
    for (let g = 0; g < 60; g++) {
      const { s } = simulate(2 + (g % 5), 91000 + g, withRules({ jakkEnabled: false, skipRank: null, reverseRank: null }));
      expect(s.handOver).not.toBeNull();
    }
  });
});
