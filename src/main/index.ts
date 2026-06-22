import { app, BrowserWindow, ipcMain } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { appPaths } from '../core/app-paths';
import { createBeaconCore, type BeaconCore } from '../core/beacon-core';
import { createTray } from './tray';
import { createIpcHandlers } from './ipc';
import { focusSession, systemRunner } from '../focuser/focus';

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.whenReady().then(async () => {
    app.dock?.hide();
    const paths = appPaths(homedir());
    let win: BrowserWindow | null = null;

    // Tray is created BEFORE core so core's onChange can reference it without a temporal-dead-zone
    // risk. `refresh` is a hoisted function declaration; it is only ever invoked after both `tray`
    // and `core` are bound (the explicit call below, or via onChange which fires post-construction).
    const tray = createTray({
      iconPath: app.isPackaged
        ? join(process.resourcesPath, 'iconTemplate.png')
        : join(__dirname, '../../resources/iconTemplate.png'),
      onToggle: () => { if (win?.isVisible()) win.hide(); else showPanel(); },
    });

    // Startup must not leave a dangling tray + unhandled rejection if core init fails
    // (mkdir / socket bind / watcher). Clean up and exit non-zero instead.
    let core: BeaconCore;
    try {
      core = await createBeaconCore({ paths, onChange: () => refresh() });
    } catch (err) {
      console.error('Beacon failed to start:', err);
      tray.destroy();
      app.exit(1);
      return;
    }

    function refresh(): void {
      tray.setBadge(core.attentionCount());
      // Guard: `win` may be non-null but its webContents destroyed (user closed the window);
      // sending to a destroyed webContents throws.
      if (win && !win.isDestroyed()) win.webContents.send('update', core.snapshot());
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

    function showPanel() {
      if (!win) {
        win = new BrowserWindow({
          width: 680, height: 520, show: false,
          webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
        });
        win.on('closed', () => { win = null; }); // reset so refresh()/showPanel() don't touch a dead window
        // SECURITY: only honor the dev-server URL in development. In a packaged app, ELECTRON_RENDERER_URL
        // must NOT be able to point the privileged (window.beacon-exposed) renderer at an arbitrary URL.
        const devUrl = process.env['ELECTRON_RENDERER_URL'];
        if (!app.isPackaged && devUrl) win.loadURL(devUrl);
        else win.loadFile(join(__dirname, '../renderer/index.html'));
      }
      win.show();
    }

    // Await the final debounced state write before the process exits (core.close() flushes the
    // writer); preventDefault + app.exit avoids losing the most recent state on quit.
    let quitting = false;
    app.on('will-quit', (e) => {
      if (quitting) return;
      quitting = true;
      e.preventDefault();
      // Catch so a failed final flush can't become an unhandled rejection while we exit anyway.
      core.close().catch((err) => console.error('Beacon close error:', err))
        .finally(() => { tray.destroy(); app.exit(0); });
    });
  });
}
