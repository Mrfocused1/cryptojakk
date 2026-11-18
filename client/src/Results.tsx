import { useEffect, useRef } from 'react';
import type { PlayerView } from '@shared/engine';
import type { RoomSnapshot } from '@shared/protocol';
import { Avatar, ChipStack, Icon, useMedia } from './components';
import { leaveRoom, rematch, useApp } from './store';
import { playSfx, vibrate } from './sound';

function Confetti() {
  const bits = Array.from({ length: 28 }, (_, i) => {
    const a = (i / 28) * Math.PI * 2 + (i % 3) * 0.2;
    const d = 110 + ((i * 37) % 120);
    return {
      x: Math.cos(a) * d,
      y: Math.sin(a) * d - 60,
      r: (i * 83) % 360,
      c: ['#c6ff3d', '#f4f1ea', '#ffb020', '#ff5d8f', '#5eb0ff'][i % 5],
      dl: (i % 7) * 25,
      w: 6 + (i % 4) * 3,
    };
  });
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <i key={i} style={{ ['--x' as string]: `${b.x}px`, ['--y' as string]: `${b.y}px`, ['--r' as string]: `${b.r}deg`, background: b.c, animationDelay: `${b.dl}ms`, width: b.w, height: b.w * 1.6 }} />
      ))}
    </div>
  );
}

export function Results({ view, room }: { view: PlayerView; room: RoomSnapshot }) {
  const { rematchRequested } = useApp();
  const iWon = view.winner === view.you;
  const rematchRef = useRef<HTMLButtonElement>(null);
  const desk = useMedia('(min-width: 1024px)');
  useEffect(() => {
    // Keyboard players land on the primary action; phones are left alone (no stray focus ring).
    if (desk) rematchRef.current?.focus();
  }, [desk]);
  useEffect(() => {
    playSfx(iWon ? 'win' : 'lose');
    if (iWon) vibrate([60, 40, 60]);
  }, [iWon]);
  const rows = room.players
    .map((p) => ({ p, count: view.handCounts[p.playerId] ?? 0, won: p.playerId === view.winner }))
    .sort((a, b) => Number(b.won) - Number(a.won) || a.count - b.count);
  const winner = rows.find((r) => r.won);
  return (
    <div className="results-wrap" data-testid="results">
      <div className={`results ${iWon ? 'win' : ''}`} role="dialog" aria-modal="true" aria-label="Game over">
        {iWon && <Confetti />}
        <ChipStack color="red" n={4} className="res-chip l" />
        <ChipStack color="black" n={3} className="res-chip r" />
        <p className="results-kicker">{iWon ? 'You win!' : 'Game over'}</p>
        <h2 className="results-title">{iWon ? 'Hand cleared!' : `${winner?.p.name ?? 'Someone'} wins`}</h2>
        <ul className="results-list">
          {rows.map(({ p, count, won }) => (
            <li key={p.playerId} className={won ? 'won' : ''}>
              <Avatar avatar={p.avatar} size={36} />
              <span className="rn">
                {p.name}
                {p.playerId === view.you && <i> (you)</i>}
              </span>
              <span className="rc">{won ? 'Out!' : `${count} ${count === 1 ? 'card' : 'cards'} left`}</span>
            </li>
          ))}
        </ul>
        <div className="results-actions">
          <button ref={rematchRef} className="pill primary wide" data-testid="rematch" onClick={rematch} disabled={rematchRequested && room.mode === 'friends'}>
            {rematchRequested && room.mode === 'friends' ? 'Waiting...' : <>Rematch <Icon name="next" /></>}
          </button>
          <button className="pill secondary wide" data-testid="leave" onClick={leaveRoom}>
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}
