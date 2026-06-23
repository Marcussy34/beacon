// Compact, glanceable age of an epoch-ms timestamp ("just now", "5m", "2h", "3d").
// Pure: callers pass `now` so it is deterministic and unit-testable.
export function relativeTime(ts: number, now: number): string {
  const sec = Math.floor((now - ts) / 1000);
  if (sec < 60) return 'just now';           // also covers future timestamps (negative delta)
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}
