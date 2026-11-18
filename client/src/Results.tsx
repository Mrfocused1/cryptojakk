import { useEffect, useRef } from 'react';
import type { PlayerView } from '@shared/engine';
import type { RoomSnapshot } from '@shared/protocol';
import { Avatar, ChipStack, Icon, useMedia } from './components';
import { leaveRoom, nextHand, rematch, useApp } from './store';
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

const REASON_TEXT: Record<string, string> = {
  deckExhausted: 'No winner - the deck ran out and two or more players tied for the most cards.',
  lastStanding: 'Everyone else sat out when the deck ran out, so the last player standing wins.',
  turnCap: 'No winner - the hand hit the turn limit.',
};

export function Results({ view, room }: { view: PlayerView; room: RoomSnapshot }) {
  const { rematchRequested } = useApp();
  const me = view.you;
  const target = room.options.handsToWin;
  const finished = room.phase === 'finished';
  const between = room.phase === 'handOver';
  const pending = !finished && !between; // the final state has arrived, the room update is a moment behind
  const handWinner = view.winner;
  const iWonHand = handWinner === me;
  const matchWinner = room.matchWinner;
  const iWon = finished ? matchWinner === me : iWonHand;
  const isHost = room.hostId === me;
  const primaryRef = useRef<HTMLButtonElement>(null);
  const desk = useMedia('(min-width: 1024px)');
  useEffect(() => {
    // Keyboard players land on the primary action; phones are left alone (no stray focus ring).
    if (desk && !pending) primaryRef.current?.focus();
  }, [desk, pending]);
  useEffect(() => {
    playSfx(iWon ? 'win' : 'lose');
    if (iWon) vibrate([60, 40, 60]);
  }, [iWon]);
  const nameOf = (id: string | null) => (id ? (room.players.find((p) => p.playerId === id)?.name ?? 'Someone') : 'Nobody');
  const rows = view.players
    .map((id) => room.players.find((p) => p.playerId === id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({ p, count: view.handCounts[p.playerId] ?? 0, won: p.playerId === handWinner, wins: room.scores[p.playerId] ?? 0, out: view.out.includes(p.playerId) }))
    .sort((a, b) => b.wins - a.wins || Number(b.won) - Number(a.won) || a.count - b.count);
  const reasonText = view.handOver && view.handOver.reason !== 'finished' ? REASON_TEXT[view.handOver.reason] : null;

  let kicker: string;
  let title: string;
  if (finished && target > 1) {
    kicker = iWon ? 'You win the match!' : 'Match over';
    title = iWon ? 'Match winner!' : `${nameOf(matchWinner)} wins the match`;
  } else if (finished) {
    kicker = iWon ? 'You win!' : 'Game over';
    title = !handWinner ? 'No winner this hand' : iWon ? 'Hand cleared!' : `${nameOf(handWinner)} wins`;
  } else {
    kicker = iWonHand ? 'You win the hand!' : `Hand ${room.handNumber} over`;
    title = !handWinner ? 'No winner - the deck ran out' : iWonHand ? 'Hand cleared!' : `${nameOf(handWinner)} wins the hand`;
    if (!handWinner && view.handOver?.reason !== 'deckExhausted') title = 'No winner this hand';
  }
  return (
    <div className="results-wrap" data-testid="results" data-phase={room.phase}>
      <div className={`results ${iWon ? 'win' : ''}`} role="dialog" aria-modal="true" aria-label={kicker}>
        {iWon && <Confetti />}
        <ChipStack color="red" n={4} className="res-chip l" />
        <ChipStack color="black" n={3} className="res-chip r" />
        <p className="results-kicker" data-testid="results-kicker">{kicker}</p>
        <h2 className="results-title" data-testid="results-title">{title}</h2>
        {reasonText && <p className="results-reason" data-testid="results-reason">{reasonText}</p>}
        {target > 1 && (
          <p className="results-match" data-testid="results-match">
            {finished ? `Final score, first to ${target} hands` : `Hand ${room.handNumber} - first to ${target} hands wins the match`}
          </p>
        )}
        <ul className="results-list">
          {rows.map(({ p, count, won, wins, out }) => (
            <li key={p.playerId} className={won ? 'won' : ''} data-testid="results-row">
              <Avatar avatar={p.avatar} size={36} />
              <span className="rn">
                {p.name}
                {p.playerId === me && <i> (you)</i>}
              </span>
              {target > 1 && (
                <span className="rs" data-testid="results-score" aria-label={`${wins} hands won`}>
                  {Array.from({ length: target }, (_, i) => (
                    <i key={i} className={i < wins ? 'on' : ''}>
                      ★
                    </i>
                  ))}
                </span>
              )}
              <span className="rc">{won ? 'Out!' : out ? 'Sat out' : `${count} ${count === 1 ? 'card' : 'cards'} left`}</span>
            </li>
          ))}
        </ul>
        <div className="results-actions">
          {finished ? (
            <button ref={primaryRef} className="pill primary wide" data-testid="rematch" onClick={rematch} disabled={rematchRequested && room.mode === 'friends'}>
              {rematchRequested && room.mode === 'friends' ? 'Waiting...' : <>Rematch <Icon name="next" /></>}
            </button>
          ) : (
            <button ref={primaryRef} className="pill primary wide" data-testid="next-hand" onClick={nextHand} disabled={!isHost || pending}>
              {isHost ? <>Next hand <Icon name="next" /></> : 'Waiting for the host...'}
            </button>
          )}
          <button className="pill secondary wide" data-testid="leave" onClick={leaveRoom}>
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}
