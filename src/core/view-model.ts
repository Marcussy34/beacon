import type { Session } from '../domain/types';

export function badgeText(count: number): string {
  if (count <= 0) return '';
  return count >= 10 ? '9+' : String(count);
}

export const DONE_RECENT_MS = 30 * 60 * 1000;

export interface GroupedSessions {
  needsYou: Session[]; working: Session[]; done: Session[]; finished: Session[]; closed: Session[];
}

const byRecent = (a: Session, b: Session) => b.lastEventAt - a.lastEventAt;

export function groupSessions(sessions: Session[], now = Date.now()): GroupedSessions {
  const g: GroupedSessions = { needsYou: [], working: [], done: [], finished: [], closed: [] };
  for (const s of sessions) {
    // Bucket by the durable lifecycle `state`, NOT `attention`: markSeen ("Go to") clears
    // attention to 'none' to silence the dot/badge, but the row must stay in its section
    // (a seen "done" is still done). attention+seen drive only the unseen indicator.
    if (s.state === 'closed') g.closed.push(s);
    else if (s.state === 'waiting') g.needsYou.push(s);
    // "Done" is the just-finished window; older completed turns remain done, but display as Finished.
    else if (s.state === 'done') (now - s.lastEventAt > DONE_RECENT_MS ? g.finished : g.done).push(s);
    else g.working.push(s); // started | working
  }
  g.needsYou.sort(byRecent); g.working.sort(byRecent); g.done.sort(byRecent); g.finished.sort(byRecent); g.closed.sort(byRecent);
  return g;
}
