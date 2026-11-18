import { Banner, ChipDefs, Toast } from './components';
import { HowToPlayPage } from './HowToPlay';
import { Lobby } from './Lobby';
import { useRoute, navigate } from './router';
import { GuestEntry, JoinFlow, Landing, PlayAI, PlayFriends } from './Screens';
import { useApp } from './store';
import { Table } from './Table';

function Routed() {
  const route = useRoute();
  const { identity } = useApp();
  switch (route.name) {
    case 'how':
      return <HowToPlayPage />;
    case 'profile':
      return <GuestEntry mode="edit" onDone={() => navigate('/')} />;
    case 'friends':
      return identity ? <PlayFriends /> : <GuestEntry mode="new" />;
    case 'ai':
      return <PlayAI />;
    case 'join':
      return identity ? <JoinFlow code={route.code} /> : <GuestEntry mode="new" invite={route.code.toUpperCase().slice(0, 5)} />;
    default:
      return <Landing />;
  }
}

export function App() {
  const { room } = useApp();
  let screen;
  if (room) screen = room.phase === 'lobby' || room.phase === 'rematch' ? <Lobby /> : <Table />;
  else screen = <Routed />;
  return (
    <div className="app">
      <ChipDefs />
      <Banner />
      {screen}
      <Toast />
    </div>
  );
}
