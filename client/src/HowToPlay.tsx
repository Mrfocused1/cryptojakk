import type { ReactNode } from 'react';
import { type Card, DEFAULT_RULES } from '@shared/engine';
import { CardFace, KeyList } from './components';
import { navigate } from './router';
import { AppHeader, DecoChips } from './components';

const c = (id: string): Card => ({ id, rank: id.slice(0, -1) as Card['rank'], suit: id.slice(-1) as Card['suit'] });
const R = DEFAULT_RULES;

function Row({ cards, title, children }: { cards: string[]; title: string; children: ReactNode }) {
  return (
    <li className="how-row">
      <div className="how-cards">
        {cards.map((id) => (
          <CardFace key={id} card={c(id)} style={{ ['--cw' as string]: '46px' }} />
        ))}
      </div>
      <div>
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
    </li>
  );
}

/** A little strip of real cards with a caption, for the Sequences section. */
function Demo({ cards, ok, caption }: { cards: string[]; ok: boolean; caption: ReactNode }) {
  return (
    <div className={`seq-demo ${ok ? 'ok' : 'no'}`}>
      <div className="seq-cards">
        {cards.map((id, i) => (
          <span key={id} className="seq-c">
            <CardFace card={c(id)} noTag style={{ ['--cw' as string]: '42px' }} />
            <i>{i + 1}</i>
          </span>
        ))}
      </div>
      <p>
        <b>{ok ? 'Yes' : 'No'}</b> {caption}
      </p>
    </div>
  );
}

export function HowToPlayContent() {
  return (
    <div className="how-c">
      <div className="how" data-testid="how-content">
        <section className="how-goal">
          <h3 className="how-h">The goal</h3>
          <p>
            Everyone starts with {R.handSize} cards. Be the <b>first to get rid of all of yours</b>, legally. 2 to 6 players, or 1 to 5 CPU players.
          </p>
        </section>
        <section className="how-turn">
          <h3 className="how-h">On your turn</h3>
          <p>
            Play a card that matches the <b>suit</b> or the <b>rank</b> of the top card. Can't or don't want to? <b>Draw</b> one card and your turn ends. An Ace can start a play on anything (unless a pickup is waiting).
          </p>
          <p>
            The last card you play lands on top and sets the suit for the next player.
          </p>
        </section>
        <section className="how-seq" data-testid="how-sequences">
          <h3 className="how-h">Sequences</h3>
          <p>
            Play <b>several cards in one turn</b>. Each card after the first must connect to the one before it: the <b>same rank</b>, or the <b>same suit one step up or down</b>. Tap the cards in the order you want them played; the numbers show the order.
          </p>
          <div className="seq-grid">
            <Demo cards={['2H', '3H', '4H', '5H']} ok caption="A run: same suit, each one step up. It can go up or down, even change direction." />
            <Demo cards={['9H', '9S', '9C']} ok caption="Same rank, any suits." />
            <Demo cards={['9H', '10S']} ok={false} caption="Different suit and different rank: they don't connect." />
            <Demo cards={['KH', 'AH']} ok={false} caption="The Ace is low: it sits next to 2 only. No King-Ace wrap." />
          </div>
          <p>
            Every special card in the sequence counts: each 8 skips a player, each King flips the direction. A Queen in the middle needs its cover right after it. An Ace in the middle is just an Ace; only an Ace as the <b>last</b> card makes you name a suit.
          </p>
        </section>
        <section className="how-power">
          <h3 className="how-h">Power cards</h3>
          <ul className="how-list">
            <Row cards={['2H', '2S']} title={`2: pick up ${R.twoPenalty}`}>
              The next player picks up {R.twoPenalty}, or answers with another 2 to pass the total on (+2, +4, +6...). A 2 only answers a 2.
            </Row>
            <Row cards={['JS', 'JC']} title={`Black Jack: pick up ${R.blackJackPenalty}`}>
              Jack of spades or clubs. The next player picks up {R.blackJackPenalty}, or answers with another black Jack, or a red Jack.
            </Row>
            <Row cards={['JH', 'JD']} title="Red Jack: block">
              Cancels a Jack pickup you are facing. With no pickup it is an ordinary card.
            </Row>
            <Row cards={['8D']} title="8: skip">
              The next player misses their turn. Two 8s skip two players. With two players you simply go again.
            </Row>
            <Row cards={['KS']} title="King: reverse">
              Play passes the other way round the table. Two Kings cancel out. With two players you go again.
            </Row>
            <Row cards={['QD', 'QC']} title="Queen: cover it">
              A Queen must be covered by the next card of the same play (any card, unless the host chose strict covering). Leave one uncovered and you pick up {R.uncoveredQueenPenalty}. A Queen can never be your winning card.
            </Row>
            <Row cards={['AS']} title="Ace: wild">
              Play it on anything (except a pickup). If it is your last card, name the suit that must be played next.
            </Row>
            <Row cards={['7C']} title="7: ordinary">
              No effect at all. Just a card.
            </Row>
          </ul>
          <p className="how-note">
            <b>Pickups in a sequence:</b> a 2 or black Jack only adds to the pickup if no ordinary card follows it in the same play. 2♥ 3♥ 4♥ leaves nothing; 3♥ 2♥ leaves +2. When a pickup is waiting for you, every card you play must be a defence card, or you take it with the <b>Pick up</b> button.
          </p>
        </section>
        <section className="how-jakk">
          <img className="how-jakk-badge" src="/art/icon-spade.webp" alt="" width="64" height="64" draggable={false} />
          <h3 className="how-h">Say JAKK!</h3>
          <p>
            Declare <b>JAKK</b> <b>before the turn you go out on</b>. Tap JAKK while it is not your turn, or tick it together with your move. It covers <b>your next turn only</b>; if you don't finish on it, it expires and you can declare again.
          </p>
          <p>
            Empty your hand <b>without</b> a live JAKK and the cards stay played, but you pick up <b>{R.finishPenalty}</b> and stay in. The same happens if your last card is a Queen, or (with two players) a King or an 8.
          </p>
        </section>
        <section className="how-run">
          <h3 className="how-h">Running out of cards</h3>
          <p>
            When the draw pile is empty the discard pile (under the top card) is shuffled back in. If there is still nothing to draw, the player with the most cards sits out the rest of the hand and their cards go back into the deck. A tie for most cards ends the hand with no winner.
          </p>
        </section>
        <section className="how-match">
          <h3 className="how-h">Matches and house rules</h3>
          <p>
            The host picks how many hands win the match (1, 3 or 5) and an optional turn timer. When the timer runs out you take the pickup, or draw one. The dealer button moves round the table each hand.
          </p>
          <ul className="how-bullets">
            <li><b>Flexible Queen cover</b> (default on): any card covers a Queen. Off: same suit or another Queen.</li>
            <li><b>Mixed stacking</b> (off): 2s and black Jacks stack on each other and a red Jack cancels any pickup.</li>
            <li><b>Bring Backs</b> (off): go out leaving a pickup and you are only provisionally out. If the pickup travels back to you, you take it and play on.</li>
            <li><b>Finish on power cards</b> (default on): off means you can't win with an Ace, 2, 8, Jack or King.</li>
            <li><b>First Card Active</b> (off): the opening card's power applies to the first player. Otherwise it is neutral.</li>
          </ul>
          <p>Whoever joins a game in progress watches until the next hand. It's free to play; there is no money in the game.</p>
        </section>
        <section className="how-keys">
          <h3 className="how-h">Keyboard</h3>
          <KeyList />
        </section>
      </div>
    </div>
  );
}

export function HowToPlayPage() {
  return (
    <div className="screen page how-page">
      <AppHeader onBack={() => (history.length > 1 ? history.back() : navigate('/'))} />
      <div className="body">
        <p className="eyebrow">The rules</p>
        <h1 className="title h2">How to Play</h1>
        <p className="subtitle">Everything you need to dump your hand first.</p>
        <HowToPlayContent />
      </div>
      <DecoChips variant="bottom" />
    </div>
  );
}
