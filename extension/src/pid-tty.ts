import { execFile } from 'node:child_process';
import { normalizeTty } from './focus-terminal';

/** Resolve a PID's controlling tty via `ps -o tty= -p <pid>`. Returns a normalized '/dev/ttysNNN' or null. Never throws. */
export function resolvePidTty(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'tty=', '-p', String(pid)], { timeout: 3000 }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      const out = stdout.trim();
      // `ps` prints '??' for a process with no controlling tty.
      if (out === '' || out === '??') {
        resolve(null);
        return;
      }
      resolve(normalizeTty(out));
    });
  });
}
