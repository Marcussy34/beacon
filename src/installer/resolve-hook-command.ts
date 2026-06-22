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
}

/**
 * Resolve the shell-safe invocation prefix for the built beacon-hook.
 * Dev/runnable default: `node "<root>/dist/hook/beacon-hook.cjs"`.
 * (M3 packaging is the single place to switch to the bundled binary.)
 */
export function resolveHookCommand(opts: ResolveOptions = {}): string {
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
