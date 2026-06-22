import { useEffect, useState } from 'react';

interface Snap { version: number; sessions: Array<{ id: string; repoName: string; tool: string; state: string; attention: string; seen: boolean }>; }
declare global {
  interface Window { beacon: { getSnapshot(): Promise<Snap>; markSeen(k: string): Promise<void>; goto(k: string): Promise<{ ok: boolean; message: string }>; onUpdate(cb: (s: Snap) => void): () => void; }; }
}

export function App() {
  const [snap, setSnap] = useState<Snap>({ version: 1, sessions: [] });
  useEffect(() => { window.beacon.getSnapshot().then(setSnap); return window.beacon.onUpdate(setSnap); }, []);
  return (
    <div style={{ fontFamily: 'system-ui', padding: 12 }}>
      <h3>Beacon — {snap.sessions.length} session(s)</h3>
      <ul>
        {snap.sessions.map((s) => (
          <li key={s.id}>
            <b>{s.repoName}</b> [{s.tool}] {s.state} {s.attention !== 'none' && !s.seen ? '●' : ''}
            {' '}<button onClick={() => window.beacon.goto(s.id)}>Go to</button>
            {' '}<button onClick={() => window.beacon.markSeen(s.id)}>seen</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
