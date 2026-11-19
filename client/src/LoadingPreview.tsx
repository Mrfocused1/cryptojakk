// Dev-only design review page at /loading (not reachable in production builds).
import { useState } from 'react';
import { LoadingScreen, LogoLoader } from './Loading';
import { navigate } from './router';

export default function LoadingPreview() {
  const q = new URLSearchParams(location.search);
  const [full, setFull] = useState(q.get('full') !== '0');
  const elapsed = Number(q.get('at') ?? 0) || 0;
  return (
    <>
      {full && <LoadingScreen elapsed={elapsed} onPlayAI={() => navigate('/ai')} />}
      <div className="stack" style={{ position: 'fixed', zIndex: 70, left: 0, right: 0, bottom: 8, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button className="pill secondary sm" onClick={() => setFull(!full)} data-testid="toggle-full">
          {full ? 'Hide' : 'Show'} full screen
        </button>
        <button className="pill primary sm" disabled>
          <LogoLoader size={12} />
        </button>
        <button className="pill secondary sm" disabled>
          <LogoLoader size={11} />
        </button>
        <LogoLoader size={22} />
      </div>
    </>
  );
}
