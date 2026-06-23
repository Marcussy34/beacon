import { describe, it, expect } from 'vitest';
import { panelPosition, PANEL_SIZE } from '../../src/main/panel';

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
