import { app, globalShortcut, ipcMain } from 'electron';
import { homedir } from 'node:os';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appPaths } from '../core/app-paths';
import { createBeaconCore, type BeaconCore } from '../core/beacon-core';
import { createTray } from './tray';
import { createPanel } from './panel';
import { createShortcutManager, loadAccelerator } from './shortcut';
import { createIpcHandlers } from './ipc';
import { installHooks, defaultTargets } from '../installer/install';
import { focusSession, systemRunner } from '../focuser/focus';

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.whenReady().then(async () => {
    app.dock?.hide();
    const paths = appPaths(homedir());

    // The activating, all-Spaces panel: frameless, floats over fullscreen + every Space, opens on
    // the display under the cursor, hides on blur/Esc. Created before core so core.onChange can
    // reference it; `refresh` (hoisted) only runs after core is bound.
    const panel = createPanel({
      preloadPath: join(__dirname, '../preload/index.js'),
      // SECURITY: only honor the dev-server URL in development (a packaged app must never load a remote URL).
      loadDevUrl: (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) || undefined,
      loadFile: join(__dirname, '../renderer/index.html'),
    });

    const tray = createTray({
      iconPath: app.isPackaged
        ? join(process.resourcesPath, 'iconTemplate.png')
        : join(__dirname, '../../resources/iconTemplate.png'),
      onToggle: () => panel.toggle(),
    });

    // Startup must not leave a dangling tray/panel + unhandled rejection if core init fails
    // (mkdir / socket bind / watcher). Clean up and exit non-zero instead.
    let core: BeaconCore;
    try {
      core = await createBeaconCore({ paths, onChange: () => refresh() });
    } catch (err) {
      console.error('Beacon failed to start:', err);
      panel.destroy();
      tray.destroy();
      app.exit(1);
      return;
    }

    function refresh(): void {
      tray.setBadge(core.attentionCount());
      panel.send('update', core.snapshot()); // panel.send guards a destroyed window
    }
    refresh(); // initial badge

    const handlers = createIpcHandlers(core, async (key) => {
      const s = core.store.get(key);
      if (!s) { console.warn(`[beacon] goto: no session for key "${key}"`); return { ok: false, message: 'session gone' }; }
      const r = await focusSession(s, systemRunner);
      console.log(`[beacon] goto "${key}" host=${s.host}: ok=${r.ok} — ${r.message}`);
      return { ok: r.ok, message: r.message };
    });
    ipcMain.handle('snapshot', () => handlers.snapshot());
    ipcMain.handle('markSeen', (_e, key: string) => { console.log(`[beacon] markSeen "${key}"`); return handlers.markSeen(key); });
    ipcMain.handle('goto', (_e, key: string) => handlers.goto(key));

    // Launching a second instance summons the panel instead of starting another app.
    app.on('second-instance', () => panel.show());

    // Global hotkey (⌘⇧Space, configurable). register() fails SILENTLY if the combo is taken,
    // so the manager surfaces that as lastError and the Tray keeps working regardless.
    const accelerator = loadAccelerator(join(paths.dataDir, 'shortcut.json'));
    const shortcut = createShortcutManager(
      { register: (a, cb) => globalShortcut.register(a, cb), unregisterAll: () => globalShortcut.unregisterAll() },
      () => panel.toggle(),
    );
    const res = shortcut.apply(accelerator);
    console.log(`[beacon] global shortcut "${accelerator}": ${res.ok ? 'registered' : 'CONFLICT'}`);
    if (!res.ok) console.warn('[beacon]', shortcut.lastError(), '— summon via the menu-bar icon instead.');

    // First run: install Beacon's hooks (idempotent merge — safe even if already installed manually).
    // TODO(M3c): in a packaged build, pass resolveHookCommand({ packaged, execPath, resourcesPath }) so
    // the installed command uses the bundled binary instead of the dev `node dist/...` invocation.
    const installedFlag = join(paths.dataDir, '.installed');
    if (!existsSync(installedFlag)) {
      try {
        const { trustMessage } = installHooks(defaultTargets());
        console.log('Beacon: installed hooks on first run.', trustMessage);
        writeFileSync(installedFlag, new Date().toISOString(), 'utf8');
      } catch (err) {
        console.error('Beacon: first-run hook install failed:', err);
      }
    }

    // Await the final debounced state write before the process exits (core.close() flushes the
    // writer); preventDefault + app.exit avoids losing the most recent state on quit.
    let quitting = false;
    app.on('will-quit', (e) => {
      if (quitting) return;
      quitting = true;
      e.preventDefault();
      globalShortcut.unregisterAll();
      // Catch so a failed final flush can't become an unhandled rejection while we exit anyway.
      core.close().catch((err) => console.error('Beacon close error:', err))
        .finally(() => { panel.destroy(); tray.destroy(); app.exit(0); });
    });
  });
}
