import type { Session, BeaconEvent, RolloutInfo } from './types';
import { applyEvent } from './state-machine';
import { matchesRollout, reconcile } from './identity';

export interface SessionsSnapshot {
  version: 1;
  sessions: Session[];
}

function newSession(event: BeaconEvent): Session {
  return {
    id: event.key,
    tempId: event.key,
    tool: event.tool,
    claudeSessionId: event.claudeSessionId,
    codexSessionId: undefined,
    repoPath: event.cwd,
    gitRoot: event.gitRoot,
    repoName: event.repoName,
    host: event.host,
    termSessionId: event.termSessionId,
    tty: event.tty,
    remote: event.remote,
    gotoPrecision: event.gotoPrecision,
    state: 'started',
    attention: 'none',
    seen: true,
    startedAt: event.ts,
    lastEventAt: event.ts,
  };
}

/**
 * In-memory session map, keyed by `tempId` (= the event key from identity.eventKey).
 * The `tempId` is stable for a session's whole life; reconcile only updates the DISPLAY `id`
 * (+ codexSessionId). All lookups (get/markSeen) use `tempId`/key — `id` is display-only, so
 * there is intentionally no id->tempId index. M3 addresses sessions by `tempId`.
 */
export class SessionStore {
  private map = new Map<string, Session>();

  upsertFromEvent(event: BeaconEvent): Session {
    const existing = this.map.get(event.key) ?? newSession(event);
    const updated = applyEvent(existing, event);
    this.map.set(event.key, updated);
    return updated;
  }

  /**
   * Reconcile a Codex temp session against a rollout's session_meta. Finds the FIRST un-reconciled
   * Codex session matching the rollout (gitRoot + start-time within tolerance, via matchesRollout),
   * stamps its codexSessionId + display id, and stores it under the SAME map key (tempId is stable).
   * Returns the reconciled session, or undefined if nothing matched. Idempotent (an already-reconciled
   * session no longer matches) and never merges: at most one session is reconciled per rollout.
   */
  reconcileCodex(rollout: RolloutInfo): Session | undefined {
    for (const s of this.map.values()) {
      if (matchesRollout(s, rollout)) {
        const reconciled = reconcile(s, rollout);
        this.map.set(s.tempId, reconciled); // map key = tempId, unchanged by reconcile
        return reconciled;
      }
    }
    return undefined;
  }

  get(key: string): Session | undefined {
    return this.map.get(key);
  }

  all(): Session[] {
    return [...this.map.values()];
  }

  markSeen(key: string): void {
    const s = this.map.get(key);
    if (s) this.map.set(key, { ...s, seen: true, attention: 'none' });
  }

  clearAll(): void {
    this.map.clear();
  }

  /** Remove one session by key (the per-row ×). Returns true if a session was removed. */
  dismiss(key: string): boolean {
    return this.map.delete(key);
  }

  /**
   * Remove stale sessions. "Stale" = SILENT (no events) past a threshold AND not awaiting the user:
   * unseen needs-you / unseen done are protected and never time-evicted. closed → closedTtlMs,
   * everything else (working/started, or an acknowledged needs-you/done) → deadTtlMs.
   * Returns true if anything was removed.
   */
  sweepStale(now: number, closedTtlMs: number, deadTtlMs: number): boolean {
    let changed = false;
    for (const [k, s] of this.map) {
      if (this.isStale(s, now, closedTtlMs, deadTtlMs)) { this.map.delete(k); changed = true; }
    }
    return changed;
  }

  private isStale(s: Session, now: number, closedTtlMs: number, deadTtlMs: number): boolean {
    if (s.attention !== 'none' && !s.seen) return false; // awaiting you — protected
    const silent = now - s.lastEventAt;
    return s.state === 'closed' ? silent > closedTtlMs : silent > deadTtlMs;
  }

  attentionCount(): number {
    return this.all().filter((s) => s.attention !== 'none' && !s.seen).length;
  }

  toJSON(): SessionsSnapshot {
    return { version: 1, sessions: this.all() };
  }

  static fromJSON(snap: SessionsSnapshot): SessionStore {
    const store = new SessionStore();
    for (const s of snap.sessions) store.map.set(s.tempId, s);
    return store;
  }
}
