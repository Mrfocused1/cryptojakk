// Move history: the server's public log of the current hand, in plain language. Auto-updates while it is on screen.
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { HistoryEntry } from '@shared/protocol';
import { Icon } from './components';
import { type NameCtx, describeEvents } from './describe';
import { refreshHistory, useApp, watchHistory } from './store';

const KIND_TAG: Partial<Record<HistoryEntry['kind'], string>> = { bot: 'CPU', timeout: 'TIMER' };

export function HistoryPanel({ className = '' }: { className?: string }) {
  const { history, room, playerId } = useApp();
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    watchHistory(true);
    return () => watchHistory(false);
  }, []);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history?.length]);
  const ctx: NameCtx = { me: playerId ?? '', nameOf: (id) => room?.players.find((p) => p.playerId === id)?.name ?? 'Player' };
  const rows: Array<{ key: string; lines: Array<{ text: string; tone: string }>; tag?: string; seq: number; hand: number }> = (history ?? []).map((h) => {
    let lines = h.kind === 'deal' ? [{ text: `Hand ${h.hand} dealt`, tone: 'info' }] : describeEvents(h.events, ctx);
    if (lines.length === 0 && h.kind !== 'deal') {
      const who = h.playerId ? (h.playerId === ctx.me ? 'You' : ctx.nameOf(h.playerId)) : 'Someone';
      lines = [{ text: `${who} ${h.kind === 'declareJakk' ? 'declared JAKK' : h.kind === 'chooseSuit' ? 'chose a suit' : 'made a move'}`, tone: 'info' }];
    }
    return { key: `${h.hand}-${h.seq}`, lines, tag: KIND_TAG[h.kind], seq: h.seq, hand: h.hand };
  });
  return (
    <div className={`history ${className}`} data-testid="history">
      <div className="history-bar">
        <span>{history === null ? 'Loading...' : `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} this hand`}</span>
        <button type="button" className="icon-btn small" onClick={refreshHistory} aria-label="Refresh history" data-testid="history-refresh">
          <Icon name="refresh" />
        </button>
      </div>
      <ol className="history-list" ref={listRef}>
        {rows.length === 0 && <li className="history-empty">Nothing yet. Moves appear here as they are played.</li>}
        {rows.map((r) => (
          <li key={r.key} data-tone={r.lines[0]?.tone} data-testid="history-item">
            <span className="h-n">{r.seq}</span>
            <span className="h-t">
              {r.lines.map((l, i) => (
                <span key={i} className={`h-l ${l.tone}`}>
                  {l.text}
                </span>
              ))}
            </span>
            {r.tag && <i className="mark">{r.tag}</i>}
          </li>
        ))}
      </ol>
    </div>
  );
}
