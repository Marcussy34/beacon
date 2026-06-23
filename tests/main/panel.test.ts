import { describe, it, expect } from 'vitest';
import { panelPosition, PANEL_SIZE, applyHudWindowBehavior, panelWindowOptions, type HudWindow } from '../../src/main/panel';

describe('panelPosition', () => {
  it('centers horizontally and sits near the top of the work area', () => {
    const wa = { x: 0, y: 25, width: 1440, height: 875 }; // 25 = menu bar offset
    const pos = panelPosition(wa, PANEL_SIZE);
    expect(pos.x).toBe(Math.round((1440 - PANEL_SIZE.width) / 2));
    expect(pos.y).toBe(25 + Math.round(875 * 0.12));
  });
  it('respects a non-zero work-area origin (second display)', () => {
    const wa = { x: 1440, y: 0, width: 1920, height: 1080 };
    const pos = panelPosition(wa, PANEL_SIZE);
    expect(pos.x).toBe(1440 + Math.round((1920 - PANEL_SIZE.width) / 2));
    expect(pos.y).toBe(Math.round(1080 * 0.12));
  });
  it('clamps within the work area for a tiny screen', () => {
    const wa = { x: 0, y: 0, width: 400, height: 300 };
    const pos = panelPosition(wa, PANEL_SIZE);
    expect(pos.x).toBeGreaterThanOrEqual(0);
    expect(pos.y).toBeGreaterThanOrEqual(0);
  });
});

describe('applyHudWindowBehavior', () => {
  // Records the order + args of the two macOS Space-behavior calls.
  function recorder(): { win: HudWindow; calls: Array<{ fn: string; args: unknown[] }> } {
    const calls: Array<{ fn: string; args: unknown[] }> = [];
    const win: HudWindow = {
      setAlwaysOnTop: (flag, level) => { calls.push({ fn: 'setAlwaysOnTop', args: [flag, level] }); },
      setVisibleOnAllWorkspaces: (visible, options) => {
        calls.push({ fn: 'setVisibleOnAllWorkspaces', args: [visible, options] });
      },
    };
    return { win, calls };
  }

  it('calls setAlwaysOnTop BEFORE setVisibleOnAllWorkspaces (so canJoinAllSpaces is not clobbered)', () => {
    const { win, calls } = recorder();
    applyHudWindowBehavior(win);
    // This is the bug fix: the reverse order pins the panel to its origin Space.
    expect(calls.map((c) => c.fn)).toEqual(['setAlwaysOnTop', 'setVisibleOnAllWorkspaces']);
  });

  it('uses the screen-saver level and the all-spaces options (over fullscreen, no process-type flicker)', () => {
    const { win, calls } = recorder();
    applyHudWindowBehavior(win);
    expect(calls[0]!.args).toEqual([true, 'screen-saver']);
    expect(calls[1]!.args).toEqual([
      true,
      { visibleOnFullScreen: true, skipTransformProcessType: true },
    ]);
  });
});

describe('panelWindowOptions', () => {
  it('creates an NSPanel (type:panel) so show()/focus() never yank the user to another Space', () => {
    // THE Space-jump fix. A normal NSWindow's show()/focus() call activateIgnoringOtherApps:YES,
    // which activates the app and switches macOS to the window's "home" Space. type:'panel' makes
    // Electron skip that activation (Spotlight-style key focus), so the panel opens on the CURRENT
    // Space instead of dragging the user back to where it was last shown.
    expect(panelWindowOptions('/preload.js').type).toBe('panel');
  });

  it('stays a borderless, non-fullscreening HUD off the taskbar', () => {
    const o = panelWindowOptions('/preload.js');
    expect(o.show).toBe(false);
    expect(o.frame).toBe(false);
    expect(o.fullscreenable).toBe(false); // also keeps FullScreenAuxiliary → floats over fullscreen
    expect(o.skipTaskbar).toBe(true);
    expect(o.webPreferences?.preload).toBe('/preload.js');
  });
});
