import { describe, it, expect } from 'vitest';
import { relativeTime } from '../../src/renderer/src/lib/relative-time';

const NOW = 1_000_000_000_000; // fixed reference
const ago = (ms: number) => NOW - ms;
const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;

describe('relativeTime', () => {
  it('shows "just now" under a minute', () => {
    expect(relativeTime(ago(0), NOW)).toBe('just now');
    expect(relativeTime(ago(59 * SEC), NOW)).toBe('just now');
  });
  it('shows whole minutes under an hour', () => {
    expect(relativeTime(ago(MIN), NOW)).toBe('1m');
    expect(relativeTime(ago(59 * MIN), NOW)).toBe('59m');
  });
  it('shows whole hours under a day', () => {
    expect(relativeTime(ago(HOUR), NOW)).toBe('1h');
    expect(relativeTime(ago(23 * HOUR), NOW)).toBe('23h');
  });
  it('shows whole days from a day up', () => {
    expect(relativeTime(ago(DAY), NOW)).toBe('1d');
    expect(relativeTime(ago(10 * DAY), NOW)).toBe('10d');
  });
  it('clamps future/negative deltas to "just now"', () => {
    expect(relativeTime(NOW + 5 * MIN, NOW)).toBe('just now');
  });
});
