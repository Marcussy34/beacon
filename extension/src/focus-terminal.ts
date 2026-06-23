// Pure, framework-free core for the Beacon Focus Helper extension.
// NO `vscode` import here, so this module type-checks and unit-tests with zero VS Code deps.

/** The minimal slice of a vscode.Terminal that focusTerminalByTty needs. */
export interface TerminalLike {
  readonly processId: PromiseLike<number | undefined>;
  show(preserveFocus?: boolean): void;
}

/** Resolves a shell PID to its controlling tty (e.g. '/dev/ttys154'), or null. Must never throw. */
export type PidTtyResolver = (pid: number) => Promise<string | null>;

/** Canonicalize a tty string to '/dev/ttysNNN'. Accepts '/dev/ttys154', 'ttys154', 's154', or trailing whitespace. */
export function normalizeTty(raw: string): string {
  let t = raw.trim();
  if (t.startsWith('/dev/')) t = t.slice('/dev/'.length);
  if (t.startsWith('ttys')) return `/dev/${t}`;
  if (t.startsWith('s')) return `/dev/tty${t}`; // `ps -o tty=` can print 's154'
  return `/dev/${t}`;
}

/** Extract the tty from a focus URI's path+query. Returns the normalized tty, or null unless path is '/focus' with a tty. */
export function parseFocusTty(path: string, query: string): string | null {
  if (path !== '/focus') return null;
  // URLSearchParams percent-decodes its input, so this works whether or not the editor pre-decoded the query.
  const tty = new URLSearchParams(query).get('tty');
  return tty ? normalizeTty(tty) : null;
}

/** Focus the terminal whose shell tty matches `target`. Returns true on match. Never throws. */
export async function focusTerminalByTty(
  target: string,
  terminals: readonly TerminalLike[],
  resolve: PidTtyResolver,
): Promise<boolean> {
  for (const terminal of terminals) {
    let pid: number | undefined;
    try {
      pid = await terminal.processId;
    } catch {
      continue;
    }
    if (pid === undefined) continue;
    const tty = await resolve(pid).catch(() => null);
    if (tty !== null && tty === target) {
      // Guard against a disposed terminal: show() may throw synchronously.
      // Matched but couldn't reveal → return false rather than letting the error escape.
      try {
        terminal.show();
        return true;
      } catch {
        return false;
      }
    }
  }
  return false;
}
