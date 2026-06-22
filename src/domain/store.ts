import type { Session, BeaconEvent } from './types';
import { applyEvent } from './state-machine';

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

export class SessionStore {
  private map = new Map<string, Session>();

  upsertFromEvent(event: BeaconEvent): Session {
    const existing = this.map.get(event.key) ?? newSession(event);
    const updated = applyEvent(existing, event);
    this.map.set(event.key, updated);
    return updated;
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

  evictStale(now: number, ttlMs: number): void {
    for (const [k, s] of this.map) {
      if (s.state === 'closed' && now - s.lastEventAt > ttlMs) this.map.delete(k);
    }
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
