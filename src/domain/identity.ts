import type { RawHookEvent, RolloutInfo, Session } from './types';

export function eventKey(raw: RawHookEvent): string {
  if (raw.tool === 'claude' && raw.sessionId) return `claude:${raw.sessionId}`;
  const root = raw.gitRoot ?? raw.cwd;
  const pid = raw.codexAncestorPid ?? 0;
  const start = raw.codexAncestorStartTime ?? 'unknown';
  const tty = raw.tty ?? 'notty';
  return `codex:${pid}:${start}:${root}:${tty}`;
}

// M1 → M2 HANDOFF: the three Codex-reconcile helpers below (parseRolloutMeta,
// matchesRollout, reconcile) are unit-proven but NOT yet wired into any caller.
// M2 must add the `~/.codex/sessions/.../rollout-*.jsonl` watcher that invokes
// them, plus a Codex temp-id -> reconcile INTEGRATION test (M1's e2e covers
// Claude only). Note: reconcile only changes the display `id`; the store map key
// is `tempId`, which stays stable across reconcile — so markSeen/badge keep
// working. Decide the id-vs-tempId lookup contract when wiring (id is currently
// display-only; add an id->tempId index if M3 addresses sessions by id).

/** Parse the first JSONL line of a Codex rollout file. Returns null unless it is session_meta. */
export function parseRolloutMeta(firstLine: string): RolloutInfo | null {
  let obj: any;
  try { obj = JSON.parse(firstLine); } catch { return null; }
  if (!obj || obj.type !== 'session_meta' || !obj.payload) return null;
  const id = obj.payload.id;
  const cwd = obj.payload.cwd;
  const ts = obj.timestamp ? Date.parse(obj.timestamp) : NaN;
  if (typeof id !== 'string' || typeof cwd !== 'string' || Number.isNaN(ts)) return null;
  return { codexSessionId: id, gitRoot: cwd, startedAt: ts };
}

export function matchesRollout(session: Session, rollout: RolloutInfo, toleranceMs = 10_000): boolean {
  return session.tool === 'codex'
    && !session.codexSessionId
    && session.gitRoot === rollout.gitRoot
    && Math.abs(session.startedAt - rollout.startedAt) <= toleranceMs;
}

/** Stamp the reconciled Codex session id. The store map key (tempId) does not change. */
export function reconcile(session: Session, rollout: RolloutInfo): Session {
  return { ...session, codexSessionId: rollout.codexSessionId, id: `codex:${rollout.codexSessionId}` };
}
