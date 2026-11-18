import { useEffect, useRef, useState } from 'react';
import { type Card, DEFAULT_MATCH_OPTIONS, DEFAULT_RULES, type HouseRules, type MatchOptions, houseRulesOf } from '@shared/engine';
import { MAX_BOTS_AI_MODE, NAME_MAX_LENGTH, normalizeRoomCode, sanitizeName } from '@shared/protocol';
import { AppHeader, Avatar, CardBack, CardFace, DecoChips, Icon, LogoTile, ChipStack, useMuted } from './components';
import { AVATAR_COLORS, AVATAR_EMOJIS, type Identity, randomGuest } from './identity';
import { navigate } from './router';
import { readStore, writeStore } from './storage';
import { clearJoinError, createFriendsRoom, ensureMultiplayer, joinCode, playAI, playNow, retryMultiplayer, setIdentity, useApp } from './store';
import { setMuted, unlockAudio } from './sound';
import { setReduce, useReduce } from './prefs';
import { OptionsEditor } from './Options';

const card = (id: string): Card => ({ id, rank: id.slice(0, -1) as Card['rank'], suit: id.slice(-1) as Card['suit'] });

/** The gold arc with the table slogan, as printed on the felt. */
export function TableArc({ className = '' }: { className?: string }) {
  return (
    <svg className={`table-arc ${className}`} viewBox="0 0 420 110" aria-hidden="true" focusable="false">
      <defs>
        <path id="cj-arc-path" d="M 40 30 Q 210 112 380 30" />
      </defs>
      <path d="M 6 24 Q 210 124 414 24" fill="none" stroke="#c4af78" strokeWidth="2" />
      <text fill="#e1cc94" fontSize="15" fontWeight="700" letterSpacing="2.6" textAnchor="middle">
        <textPath href="#cj-arc-path" startOffset="50%">
          FIRST TO EMPTY THEIR HAND WINS
        </textPath>
      </text>
      <g fill="#c4af78">
        <path transform="translate(8 0) scale(0.9) rotate(-12 18 24)" d="M18 6c4 5 9 7 9 12a4.500 4.500 0 0 1-7.600 3.200c0 2.400.5 4.400 1.900 6.800h-6.600c1.400-2.400 1.900-4.400 1.900-6.800A4.500 4.500 0 0 1 9 18c0-5 5-7 9-12z" />
        <path transform="translate(376 0) scale(0.9) rotate(12 18 24)" d="M18 6c4 5 9 7 9 12a4.500 4.500 0 0 1-7.600 3.200c0 2.400.5 4.400 1.900 6.800h-6.600c1.400-2.400 1.900-4.400 1.900-6.800A4.500 4.500 0 0 1 9 18c0-5 5-7 9-12z" />
      </g>
    </svg>
  );
}

function Panel({ icon, title, text, onClick, testid, go = true, lock = false }: { icon: string; title: string; text: string; onClick?: () => void; testid?: string; go?: boolean; lock?: boolean }) {
  const inner = (
    <>
      <Icon name={icon} className="row-ico" />
      <span className="row-t">
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
      {lock && <Icon name="lock" className="row-meta" />}
      {go && <Icon name="next" className="row-go" />}
    </>
  );
  return onClick ? (
    <button className="row" onClick={onClick} data-testid={testid}>
      {inner}
    </button>
  ) : (
    <div className="row static">{inner}</div>
  );
}

const FAQ: Array<{ q: string; a: string }> = [
  { q: 'How do I get started?', a: 'Tap Play Now. You are dealt in against a bot straight away: no sign-up, no download. Pick a name and avatar any time from the menu.' },
  { q: 'Is it casino blackjack?', a: 'No. Crypto Jakk is the UK-style card-shedding game (think Crazy Eights with power cards). Everyone starts with seven cards and the first player to get rid of all of theirs, legally, wins the hand.' },
  { q: 'What are sequences?', a: 'You can play several cards in one turn: the same rank, or the same suit one step up or down (2♥ 3♥ 4♥ 5♥). Tap them in the order you want them played and the game shows what the play will do before you commit.' },
  { q: 'What is JAKK?', a: 'You must declare JAKK before the turn you go out on. It lasts one turn. If you empty your hand without it, your cards stay played, you pick up one card and the game goes on. A Queen can never be your last card either.' },
  { q: 'What are house rules?', a: 'Optional rules the host switches on before a match: flexible or strict Queen cover, mixed 2 / Jack stacking, Bring Backs, finishing on power cards and First Card Active. Everyone can see which are on, at the table and in the lobby.' },
  { q: 'Do I need an account?', a: 'No. Your display name and a secret seat key live in your browser only. Clearing your browser data removes them.' },
  { q: 'Can I play with friends?', a: 'Yes, 2 to 6 players. Create a private room and send the link or the five-letter code. Friends who join mid-hand watch and are dealt in next hand. Friends rooms need the multiplayer server to be online; solo games against 1 to 5 bots always work, even offline.' },
  { q: 'Does it cost anything? Is there real money?', a: 'It is free and there is no money in the game at all: no wallet, no stakes and nothing to buy. The chips you see are decoration.' },
];

function Faq() {
  return (
    <div className="faq">
      {FAQ.map((f) => (
        <details key={f.q} className="faq-item">
          <summary>
            <span>{f.q}</span>
            <Icon name="down" className="faq-chev" />
          </summary>
          <p>{f.a}</p>
        </details>
      ))}
    </div>
  );
}

function HeroCards({ className = '' }: { className?: string }) {
  return (
    <div className={`hero-cards ${className}`} aria-hidden="true">
      <div className="hc-card c1">
        <CardFace card={card('AS')} />
      </div>
      <div className="hc-card c2">
        <CardFace card={card('KH')} />
      </div>
      <div className="hc-card c3">
        <CardBack />
      </div>
    </div>
  );
}

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
  const toId = (id: string) => () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <div className="screen page landing">
      <AppHeader
        className="hdr-landing"
        nav={
          <nav className="hdr-nav" aria-label="Site">
            <button onClick={go}>Play</button>
            <button onClick={() => navigate('/friends')}>Play Friends</button>
            <button onClick={() => navigate('/how-to-play')}>How to Play</button>
            <button onClick={toId('faq')}>FAQ</button>
          </nav>
        }
        extra={
          <button className="pill sm hdr-cta" onClick={go} disabled={busy}>
            Play Now <Icon name="next" />
          </button>
        }
      />
      <div className="body">
        <section className="hero">
          <DecoChips variant="sides" />
          <div className="hero-copy">
            <p className="eyebrow">The UK card-shedding table</p>
            <h1 className="title">
              Play Blackjack.
              <br />
              Dump Your Hand.
            </h1>
            <p className="subtitle">Match suit or rank, play runs and power cards, and be first to empty your hand. Free to play, no sign-up.</p>
            <button className="pill primary big" data-testid="play-now" onClick={go} disabled={busy}>
              {busy ? 'Dealing...' : 'Play Now'} <Icon name="next" />
            </button>
            <p className="micro">vs 1 bot, instantly</p>
          </div>
          <div className="hero-stage">
            <HeroCards />
            <TableArc />
          </div>
        </section>

        <section className="feature-bar" aria-label="Highlights">
          <div className="fb">
            <Icon name="cards" />
            <span>
              <strong>Classic Shedding</strong>
              <small>The UK card game you know and love.</small>
            </span>
          </div>
          <div className="fb">
            <Icon name="bolt" />
            <span>
              <strong>Play Instantly</strong>
              <small>One tap, one bot, no sign-up.</small>
            </span>
          </div>
          <div className="fb">
            <Icon name="users" />
            <span>
              <strong>Play with Friends</strong>
              <small>Private rooms through a shared link.</small>
            </span>
          </div>
          <div className="fb">
            <Icon name="shield" />
            <span>
              <strong>Fair Shuffles</strong>
              <small>Cryptographically random deals.</small>
            </span>
          </div>
        </section>

        <section className="sec lobby-sec" id="modes">
          <p className="eyebrow">Choose a table</p>
          <h2 className="title h2">Game Lobby</h2>
          <p className="subtitle">Jump in against bots or set up a private table.</p>
          <div className="rows">
            <Panel icon="spade" title="Quick Game" text="Face one bot, dealt in instantly" onClick={go} />
            <Panel icon="bot" title="Play AI" text="Take on one to five bots, pick your house rules" onClick={() => navigate('/ai')} testid="play-ai" />
            <Panel icon="users" title="Play Friends" text="Private room for 2 to 6, share a link" onClick={() => navigate('/friends')} testid="play-friends" lock />
            <Panel icon="hash" title="Join with Code" text="Got a five-letter room code?" onClick={() => navigate('/friends')} />
          </div>
          <button className="pill secondary" data-testid="how-to-play" onClick={() => navigate('/how-to-play')}>
            <Icon name="help" /> How to Play
          </button>
          {identity && (
            <button className="profile-chip" onClick={() => navigate('/profile')} aria-label={`Edit profile: ${identity.name}`} data-testid="profile-chip">
              <Avatar avatar={identity.avatar} size={28} />
              <span>{identity.name}</span>
            </button>
          )}
        </section>

        <section className="sec steps-sec">
          <p className="eyebrow">Get in the game</p>
          <h2 className="title h2">How It Works</h2>
          <p className="subtitle">From name to first card in three simple steps.</p>
          <div className="rows cols3">
            <Panel icon="user" title="1. Pick a name" text="Choose a nickname and avatar. No account needed." go={false} />
            <Panel icon="cards" title="2. Start a game" text="Play a bot, or send friends a room link." go={false} />
            <Panel icon="spade" title="3. Dump your hand" text="Match suit or rank, play runs and declare JAKK before you go out." go={false} />
          </div>
          <button className="pill primary" onClick={go} disabled={busy}>
            Play Now <Icon name="next" />
          </button>
        </section>

        <section className="sec why-sec">
          <p className="eyebrow">Built for the table</p>
          <h2 className="title h2">Why Crypto Jakk</h2>
          <p className="subtitle">A quick, friendly card game with a modern look.</p>
          <div className="whys">
            <div className="why">
              <Icon name="spade" />
              <span>
                <strong>Classic Gameplay</strong>
                <small>Match the top card, empty your hand. Easy to learn, hard to put down.</small>
              </span>
            </div>
            <div className="why">
              <Icon name="bolt" />
              <span>
                <strong>Power Cards</strong>
                <small>2s, Jacks, 8s, Kings, Queens and wild Aces, plus runs and same-rank sets, keep every turn lively.</small>
              </span>
            </div>
            <div className="why">
              <Icon name="phone" />
              <span>
                <strong>Play Anywhere</strong>
                <small>Phone, tablet or desktop, with keyboard shortcuts at the table.</small>
              </span>
            </div>
            <div className="why">
              <Icon name="shield" />
              <span>
                <strong>A Fair Game</strong>
                <small>Shuffles use a secure random number generator, and the rules are public.</small>
              </span>
            </div>
          </div>
        </section>

        <section className="sec faq-sec" id="faq">
          <p className="eyebrow">Quick answers</p>
          <h2 className="title h2">Frequently Asked Questions</h2>
          <Faq />
        </section>

        <section className="sec cta-sec">
          <HeroCards className="small" />
          <h2 className="title h2">Ready to Play?</h2>
          <p className="subtitle">Jump in against a bot, or invite friends to a private table. It is free.</p>
          <button className="pill primary big" onClick={go} disabled={busy}>
            Play Now <Icon name="next" />
          </button>
          <div className="cta-foot">
            <span>
              <Icon name="info" /> A free card game. No sign-up and no money involved.
            </span>
            <LogoTile />
          </div>
        </section>
      </div>
      <DecoChips variant="bottom" />
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
  const muted = useMuted();
  const reduce = useReduce();
  const clean = sanitizeName(name);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clean) return;
    setIdentity({ name: clean, avatar: { emoji, color } });
    onDone?.();
  };
  return (
    <form className="screen page guest" onSubmit={submit}>
      <AppHeader onBack={() => navigate('/')} backLabel={mode === 'edit' ? 'Back' : 'Home'} />
      <div className="body narrow">
        {invite && (
          <p className="invite-note">
            You're invited to room <b>{invite}</b>
          </p>
        )}
        <p className="eyebrow">{mode === 'edit' ? 'Your details' : 'Step 1 of 1'}</p>
        <h1 className="title h2">{mode === 'edit' ? 'Profile & Settings' : "Who's Playing?"}</h1>
        <p className="subtitle">{mode === 'edit' ? 'Change how you appear at the table and tune the game to your liking.' : 'Pick a name and an avatar. No account needed.'}</p>
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
        {mode === 'edit' && (
          <div className="rows settings" aria-label="Settings">
            <label className="row toggle">
              <Icon name={muted ? 'mute' : 'sound'} className="row-ico" />
              <span className="row-t">
                <strong>Sound</strong>
                <small>Card sounds and turn alerts</small>
              </span>
              <input type="checkbox" role="switch" checked={!muted} onChange={(e) => setMuted(!e.target.checked)} data-testid="sound-toggle" />
              <i className="switch" aria-hidden="true" />
            </label>
            <label className="row toggle">
              <Icon name="motion" className="row-ico" />
              <span className="row-t">
                <strong>Reduce animation</strong>
                <small>Skip card flights, floating decoration and callouts</small>
              </span>
              <input type="checkbox" role="switch" checked={reduce} onChange={(e) => setReduce(e.target.checked)} data-testid="reduce-toggle" />
              <i className="switch" aria-hidden="true" />
            </label>
          </div>
        )}
        <button className="pill primary big wide" type="submit" disabled={!clean} data-testid="guest-continue">
          {mode === 'edit' ? 'Save' : 'Continue'} <Icon name="next" />
        </button>
        <p className="quiet">No account needed. Your name and a secret seat key live only in this browser, so clearing your browser data removes them.</p>
      </div>
      <DecoChips variant="bottom" />
    </form>
  );
}

// ------------------------------------------------------------------ friends

/** Shown on every friends screen when the multiplayer server cannot be reached. Solo play is unaffected. */
export function MultiplayerOffline({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="offline-panel" role="alert" data-testid="mp-offline">
      <p className="eyebrow">Connection</p>
      <p className="title h3">Multiplayer is offline right now</p>
      <p className="subtitle">We couldn't reach the game server. Playing against bots still works anywhere, even without a connection.</p>
      <div className="stack">
        <button className="pill primary" data-testid="mp-retry" onClick={onRetry}>
          Retry <Icon name="next" />
        </button>
        <button className="pill secondary" data-testid="mp-play-ai" onClick={() => navigate('/ai')}>
          Play vs AI instead
        </button>
        <button className="pill secondary" onClick={() => navigate('/')}>
          Home
        </button>
      </div>
    </div>
  );
}

const JOIN_MESSAGES: Record<string, string> = {
  ROOM_NOT_FOUND: "We couldn't find that room. It may have expired. Check the code or ask for a fresh link.",
  ROOM_FULL: 'That room is full (6 players).',
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
    <div className="screen page friends friends-page">
      <AppHeader onBack={() => navigate('/')} backLabel="Home" />
      <div className="body">
      <p className="eyebrow">Private tables</p>
      <h1 className="title h2">Play Friends</h1>
      {conn === 'unavailable' ? (
        <MultiplayerOffline onRetry={retryMultiplayer} />
      ) : (
        <>
      <p className="subtitle">Start a private room and send the link, or jump into one with a code.</p>
      <div className="friends-grid">
        <section className="fcard create">
          <h2 className="fcard-h">Start a room</h2>
          <p className="fcard-p">You get a code and a link to send. Choose house rules, add bots to fill empty seats (2 to 6 players), then deal.</p>
          <button
            className="pill primary wide"
            data-testid="create-room"
            disabled={busy}
            onClick={() => {
              unlockAudio();
              setBusy(true);
              createFriendsRoom();
              setTimeout(() => setBusy(false), 3000);
            }}
          >
            {busy && conn !== 'open' ? 'Connecting...' : 'Create room'} <Icon name="next" />
          </button>
        </section>
        <div className="or">
          <span>or join with a code</span>
        </div>
        <section className="fcard join">
          <h2 className="fcard-h">Join a room</h2>
          <p className="fcard-p">Got a code from a friend? Type it in, or paste the whole invite link.</p>
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
            <button className="pill secondary" type="submit" disabled={cleaned.length < 5 || joining} data-testid="join-btn">
              {joining ? 'Joining...' : 'Join'}
            </button>
          </form>
          {cleaned.length === 5 && !valid && <p className="error-text">Room codes never contain 0, O, 1 or I. Double-check the code.</p>}
          {joinError && (
            <p className="error-text" role="alert" data-testid="join-error">
              {joinErrorText(joinError.code, joinError.message)}
            </p>
          )}
        </section>
      </div>
        </>
      )}
      </div>
      <DecoChips variant="bottom" />
    </div>
  );
}

// ------------------------------------------------------------------ play AI

const AI_SETUP_KEY = 'cj.aiSetup';
interface AiSetup {
  n: number;
  houseRules: HouseRules;
  options: MatchOptions;
}
function loadAiSetup(): AiSetup {
  const def: AiSetup = { n: 2, houseRules: houseRulesOf(DEFAULT_RULES), options: { ...DEFAULT_MATCH_OPTIONS } };
  try {
    const o = JSON.parse(readStore(AI_SETUP_KEY) ?? 'null') as Partial<AiSetup> | null;
    if (!o) return def;
    const hr = { ...def.houseRules };
    for (const k of Object.keys(hr) as Array<keyof HouseRules>) if (typeof o.houseRules?.[k] === 'boolean') hr[k] = o.houseRules[k] as boolean;
    const hands = [1, 3, 5].includes(o.options?.handsToWin as number) ? (o.options?.handsToWin as MatchOptions['handsToWin']) : 1;
    const n = Number.isInteger(o.n) && (o.n as number) >= 1 && (o.n as number) <= MAX_BOTS_AI_MODE ? (o.n as number) : 2;
    return { n, houseRules: hr, options: { handsToWin: hands, turnSeconds: 0 } };
  } catch {
    return def;
  }
}

export function PlayAI() {
  const [setup, setSetup] = useState<AiSetup>(loadAiSetup);
  const [busy, setBusy] = useState(false);
  const { n, houseRules, options } = setup;
  const update = (p: Partial<AiSetup>) =>
    setSetup((cur) => {
      const next = { ...cur, ...p };
      writeStore(AI_SETUP_KEY, JSON.stringify(next));
      return next;
    });
  return (
    <div className="screen page friends ai-page">
      <AppHeader onBack={() => navigate('/')} backLabel="Home" />
      <div className="body narrow wide-ai">
        <p className="eyebrow">Solo table</p>
        <h1 className="title h2">Play AI</h1>
        <p className="subtitle">How many bots do you want to beat?</p>
        <div className="seg five" role="radiogroup" aria-label="Number of opponents">
          {[1, 2, 3, 4, 5].map((k) => (
            <button key={k} role="radio" aria-checked={n === k} className={`seg-opt ${n === k ? 'on' : ''}`} onClick={() => update({ n: k })} data-testid={`bots-${k}`}>
              <strong>{k}</strong>
              <span>{k === 1 ? 'bot' : 'bots'}</span>
            </button>
          ))}
        </div>
        <div className="seat-preview" aria-hidden="true">
          {Array.from({ length: n }, (_, i) => (
            <span key={i} className="sp-bot">
              <Icon name="bot" />
            </span>
          ))}
          <span className="sp-you">You</span>
        </div>
        <section className="ai-opts" aria-label="Match options and house rules">
          <h2 className="opt-title">Match options</h2>
          <OptionsEditor
            houseRules={houseRules}
            options={options}
            editable
            showTimer={false}
            onHouseRules={(p) => update({ houseRules: { ...houseRules, ...p } })}
            onOptions={(p) => update({ options: { ...options, ...p } })}
          />
          <p className="opt-note">The turn timer is for friends rooms. Bots play at their own pace.</p>
        </section>
        <div className="sticky-cta">
          <button
            className="pill primary big wide"
            data-testid="start-ai"
            disabled={busy}
            onClick={() => {
              unlockAudio();
              setBusy(true);
              playAI(n, houseRules, { handsToWin: options.handsToWin });
              setTimeout(() => setBusy(false), 1500);
            }}
          >
            Start game <Icon name="next" />
          </button>
        </div>
      </div>
      <DecoChips variant="bottom" />
    </div>
  );
}

/** Shown when the server speaks a newer protocol than this page. */
export function UpdateScreen() {
  return (
    <div className="screen page update-screen" data-testid="update-screen" role="alert">
      <div className="body narrow center">
        <p className="eyebrow">New version</p>
        <h1 className="title h2">Please refresh</h1>
        <p className="subtitle">A new version of Crypto Jakk is available. Refresh the page to keep playing with your friends.</p>
        <div className="stack">
          <button className="pill primary big" data-testid="reload" onClick={() => location.reload()}>
            Refresh now <Icon name="next" />
          </button>
        </div>
        <p className="quiet">Games against bots on this device are not affected.</p>
      </div>
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
    <div className="screen page join-flow">
      <AppHeader onBack={() => navigate('/')} backLabel="Home" />
      <div className="body narrow center">
      {conn === 'unavailable' ? (
        <MultiplayerOffline onRetry={retry} />
      ) : !code ? (
        <>
          <p className="error-text big">That invite link doesn't look right.</p>
          <button className="pill secondary" onClick={() => navigate('/friends')}>
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
              <button className="pill secondary" onClick={retry}>
                Try again
              </button>
            )}
            <button className="pill primary" onClick={() => navigate('/friends')}>
              Create your own room
            </button>
            <button className="pill secondary" onClick={() => navigate('/')}>
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
      <DecoChips variant="bottom" />
    </div>
  );
}
