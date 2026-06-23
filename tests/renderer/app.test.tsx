// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../../src/renderer/src/App';
import type { Session } from '../../src/domain/types';

// A RECONCILED Codex session: display `id` diverges from the store key `tempId`.
// Row actions MUST use tempId; using id would silently no-op (the M3b bug).
const reconciled: Session = {
  id: 'codex:11111111-2222-3333-4444-555555555555', // display-only, divergent
  tempId: 'codex:4242:/dev/ttys009',                // the real store key
  tool: 'codex',
  codexSessionId: '11111111-2222-3333-4444-555555555555',
  repoPath: '/Users/m/work/predictefy',
  gitRoot: '/Users/m/work/predictefy',
  repoName: 'predictefy',
  host: 'terminal',
  tty: '/dev/ttys009',
  remote: 'none',
  gotoPrecision: 'precise',
  state: 'done',
  attention: 'done',
  seen: false,
  startedAt: 1,
  lastEventAt: 2,
};

function mockBeacon(over: Partial<Window['beacon']> = {}) {
  const beacon = {
    getSnapshot: vi.fn().mockResolvedValue({ version: 1, sessions: [reconciled] }),
    markSeen: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue({ ok: true, message: 'Focused the Terminal tab' }),
    dismiss: vi.fn().mockResolvedValue(undefined),
    hide: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockReturnValue(() => {}),
    ...over,
  };
  (window as unknown as { beacon: typeof beacon }).beacon = beacon;
  return beacon;
}

describe('App panel', () => {
  beforeEach(() => { mockBeacon(); });

  it('renders the session and its group heading', async () => {
    render(<App />);
    expect(await screen.findByText('predictefy')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy(); // group heading for attention:'done'
  });

  it('Go to calls beacon.goto with tempId, never the display id', async () => {
    const beacon = mockBeacon();
    render(<App />);
    const go = await screen.findByRole('button', { name: /go to/i });
    fireEvent.click(go);
    await waitFor(() => expect(beacon.goto).toHaveBeenCalledWith(reconciled.tempId));
    expect(beacon.goto).not.toHaveBeenCalledWith(reconciled.id);
  });

  it('Mark seen calls beacon.markSeen with tempId, never the display id', async () => {
    const beacon = mockBeacon();
    render(<App />);
    const seen = await screen.findByRole('button', { name: /mark seen/i });
    fireEvent.click(seen);
    await waitFor(() => expect(beacon.markSeen).toHaveBeenCalledWith(reconciled.tempId));
    expect(beacon.markSeen).not.toHaveBeenCalledWith(reconciled.id);
  });

  it('surfaces a goto failure message as a toast', async () => {
    mockBeacon({ goto: vi.fn().mockResolvedValue({ ok: false, message: "Couldn't focus the editor" }) });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /go to/i }));
    expect(await screen.findByText(/couldn't focus the editor/i)).toBeTruthy();
  });

  it('Dismiss calls beacon.dismiss with tempId, never the display id', async () => {
    const beacon = mockBeacon();
    render(<App />);
    const x = await screen.findByRole('button', { name: /dismiss/i });
    fireEvent.click(x);
    await waitFor(() => expect(beacon.dismiss).toHaveBeenCalledWith(reconciled.tempId));
    expect(beacon.dismiss).not.toHaveBeenCalledWith(reconciled.id);
  });

  it('the close button hides the panel via beacon.hide', async () => {
    const beacon = mockBeacon();
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /close/i }));
    await waitFor(() => expect(beacon.hide).toHaveBeenCalled());
  });
});
