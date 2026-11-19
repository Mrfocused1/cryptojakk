import { lazy, Suspense } from 'react';
import { Banner, Toast } from './components';
import { LoadingGate } from './Loading';
import { HowToPlayPage } from './HowToPlay';
import { Lobby } from './Lobby';
import { useRoute, navigate } from './router';
import { GuestEntry, JoinFlow, Landing, PlayAI, PlayFriends, UpdateScreen } from './Screens';
import { useApp } from './store';
import { Table } from './Table';

// Dev-only preview route (tree-shaken from production builds).
const LoadingPreview = import.meta.env.DEV ? lazy(() => import('./LoadingPreview')) : null;

function Routed() {
  const route = useRoute();
  const { identity } = useApp();
  switch (route.name) {
    case 'loading':
      return LoadingPreview ? (
        <Suspense fallback={null}>
          <LoadingPreview />
        </Suspense>
      ) : (
        <Landing />
      );
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
  const { room, unsupported } = useApp();
  let screen;
  if (unsupported) screen = <UpdateScreen />;
  else if (room) screen = room.phase === 'lobby' || room.phase === 'rematch' ? <Lobby /> : <Table />;
  else screen = <Routed />;
  return (
    <div className="app">
      <Banner />
      {screen}
      <Toast />
      <LoadingGate />
    </div>
  );
}
