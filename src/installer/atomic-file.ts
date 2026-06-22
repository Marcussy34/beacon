import { closeSync, copyFileSync, existsSync, lstatSync, openSync, readFileSync, readlinkSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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
 * If `path` is a symlink, resolve it so we write THROUGH the link — preserving the link itself
 * and updating the file it points at. This matters for dotfile-manager setups (chezmoi/stow/dotbot)
 * where `~/.claude/settings.json` is a symlink into a managed store: a naive temp+rename would
 * replace the symlink with a regular file and silently break the manager's indirection.
 */
function resolveWriteTarget(path: string): string {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      // realpathSync resolves chained links when the target exists; for a broken link
      // fall back to its immediate target resolved against the link's directory.
      try { return realpathSync(path); }
      catch { return resolve(dirname(path), readlinkSync(path)); }
    }
  } catch { /* lstat failed → path does not exist; write it as-is */ }
  return path;
}

/**
 * Atomically write `obj` as pretty JSON:
 * resolve symlink → exclusive lock → backup (unless disabled) → temp file (0600) → rename over target.
 * Strict-serializes+parses before touching disk. Lock + temp cleaned in `finally`.
 * All on-disk work targets the resolved real file, so a symlinked target keeps its link.
 */
export function writeJsonAtomic(path: string, obj: unknown, opts: WriteOptions = {}): { backupPath?: string } {
  const json = JSON.stringify(obj, null, 2) + '\n';
  JSON.parse(json); // strict validate what we are about to write

  const target = resolveWriteTarget(path); // write through symlinks; keep temp on the real file's fs

  const lockPath = `${target}.beacon-lock`;
  let lockFd: number;
  try {
    lockFd = openSync(lockPath, 'wx'); // exclusive-create; throws if already held
  } catch {
    throw new Error(
      `Another Beacon install is in progress (lock exists: ${lockPath}). ` +
      `If this lock is stale, remove it and retry.`,
    );
  }

  const tmpPath = `${target}.beacon-tmp-${process.pid}`;
  try {
    let backupPath: string | undefined;
    if (opts.backup !== false && existsSync(target)) {
      backupPath = `${target}.beacon-backup-${opts.now ?? Date.now()}`;
      copyFileSync(target, backupPath);
    }
    writeFileSync(tmpPath, json, { encoding: 'utf8', mode: 0o600 });
    renameSync(tmpPath, target); // atomic on the same filesystem
    return { backupPath };
  } finally {
    try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* best-effort */ }
    closeSync(lockFd);
    try { unlinkSync(lockPath); } catch { /* best-effort */ }
  }
}
