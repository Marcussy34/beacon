import { describe, it, expect } from 'vitest';
import { summarize } from '../../src/domain/summarize';

describe('summarize', () => {
  it('passes through a short prompt unchanged', () => {
    expect(summarize('fix the login bug')).toBe('fix the login bug');
  });
  it('keeps the first 5 words and adds an ellipsis when longer', () => {
    expect(summarize('add a dark mode toggle to settings')).toBe('add a dark mode toggle…');
  });
  it('collapses whitespace and newlines', () => {
    expect(summarize('  refactor\n\n  the   parser  ')).toBe('refactor the parser');
  });
  it('hard-caps a very long single word', () => {
    const long = 'a'.repeat(80);
    expect(summarize(long).length).toBeLessThanOrEqual(48);
    expect(summarize(long).endsWith('…')).toBe(true);
  });
  it('returns empty string for empty/whitespace input', () => {
    expect(summarize('   \n ')).toBe('');
    expect(summarize('')).toBe('');
  });
});
