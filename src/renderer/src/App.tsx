import { useEffect, useState } from 'react';
import {
  Sparkles, Braces, Code2, MousePointer2, SquareTerminal, CircleHelp,
  AlertTriangle, ArrowRight, Check, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { relativeTime } from '@/lib/relative-time';
import { groupSessions, type GroupedSessions } from '../../core/view-model';
import type { Session } from '../../domain/types';

// The renderer addresses sessions by `tempId` (the store's stable map key), NOT `id`
// (display-only; for a reconciled Codex session id=codex:<uuid> diverges from tempId).
interface Snap { version: number; sessions: Session[]; }
declare global {
  interface Window {
    beacon: {
      getSnapshot(): Promise<Snap>;
      markSeen(tempId: string): Promise<void>;
      goto(tempId: string): Promise<{ ok: boolean; message: string }>;
      hide(): Promise<void>;
      onUpdate(cb: (s: Snap) => void): () => void;
    };
  }
}

const EMPTY: Snap = { version: 1, sessions: [] };

// Display order + heading + status-dot color. Keys match GroupedSessions.
// Needs-you stays pinned on top (urgent — the menu-bar badge fires for it); the rest run
// Done → Working → Recently closed per request.
const GROUPS: ReadonlyArray<{ key: keyof GroupedSessions; label: string; dot: string }> = [
  { key: 'needsYou', label: 'Needs you', dot: 'bg-red-500' },
  { key: 'done', label: 'Done', dot: 'bg-sky-500' },
  { key: 'working', label: 'Working', dot: 'bg-emerald-500' },
  { key: 'closed', label: 'Recently closed', dot: 'bg-zinc-500' },
];

function ToolIcon({ tool }: { tool: Session['tool'] }) {
  const Icon = tool === 'codex' ? Braces : Sparkles;
  return <Icon className="h-3.5 w-3.5 text-zinc-400" aria-label={tool} />;
}

function HostIcon({ host }: { host: Session['host'] }) {
  const Icon =
    host === 'vscode' ? Code2 :
    host === 'cursor' ? MousePointer2 :
    host === 'terminal' ? SquareTerminal : CircleHelp;
  return <Icon className="h-3.5 w-3.5 text-zinc-400" aria-label={host} />;
}

function Row({ session, dot, onToast }: {
  session: Session; dot: string; onToast: (m: string) => void;
}) {
  const showSeen = session.attention !== 'none' && !session.seen;
  const go = async () => {
    const res = await window.beacon.goto(session.tempId);
    if (!res.ok) onToast(res.message);
  };
  return (
    <li className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
      <span className={`h-2 w-2 shrink-0 rounded-full ${showSeen ? dot : 'bg-zinc-700'}`} />
      <ToolIcon tool={session.tool} />
      <span className="truncate text-sm text-zinc-100">{session.repoName}</span>
      <HostIcon host={session.host} />
      {session.gotoPrecision === 'degraded' && (
        <Badge variant="outline" className="text-amber-400">
          <AlertTriangle className="h-2.5 w-2.5" />degraded
        </Badge>
      )}
      <span className="ml-auto shrink-0 text-xs tabular-nums text-zinc-500">
        {relativeTime(session.lastEventAt, Date.now())}
      </span>
      {showSeen && (
        <Button variant="ghost" size="sm" aria-label="Mark seen"
          onClick={() => window.beacon.markSeen(session.tempId)}>
          <Check className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button variant="secondary" size="sm" onClick={go}>
        Go to<ArrowRight className="h-3 w-3" />
      </Button>
    </li>
  );
}

export function App() {
  const [snap, setSnap] = useState<Snap>(EMPTY);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    window.beacon.getSnapshot().then(setSnap);
    return window.beacon.onUpdate(setSnap);
  }, []);

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 4000);
  };

  const groups = groupSessions(snap.sessions);

  return (
    // The whole card is the drag handle (app-drag) so the entire band above the first group
    // moves the window; the scrollable list and the close button opt out (app-no-drag) so
    // scroll + clicks still register. bg .95 keeps the card near-solid (ChatGPT-style frost).
    <div className="app-drag flex h-full flex-col gap-3 rounded-xl border border-white/10 bg-zinc-900/98 p-3 text-zinc-100 backdrop-blur-xl">
      <header className="flex items-center justify-between gap-2 px-1">
        <span className="text-sm font-semibold">Beacon</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">{snap.sessions.length} session{snap.sessions.length === 1 ? '' : 's'}</span>
          <Button variant="ghost" size="icon" aria-label="Close"
            className="app-no-drag h-6 w-6 text-zinc-400 hover:text-zinc-100"
            onClick={() => window.beacon.hide()}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      <div className="app-no-drag beacon-scroll flex-1 overflow-y-auto pr-1">
        {snap.sessions.length === 0 && (
          <p className="px-2 py-8 text-center text-sm text-zinc-500">No active sessions.</p>
        )}
        {GROUPS.map(({ key, label, dot }) => {
          const items = groups[key];
          if (items.length === 0) return null;
          return (
            <section key={key} className="mb-3">
              <h2 className="mb-1 flex items-center gap-1.5 px-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />{label}
                <span className="text-zinc-600">{items.length}</span>
              </h2>
              <ul>
                {items.map((s) => <Row key={s.tempId} session={s} dot={dot} onToast={showToast} />)}
              </ul>
            </section>
          );
        })}
      </div>

      {toast && (
        <div className="rounded-lg border border-white/10 bg-zinc-800/90 px-3 py-2 text-xs text-zinc-200">
          {toast}
        </div>
      )}
    </div>
  );
}
