import { app, ipcMain } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { appPaths } from '../core/app-paths';
import { createBeaconCore, type BeaconCore } from '../core/beacon-core';
import { createTray } from './tray';
import { createPanel } from './panel';
import { createIpcHandlers } from './ipc';
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
      if (!s) return { ok: false, message: 'session gone' };
      const r = await focusSession(s, systemRunner);
      return { ok: r.ok, message: r.message };
    });
    ipcMain.handle('snapshot', () => handlers.snapshot());
    ipcMain.handle('markSeen', (_e, key: string) => handlers.markSeen(key));
    ipcMain.handle('goto', (_e, key: string) => handlers.goto(key));

    // Launching a second instance summons the panel instead of starting another app.
    app.on('second-instance', () => panel.show());

    // Await the final debounced state write before the process exits (core.close() flushes the
    // writer); preventDefault + app.exit avoids losing the most recent state on quit.
    let quitting = false;
    app.on('will-quit', (e) => {
      if (quitting) return;
      quitting = true;
      e.preventDefault();
      // Catch so a failed final flush can't become an unhandled rejection while we exit anyway.
      core.close().catch((err) => console.error('Beacon close error:', err))
        .finally(() => { panel.destroy(); tray.destroy(); app.exit(0); });
    });
  });
}
