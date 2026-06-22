// Headless smoke: prove the sandboxed preload loads and exposes window.beacon.
// Run: npx electron scripts/smoke-preload.mjs  (exits 0 if window.beacon has the 4 wrapper fns).
import { app, BrowserWindow } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
app.disableHardwareAcceleration(); // help it run without a GPU/display
app.dock?.hide();

const done = (code, msg) => { console.log(`SMOKE:${code}:${msg}`); app.exit(code); };
setTimeout(() => done(3, 'timeout: did-finish-load never fired'), 9000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(ROOT, 'out', 'preload', 'index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  win.webContents.on('did-finish-load', async () => {
    try {
      const res = await win.webContents.executeJavaScript(
        '({ type: typeof window.beacon, keys: window.beacon ? Object.keys(window.beacon).sort() : [] })',
      );
      const ok = res.type === 'object' &&
        ['getSnapshot', 'goto', 'markSeen', 'onUpdate'].every((k) => res.keys.includes(k));
      done(ok ? 0 : 1, `type=${res.type} keys=[${res.keys.join(',')}]`);
    } catch (e) {
      done(2, `executeJavaScript threw: ${e}`);
    }
  });
  await win.loadURL('about:blank');
});
