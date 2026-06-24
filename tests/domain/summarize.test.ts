import { describe, it, expect } from 'vitest';
import { summarize } from '../../src/domain/summarize';

describe('summarize', () => {
  it('passes through a short prompt unchanged', () => {
    expect(summarize('fix the login bug')).toBe('fix the login bug');
  });
  it('keeps the full prompt text — no word limit (the UI truncates to window width)', () => {
    expect(summarize('add a dark mode toggle to the settings page and persist it'))
      .toBe('add a dark mode toggle to the settings page and persist it');
  });
  it('collapses whitespace and newlines to a single line', () => {
    expect(summarize('  refactor\n\n  the   parser  ')).toBe('refactor the parser');
  });
  it('hard-caps very long input at the storage bound with an ellipsis', () => {
    const long = 'word '.repeat(200).trim(); // ~1000 chars
    const out = summarize(long);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out.endsWith('…')).toBe(true);
  });
  it('does not append an ellipsis when within the bound', () => {
    const fits = 'a'.repeat(280);
    expect(summarize(fits)).toBe(fits);
    expect(summarize(fits).endsWith('…')).toBe(false);
  });
  it('returns empty string for empty/whitespace input', () => {
    expect(summarize('   \n ')).toBe('');
    expect(summarize('')).toBe('');
  });
});
