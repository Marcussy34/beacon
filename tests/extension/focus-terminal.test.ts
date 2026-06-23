import { describe, it, expect } from 'vitest';
import {
  parseFocusTty, normalizeTty, focusTerminalByTty,
  type TerminalLike, type PidTtyResolver,
} from '../../extension/src/focus-terminal';

describe('parseFocusTty', () => {
  it('returns the normalized tty for a /focus uri with an encoded tty', () => {
    expect(parseFocusTty('/focus', 'tty=%2Fdev%2Fttys154')).toBe('/dev/ttys154');
  });
  it('also handles an already-decoded query (VS Code may decode it)', () => {
    expect(parseFocusTty('/focus', 'tty=/dev/ttys154')).toBe('/dev/ttys154');
  });
  it('returns null when the path is not /focus', () => {
    expect(parseFocusTty('/other', 'tty=%2Fdev%2Fttys154')).toBe(null);
  });
  it('returns null when there is no tty param', () => {
    expect(parseFocusTty('/focus', 'foo=bar')).toBe(null);
  });
});

describe('normalizeTty', () => {
  it('passes through a full /dev/ttysNNN path', () => {
    expect(normalizeTty('/dev/ttys154')).toBe('/dev/ttys154');
  });
  it('prefixes a bare ttysNNN', () => {
    expect(normalizeTty('ttys154')).toBe('/dev/ttys154');
  });
  it('expands a ps-style sNNN', () => {
    expect(normalizeTty('s154')).toBe('/dev/ttys154');
  });
  it('trims trailing whitespace from ps output', () => {
    expect(normalizeTty('ttys154\n')).toBe('/dev/ttys154');
  });
});

describe('focusTerminalByTty', () => {
  function term(pid: number | undefined): TerminalLike & { shown: boolean } {
    const t = { processId: Promise.resolve(pid), shown: false, show() { t.shown = true; } };
    return t;
  }
  it('focuses the matching terminal and returns true; leaves others alone', async () => {
    const a = term(1), b = term(2), c = term(3);
    const resolve: PidTtyResolver = async (pid) => (pid === 2 ? '/dev/ttys154' : '/dev/ttys000');
    expect(await focusTerminalByTty('/dev/ttys154', [a, b, c], resolve)).toBe(true);
    expect([a.shown, b.shown, c.shown]).toEqual([false, true, false]);
  });
  it('returns false and focuses nothing when no terminal matches', async () => {
    const a = term(1);
    const resolve: PidTtyResolver = async () => '/dev/ttys999';
    expect(await focusTerminalByTty('/dev/ttys154', [a], resolve)).toBe(false);
    expect(a.shown).toBe(false);
  });
  it('skips a terminal whose pid is undefined, continuing to the next', async () => {
    const a = term(undefined), b = term(2);
    const resolve: PidTtyResolver = async () => '/dev/ttys154';
    expect(await focusTerminalByTty('/dev/ttys154', [a, b], resolve)).toBe(true);
    expect(b.shown).toBe(true);
  });
  it('skips a terminal when the resolver rejects, continuing to the next', async () => {
    const a = term(1), b = term(2);
    const resolve: PidTtyResolver = async (pid) => { if (pid === 1) throw new Error('boom'); return '/dev/ttys154'; };
    expect(await focusTerminalByTty('/dev/ttys154', [a, b], resolve)).toBe(true);
    expect(b.shown).toBe(true);
  });
});
