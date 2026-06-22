import { app, BrowserWindow, ipcMain } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { appPaths } from '../core/app-paths';
import { createBeaconCore } from '../core/beacon-core';
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

    const core = await createBeaconCore({ paths, onChange: () => refresh() });

    function refresh(): void {
      tray.setBadge(core.attentionCount());
      win?.webContents.send('update', core.snapshot());
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
        if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL']);
        else win.loadFile(join(__dirname, '../renderer/index.html'));
      }
      win.show();
    }

    app.on('will-quit', () => { void core.close(); tray.destroy(); });
  });
}
