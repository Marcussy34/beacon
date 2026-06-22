import type { Session } from '../domain/types';

export function badgeText(count: number): string {
  if (count <= 0) return '';
  return count >= 10 ? '9+' : String(count);
}

export interface GroupedSessions {
  needsYou: Session[]; working: Session[]; done: Session[]; closed: Session[];
}

const byRecent = (a: Session, b: Session) => b.lastEventAt - a.lastEventAt;

export function groupSessions(sessions: Session[]): GroupedSessions {
  const g: GroupedSessions = { needsYou: [], working: [], done: [], closed: [] };
  for (const s of sessions) {
    if (s.state === 'closed') g.closed.push(s);
    else if (s.attention === 'needs-you') g.needsYou.push(s);
    else if (s.attention === 'done') g.done.push(s);
    else g.working.push(s); // started | working | (waiting handled above via attention)
  }
  g.needsYou.sort(byRecent); g.working.sort(byRecent); g.done.sort(byRecent); g.closed.sort(byRecent);
  return g;
}
