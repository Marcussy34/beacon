// Tests for pid-tty.ts — must never reject, even when execFile throws synchronously.
import { describe, it, expect, vi } from 'vitest';

// Defect 1: execFile throwing synchronously must not cause resolvePidTty to reject.
// Mock before the dynamic import so the module uses the mocked version.
vi.mock('node:child_process', () => ({ execFile: vi.fn(() => { throw new Error('spawn EPERM'); }) }));

const { resolvePidTty } = await import('../../extension/src/pid-tty');

describe('resolvePidTty', () => {
  it('resolves null (never rejects) when execFile throws synchronously', async () => {
    await expect(resolvePidTty(123)).resolves.toBe(null);
  });
});
