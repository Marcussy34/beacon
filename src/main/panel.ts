import { app, BrowserWindow, screen } from 'electron';

export const PANEL_SIZE = { width: 680, height: 520 } as const;

export interface WorkArea { x: number; y: number; width: number; height: number; }
export interface Size { width: number; height: number; }

/** Centered horizontally, near the top of the work area; clamped to stay on-screen. */
export function panelPosition(workArea: WorkArea, size: Size): { x: number; y: number } {
  const x = workArea.x + Math.round((workArea.width - size.width) / 2);
  const y = workArea.y + Math.round(workArea.height * 0.12);
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));
  return {
    x: clamp(x, workArea.x, workArea.x + Math.max(0, workArea.width - size.width)),
    y: clamp(y, workArea.y, workArea.y + Math.max(0, workArea.height - size.height)),
  };
}

export interface Panel {
  show(): void; hide(): void; toggle(): void;
  send(channel: string, payload: unknown): void;
  isVisible(): boolean; destroy(): void;
}

export function createPanel(opts: {
  preloadPath: string; loadDevUrl?: string; loadFile: string; onHidden?: () => void;
}): Panel {
  let win: BrowserWindow | null = null;

  function build(): BrowserWindow {
    const w = new BrowserWindow({
      ...PANEL_SIZE,
      show: false, frame: false, transparent: true, resizable: false,
      fullscreenable: false, skipTaskbar: true, focusable: true, alwaysOnTop: true,
      webPreferences: { preload: opts.preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    // Float over all Spaces + fullscreen apps; skipTransformProcessType because we are an LSUIElement app.
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    w.setAlwaysOnTop(true, 'screen-saver');
    if (opts.loadDevUrl) w.loadURL(opts.loadDevUrl); else w.loadFile(opts.loadFile);
    w.on('closed', () => { win = null; });
    w.on('blur', () => { if (win && !win.webContents.isDevToolsFocused()) hide(); }); // hide on click-away
    w.webContents.on('before-input-event', (_e, input) => { if (input.key === 'Escape') hide(); });
    return w;
  }
  function positionOnActiveDisplay(w: BrowserWindow): void {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const { x, y } = panelPosition(display.workArea, PANEL_SIZE);
    w.setPosition(x, y);
  }
  function show(): void {
    if (!win) win = build();
    positionOnActiveDisplay(win);
    win.show();
    app.focus({ steal: true }); // activating: take focus like Spotlight/ChatGPT
  }
  function hide(): void { if (win && win.isVisible()) { win.hide(); opts.onHidden?.(); } }
  function toggle(): void { if (win && win.isVisible()) hide(); else show(); }
  function send(channel: string, payload: unknown): void {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
  return { show, hide, toggle, send, isVisible: () => !!win && win.isVisible(), destroy: () => win?.destroy() };
}
