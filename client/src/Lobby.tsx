import { useState } from 'react';
import type { LobbyPlayer, RoomSnapshot } from '@shared/protocol';
import { AppHeader, Avatar, DecoChips, Icon } from './components';
import { addBot, leaveRoom, removeBot, setReady, startGame, useApp } from './store';

function startBlock(room: RoomSnapshot): string | null {
  if (room.canStart) return null;
  if (room.players.length < room.minPlayers) return `Need at least ${room.minPlayers} players`;
  const waiting = room.players.find((p) => !p.isHost && !p.isBot && !p.ready);
  if (waiting) return `Waiting for ${waiting.name} to ready up`;
  return 'Not ready to start yet';
}

export function inviteLink(code: string): string {
  return `${location.origin}/r/${code}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

const WA_PATH = 'M12 2a10 10 0 0 0-8.600 15.100L2 22l5-1.300A10 10 0 1 0 12 2zm5.200 14c-.2.600-1.300 1.200-1.800 1.200-.5.100-1 .200-3.300-.700-2.800-1.100-4.600-4-4.700-4.200-.100-.2-1.100-1.500-1.100-2.800s.7-2 1-2.300c.2-.3.500-.3.700-.3h.5c.2 0 .4 0 .6.500l.8 1.900c.1.200.1.400 0 .5l-.4.600-.3.400c-.1.100-.3.300-.1.600.2.300.8 1.300 1.700 2.100 1.200 1 2.200 1.400 2.500 1.500.3.100.5.100.7-.1l.9-1.100c.2-.3.400-.2.700-.1l1.800.9c.3.100.5.200.5.300.1.100.1.700-.1 1.300z';

/** WhatsApp / native share / copy link. Used by the lobby and (on desktop) the table's side panel. */
export function InviteActions({ code, compact = false }: { code: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const link = inviteLink(code);
  const message = `Join my Crypto Jakk game! Room ${code}: ${link}`;
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  async function copy() {
    if (await copyText(link)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }
  async function share() {
    try {
      await navigator.share({ title: 'Crypto Jakk', text: `Join my Crypto Jakk game! Room ${code}`, url: link });
    } catch {
      /* cancelled */
    }
  }
  return (
    <div className={`share-row ${compact ? 'compact' : ''}`}>
      <a className="pill secondary wa" data-testid="share-wa" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path fill="currentColor" d={WA_PATH} />
        </svg>
        Share on WhatsApp
      </a>
      <div className="share-sub">
        {canShare && (
          <button className="pill secondary" onClick={share} data-testid="share-native">
            Share
          </button>
        )}
        <button className="pill primary" onClick={copy} data-testid="copy-link">
          <Icon name="link" /> {copied ? 'Link copied!' : 'Copy link'}
        </button>
      </div>
    </div>
  );
}

function PlayerRow({ p, me, isHost, canRemove }: { p: LobbyPlayer; me: boolean; isHost: boolean; canRemove: boolean }) {
  return (
    <li className={`player-row ${p.connected ? '' : 'away'}`} data-testid="lobby-player">
      <Avatar avatar={p.avatar} size={42} />
      <span className="pr-name">
        {p.name}
        {me && <i> (you)</i>}
      </span>
      <span className="pr-badges">
        {p.isHost && <b className="badge host">HOST</b>}
        {p.isBot && <b className="badge">BOT</b>}
        {!p.connected && !p.isBot && <b className="badge off">OFFLINE</b>}
        {!p.isHost && (p.ready ? <b className="badge ready">READY</b> : <b className="badge wait">NOT READY</b>)}
      </span>
      {isHost && p.isBot && canRemove && (
        <button className="icon-btn small" aria-label={`Remove ${p.name}`} onClick={() => removeBot(p.playerId)}>
          ✕
        </button>
      )}
    </li>
  );
}

export function Lobby() {
  const { room, playerId } = useApp();
  if (!room) return null;
  const me = room.players.find((p) => p.playerId === playerId);
  const amHost = room.hostId === playerId;
  const link = inviteLink(room.code);
  const block = startBlock(room);
  const open = Math.max(0, room.maxPlayers - room.players.length);

  return (
    <div className="screen page lobby">
      <AppHeader onBack={leaveRoom} backLabel="Leave" inGame onLeave={leaveRoom} />
      <div className="body">
      <p className="eyebrow">{room.phase === 'rematch' ? 'Rematch lobby' : 'Lobby'}</p>
      <h1 className="title h2">{room.mode === 'friends' ? 'Your Table' : 'Get Ready'}</h1>

      <div className="lobby-grid">
        <div className="lobby-col lobby-invite">
          <div className="code-block">
            <span className="code-label">Room code</span>
            <div className="code tilt" data-testid="room-code" aria-label={`Room code ${room.code.split('').join(' ')}`}>
              {room.code}
            </div>
          </div>
          <p className="invite-hint">Send friends the link, or have them type the code on the Play Friends screen.</p>
          <div className="link-box" aria-label="Invite link">
            {link}
          </div>
          <InviteActions code={room.code} />
        </div>

        <div className="lobby-col lobby-people">
          <h2 className="section-title">
            Players <span>{room.players.length}/{room.maxPlayers}</span>
          </h2>
          <ul className="player-list">
            {room.players.map((p) => (
              <PlayerRow key={p.playerId} p={p} me={p.playerId === playerId} isHost={amHost} canRemove />
            ))}
            {Array.from({ length: open }, (_, i) => (
              <li key={`open${i}`} className="player-row open">
                <span className="avatar ghost">?</span>
                <span className="pr-name">Waiting for a player...</span>
              </li>
            ))}
          </ul>

          <div className="lobby-actions">
            {amHost ? (
              <>
                <button className="pill secondary wide" onClick={addBot} disabled={room.players.length >= room.maxPlayers} data-testid="add-bot">
                  <Icon name="plus" /> Add bot
                </button>
                <button className="pill primary wide" onClick={startGame} disabled={!room.canStart} data-testid="start-game">
                  Start game
                </button>
                {block && (
                  <p className="reason" data-testid="start-reason">
                    {block}
                  </p>
                )}
              </>
            ) : (
              <>
                <button className={`pill wide ${me?.ready ? 'secondary' : 'primary'}`} onClick={() => setReady(!me?.ready)} data-testid="ready-btn">
                  {me?.ready ? 'Ready - tap to undo' : "I'm ready"}
                </button>
                <p className="reason">{me?.ready ? 'Waiting for the host to start...' : 'Tap ready so the host can start.'}</p>
              </>
            )}
          </div>

          <p className="rules-line">
            {room.minPlayers}-{room.maxPlayers} players. Match suit or rank, empty your hand first. 2 = +2, black Jack = +5, 8 skips, King reverses, Queens need a cover, Ace is wild. Say JAKK on one card.
          </p>
          <ul className="rules-list" aria-label="Rules summary">
            <li>
              <b>Goal</b> Empty your hand first. Match the top card by suit or rank, or draw.
            </li>
            <li>
              <b>2</b> +2 for the next player, stackable with another 2.
            </li>
            <li>
              <b>Black Jack</b> +5, answered only by another Jack. A red Jack cancels it.
            </li>
            <li>
              <b>8 / King</b> 8 skips the next player, King reverses direction.
            </li>
            <li>
              <b>Queen</b> Must be covered in the same turn.
            </li>
            <li>
              <b>Ace</b> Wild: name the next suit.
            </li>
            <li>
              <b>JAKK</b> Call it on one card left, or pick up 2.
            </li>
          </ul>
        </div>
      </div>
      </div>
      <DecoChips variant="bottom" />
    </div>
  );
}
