import { watch, type FSWatcher } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseRolloutMeta } from '../domain/identity';
import type { RolloutInfo } from '../domain/types';

const ROLLOUT_RE = /^rollout-.*\.jsonl$/;

/** Read a rollout file's first line and parse its session_meta. Null if absent/unflushed/non-meta. */
export async function readRolloutMeta(path: string): Promise<RolloutInfo | null> {
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch { return null; }
  const nl = text.indexOf('\n');
  if (nl < 0) return null; // first line not fully written yet — a later fs event will retry
  return parseRolloutMeta(text.slice(0, nl));
}

/** Recursively scan a sessions dir for rollout-*.jsonl files and parse each session_meta. */
export async function scanRolloutDir(dir: string): Promise<RolloutInfo[]> {
  let names: string[];
  try { names = (await readdir(dir, { recursive: true })) as string[]; } catch { return []; }
  const out: RolloutInfo[] = [];
  for (const name of names) {
    if (!ROLLOUT_RE.test(basename(name))) continue;
    const info = await readRolloutMeta(join(dir, name));
    if (info) out.push(info);
  }
  return out;
}

export interface RolloutWatcher { close(): void; }

/**
 * Recursively watch a Codex sessions dir for rollout-*.jsonl files; on each, read the first
 * session_meta line and hand the RolloutInfo to onRollout. Runs an initial scan first (unless
 * disabled) so rollouts that already exist at startup reconcile loaded sessions. Durable: a
 * transient watch/read error never crashes it, and onRollout errors are swallowed.
 * NOTE: `dir` must exist (watch() throws on a missing dir) — the caller (M3) ensures ~/.codex/sessions.
 */
export function startRolloutWatcher(
  dir: string,
  onRollout: (info: RolloutInfo) => void,
  opts: { initialScan?: boolean } = {},
): RolloutWatcher {
  const safeEmit = (info: RolloutInfo) => { try { onRollout(info); } catch { /* never crash the watcher */ } };

  if (opts.initialScan !== false) {
    void scanRolloutDir(dir).then((infos) => infos.forEach(safeEmit)).catch(() => {});
  }

  const watcher: FSWatcher = watch(dir, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const rel = filename.toString();
    if (!ROLLOUT_RE.test(basename(rel))) return;
    void readRolloutMeta(join(dir, rel)).then((info) => { if (info) safeEmit(info); }).catch(() => {});
  });
  // Long-lived handler so a transient watch error never crashes the daemon.
  watcher.on('error', () => {});
  return { close: () => watcher.close() };
}
