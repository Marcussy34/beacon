#!/usr/bin/env node
import { runInstallerCli } from './cli';
import { defaultTargets, dryRunInstall, installHooks, uninstallHooks } from './install';

const code = runInstallerCli(process.argv.slice(2), {
  targets: defaultTargets(),
  dryRun: dryRunInstall,
  install: installHooks,
  uninstall: uninstallHooks,
  log: (s) => console.log(s),
});
process.exit(code);
