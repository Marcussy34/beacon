// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../../src/renderer/src/App';
import type { Session } from '../../src/domain/types';

const RECENT_TS = Date.now();

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
  summary: 'fix the build',
  startedAt: RECENT_TS - 1000,
  lastEventAt: RECENT_TS,
};

function mockBeacon(over: Partial<Window['beacon']> = {}) {
  const beacon = {
    getSnapshot: vi.fn().mockResolvedValue({ version: 1, sessions: [reconciled] }),
    markSeen: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue({ ok: true, message: 'Focused the Terminal tab' }),
    dismiss: vi.fn().mockResolvedValue(undefined),
    move: vi.fn().mockResolvedValue(undefined),
    hide: vi.fn().mockResolvedValue(undefined),
    copy: vi.fn().mockResolvedValue(undefined),
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

  it('renders the per-session summary snippet under the repo name', async () => {
    render(<App />);
    expect(await screen.findByText('fix the build')).toBeTruthy();
  });

  it('renders a row without a summary without crashing', async () => {
    const noSummary: Session = { ...reconciled, summary: undefined };
    mockBeacon({ getSnapshot: vi.fn().mockResolvedValue({ version: 1, sessions: [noSummary] }) });
    render(<App />);
    expect(await screen.findByText('predictefy')).toBeTruthy();
    expect(screen.queryByText('fix the build')).toBeNull();
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

  it('Move on a done row escalates via beacon.move(tempId, "needsYou")', async () => {
    const beacon = mockBeacon(); // `reconciled` fixture has state:'done'
    render(<App />);
    const btn = await screen.findByRole('button', { name: /move to needs you/i });
    fireEvent.click(btn);
    await waitFor(() => expect(beacon.move).toHaveBeenCalledWith(reconciled.tempId, 'needsYou'));
    expect(beacon.move).not.toHaveBeenCalledWith(reconciled.id, 'needsYou');
  });

  it('renders old done rows under Finished and keeps the move action', async () => {
    const oldDone: Session = {
      ...reconciled,
      id: 'codex:old',
      tempId: 'codex:old:tty',
      repoName: 'oldrepo',
      lastEventAt: Date.now() - (31 * 60 * 1000),
    };
    const beacon = mockBeacon({ getSnapshot: vi.fn().mockResolvedValue({ version: 1, sessions: [oldDone] }) });

    render(<App />);

    expect(await screen.findByText('Finished')).toBeTruthy();
    const btn = await screen.findByRole('button', { name: /move to needs you/i });
    fireEvent.click(btn);
    await waitFor(() => expect(beacon.move).toHaveBeenCalledWith(oldDone.tempId, 'needsYou'));
  });

  it('uses green for Done, blue for Finished, and orange for Working', async () => {
    const finished: Session = {
      ...reconciled,
      id: 'codex:finished',
      tempId: 'codex:finished:tty',
      repoName: 'finishedrepo',
      lastEventAt: Date.now() - (31 * 60 * 1000),
    };
    const working: Session = {
      ...reconciled,
      id: 'codex:working',
      tempId: 'codex:working:tty',
      repoName: 'workingrepo',
      state: 'working',
      attention: 'none',
      seen: true,
      lastEventAt: RECENT_TS,
    };
    mockBeacon({ getSnapshot: vi.fn().mockResolvedValue({ version: 1, sessions: [reconciled, finished, working] }) });

    render(<App />);

    const doneHeading = await screen.findByRole('heading', { name: /done/i });
    const finishedHeading = await screen.findByRole('heading', { name: /finished/i });
    const workingHeading = await screen.findByRole('heading', { name: /working/i });
    expect(doneHeading.querySelector('span')?.className).toContain('bg-green-500');
    expect(finishedHeading.querySelector('span')?.className).toContain('bg-sky-500');
    expect(workingHeading.querySelector('span')?.className).toContain('bg-orange-500');
  });

  it('Move on a needs-you row demotes via beacon.move(tempId, "done")', async () => {
    const waiting: Session = { ...reconciled, id: 'codex:w', tempId: 'codex:w:tty', state: 'waiting', attention: 'needs-you', seen: false, repoName: 'waitingrepo' };
    const beacon = mockBeacon({ getSnapshot: vi.fn().mockResolvedValue({ version: 1, sessions: [waiting] }) });
    render(<App />);
    const btn = await screen.findByRole('button', { name: /move to done/i });
    fireEvent.click(btn);
    await waitFor(() => expect(beacon.move).toHaveBeenCalledWith(waiting.tempId, 'done'));
  });

  it('renders a copy-resume button for a session with a resumable id', async () => {
    render(<App />);
    expect(await screen.findByRole('button', { name: /copy resume command/i })).toBeTruthy();
  });

  it('Copy resume calls beacon.copy with the exact resume command', async () => {
    const beacon = mockBeacon(); // `reconciled` is a codex session with codexSessionId set
    render(<App />);
    const copyBtn = await screen.findByRole('button', { name: /copy resume command/i });
    fireEvent.click(copyBtn);
    await waitFor(() =>
      expect(beacon.copy).toHaveBeenCalledWith(`codex resume ${reconciled.codexSessionId}`));
  });

  it('shows copy feedback as an overlay instead of a layout row', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /copy resume command/i }));

    const toast = await screen.findByText(`Copied: codex resume ${reconciled.codexSessionId}`);
    expect(toast.className).toContain('absolute');
    expect(toast.className).toContain('bottom-3');
    expect(toast.className).toContain('pointer-events-none');
    expect(toast.parentElement?.className).toContain('relative');
  });

  it('hides the copy-resume button when the session has no resumable id', async () => {
    const noId: Session = { ...reconciled, codexSessionId: undefined };
    mockBeacon({ getSnapshot: vi.fn().mockResolvedValue({ version: 1, sessions: [noId] }) });
    render(<App />);
    expect(await screen.findByText('predictefy')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /copy resume command/i })).toBeNull();
  });

  it('the close button hides the panel via beacon.hide', async () => {
    const beacon = mockBeacon();
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /close/i }));
    await waitFor(() => expect(beacon.hide).toHaveBeenCalled());
  });
});
