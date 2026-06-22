import type { InstallTarget, TargetPlan, InstallResult, UninstallResult } from './install';

// Explicit function-type signatures (NOT `typeof installHooks`): a type-only import
// has no value binding, so `typeof` on it would fail typecheck.
export interface CliDeps {
  targets: InstallTarget[];
  dryRun: (targets: InstallTarget[]) => TargetPlan[];
  install: (targets: InstallTarget[]) => { results: InstallResult[]; trustMessage: string };
  uninstall: (targets: InstallTarget[]) => UninstallResult[];
  log: (s: string) => void;
}

/** Pure CLI dispatcher. All IO goes through injected deps; returns the process exit code. */
export function runInstallerCli(argv: string[], deps: CliDeps): number {
  if (argv.includes('--uninstall')) {
    for (const r of deps.uninstall(deps.targets)) {
      deps.log(`[${r.tool}] removed ${r.removed} Beacon hook(s) from ${r.path}` +
        (r.backupPath ? ` (backup: ${r.backupPath})` : ''));
    }
    return 0;
  }
  if (argv.includes('--dry-run')) {
    for (const p of deps.dryRun(deps.targets)) {
      deps.log(`[${p.tool}] ${p.path}: ${p.merge.additions.length} to add, ` +
        `${p.merge.alreadyPresent.length} already present`);
      for (const a of p.merge.additions) deps.log(`   + ${a.event}${a.matcher ? ` [${a.matcher}]` : ''}`);
    }
    return 0;
  }
  const { results, trustMessage } = deps.install(deps.targets);
  for (const r of results) {
    deps.log(`[${r.tool}] added ${r.added} Beacon hook(s) to ${r.path}` +
      (r.backupPath ? ` (backup: ${r.backupPath})` : ''));
  }
  deps.log(trustMessage);
  return 0;
}
