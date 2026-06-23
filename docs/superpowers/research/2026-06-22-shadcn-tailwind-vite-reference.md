# Beacon M3c — shadcn/ui + Tailwind v4 + lucide in electron-vite (verified 2026-06-22)

Source research for the M3c UI plan. Verified against tailwindcss.com (v4.3), ui.shadcn.com/docs/installation/vite + /tailwind-v4 + /components-json, lucide.dev, electron-vite.org/config + 2025 community electron-vite+shadcn guides.

## Tailwind v4 (CSS-first — NO tailwind.config.js, NO postcss)
- Install: `npm install -D tailwindcss @tailwindcss/vite`.
- Add `tailwindcss()` to `renderer.plugins` in `electron.vite.config.ts` (it's a standard Vite plugin; works in the renderer).
- CSS entry (`src/renderer/src/assets/main.css`): single line `@import "tailwindcss";` (replaces the old @tailwind directives).
- Dark mode = `.dark` class on `<html>` (class strategy is the v4 default). shadcn writes `:root`/`.dark` CSS vars into the entry CSS.

## shadcn init (Vite + TS + Tailwind v4)
- **CRITICAL GOTCHA:** the `shadcn` CLI looks for `vite.config.*` in the project ROOT — it does NOT recognize `electron.vite.config.ts`. Create a root `vite.config.ts` (copy of the renderer config bits with the `@` alias) so the CLI detects Vite. Keep `electron.vite.config.ts` as the actual build config.
- **CRITICAL GOTCHA:** electron-vite renderer needs `base: './'` so packaged `file://` loads find relative assets (Vite defaults to `/` which breaks file://). Put `base: './'` in the `renderer` config.
- Aliases (BOTH places): `electron.vite.config.ts` `renderer.resolve.alias['@'] = resolve('src/renderer/src')`; AND `tsconfig.web.json` (the renderer tsconfig — NOT tsconfig.app.json) `compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/renderer/src/*"] } }`. Root `tsconfig.json` can mirror the paths.
- `npx shadcn@latest init` → style `new-york`, baseColor `zinc`, cssVariables yes. Creates `components.json`, `src/renderer/src/lib/utils.ts` (`cn`), CSS vars in the entry CSS (+ `tw-animate-css` import).
- `components.json`: `tailwind.config: ""` (blank for v4), `tailwind.css: "src/renderer/src/assets/main.css"`, `rsc: false`, `tsx: true`, aliases all `@/...`.

## Components (smallest set for the session-list popover)
- `npx shadcn@latest add button badge card scroll-area separator`
- Land in `src/renderer/src/components/ui/`. Peer deps auto: `@radix-ui/react-scroll-area`, `@radix-ui/react-separator`, `class-variance-authority`, `clsx`, `tailwind-merge`. Badge/Card/Separator are pure HTML+CSS; Button uses cva; ScrollArea uses Radix.
- `npm install lucide-react`; import individual icons (`import { Circle, ... } from 'lucide-react'`).

## Translucent dark panel (frameless transparent window)
- Entry CSS: `html, body { background: transparent !important; }` (overrides v4 preflight's default body bg).
- Card look: `bg-zinc-900/80 backdrop-blur-md rounded-xl border border-white/10`.
- Set dark mode: `document.documentElement.classList.add('dark')` (or a provider).
- Window already: `{ frame:false, transparent:true }` (createPanel). Optional `vibrancy: 'under-window'|'hud'` for native frosted glass.

## Files to create/modify (summary)
| File | Change |
|---|---|
| electron.vite.config.ts | renderer: add `tailwindcss()` plugin, `@` alias, `base: './'` |
| vite.config.ts (NEW root) | minimal Vite config w/ `@` alias so shadcn CLI detects Vite |
| tsconfig.web.json | add baseUrl + `paths {"@/*": ["./src/renderer/src/*"]}` |
| src/renderer/src/assets/main.css (NEW) | `@import "tailwindcss";` + shadcn CSS vars + transparent body; import it in main.tsx |
| components.json (generated) | config blank/v4 + aliases |
| src/renderer/src/lib/utils.ts (generated) | `cn` |
| src/renderer/src/components/ui/* (generated) | button/badge/card/scroll-area/separator |

## Gotchas recap
- root `vite.config.ts` REQUIRED for shadcn CLI (electron.vite.config.ts not detected).
- `base: './'` REQUIRED for packaged file:// asset loads.
- Use `tsconfig.web.json` (not tsconfig.app.json) for renderer paths.
- transparent body CSS needed so the frameless window stays see-through behind the card.
