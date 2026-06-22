import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, openSync, closeSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJsonOrDefault, writeJsonAtomic } from '../../src/installer/atomic-file';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'beacon-atomic-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('readJsonOrDefault', () => {
  it('returns the fallback when the file is missing', () => {
    expect(readJsonOrDefault(join(dir, 'nope.json'), { hooks: {} })).toEqual({ hooks: {} });
  });
  it('returns the fallback when the file is empty/whitespace', () => {
    const p = join(dir, 'empty.json'); writeFileSync(p, '   \n');
    expect(readJsonOrDefault(p, { a: 1 })).toEqual({ a: 1 });
  });
  it('parses valid JSON', () => {
    const p = join(dir, 'ok.json'); writeFileSync(p, '{"x":42}');
    expect(readJsonOrDefault(p, {})).toEqual({ x: 42 });
  });
  it('throws (does NOT return fallback) on malformed JSON', () => {
    const p = join(dir, 'bad.json'); writeFileSync(p, '{not json');
    expect(() => readJsonOrDefault(p, {})).toThrow(/not valid JSON/i);
  });
});

describe('writeJsonAtomic', () => {
  it('writes pretty JSON with a trailing newline and re-reads equal', () => {
    const p = join(dir, 'out.json');
    writeJsonAtomic(p, { hooks: { Stop: [] } });
    const text = readFileSync(p, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual({ hooks: { Stop: [] } });
  });
  it('backs up an existing file to .beacon-backup-<now>', () => {
    const p = join(dir, 'cfg.json'); writeFileSync(p, '{"old":true}');
    const { backupPath } = writeJsonAtomic(p, { new: true }, { now: 123 });
    expect(backupPath).toBe(`${p}.beacon-backup-123`);
    expect(JSON.parse(readFileSync(backupPath!, 'utf8'))).toEqual({ old: true });
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual({ new: true });
  });
  it('does not back up when the file does not yet exist', () => {
    const p = join(dir, 'fresh.json');
    const { backupPath } = writeJsonAtomic(p, { a: 1 });
    expect(backupPath).toBeUndefined();
  });
  it('writes with 0600 permissions', () => {
    const p = join(dir, 'perm.json');
    writeJsonAtomic(p, { a: 1 });
    expect(statSync(p).mode & 0o777).toBe(0o600);
  });
  it('aborts when a lock is already held', () => {
    const p = join(dir, 'locked.json');
    const fd = openSync(`${p}.beacon-lock`, 'wx'); // pre-hold the lock
    try {
      expect(() => writeJsonAtomic(p, { a: 1 })).toThrow(/in progress/i);
    } finally { closeSync(fd); }
  });
  it('leaves no .beacon-tmp / .beacon-lock residue after success', () => {
    const p = join(dir, 'clean.json');
    writeJsonAtomic(p, { a: 1 });
    const leftovers = readdirSync(dir).filter(f => f.includes('.beacon-tmp') || f.includes('.beacon-lock'));
    expect(leftovers).toEqual([]);
  });
});
