import { BrowserWindow, screen, type BrowserWindowConstructorOptions } from 'electron';

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

// Minimal surface of the two macOS window APIs that decide the panel's Space behavior.
export interface HudWindow {
  setAlwaysOnTop(flag: boolean, level: 'screen-saver'): void;
  setVisibleOnAllWorkspaces(
    visible: boolean,
    options: { visibleOnFullScreen: boolean; skipTransformProcessType: boolean },
  ): void;
}

// Makes the panel a persistent HUD that floats over fullscreen apps AND follows the user across
// every Space. ORDER IS LOAD-BEARING: setAlwaysOnTop must run FIRST, then setVisibleOnAllWorkspaces.
// On macOS, setAlwaysOnTop re-applies the window's collectionBehavior when it sets the window level,
// which CLOBBERS the canJoinAllSpaces bit. If setVisibleOnAllWorkspaces runs first (then is clobbered),
// the panel gets pinned to the Space it was opened on — it won't follow you across Spaces, and
// re-showing it yanks you back to that origin Space. Applying all-spaces LAST keeps the bit intact.
// skipTransformProcessType: the app is already an accessory/LSUIElement app (app.dock.hide()).
export function applyHudWindowBehavior(win: HudWindow): void {
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
}

// BrowserWindow options for the panel. type:'panel' (an NSPanel) is LOAD-BEARING on macOS and is the
// real Space-jump fix: a normal NSWindow's show()/focus() call [NSApp activateIgnoringOtherApps:YES],
// which activates the whole app and switches macOS to the window's "home" Space — so summoning the
// panel from another Space yanked the user back to wherever it was last shown (a fullscreen video's
// Space, or Desktop 1). For a panel, Electron SKIPS that activation: the window takes key focus via
// makeKeyAndOrderFront without activating the app (exactly how Spotlight behaves), so it opens on the
// CURRENT Space and never drags the user away. setVisibleOnAllWorkspaces only controls where the
// window *appears* — not activation — which is why it looked visible everywhere yet still pulled focus.
export function panelWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    ...PANEL_SIZE,
    show: false, frame: false, transparent: true,
    type: 'panel', // NSPanel — keyboard focus without app activation, so summoning never switches Spaces
    // Movable (header is a drag region in the renderer) + resizable from the edges. minWidth/Height
    // keep it usable; maximize is off (it's a HUD, not a document window).
    resizable: true, maximizable: false, minWidth: 380, minHeight: 260,
    fullscreenable: false, skipTaskbar: true, focusable: true, alwaysOnTop: true,
    webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true },
  };
}

export function createPanel(opts: {
  preloadPath: string; loadDevUrl?: string; loadFile: string; onHidden?: () => void;
}): Panel {
  let win: BrowserWindow | null = null;

  function build(): BrowserWindow {
    const w = new BrowserWindow(panelWindowOptions(opts.preloadPath));
    // Float over all Spaces + fullscreen apps. Order matters — see applyHudWindowBehavior.
    applyHudWindowBehavior(w);
    if (opts.loadDevUrl) w.loadURL(opts.loadDevUrl); else w.loadFile(opts.loadFile);
    w.on('closed', () => { win = null; });
    // NOTE: intentionally NO hide-on-blur. Beacon's panel is a PERSISTENT HUD — once summoned it stays
    // visible across every Space/display and over other apps until the user explicitly hides it (global
    // shortcut, Esc, or the in-panel close button). An earlier ChatGPT-style hide-on-blur was removed by
    // user direction: it made the panel flash-and-vanish on a Space switch (Cmd+arrow) and disappear on
    // any click elsewhere, defeating the "always on screen" purpose.
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
    // type:'panel' makes win.show() key the panel WITHOUT activating the app, so it opens on the
    // Space the user is currently on. Do NOT call app.focus({steal:true}) here: app activation
    // ignores the panel exemption and switches macOS to the window's home Space — the yank bug.
    win.show();
  }
  function hide(): void { if (win && win.isVisible()) { win.hide(); opts.onHidden?.(); } }
  function toggle(): void { if (win && win.isVisible()) hide(); else show(); }
  function send(channel: string, payload: unknown): void {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
  return { show, hide, toggle, send, isVisible: () => !!win && win.isVisible(), destroy: () => win?.destroy() };
}
