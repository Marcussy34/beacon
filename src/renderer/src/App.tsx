import { useEffect, useState } from 'react';

// NOTE: actions key on `tempId` (the store's stable map key), NOT `id` (display-only; for a
// reconciled Codex session id=codex:<uuid> diverges from tempId, so id would not resolve).
interface Snap { version: number; sessions: Array<{ id: string; tempId: string; repoName: string; tool: string; state: string; attention: string; seen: boolean }>; }
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
          <li key={s.tempId}>
            <b>{s.repoName}</b> [{s.tool}] {s.state} {s.attention !== 'none' && !s.seen ? '●' : ''}
            {' '}<button onClick={() => window.beacon.goto(s.tempId)}>Go to</button>
            {' '}<button onClick={() => window.beacon.markSeen(s.tempId)}>seen</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
