# Beacon docs site

The Beacon documentation website, built with [Nextra 4](https://nextra.site) (Next.js App Router).
Self-contained — it has its own dependencies and does not touch the Electron app's toolchain.

## Develop

```bash
cd website
npm install
npm run dev      # http://localhost:3000
npm run build    # production build (prerenders all pages)
```

Content lives in `content/` as MDX; `_meta.js` files define the sidebar order and labels.

## Deploy (Vercel)

1. Import the GitHub repo (`Marcussy34/beacon`) into [Vercel](https://vercel.com).
2. In **Project → Settings → Build & Deployment**, set **Root Directory** to `website`.
3. Framework preset: **Next.js** (auto-detected). Deploy.

Vercel then auto-deploys on every push to `main`. Attach a custom domain later in the project settings.

## Note on dependencies

`zod` is pinned to `4.3.6` via `overrides` in `package.json`. Nextra 4.6.x throws
`Invalid input: expected nonoptional, received undefined → at children` with Zod `4.4.x`
([nextra#4989](https://github.com/shuding/nextra/issues/4989)) — the pin avoids that. Revisit once
Nextra ships a release that is compatible with Zod `4.4.x`.
