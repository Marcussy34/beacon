import { closeSync, copyFileSync, existsSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';

/** Read+parse JSON. Missing/empty file → fallback. Malformed JSON → throw (never silently overwrite). */
export function readJsonOrDefault<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  const text = readFileSync(path, 'utf8');
  if (text.trim() === '') return fallback;
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(
      `Refusing to proceed: ${path} is not valid JSON (${(e as Error).message}). ` +
      `Fix or remove it; Beacon will not overwrite a file it cannot parse.`,
    );
  }
}

export interface WriteOptions { now?: number; backup?: boolean; }

/**
 * Atomically write `obj` as pretty JSON:
 * exclusive lock → backup (unless disabled) → temp file (0600) → rename over target.
 * Strict-serializes+parses before touching disk. Lock + temp cleaned in `finally`.
 */
export function writeJsonAtomic(path: string, obj: unknown, opts: WriteOptions = {}): { backupPath?: string } {
  const json = JSON.stringify(obj, null, 2) + '\n';
  JSON.parse(json); // strict validate what we are about to write

  const lockPath = `${path}.beacon-lock`;
  let lockFd: number;
  try {
    lockFd = openSync(lockPath, 'wx'); // exclusive-create; throws if already held
  } catch {
    throw new Error(
      `Another Beacon install is in progress (lock exists: ${lockPath}). ` +
      `If this lock is stale, remove it and retry.`,
    );
  }

  const tmpPath = `${path}.beacon-tmp-${process.pid}`;
  try {
    let backupPath: string | undefined;
    if (opts.backup !== false && existsSync(path)) {
      backupPath = `${path}.beacon-backup-${opts.now ?? Date.now()}`;
      copyFileSync(path, backupPath);
    }
    writeFileSync(tmpPath, json, { encoding: 'utf8', mode: 0o600 });
    renameSync(tmpPath, path); // atomic on the same filesystem
    return { backupPath };
  } finally {
    try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* best-effort */ }
    closeSync(lockFd);
    try { unlinkSync(lockPath); } catch { /* best-effort */ }
  }
}
