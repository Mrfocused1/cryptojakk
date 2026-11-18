import { useEffect, useRef, useState } from 'react';
import { NAME_MAX_LENGTH, normalizeRoomCode, sanitizeName } from '@shared/protocol';
import { Avatar, BackButton, Logo } from './components';
import { AVATAR_COLORS, AVATAR_EMOJIS, type Identity, randomGuest } from './identity';
import { navigate } from './router';
import { clearJoinError, createFriendsRoom, ensureMultiplayer, joinCode, playAI, playNow, retryMultiplayer, setIdentity, useApp } from './store';
import { unlockAudio } from './sound';

// ------------------------------------------------------------------ landing

export function Landing() {
  const { identity } = useApp();
  const [busy, setBusy] = useState(false);
  const go = () => {
    unlockAudio();
    setBusy(true);
    playNow();
    setTimeout(() => setBusy(false), 1500);
  };
  return (
    <div className="screen landing">
      <header className="topline end">
        {identity && (
          <button className="profile-chip" onClick={() => navigate('/profile')} aria-label={`Edit profile: ${identity.name}`} data-testid="profile-chip">
            <Avatar avatar={identity.avatar} size={28} />
            <span>{identity.name}</span>
          </button>
        )}
      </header>
      <div className="landing-main">
        <Logo className="landing-logo" />
        <p className="tagline tilt">Dump your hand first.</p>
      </div>
      <nav className="landing-actions" aria-label="Main menu">
        <button className="btn primary huge" data-testid="play-now" onClick={go} disabled={busy}>
          {busy ? 'Dealing...' : 'Play Now'}
          <small>vs 1 bot, instantly</small>
        </button>
        <div className="two-col">
          <button className="btn secondary" data-testid="play-friends" onClick={() => navigate('/friends')}>
            Play Friends
          </button>
          <button className="btn secondary" data-testid="play-ai" onClick={() => navigate('/ai')}>
            Play AI
          </button>
        </div>
        <button className="btn ghost" data-testid="how-to-play" onClick={() => navigate('/how-to-play')}>
          How to Play
        </button>
      </nav>
    </div>
  );
}

// ------------------------------------------------------------------ guest entry

export function GuestEntry({ mode, invite, onDone }: { mode: 'new' | 'edit'; invite?: string; onDone?: () => void }) {
  const { identity } = useApp();
  const [seed] = useState<Identity>(() => identity ?? randomGuest());
  const [name, setName] = useState(identity ? seed.name : '');
  const [emoji, setEmoji] = useState(seed.avatar.emoji ?? AVATAR_EMOJIS[0]);
  const [color, setColor] = useState(seed.avatar.color);
  const clean = sanitizeName(name);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clean) return;
    setIdentity({ name: clean, avatar: { emoji, color } });
    onDone?.();
  };
  return (
    <form className="screen scroll-screen guest" onSubmit={submit}>
      <header className="topline">{mode === 'edit' ? <BackButton onClick={() => navigate('/')} /> : <BackButton onClick={() => navigate('/')} label="Home" />}</header>
      {invite && (
        <p className="invite-note tilt">
          You're invited to room <b>{invite}</b>
        </p>
      )}
      <h1 className="page-title tilt">{mode === 'edit' ? 'Your profile' : "Who's playing?"}</h1>
      <div className="preview-row">
        <Avatar avatar={{ emoji, color }} size={84} className="preview" />
      </div>
      <label className="field">
        <span>Display name</span>
        <input
          data-testid="name-input"
          value={name}
          maxLength={NAME_MAX_LENGTH}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          autoComplete="nickname"
          autoCapitalize="words"
          spellCheck={false}
          autoFocus
        />
        <em>{[...name].length}/{NAME_MAX_LENGTH}</em>
      </label>
      <fieldset className="pick">
        <legend>Pick an avatar</legend>
        <div className="emoji-grid">
          {AVATAR_EMOJIS.map((em) => (
            <button type="button" key={em} className={`pick-btn ${em === emoji ? 'on' : ''}`} onClick={() => setEmoji(em)} aria-pressed={em === emoji} aria-label={`Avatar ${em}`}>
              {em}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="pick">
        <legend>Pick a colour</legend>
        <div className="swatch-row">
          {AVATAR_COLORS.map((c) => (
            <button type="button" key={c} className={`swatch ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-pressed={c === color} aria-label={`Colour ${c}`} />
          ))}
        </div>
      </fieldset>
      <button className="btn primary wide big" type="submit" disabled={!clean} data-testid="guest-continue">
        {mode === 'edit' ? 'Save' : 'Continue'}
      </button>
      <p className="quiet">No account needed. Your name and a secret seat key live only in this browser, so clearing your browser data removes them.</p>
      <div className="spacer" />
    </form>
  );
}

// ------------------------------------------------------------------ friends

/** Shown on every friends screen when the multiplayer server cannot be reached. Solo play is unaffected. */
export function MultiplayerOffline({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="offline-panel" role="alert" data-testid="mp-offline">
      <p className="offline-title tilt">Multiplayer is offline right now</p>
      <p className="quiet">We couldn't reach the game server. Playing against bots still works anywhere, even without a connection.</p>
      <div className="stack">
        <button className="btn primary" data-testid="mp-retry" onClick={onRetry}>
          Retry
        </button>
        <button className="btn secondary" data-testid="mp-play-ai" onClick={() => navigate('/ai')}>
          Play vs AI instead
        </button>
        <button className="btn ghost" onClick={() => navigate('/')}>
          Home
        </button>
      </div>
    </div>
  );
}

const JOIN_MESSAGES: Record<string, string> = {
  ROOM_NOT_FOUND: "We couldn't find that room. It may have expired. Check the code or ask for a fresh link.",
  ROOM_FULL: 'That room is full (4 players).',
  GAME_IN_PROGRESS: 'That game has already started. Ask your friends for a rematch invite, or start your own room.',
};

export function joinErrorText(code: string, message: string): string {
  return JOIN_MESSAGES[code] ?? message;
}

export function PlayFriends() {
  const { joinError, joining, conn } = useApp();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    ensureMultiplayer();
    return () => clearJoinError();
  }, []);
  const cleaned = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5);
  const valid = normalizeRoomCode(cleaned) !== null;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (cleaned.length < 5) return;
    unlockAudio();
    joinCode(cleaned);
  };
  return (
    <div className="screen scroll-screen friends">
      <header className="topline">
        <BackButton onClick={() => navigate('/')} label="Home" />
      </header>
      <h1 className="page-title tilt">Play Friends</h1>
      {conn === 'unavailable' ? (
        <MultiplayerOffline onRetry={retryMultiplayer} />
      ) : (
        <>
      <p className="lead">Start a private room and send the link, or jump into one with a code.</p>
      <button
        className="btn primary wide big"
        data-testid="create-room"
        disabled={busy}
        onClick={() => {
          unlockAudio();
          setBusy(true);
          createFriendsRoom();
          setTimeout(() => setBusy(false), 3000);
        }}
      >
        {busy && conn !== 'open' ? 'Connecting...' : 'Create room'}
      </button>
      <div className="or">
        <span>or join with a code</span>
      </div>
      <form onSubmit={submit} className="join-form">
        <input
          data-testid="code-input"
          className="code-input"
          value={cleaned}
          onChange={(e) => {
            setCode(e.target.value);
            if (joinError) clearJoinError();
          }}
          onPaste={(e) => {
            // Accept a pasted full invite link too.
            const t = e.clipboardData.getData('text');
            const m = /\/r\/([A-Za-z0-9]{5})/.exec(t);
            if (m) {
              e.preventDefault();
              setCode(m[1].toUpperCase());
            }
          }}
          placeholder="K7M2Q"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          maxLength={40}
          aria-label="Room code"
        />
        <button className="btn secondary" type="submit" disabled={cleaned.length < 5 || joining} data-testid="join-btn">
          {joining ? 'Joining...' : 'Join'}
        </button>
      </form>
      {cleaned.length === 5 && !valid && <p className="error-text">Room codes never contain 0, O, 1 or I. Double-check the code.</p>}
      {joinError && (
        <p className="error-text" role="alert" data-testid="join-error">
          {joinErrorText(joinError.code, joinError.message)}
        </p>
      )}
        </>
      )}
      <div className="spacer" />
    </div>
  );
}

// ------------------------------------------------------------------ play AI

export function PlayAI() {
  const [n, setN] = useState(2);
  const [busy, setBusy] = useState(false);
  return (
    <div className="screen scroll-screen friends">
      <header className="topline">
        <BackButton onClick={() => navigate('/')} label="Home" />
      </header>
      <h1 className="page-title tilt">Play AI</h1>
      <p className="lead">How many bots do you want to beat?</p>
      <div className="bot-choice" role="radiogroup" aria-label="Number of opponents">
        {[1, 2, 3].map((k) => (
          <button key={k} role="radio" aria-checked={n === k} className={`choice ${n === k ? 'on' : ''}`} onClick={() => setN(k)} data-testid={`bots-${k}`}>
            <strong>{k}</strong>
            <span>{k === 1 ? 'opponent' : 'opponents'}</span>
          </button>
        ))}
      </div>
      <button
        className="btn primary wide big"
        data-testid="start-ai"
        disabled={busy}
        onClick={() => {
          unlockAudio();
          setBusy(true);
          playAI(n);
          setTimeout(() => setBusy(false), 1500);
        }}
      >
        Start game
      </button>
      <div className="spacer" />
    </div>
  );
}

// ------------------------------------------------------------------ deep link join

export function JoinFlow({ code: raw }: { code: string }) {
  const { joinError, joining, conn } = useApp();
  const code = normalizeRoomCode(raw);
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (code && sent.current !== code) {
      sent.current = code;
      joinCode(code);
    }
    return () => clearJoinError();
  }, [code]);
  const retry = () => code && joinCode(code);
  return (
    <div className="screen join-flow">
      <Logo className="join-logo" />
      {conn === 'unavailable' ? (
        <MultiplayerOffline onRetry={retry} />
      ) : !code ? (
        <>
          <p className="error-text big">That invite link doesn't look right.</p>
          <button className="btn secondary" onClick={() => navigate('/friends')}>
            Enter a code instead
          </button>
        </>
      ) : joinError ? (
        <>
          <p className="error-text big" role="alert" data-testid="join-error">
            {joinErrorText(joinError.code, joinError.message)}
          </p>
          <div className="stack">
            {joinError.code === 'ROOM_FULL' && (
              <button className="btn secondary" onClick={retry}>
                Try again
              </button>
            )}
            <button className="btn primary" onClick={() => navigate('/friends')}>
              Create your own room
            </button>
            <button className="btn ghost" onClick={() => navigate('/')}>
              Home
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="joining tilt" data-testid="joining">
            Joining room <b>{code}</b>
          </p>
          <p className="quiet">{conn === 'open' ? (joining ? 'Grabbing a seat...' : 'One moment...') : 'Connecting...'}</p>
        </>
      )}
    </div>
  );
}
