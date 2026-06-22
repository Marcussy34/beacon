import { describe, it, expect } from 'vitest';
import { SessionStore } from '../../src/domain/store';
import { parseHookEvent } from '../../src/domain/parser';
import type { RawHookEvent, RolloutInfo } from '../../src/domain/types';

// A Codex hook event keyed on its ancestor (temp id), no codexSessionId yet.
function codexEvent(over: Partial<RawHookEvent> = {}): RawHookEvent {
  return {
    tool: 'codex', event: 'SessionStart', cwd: '/Users/m/proj', gitRoot: '/Users/m/proj',
    host: 'terminal', remote: 'none', tty: '/dev/ttys009',
    codexAncestorPid: 4242, codexAncestorStartTime: 'StartA', ts: 1_750_000_000_000, ...over,
  };
}
const rollout: RolloutInfo = { codexSessionId: 'uuid-1', gitRoot: '/Users/m/proj', startedAt: 1_750_000_003_000 };

describe('SessionStore.reconcileCodex', () => {
  it('stamps codexSessionId + display id on the matching temp session, keeping the tempId key', () => {
    const store = new SessionStore();
    const s = store.upsertFromEvent(parseHookEvent(codexEvent()));
    const tempId = s.tempId;
    expect(s.codexSessionId).toBeUndefined();

    const r = store.reconcileCodex(rollout);
    expect(r).toBeDefined();
    expect(r!.codexSessionId).toBe('uuid-1');
    expect(r!.id).toBe('codex:uuid-1');
    // still reachable by the ORIGINAL tempId key (reconcile does not change the map key)
    expect(store.get(tempId)!.codexSessionId).toBe('uuid-1');
    expect(store.get(tempId)!.tempId).toBe(tempId);
  });

  it('mark-seen and badge keep working by tempId after reconcile', () => {
    const store = new SessionStore();
    const s = store.upsertFromEvent(parseHookEvent(codexEvent({ event: 'PermissionRequest' })));
    const tempId = s.tempId;
    expect(store.attentionCount()).toBe(1); // needs-you, unseen
    store.reconcileCodex(rollout);
    store.markSeen(tempId);
    expect(store.get(tempId)!.seen).toBe(true);
    expect(store.attentionCount()).toBe(0);
  });

  it('returns undefined when no session matches, and never touches non-matching sessions', () => {
    const store = new SessionStore();
    store.upsertFromEvent(parseHookEvent(codexEvent({ gitRoot: '/other/repo', cwd: '/other/repo' })));
    expect(store.reconcileCodex(rollout)).toBeUndefined();
  });

  it('is idempotent: a second reconcile with the same rollout matches nothing new', () => {
    const store = new SessionStore();
    store.upsertFromEvent(parseHookEvent(codexEvent()));
    expect(store.reconcileCodex(rollout)).toBeDefined();
    expect(store.reconcileCodex(rollout)).toBeUndefined(); // already reconciled -> no re-match
  });

  it('never merges two unrelated same-repo sessions: reconciles only one per rollout', () => {
    const store = new SessionStore();
    const a = store.upsertFromEvent(parseHookEvent(codexEvent({ codexAncestorPid: 1, codexAncestorStartTime: 'A', tty: '/dev/ttys001' })));
    const b = store.upsertFromEvent(parseHookEvent(codexEvent({ codexAncestorPid: 2, codexAncestorStartTime: 'B', tty: '/dev/ttys002' })));
    expect(a.tempId).not.toBe(b.tempId);
    store.reconcileCodex(rollout);
    const reconciledCount = store.all().filter(s => s.codexSessionId === 'uuid-1').length;
    expect(reconciledCount).toBe(1); // exactly one gets the id; the other stays temp
  });
});
