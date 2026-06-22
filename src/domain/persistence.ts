import { writeFile, rename, readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SessionsSnapshot } from './store';

export async function saveSnapshot(path: string, snap: SessionsSnapshot): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(snap, null, 2), 'utf8');
  await rename(tmp, path); // atomic within the same filesystem
}

export async function loadSnapshot(path: string): Promise<SessionsSnapshot | null> {
  try {
    const txt = await readFile(path, 'utf8');
    const data = JSON.parse(txt) as SessionsSnapshot;
    if (data?.version !== 1 || !Array.isArray(data.sessions)) return null;
    return data;
  } catch {
    return null;
  }
}

/** Single-writer debounced persistence: coalesces rapid updates into one write. */
export function createDebouncedWriter(
  path: string,
  delayMs: number,
  onError?: (err: unknown) => void,
): { schedule(snap: SessionsSnapshot): void; flush(): Promise<void> } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: SessionsSnapshot | null = null;
  let inflight: Promise<void> = Promise.resolve();

  const write = (): Promise<void> => {
    if (!pending) return inflight; // nothing new; await any in-progress write
    const snap = pending;
    pending = null;
    inflight = inflight.then(() => saveSnapshot(path, snap));
    return inflight;
  };

  return {
    schedule(snap: SessionsSnapshot): void {
      pending = snap;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        // Background write: report errors so they never become unhandled rejections.
        write().catch((err) => onError?.(err));
      }, delayMs);
    },
    async flush(): Promise<void> {
      if (timer) { clearTimeout(timer); timer = null; }
      await write();
    },
  };
}
