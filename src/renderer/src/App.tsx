import { useEffect, useState } from 'react';
import {
  SquareTerminal, CircleHelp,
  AlertTriangle, ArrowRight, Check, X, ChevronDown, ChevronUp,
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
      dismiss(tempId: string): Promise<void>;
      move(tempId: string, group: 'needsYou' | 'done'): Promise<void>;
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

// Official brand marks (simple-icons, single-path). Fill from `currentColor` so they
// inherit the same zinc tint / theme as the Lucide icons they replaced.
function ClaudeMark({ className, label }: { className?: string; label?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" role="img" aria-label={label}>
      <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" />
    </svg>
  );
}

function OpenAIMark({ className, label }: { className?: string; label?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" role="img" aria-label={label}>
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  );
}

function VSCodeMark({ className, label }: { className?: string; label?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" role="img" aria-label={label}>
      <path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z" />
    </svg>
  );
}

function CursorMark({ className, label }: { className?: string; label?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" role="img" aria-label={label}>
      <path d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23" />
    </svg>
  );
}

function ToolIcon({ tool }: { tool: Session['tool'] }) {
  const cls = 'h-3.5 w-3.5 text-zinc-400';
  return tool === 'codex'
    ? <OpenAIMark className={cls} label="codex" />
    : <ClaudeMark className={cls} label="claude" />;
}

function HostIcon({ host }: { host: Session['host'] }) {
  const cls = 'h-3.5 w-3.5 text-zinc-400';
  // VS Code & Cursor get their real brand marks; Terminal.app / unknown stay on Lucide glyphs.
  if (host === 'vscode') return <VSCodeMark className={cls} label="vscode" />;
  if (host === 'cursor') return <CursorMark className={cls} label="cursor" />;
  const Icon = host === 'terminal' ? SquareTerminal : CircleHelp;
  return <Icon className={cls} aria-label={host} />;
}

function Row({ session, dot, onToast }: {
  session: Session; dot: string; onToast: (m: string) => void;
}) {
  const showSeen = session.attention !== 'none' && !session.seen;
  // Grouping is by state: a waiting row lives in Needs-you, a done row in Done. Offer the inverse move.
  const moveTarget: 'done' | 'needsYou' | null =
    session.state === 'waiting' ? 'done' : session.state === 'done' ? 'needsYou' : null;
  const go = async () => {
    const res = await window.beacon.goto(session.tempId);
    if (!res.ok) onToast(res.message);
  };
  return (
    <li className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
      <span className={`h-2 w-2 shrink-0 rounded-full ${showSeen ? dot : 'bg-zinc-700'}`} />
      <ToolIcon tool={session.tool} />
      {/* Repo name + a dimmed summary line stack vertically; this flex-1 column pushes the
          right cluster (move / time / buttons) to the edge, so no ml-auto is needed. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-zinc-100">{session.repoName}</span>
          <HostIcon host={session.host} />
          {session.gotoPrecision === 'degraded' && (
            <Badge variant="outline" className="text-amber-400">
              <AlertTriangle className="h-2.5 w-2.5" />degraded
            </Badge>
          )}
        </div>
        {session.summary && (
          // "What this session is about" — the latest prompt, trimmed to ~5 words.
          <span className="truncate text-xs text-zinc-500">{session.summary}</span>
        )}
      </div>
      {moveTarget && (
        <Button variant="ghost" size="icon"
          aria-label={moveTarget === 'done' ? 'Move to Done' : 'Move to Needs you'}
          className="app-no-drag h-6 w-6 text-zinc-500 opacity-0 transition-opacity hover:text-zinc-200 group-hover:opacity-100"
          onClick={() => window.beacon.move(session.tempId, moveTarget)}>
          {moveTarget === 'done' ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </Button>
      )}
      <span className="shrink-0 text-xs tabular-nums text-zinc-500">
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
      <Button variant="ghost" size="icon" aria-label="Dismiss"
        className="app-no-drag h-6 w-6 text-zinc-500 opacity-0 transition-opacity hover:text-zinc-200 group-hover:opacity-100"
        onClick={() => window.beacon.dismiss(session.tempId)}>
        <X className="h-3.5 w-3.5" />
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
          // Divider above Working: splits the attention section (Needs you + Done) from the
          // in-progress rows. Only when something is actually rendered above it.
          const divider = key === 'working' && (groups.needsYou.length > 0 || groups.done.length > 0);
          return (
            // mb-5 gives an even ~20px gap between every group; the divider's pt-5 matches that
            // previous gap so the line sits symmetrically (equal space above and below).
            <section key={key} className={`mb-5${divider ? ' border-t border-white/10 pt-5' : ''}`}>
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
