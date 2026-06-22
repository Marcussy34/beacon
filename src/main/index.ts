import { app, BrowserWindow } from 'electron';

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    const win = new BrowserWindow({ width: 680, height: 480, show: true });
    if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL']);
    else win.loadFile('out/renderer/index.html');
  });
}
