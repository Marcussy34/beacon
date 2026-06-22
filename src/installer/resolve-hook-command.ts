import { join } from 'node:path';

/** Double-quote a path for embedding in a POSIX shell command string. */
function shellQuote(p: string): string {
  return `"${p.replace(/(["\\$`])/g, '\\$1')}"`;
}

export interface ResolveOptions {
  /** Install/repo root that contains `dist/`. Defaults to the package root. */
  rootDir?: string;
  /** Node binary to invoke (resolved from the CLI's PATH at hook time). Defaults to 'node'. */
  nodeBin?: string;
  /** Packaged-app mode: use ELECTRON_RUN_AS_NODE invocation instead of `node`. */
  packaged?: boolean;
  /** Path to the Electron execPath (required when packaged=true). */
  execPath?: string;
  /** Path to the app's Resources directory (required when packaged=true). */
  resourcesPath?: string;
}

/**
 * Resolve the shell-safe invocation prefix for the built beacon-hook.
 * Dev/runnable default: `node "<root>/dist/hook/beacon-hook.cjs"`.
 * Packaged mode (M3): `ELECTRON_RUN_AS_NODE=1 "<execPath>" "<resourcesPath>/beacon-hook.cjs"`.
 * buildHookCommand appends `--beacon-marker <id> <tool> <event>` to this prefix.
 */
export function resolveHookCommand(opts: ResolveOptions = {}): string {
  if (opts.packaged) {
    // Packaged Electron invocation — execPath + resourcesPath are REQUIRED. Throw rather than
    // emit a broken `... "" "beacon-hook.cjs"` command that would silently fail at hook runtime.
    if (!opts.execPath || !opts.resourcesPath) {
      throw new Error('resolveHookCommand: execPath and resourcesPath are required in packaged mode');
    }
    return `ELECTRON_RUN_AS_NODE=1 ${shellQuote(opts.execPath)} ${shellQuote(join(opts.resourcesPath, 'beacon-hook.cjs'))}`;
  }
  const root = opts.rootDir ?? defaultRoot();
  const node = opts.nodeBin ?? 'node';
  return `${node} ${shellQuote(join(root, 'dist', 'hook', 'beacon-hook.cjs'))}`;
}

/** Best-effort package root: this file sits at <root>/src/installer/, so go up two levels. */
function defaultRoot(): string {
  // NOTE: __dirname is a CommonJS global. It is defined here ONLY because this function
  // ships exclusively via the esbuild CJS bundle (dist/installer/cli.cjs), where __dirname
  // resolves to dist/installer/ and `../..` lands on the package root. It is NOT defined in
  // native ESM, so defaultRoot() must never be called from un-bundled ESM source — callers in
  // ESM contexts (e.g. M3's Electron main) MUST pass an explicit `rootDir`. typecheck stays
  // clean because tsconfig's "types":["node"] injects __dirname into the type namespace.
  return join(__dirname, '..', '..');
}
