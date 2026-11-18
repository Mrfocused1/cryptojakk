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

export function HowToPlayContent() {
  return (
    <div className="how-c">
    <div className="how">
      <section className="how-goal">
        <h3 className="how-h">The goal</h3>
        <p>
          Everyone starts with {R.handSize} cards. Be the <b>first to get rid of all of yours</b>. The game ends the moment someone plays their last card.
        </p>
      </section>
      <section className="how-turn">
        <h3 className="how-h">On your turn</h3>
        <p>
          Play a card that matches the <b>suit</b> or the <b>rank</b> of the top card on the pile. Can't or don't want to? <b>Draw</b> one card and your turn ends.
        </p>
        <p>
          <b>Several at once:</b> you can play more than one card of the <b>same rank</b> in a single turn. Tap them in the order you want them played. The first must be playable, the last one ends on top.
        </p>
      </section>
      <section className="how-power">
        <h3 className="how-h">Power cards</h3>
        <ul className="how-list">
          <Row cards={['2H', '2S']} title={`2: pick up ${R.twoPenalty}`}>
            The next player picks up {R.twoPenalty}, or answers with another 2 to pass the total on. Only a 2 can answer a 2.
          </Row>
          <Row cards={['JS', 'JC']} title={`Black Jack: pick up ${R.blackJackPenalty}`}>
            Jack of spades or clubs. The next player picks up {R.blackJackPenalty}, or answers with another Jack. Only a Jack can answer a Jack.
          </Row>
          <Row cards={['JH', 'JD']} title="Red Jack: block">
            Played on a Jack penalty it cancels the whole thing. Otherwise it is an ordinary card.
          </Row>
          <Row cards={['8D']} title="8: reverse">
            Play passes the other way round the table. With two players you simply go again.
          </Row>
          <Row cards={['7C']} title="7: skip">
            The next player misses their turn. With two players you go again.
          </Row>
          <Row cards={['AS']} title="Ace: wild">
            Play it on anything (except a penalty) and name the suit that must be played next.
          </Row>
        </ul>
      </section>
      <section className="how-jakk">
        <img className="how-jakk-badge" src="/art/icon-spade.webp" alt="" width="64" height="64" draggable={false} />
        <h3 className="how-h">Say JAKK!</h3>
        <p>
          When you are down to <b>one card</b>, you must say <b>JAKK</b>. Hit the JAKK button <b>before the next player moves</b>: arm it while you play your second-to-last card, or tap it right after. Forget, and you pick up <b>{R.jakkMissPenalty}</b>.
        </p>
      </section>
      <section className="how-pick">
        <h3 className="how-h">Picking up</h3>
        <p>When a penalty is waiting for you, the Draw button turns into <b>Pick up N</b>. Tap it to take the cards and carry on.</p>
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
