# Beacon M3c — Polished UI + Packaged Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Beacon's placeholder renderer with a polished shadcn/Tailwind v4/lucide panel UI, and fix the two packaged-app functional gaps (first-run hook invocation + Go-to PATH), so Beacon is complete and correct both in `npm run dev` AND as a packaged `.app`.

**Architecture:** The renderer gains Tailwind v4 (CSS-first, via `@tailwindcss/vite`), a tiny hand-authored shadcn primitive set (`Button`, `Badge` — the canonical MIT source you own), and a rewritten `App.tsx` that groups sessions with the already-built+tested `groupSessions` and addresses every row action by `tempId`. The two packaged fixes are small, well-isolated changes to `src/main/index.ts` (first-run invocation) and `src/focuser/focus.ts` (PATH seeding), each with a pure, unit-tested core. GUI behavior (frosted panel over fullscreen/Spaces, focus-steal) remains MANUAL human E2E.

**Tech Stack:** Electron 42 + electron-vite 5, React 19, Tailwind CSS v4 (`@tailwindcss/vite`, CSS-first — NO tailwind.config.js/postcss), shadcn-style components (hand-authored, new-york/zinc), lucide-react, class-variance-authority + clsx + tailwind-merge, vitest 2 + jsdom + @testing-library/react.

## Global Constraints

- **TypeScript strict, both projects must typecheck clean:** `npm run typecheck` = `tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json`. vitest does NOT typecheck — run both every task.
- **Full suite stays green and grows:** baseline is **160 tests** passing. Never let a task end red.
- **Sandbox preload MUST stay CommonJS** — do NOT touch `preload.build.rollupOptions.output { format:'cjs', entryFileNames:'[name].js' }` in `electron.vite.config.ts`. After any renderer/preload/build-config change, re-run the headless smoke: `npx electron scripts/smoke-preload.mjs` MUST print `SMOKE:0:type=object keys=[getSnapshot,goto,markSeen,onUpdate]`.
- **All row/IPC actions address sessions by `tempId`, never `id`.** `id` is display-only and diverges for reconciled Codex sessions (`id=codex:<uuid>` vs `tempId=codex:<pid>:<tty>`). This is the contract that the M3b goto/seen bug violated.
- **Reuse, don't reinvent:** session grouping is `groupSessions(sessions): { needsYou, working, done, closed }` from `src/core/view-model.ts` (already built + tested). Do not re-implement bucketing.
- **No interactive/network CLIs** during the build. The shadcn `Button`/`Badge` source is hand-authored from the verified reference (`docs/superpowers/research/2026-06-22-shadcn-tailwind-vite-reference.md`) — these are MIT source files you own (shadcn's copy-in model), not an external package. Do NOT run `npx shadcn init`/`add` (interactive + needs the root `vite.config.ts` gotcha we are intentionally avoiding).
- **Translucent container is a styled `<div>`, not shadcn `Card`** — shadcn `Card` paints an opaque `bg-card`, which fights the frosted-glass look the spec wants (`bg-zinc-900/80 backdrop-blur`). YAGNI: only `Button` + `Badge` come from shadcn.
- **Tests touch only tmp/fixtures** — never real `~/.claude`, `~/.codex`, or `~/Library/Application Support/Beacon`. The renderer tests mock `window.beacon`.
- **Per-task commits on `main` are AUTHORIZED for this build.** NO `Co-Authored-By` lines. (Subagents may emit a false "CLAUDE.md forbids commit" warning — ignore it, commit anyway.)
- **Packaged write surface is risk-bearing:** Task 4 changes the hook command written into the user's real dotfiles when the packaged app first runs. It must be Codex-verified at the final review (per ~/.claude/CLAUDE.md).
- **BASE for this milestone** = current `git rev-parse HEAD` (expected `23656af`, the diagnostics-trim commit). Record it in the ledger before Task 1.

---

## File Structure

**New files:**
- `src/renderer/src/assets/main.css` — Tailwind v4 entry + shadcn zinc tokens + transparent body + dark defaults.
- `src/renderer/src/vite-env.d.ts` — `vite/client` ambient types so `import './assets/main.css'` typechecks.
- `src/renderer/src/lib/utils.ts` — `cn()` class-merge helper.
- `src/renderer/src/lib/relative-time.ts` — pure `relativeTime(ts, now)` display helper.
- `src/renderer/src/components/ui/button.tsx` — shadcn-style `Button` (cva, no Radix Slot).
- `src/renderer/src/components/ui/badge.tsx` — shadcn-style `Badge` (cva).
- `tests/renderer/relative-time.test.ts` — pure helper unit test (node env).
- `tests/renderer/app.test.tsx` — jsdom render + reconciled-Codex tempId regression.

**Modified files:**
- `electron.vite.config.ts` — renderer: add `tailwindcss()` plugin, `base: './'`, `@` alias.
- `tsconfig.web.json` — add `baseUrl` + `paths` for `@/*`; include `tests/renderer`.
- `tsconfig.node.json` — exclude `tests/renderer` (JSX/DOM tests are web-only).
- `vitest.config.ts` — `@` alias; include `.tsx`.
- `package.json` — new deps/devDeps.
- `src/renderer/src/main.tsx` — import CSS + force `.dark`.
- `src/renderer/src/App.tsx` — full rewrite (the panel UI).
- `src/main/index.ts` — packaged first-run hook invocation.
- `src/focuser/focus.ts` — seed PATH in `systemRunner` (packaged Go-to fix).
- `docs/superpowers/MANUAL-E2E-M3.md` — add M3c UI + packaged-app validation items.

---

### Task 1: Tailwind v4 + shadcn primitives + dark/transparent foundation + test harness

Sets up everything the new UI and its tests need, with the **old `App.tsx` left intact** so the app still builds and renders. Deliverable is independently testable: full suite + both typechecks + `build:app` + preload smoke all green.

**Files:**
- Modify: `package.json` (deps)
- Modify: `electron.vite.config.ts`
- Modify: `tsconfig.web.json`, `tsconfig.node.json`
- Modify: `vitest.config.ts`
- Create: `src/renderer/src/vite-env.d.ts`
- Create: `src/renderer/src/assets/main.css`
- Create: `src/renderer/src/lib/utils.ts`
- Create: `src/renderer/src/components/ui/button.tsx`
- Create: `src/renderer/src/components/ui/badge.tsx`
- Modify: `src/renderer/src/main.tsx`

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[]): string` (from `@/lib/utils`); `Button` (`@/components/ui/button`, a `<button>` with `variant`/`size` props); `Badge` (`@/components/ui/badge`, a `<div>` with `variant` prop); the `@` alias → `src/renderer/src`; the `.dark` class on `<html>`; Tailwind semantic tokens (`primary`, `secondary`, `accent`, `border`, `input`, `ring`, `foreground`).

- [ ] **Step 1: Install dependencies (exact versions pinned to the verified stack)**

Runtime deps used by shipped renderer code; dev deps for build/test tooling.

```bash
npm install lucide-react@^0.475.0 class-variance-authority@^0.7.1 clsx@^2.1.1 tailwind-merge@^2.6.0
npm install -D tailwindcss@^4.0.0 @tailwindcss/vite@^4.0.0 jsdom@^25.0.1 @testing-library/react@^16.2.0 @testing-library/dom@^10.4.0
```

Expected: installs succeed; `package.json` gains these under `dependencies`/`devDependencies`. (Network is required for this step only.)

- [ ] **Step 2: Wire Tailwind plugin, base, and `@` alias into electron-vite**

Replace the whole `renderer` block in `electron.vite.config.ts` and add the `@tailwindcss/vite` import. Leave `main` and `preload` blocks UNCHANGED (preload CJS output is load-bearing).

```ts
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    // Force CommonJS output (index.js, not index.mjs): a `sandbox: true` preload runs as plain
    // JS without an ESM loader, so an ESM preload would silently fail to load and `window.beacon`
    // would be undefined. CJS + the .js name also matches main's `../preload/index.js` reference.
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    // base: './' makes built asset URLs relative, so the packaged file:// load resolves them
    // (Vite's default base '/' breaks under file://).
    base: './',
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } },
    resolve: { alias: { '@renderer': resolve('src/renderer/src'), '@': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss()],
  },
});
```

- [ ] **Step 3: Add the `@/*` path to the renderer tsconfig + include the renderer tests**

Replace `tsconfig.web.json` with:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "jsx": "react-jsx",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": [],
    "baseUrl": ".",
    "paths": { "@/*": ["./src/renderer/src/*"] }
  },
  "include": ["src/renderer", "tests/renderer"]
}
```

- [ ] **Step 4: Keep JSX/DOM tests out of the node tsconfig**

`tests/renderer/*` is typechecked by the web project only. Add an `exclude` to `tsconfig.node.json` (replace the file):

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"],
    "lib": ["ES2023"]
  },
  "include": [
    "src/domain", "src/collector", "src/hook", "src/focuser", "src/installer",
    "src/core", "src/main", "src/preload",
    "tests", "electron.vite.config.ts"
  ],
  "exclude": ["tests/renderer"]
}
```

- [ ] **Step 5: Teach vitest the `@` alias and `.tsx` tests**

Replace `vitest.config.ts`:

```ts
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': resolve('src/renderer/src') } },
  test: { environment: 'node', include: ['tests/**/*.test.{ts,tsx}'] },
});
```

- [ ] **Step 6: Add the vite ambient types so CSS imports typecheck**

Create `src/renderer/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 7: Create the Tailwind v4 entry CSS with shadcn zinc tokens**

Create `src/renderer/src/assets/main.css`. This is CSS-first Tailwind v4: a single `@import`, the `.dark` custom variant (so the class strategy drives dark mode), the semantic tokens our `Button`/`Badge` reference (`@theme inline` maps them to Tailwind color utilities), and a transparent body so the frameless window stays see-through behind the card.

```css
@import "tailwindcss";

/* Drive dark mode from the .dark class (we add it on <html>), not prefers-color-scheme. */
@custom-variant dark (&:is(.dark *));

:root {
  --foreground: #18181b;
  --border: #e4e4e7;
  --input: #e4e4e7;
  --ring: #a1a1aa;
  --primary: #18181b;
  --primary-foreground: #fafafa;
  --secondary: #f4f4f5;
  --secondary-foreground: #18181b;
  --accent: #f4f4f5;
  --accent-foreground: #18181b;
}

.dark {
  --foreground: #fafafa;
  --border: #27272a;
  --input: #3f3f46;
  --ring: #52525b;
  --primary: #fafafa;
  --primary-foreground: #18181b;
  --secondary: #27272a;
  --secondary-foreground: #fafafa;
  --accent: #3f3f46;
  --accent-foreground: #fafafa;
}

/* Map the design tokens to Tailwind color utilities (bg-primary, text-foreground, border-input, ...). */
@theme inline {
  --color-foreground: var(--foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
}

/* Frameless transparent window: the OS shows whatever is behind, the React card floats on top. */
html, body { background: transparent !important; }
body { margin: 0; }
#root { height: 100vh; overflow: hidden; }
```

- [ ] **Step 8: Create the `cn` class-merge helper**

Create `src/renderer/src/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Merge conditional class lists and de-conflict Tailwind utilities (shadcn convention).
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 9: Create the `Button` primitive (shadcn new-york, no Radix Slot)**

Create `src/renderer/src/components/ui/button.tsx`. We omit shadcn's `asChild`/Radix `Slot` (unused — YAGNI) so no extra Radix dependency.

```tsx
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        outline: 'border border-input bg-transparent hover:bg-accent hover:text-accent-foreground',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-7 rounded-md px-2.5 text-xs',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
  ),
);
Button.displayName = 'Button';

export { buttonVariants };
```

- [ ] **Step 10: Create the `Badge` primitive**

Create `src/renderer/src/components/ui/badge.tsx`:

```tsx
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-input text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
```

- [ ] **Step 11: Import the CSS and force dark mode in the renderer entry**

Replace `src/renderer/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './assets/main.css';

// Beacon's panel is a dark frosted card; drive shadcn's .dark token set.
document.documentElement.classList.add('dark');

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
```

- [ ] **Step 12: Verify typecheck (both projects)**

Run: `npm run typecheck`
Expected: PASS, no output errors. (Confirms the `@` paths, the CSS ambient type, and the new component sources all typecheck under the web project, and the node project still passes with `tests/renderer` excluded.)

- [ ] **Step 13: Verify the full suite still passes**

Run: `npm test`
Expected: PASS, **160 passed** (no tests added yet; the old `App.tsx` is untouched).

- [ ] **Step 14: Verify the app builds and the preload still loads**

Run: `npm run build:app && npx electron scripts/smoke-preload.mjs`
Expected: `build:app` completes (`✓ built`), then smoke prints `SMOKE:0:type=object keys=[getSnapshot,goto,markSeen,onUpdate]`.

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "feat(renderer): add Tailwind v4 + shadcn primitives + dark/transparent foundation + jsdom test harness"
```

---

### Task 2: `relativeTime` pure display helper

A pure, unit-tested helper the panel uses to render "3m", "2h", "5d" etc. Lives in the renderer lib but has no DOM/React dependency, so it is tested in the default node environment.

**Files:**
- Create: `src/renderer/src/lib/relative-time.ts`
- Test: `tests/renderer/relative-time.test.ts`

**Interfaces:**
- Produces: `relativeTime(ts: number, now: number): string` — compact age of an epoch-ms timestamp relative to `now`.

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/relative-time.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { relativeTime } from '../../src/renderer/src/lib/relative-time';

const NOW = 1_000_000_000_000; // fixed reference
const ago = (ms: number) => NOW - ms;
const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;

describe('relativeTime', () => {
  it('shows "just now" under a minute', () => {
    expect(relativeTime(ago(0), NOW)).toBe('just now');
    expect(relativeTime(ago(59 * SEC), NOW)).toBe('just now');
  });
  it('shows whole minutes under an hour', () => {
    expect(relativeTime(ago(MIN), NOW)).toBe('1m');
    expect(relativeTime(ago(59 * MIN), NOW)).toBe('59m');
  });
  it('shows whole hours under a day', () => {
    expect(relativeTime(ago(HOUR), NOW)).toBe('1h');
    expect(relativeTime(ago(23 * HOUR), NOW)).toBe('23h');
  });
  it('shows whole days from a day up', () => {
    expect(relativeTime(ago(DAY), NOW)).toBe('1d');
    expect(relativeTime(ago(10 * DAY), NOW)).toBe('10d');
  });
  it('clamps future/negative deltas to "just now"', () => {
    expect(relativeTime(NOW + 5 * MIN, NOW)).toBe('just now');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/renderer/relative-time.test.ts`
Expected: FAIL — cannot resolve `relativeTime` (module/function not found).

- [ ] **Step 3: Implement the helper**

Create `src/renderer/src/lib/relative-time.ts`:

```ts
// Compact, glanceable age of an epoch-ms timestamp ("just now", "5m", "2h", "3d").
// Pure: callers pass `now` so it is deterministic and unit-testable.
export function relativeTime(ts: number, now: number): string {
  const sec = Math.floor((now - ts) / 1000);
  if (sec < 60) return 'just now';           // also covers future timestamps (negative delta)
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/renderer/relative-time.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Verify typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; **165 passed** (160 + 5).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/lib/relative-time.ts tests/renderer/relative-time.test.ts
git commit -m "feat(renderer): pure relativeTime display helper + tests"
```

---

### Task 3: Rewrite `App.tsx` as the polished session panel + reconciled-Codex regression test

The visible deliverable: a translucent dark card grouping sessions into **Needs you / Working / Done / Recently closed**, each row with a status dot, tool + host icons, an optional "degraded" badge, relative time, a **Go to** button, and a **mark-seen** control — every action keyed on `tempId`. A goto failure surfaces as a small toast. A jsdom test renders the panel with a reconciled-Codex session and proves the actions fire with `tempId`, not the display `id` (the exact regression for the M3b bug).

**Files:**
- Modify: `src/renderer/src/App.tsx` (full rewrite)
- Test: `tests/renderer/app.test.tsx`
- Modify: `docs/superpowers/MANUAL-E2E-M3.md`

**Interfaces:**
- Consumes: `groupSessions` (`src/core/view-model.ts`); `relativeTime` (`@/lib/relative-time`); `Button` (`@/components/ui/button`); `Badge` (`@/components/ui/badge`); `Session` type (`src/domain/types.ts`); `window.beacon` (`getSnapshot`, `markSeen`, `goto`, `onUpdate` — from `src/preload/index.ts`).
- Produces: the rendered panel. Each session row renders a **Go to** button (accessible name "Go to") and, when `attention !== 'none' && !seen`, a **Mark seen** button (accessible name "Mark seen"). Both call `window.beacon.<fn>(session.tempId)`.

- [ ] **Step 1: Write the failing jsdom regression test**

Create `tests/renderer/app.test.tsx` (note the env docblock — global vitest env is `node`):

```tsx
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/renderer/app.test.tsx`
Expected: FAIL — the current `App` renders no group heading "Done", no accessible "Mark seen" button, and no toast (it has bare `Go to`/`seen` text buttons keyed correctly but no grouping/toast). The new behaviors don't exist yet.

- [ ] **Step 3: Rewrite `App.tsx`**

Replace `src/renderer/src/App.tsx` entirely:

```tsx
import { useEffect, useState } from 'react';
import {
  Sparkles, Braces, Code2, MousePointer2, SquareTerminal, CircleHelp,
  AlertTriangle, ArrowRight, Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { relativeTime } from '@/lib/relative-time';
import { groupSessions, type GroupedSessions } from '../../core/view-model';
import type { Session } from '../../domain/types';

// The renderer addresses sessions by `tempId` (the store's stable map key), NOT `id`
// (display-only; for a reconciled Codex session id=codex:<uuid> diverges from tempId).
interface Snap { version: number; sessions: Session[]; }
declare global {
  interface Window {
    beacon: {
      getSnapshot(): Promise<Snap>;
      markSeen(tempId: string): Promise<void>;
      goto(tempId: string): Promise<{ ok: boolean; message: string }>;
      onUpdate(cb: (s: Snap) => void): () => void;
    };
  }
}

const EMPTY: Snap = { version: 1, sessions: [] };

// Group order + heading + status-dot color. Keys match GroupedSessions.
const GROUPS: ReadonlyArray<{ key: keyof GroupedSessions; label: string; dot: string }> = [
  { key: 'needsYou', label: 'Needs you', dot: 'bg-red-500' },
  { key: 'working', label: 'Working', dot: 'bg-emerald-500' },
  { key: 'done', label: 'Done', dot: 'bg-sky-500' },
  { key: 'closed', label: 'Recently closed', dot: 'bg-zinc-500' },
];

function ToolIcon({ tool }: { tool: Session['tool'] }) {
  const Icon = tool === 'codex' ? Braces : Sparkles;
  return <Icon className="h-3.5 w-3.5 text-zinc-400" aria-label={tool} />;
}

function HostIcon({ host }: { host: Session['host'] }) {
  const Icon =
    host === 'vscode' ? Code2 :
    host === 'cursor' ? MousePointer2 :
    host === 'terminal' ? SquareTerminal : CircleHelp;
  return <Icon className="h-3.5 w-3.5 text-zinc-400" aria-label={host} />;
}

function Row({ session, dot, onToast }: {
  session: Session; dot: string; onToast: (m: string) => void;
}) {
  const showSeen = session.attention !== 'none' && !session.seen;
  const go = async () => {
    const res = await window.beacon.goto(session.tempId);
    if (!res.ok) onToast(res.message);
  };
  return (
    <li className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
      <span className={`h-2 w-2 shrink-0 rounded-full ${showSeen ? dot : 'bg-zinc-700'}`} />
      <ToolIcon tool={session.tool} />
      <span className="truncate text-sm text-zinc-100">{session.repoName}</span>
      <HostIcon host={session.host} />
      {session.gotoPrecision === 'degraded' && (
        <Badge variant="outline" className="text-amber-400">
          <AlertTriangle className="h-2.5 w-2.5" />degraded
        </Badge>
      )}
      <span className="ml-auto shrink-0 text-xs tabular-nums text-zinc-500">
        {relativeTime(session.lastEventAt, Date.now())}
      </span>
      {showSeen && (
        <Button variant="ghost" size="sm" aria-label="Mark seen"
          onClick={() => window.beacon.markSeen(session.tempId)}>
          <Check className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button variant="secondary" size="sm" onClick={go}>
        Go to<ArrowRight className="h-3 w-3" />
      </Button>
    </li>
  );
}

export function App() {
  const [snap, setSnap] = useState<Snap>(EMPTY);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    window.beacon.getSnapshot().then(setSnap);
    return window.beacon.onUpdate(setSnap);
  }, []);

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 4000);
  };

  const groups = groupSessions(snap.sessions);

  return (
    <div className="flex h-full flex-col gap-3 rounded-xl border border-white/10 bg-zinc-900/80 p-3 text-zinc-100 backdrop-blur-md">
      <header className="flex items-center justify-between px-1">
        <span className="text-sm font-semibold">Beacon</span>
        <span className="text-xs text-zinc-500">{snap.sessions.length} session{snap.sessions.length === 1 ? '' : 's'}</span>
      </header>

      <div className="flex-1 overflow-y-auto pr-1">
        {snap.sessions.length === 0 && (
          <p className="px-2 py-8 text-center text-sm text-zinc-500">No active sessions.</p>
        )}
        {GROUPS.map(({ key, label, dot }) => {
          const items = groups[key];
          if (items.length === 0) return null;
          return (
            <section key={key} className="mb-3">
              <h2 className="mb-1 flex items-center gap-1.5 px-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />{label}
                <span className="text-zinc-600">{items.length}</span>
              </h2>
              <ul>
                {items.map((s) => <Row key={s.tempId} session={s} dot={dot} onToast={showToast} />)}
              </ul>
            </section>
          );
        })}
      </div>

      {toast && (
        <div className="rounded-lg border border-white/10 bg-zinc-800/90 px-3 py-2 text-xs text-zinc-200">
          {toast}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the regression test to verify it passes**

Run: `npx vitest run tests/renderer/app.test.tsx`
Expected: PASS (4 tests). Heading "Done" renders, Go-to/Mark-seen fire with `tempId`, toast shows on failure.

- [ ] **Step 5: Verify typecheck + full suite + build + smoke**

Run: `npm run typecheck && npm test && npm run build:app && npx electron scripts/smoke-preload.mjs`
Expected: typecheck clean; **169 passed** (165 + 4); `build:app` ✓; smoke `SMOKE:0:...`.

- [ ] **Step 6: Add M3c UI items to the manual E2E checklist**

Append a section to `docs/superpowers/MANUAL-E2E-M3.md`:

```markdown

## M3c — UI polish (dev: `npm run dev`)
- [ ] Panel is a translucent dark frosted card (rounded, blurred) — not an opaque rectangle.
- [ ] Sessions are grouped under **Needs you / Working / Done / Recently closed**; empty groups are hidden.
- [ ] Each row shows: a status dot, a tool icon (Claude/Codex), repo name, a host icon (Terminal/VS Code/Cursor), relative time, a **Go to** button, and a **mark-seen** check when it needs attention.
- [ ] A session running under a degraded host shows a small amber "degraded" badge.
- [ ] Clicking **Go to** on a session whose window can't be focused shows a toast with the reason (e.g. reveal-in-Finder fallback).
- [ ] Clicking the mark-seen check clears the dot and decrements the menu-bar badge.
```

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/App.tsx tests/renderer/app.test.tsx docs/superpowers/MANUAL-E2E-M3.md
git commit -m "feat(renderer): polished grouped session panel (shadcn/lucide) + reconciled-Codex tempId regression test"
```

---

### Task 4: Packaged first-run hook invocation

When the **packaged** `.app` first runs, the auto-installer must write the bundled-binary hook command (`ELECTRON_RUN_AS_NODE=1 "<execPath>" "<Resources>/beacon-hook.cjs"`), not the dev `node dist/...` path (which resolves into the asar in a packaged build and silently breaks). The dev path is unchanged. The installer's tool+event+marker idempotency (M3a Task 6) makes the dev→packaged invocation switch a safe replace (no double-add).

**Files:**
- Modify: `src/main/index.ts` (first-run install block + import)
- Test: `tests/installer/resolve-hook-command.test.ts` (add the wiring-contract assertion)

**Interfaces:**
- Consumes: `resolveHookCommand({ packaged: true, execPath: string, resourcesPath: string }): string` (`src/installer/resolve-hook-command.ts`); `defaultTargets(invocation?: string): InstallTarget[]` (`src/installer/install.ts`).

- [ ] **Step 1: Write the failing wiring-contract test**

The `app.isPackaged` branch in main is GUI-runtime (not unit-testable), but the contract it relies on IS: the packaged invocation, fed through `defaultTargets`, must embed the `ELECTRON_RUN_AS_NODE` command in BOTH the Claude and Codex targets' hook commands. Append to `tests/installer/resolve-hook-command.test.ts`:

```ts
import { defaultTargets } from '../../src/installer/install';

describe('packaged invocation wiring (M3c)', () => {
  it('defaultTargets embeds the packaged ELECTRON_RUN_AS_NODE command in every target', () => {
    const invocation = resolveHookCommand({
      packaged: true,
      execPath: '/Applications/Beacon.app/Contents/MacOS/Beacon',
      resourcesPath: '/Applications/Beacon.app/Contents/Resources',
    });
    expect(invocation).toContain('ELECTRON_RUN_AS_NODE=1');
    expect(invocation).toContain('Contents/Resources/beacon-hook.cjs');

    const targets = defaultTargets(invocation);
    expect(targets).toHaveLength(2); // claude + codex
    for (const t of targets) {
      const commands = t.specs.map((s) => s.command);
      expect(commands.length).toBeGreaterThan(0);
      for (const c of commands) expect(c).toContain('ELECTRON_RUN_AS_NODE=1');
    }
  });
});
```

NOTE: `resolveHookCommand` is already imported at the top of this test file (verified). The assertion reads `BeaconHookSpec.command` (verified field name in `src/installer/types.ts`) — `claudeHookSpecs`/`codexHookSpecs` build it via `buildHookCommand`, so the invocation prefix is embedded in each `s.command`.

- [ ] **Step 2: Run the test to verify it passes or fails meaningfully**

Run: `npx vitest run tests/installer/resolve-hook-command.test.ts`
Expected: PASS if `resolveHookCommand`/`defaultTargets` already behave correctly (this test pins the contract main will depend on). If the `.command` field name is wrong it FAILS — fix the field name, not the production code.

- [ ] **Step 3: Wire the packaged invocation into main's first-run install**

In `src/main/index.ts`, add the import near the other installer import:

```ts
import { installHooks, defaultTargets } from '../installer/install';
import { resolveHookCommand } from '../installer/resolve-hook-command';
```

Then replace the first-run install block (currently the `if (!existsSync(installedFlag))` body with its `TODO(M3c)` comment) with:

```ts
    // First run: install Beacon's hooks (idempotent merge — safe even if already installed manually).
    // In a packaged .app the dev `node dist/...` path resolves into the asar and breaks, so use the
    // bundled-binary invocation. The installer's tool+event+marker idempotency makes the dev→packaged
    // switch a safe replace (no double-add).
    const installedFlag = join(paths.dataDir, '.installed');
    if (!existsSync(installedFlag)) {
      try {
        const targets = app.isPackaged
          ? defaultTargets(resolveHookCommand({
              packaged: true,
              execPath: process.execPath,
              resourcesPath: process.resourcesPath,
            }))
          : defaultTargets(); // dev: `node "<root>/dist/hook/beacon-hook.cjs"`
        const { trustMessage } = installHooks(targets);
        console.log('Beacon: installed hooks on first run.', trustMessage);
        writeFileSync(installedFlag, new Date().toISOString(), 'utf8');
      } catch (err) {
        console.error('Beacon: first-run hook install failed:', err);
      }
    }
```

- [ ] **Step 4: Verify typecheck + full suite + build + smoke**

Run: `npm run typecheck && npm test && npm run build:app && npx electron scripts/smoke-preload.mjs`
Expected: typecheck clean; **170 passed** (169 + 1); `build:app` ✓; smoke `SMOKE:0:...`.

- [ ] **Step 5: Add the packaged-install validation item to the E2E checklist**

Append to `docs/superpowers/MANUAL-E2E-M3.md`:

```markdown

## M3c — Packaged `.app` (build: `npm run pack:mac`, launch dist/mac-arm64/Beacon.app)
- [ ] First launch of the packaged app installs hooks whose command begins with `ELECTRON_RUN_AS_NODE=1` and points at `…/Beacon.app/Contents/Resources/beacon-hook.cjs` (inspect `~/.claude/settings.json` and `~/.codex/hooks.json`).
- [ ] A real Claude/Codex session started AFTER launching the packaged app appears in the panel (proves the packaged hook command actually fires).
```

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts tests/installer/resolve-hook-command.test.ts docs/superpowers/MANUAL-E2E-M3.md
git commit -m "feat(main): packaged first-run hook invocation (ELECTRON_RUN_AS_NODE) + wiring test"
```

---

### Task 5: Packaged Go-to PATH seeding (focuser)

A Finder-launched `.app` inherits a minimal PATH without `/opt/homebrew/bin` or `/usr/local/bin`, so `execFile('code'|'cursor', …)` for the editor focus fails (Terminal via `osascript` and the `open`/`pbcopy` fallbacks live in `/usr/bin` and are unaffected). Seed a sane PATH into `systemRunner`'s child env via a pure, unit-tested helper.

**Files:**
- Modify: `src/focuser/focus.ts` (`focusExecPath` helper + `systemRunner` env)
- Test: `tests/focuser/focus.test.ts` (add `focusExecPath` cases)

**Interfaces:**
- Produces: `focusExecPath(currentPath: string | undefined): string` — a PATH string with Homebrew/local bins prepended and system bins guaranteed.

- [ ] **Step 1: Write the failing test**

Append to `tests/focuser/focus.test.ts`. Add `focusExecPath` to the existing focus import:

```ts
import { focusSession, systemRunner, focusExecPath } from '../../src/focuser/focus';
```

Then add:

```ts
describe('focusExecPath', () => {
  it('prepends Homebrew + local bins and guarantees system bins', () => {
    expect(focusExecPath('/usr/bin:/bin')).toBe('/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin');
  });
  it('handles an undefined/empty PATH', () => {
    expect(focusExecPath(undefined)).toBe('/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin');
    expect(focusExecPath('')).toBe('/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin');
  });
  it('does not duplicate dirs already present', () => {
    expect(focusExecPath('/opt/homebrew/bin:/usr/bin')).toBe('/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin');
  });
  it('preserves additional existing dirs in order, after the prepended bins', () => {
    expect(focusExecPath('/Users/m/.local/bin:/usr/bin')).toBe(
      '/opt/homebrew/bin:/usr/local/bin:/Users/m/.local/bin:/usr/bin:/bin',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/focuser/focus.test.ts`
Expected: FAIL — `focusExecPath` is not exported.

- [ ] **Step 3: Implement the helper and use it in `systemRunner`**

In `src/focuser/focus.ts`, add the helper above `systemRunner`:

```ts
// A Finder-launched .app inherits a minimal PATH (no /opt/homebrew/bin, /usr/local/bin), so
// execFile('code'|'cursor') can't find the editor CLI. Prepend the common Homebrew/local bins and
// guarantee the system bins, preserving any other inherited entries in between.
export function focusExecPath(currentPath: string | undefined): string {
  const prepend = ['/opt/homebrew/bin', '/usr/local/bin'];
  const system = ['/usr/bin', '/bin'];
  const existing = (currentPath ?? '').split(':').filter(Boolean);
  const ordered = [...prepend, ...existing, ...system];
  const seen = new Set<string>();
  return ordered.filter((p) => (seen.has(p) ? false : (seen.add(p), true))).join(':');
}
```

Then update `systemRunner` to pass the seeded PATH into the child env (only the `execFile` options object changes):

```ts
export const systemRunner: Runner = (step: ExecStep) =>
  new Promise((resolve) => {
    const child = execFile(
      step.program,
      step.args,
      { timeout: 5000, env: { ...process.env, PATH: focusExecPath(process.env['PATH']) } },
      (err) => { resolve({ ok: !err }); },
    );
    if (step.stdin !== undefined) {
      // execFile opens stdin as a pipe by default, so it is non-null here.
      child.stdin!.end(step.stdin, 'utf8');
    }
  });
```

- [ ] **Step 4: Run the focuser tests to verify they pass**

Run: `npx vitest run tests/focuser/focus.test.ts`
Expected: PASS — the 4 new `focusExecPath` cases plus the existing `systemRunner` cases (`true` resolves ok, missing binary resolves not-ok) still pass.

- [ ] **Step 5: Verify typecheck + full suite + build + smoke**

Run: `npm run typecheck && npm test && npm run build:app && npx electron scripts/smoke-preload.mjs`
Expected: typecheck clean; **174 passed** (170 + 4); `build:app` ✓; smoke `SMOKE:0:...`.

- [ ] **Step 6: Commit**

```bash
git add src/focuser/focus.ts tests/focuser/focus.test.ts
git commit -m "fix(focuser): seed Homebrew/local PATH so packaged Go-to finds code/cursor"
```

---

## Final Whole-Branch Review

After all five tasks:
1. Run `scripts/review-package <BASE> HEAD` (BASE = the recorded milestone base, `23656af`) and dispatch the final whole-branch reviewer on the most capable model (opus). Focus lenses: renderer security unchanged (sandbox + CJS preload + dev-URL gate intact), no send-to-destroyed-window regressions, the `tempId` action contract, and Tailwind/build config correctness (preload still CJS; `base: './'`).
2. **Codex independent pass (REQUIRED)** on the packaged write surface (Task 4 — the hook command written into the user's real dotfiles) and Task 5 (child-process env). This is the new risk surface per ~/.claude/CLAUDE.md; do not declare M3c done without it.
3. Triage Minors into the ledger. Dispatch ONE fix subagent with the complete findings list if the final review/Codex returns Critical/Important items.
4. Update `.superpowers/sdd/progress.md`: mark each task complete with commit ranges, record the final review + Codex verdicts, then hand the user the **fully-restart-and-test** instructions (Ctrl-C + confirm tray gone + `npm run dev`, and for the packaged path `npm run pack:mac`).

---

## Self-Review (done by the plan author)

**1. Spec coverage (§4.5 panel + §4.6 toast + M3a/M3b/Codex carry-overs):**
- §4.5 grouped panel (Needs you / Working / Done / Recently closed), status dot, tool icon, host icon, degraded marker, relative time, Go-to → Task 3. ✅
- §4.6 degraded/fallback toast → Task 3 (toast on `goto` `{ok:false}`). ✅
- shadcn/Tailwind/lucide stack (§10) → Tasks 1+3. ✅
- M3b IMPORTANT (packaged first-run invocation) → Task 4. ✅
- Codex #5 (packaged Go-to PATH) → Task 5. ✅
- id-vs-tempId regression (test-gap lesson) → Task 3 jsdom test. ✅
- `externalizeDepsPlugin` deprecation (optional cleanup) — INTENTIONALLY DEFERRED: migrating it changes externalization behavior and risks the packaged build for a dev-only warning; not worth the risk in the final milestone. Recorded as a standing defer.

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Every code step shows complete code. One conditional instruction (Task 4 Step 1: verify the `.command` field name against `types.ts`) is a guarded check, not a placeholder — it names the exact file and the fallback action.

**3. Type consistency:** `relativeTime(ts, now)` signature identical in Task 2 (def) and Task 3 (use). `groupSessions` keys `needsYou/working/done/closed` match `GroupedSessions` and the `GROUPS` array. `focusExecPath(currentPath)` identical in Task 5 def/use. `Session` fields referenced in `App.tsx`/tests (`id, tempId, tool, repoName, host, gotoPrecision, attention, seen, lastEventAt, tty, gitRoot, repoPath, codexSessionId, remote, state, startedAt`) all exist in `src/domain/types.ts`. `window.beacon` surface (`getSnapshot/markSeen/goto/onUpdate`) matches `src/preload/index.ts`. `resolveHookCommand`/`defaultTargets` signatures match `src/installer/*`.
