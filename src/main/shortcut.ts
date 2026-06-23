import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_ACCELERATOR = 'CommandOrControl+Shift+Space';

export interface ShortcutDeps {
  register(accelerator: string, cb: () => void): boolean;
  unregisterAll(): void;
}

export interface ShortcutManager {
  apply(accelerator: string): { ok: boolean; accelerator: string };
  current(): string;
  lastError(): string | null;
  dispose(): void;
}

/** Register a global accelerator with conflict detection. register() fails silently (false) when
 *  the combo is taken — we surface that as lastError and keep going (the Tray still works). */
export function createShortcutManager(deps: ShortcutDeps, onTrigger: () => void): ShortcutManager {
  let applied = DEFAULT_ACCELERATOR;
  let error: string | null = null;
  return {
    apply(accelerator) {
      deps.unregisterAll();
      const ok = deps.register(accelerator, onTrigger);
      if (ok) { applied = accelerator; error = null; }
      else { error = `Shortcut "${accelerator}" is already in use by another app; pick another.`; }
      return { ok, accelerator };
    },
    current: () => applied,
    lastError: () => error,
    dispose: () => deps.unregisterAll(),
  };
}

export function loadAccelerator(path: string): string {
  if (!existsSync(path)) return DEFAULT_ACCELERATOR;
  try {
    const v = JSON.parse(readFileSync(path, 'utf8'))?.accelerator;
    return typeof v === 'string' && v.length > 0 ? v : DEFAULT_ACCELERATOR;
  } catch { return DEFAULT_ACCELERATOR; }
}

export function saveAccelerator(path: string, accelerator: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ accelerator }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}
