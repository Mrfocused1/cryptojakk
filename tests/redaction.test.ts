import { describe, expect, it } from 'vitest';
import { chooseBotAction } from '../shared/ai';
import { DEFAULT_RULES, applyAction, createGame, redactEvents, toPlayerView, type GameEvent, type GameState } from '../shared/engine';
import { seededRng } from './helpers';

function quoted(id: string) {
  return `"${id}"`;
}

describe('view / event redaction', () => {
  it('a player view never contains other hands or the deck order', () => {
    const rng = seededRng(5);
    for (let g = 0; g < 30; g++) {
      let s: GameState = createGame(['A', 'B', 'C'], DEFAULT_RULES, rng);
      for (let step = 0; step < 60 && !s.winner; step++) {
        for (const me of s.players) {
          const view = toPlayerView(s, me);
          const json = JSON.stringify(view);
          const hidden = [
            ...s.players.filter((p) => p !== me).flatMap((p) => s.hands[p].map((c) => c.id)),
            ...s.drawPile.map((c) => c.id),
          ];
          for (const id of hidden) {
            // the top discard is public, everything else hidden must not appear
            if (id === s.discard[s.discard.length - 1].id) continue;
            expect(json.includes(quoted(id)), `view of ${me} leaks ${id}`).toBe(false);
          }
          expect(Object.keys(view)).not.toContain('hands');
          expect(Object.keys(view)).not.toContain('drawPile');
          expect(view.hand.map((c) => c.id).sort()).toEqual(s.hands[me].map((c) => c.id).sort());
          expect(view.handCounts[me]).toBe(s.hands[me].length);
        }
        const pid = s.players[s.turn];
        const move = chooseBotAction(toPlayerView(s, pid), { declareJakk: rng() < 0.5 })!;
        const r = applyAction(s, { ...move, playerId: pid }, rng);
        if (!r.ok) throw new Error(r.reason);

        // events redacted for each viewer
        for (const me of s.players) {
          const events: GameEvent[] = redactEvents(r.events, me);
          const json = JSON.stringify(events) + JSON.stringify(toPlayerView(r.state, me));
          const publiclyPlayed = new Set(r.events.flatMap((e) => (e.type === 'played' ? e.cards.map((c) => c.id) : [])));
          const hiddenNow = [
            ...r.state.players.filter((p) => p !== me).flatMap((p) => r.state.hands[p].map((c) => c.id)),
            ...r.state.drawPile.map((c) => c.id),
          ].filter((id) => !publiclyPlayed.has(id) && id !== r.state.discard[r.state.discard.length - 1].id);
          for (const id of hiddenNow) expect(json.includes(quoted(id)), `events for ${me} leak ${id}`).toBe(false);
          for (const e of events) {
            if (e.type === 'drew' && e.playerId !== me) expect('cards' in e).toBe(false);
            if (e.type === 'drew' && e.playerId === me) expect(e.cards).toHaveLength(e.count);
          }
        }
        s = r.state;
      }
    }
  });

  it('the shared engine/ai/protocol code has no Node or DOM imports', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(join(import.meta.dirname, '..', 'shared'));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/from\s+['"](node:|fs|path|crypto|http|ws|express)/);
      expect(src, f).not.toMatch(/\b(document|window|localStorage)\./);
    }
  });
});
