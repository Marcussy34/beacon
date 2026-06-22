import { describe, it, expect } from 'vitest';
import { parseTty, parsePsRows, findAncestorByComm } from '../../src/hook/proc';

describe('parseTty', () => {
  it('normalizes a bare tty name', () => expect(parseTty('ttys003\n')).toBe('/dev/ttys003'));
  it('passes through an absolute dev path', () => expect(parseTty('/dev/ttys001')).toBe('/dev/ttys001'));
  it('returns undefined for no tty', () => {
    expect(parseTty('?')).toBeUndefined();
    expect(parseTty('   ')).toBeUndefined();
  });
});

describe('parsePsRows + findAncestorByComm', () => {
  // columns: pid ppid lstart(5 fields) comm...
  const out = [
    '6001 5000 Mon Jun 22 20:00:00 2026 codex',
    '6100 6001 Mon Jun 22 20:00:01 2026 node',
    '6200 6100 Mon Jun 22 20:00:02 2026 beacon-hook',
  ].join('\n');

  it('parses rows', () => {
    const rows = parsePsRows(out);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ pid: 6001, ppid: 5000, comm: 'codex' });
    expect(rows[0]!.lstart).toBe('Mon Jun 22 20:00:00 2026');
  });
  it('walks up from the hook pid to the codex ancestor', () => {
    const rows = parsePsRows(out);
    const anc = findAncestorByComm(rows, 6200, 'codex');
    expect(anc!.pid).toBe(6001);
    expect(anc!.lstart).toBe('Mon Jun 22 20:00:00 2026');
  });
  it('returns undefined when no matching ancestor exists', () => {
    const rows = parsePsRows(out);
    expect(findAncestorByComm(rows, 6200, 'claude')).toBeUndefined();
  });
});
