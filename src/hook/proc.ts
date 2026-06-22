export interface ProcRow {
  pid: number;
  ppid: number;
  lstart: string;
  comm: string;
}

export function parseTty(psOutput: string): string | undefined {
  const t = psOutput.trim();
  if (!t || t === '?' || t === '??') return undefined;
  return t.startsWith('/dev/') ? t : `/dev/${t}`;
}

/** Each line: `pid ppid <lstart: 5 whitespace-separated fields> comm...`. */
export function parsePsRows(psOutput: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of psOutput.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 8) continue;
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    if (Number.isNaN(pid) || Number.isNaN(ppid)) continue;
    const lstart = parts.slice(2, 7).join(' ');
    const comm = parts.slice(7).join(' ');
    rows.push({ pid, ppid, lstart, comm });
  }
  return rows;
}

export function findAncestorByComm(rows: ProcRow[], startPid: number, comm: string): ProcRow | undefined {
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  let current = byPid.get(startPid);
  const seen = new Set<number>();
  while (current && !seen.has(current.pid)) {
    if (current.comm === comm || current.comm.endsWith(`/${comm}`)) return current;
    seen.add(current.pid);
    current = byPid.get(current.ppid);
  }
  return undefined;
}
