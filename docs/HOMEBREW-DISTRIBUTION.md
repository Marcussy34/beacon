# Distributing Beacon via Homebrew

How to get Beacon to the point where a user runs **one command** and then presses
**⌘⇧Space** to summon it:

```bash
brew install --cask marcussy34/beacon/beacon
```

This is a planning/reference doc — it explains *what* needs to happen and *in what order*.
Nothing here is automated yet; it's the map, not the button.

> The deeper signing/notarization runbook already lives in [`RELEASING.md`](./RELEASING.md).
> This doc is the higher-level "from zero to `brew install`" picture, including the
> **unsigned-beta-now / signed-later** split.

---

## TL;DR — where things stand

About 90% of this is **already built**. The remaining work is mostly *operational*
(cut a release, create a tap repo), not code.

| Piece | Status |
| --- | --- |
| Build → signed/notarized DMG + ZIP (arm64 + x64) | ✅ `electron-builder.yml` |
| Release on tag push (build + publish to GitHub Releases) | ✅ `.github/workflows/release.yml` |
| Global shortcut **⌘⇧Space** (configurable, persisted) | ✅ already the default |
| Menu-bar-only app (no Dock icon), Apple Events entitlements | ✅ `electron-builder.yml` + entitlements |
| Homebrew cask file (template) | ✅ `Casks/beacon.rb` (placeholder checksums) |
| LICENSE | ✅ MIT, committed |
| **App icon** (`build/icon.icns`) | ❌ missing |
| **First release cut** (tag → artifacts on GitHub) | ❌ not done (version still `0.0.1`) |
| **Homebrew tap repo** `Marcussy34/homebrew-beacon` | ❌ doesn't exist yet |
| **Real cask checksums** | ❌ placeholders until artifacts exist |

---

## The shortcut is already done

The user's desired flow — install, then **⌘⇧Space** to open — already works out of the box.

- `src/main/shortcut.ts` → `DEFAULT_ACCELERATOR = 'CommandOrControl+Shift+Space'` (= ⌘⇧Space on macOS).
- It's a **global** shortcut (works system-wide, even over fullscreen apps), registered in
  `src/main/index.ts` on launch.
- It's **configurable** and persisted to `shortcut.json` in the app's data dir, so a user can
  rebind it if ⌘⇧Space conflicts with something else.
- If the combo is already taken by another app, registration fails *silently* and the user can
  still summon Beacon from the menu-bar icon.

**Nothing to do here.** Once the app is installed, ⌘⇧Space works.

---

## How Homebrew distribution actually works (the mental model)

There are two GitHub repos involved:

1. **The app repo** — `github.com/Marcussy34/beacon` (this one). It builds the `.dmg`/`.zip`
   artifacts and attaches them to a **GitHub Release** for each version tag.
2. **The tap repo** — `github.com/Marcussy34/homebrew-beacon` (**must be created**). A "tap" is
   just a git repo named `homebrew-<something>` that contains cask files. It holds
   `Casks/beacon.rb`, which points at the DMGs in the app repo's Releases.

When a user runs `brew install --cask marcussy34/beacon/beacon`, Homebrew reads it as:

```
marcussy34 / beacon            / beacon
└ GitHub user  └ tap "homebrew-beacon"  └ cask token → Casks/beacon.rb
```

So `Casks/beacon.rb` in *this* repo is the **source template**; the *live* copy users install
from lives in the separate `homebrew-beacon` tap repo. (You could keep them in sync by hand, or
automate it — see "Open choices" below.)

> Why a personal tap and not the official `homebrew-cask`? The official cask repo requires a
> notable, stable project (stars, age, signed builds). A personal tap has none of those
> requirements and is the right call for a new app.

---

## The two paths

You chose **"map both paths"**: ship an unsigned beta now, upgrade to signed/notarized later
**without rework**. That works because `electron-builder` *skips* signing when no Developer ID
cert is present — the **same** workflow produces unsigned artifacts today and signed ones the
day you add the secrets. No pipeline changes needed to flip between them.

### Path A — Unsigned beta (ship today, no Apple account, $0)

Good enough for early testers. The tradeoffs, and how to soften them:

- **Apple Silicon launches fine** — electron-builder ad-hoc-signs by default, which macOS
  requires just to run a binary on arm64.
- **Gatekeeper still warns** on first open ("Beacon cannot be verified…"), because the app
  isn't notarized. Soften it by telling users to install with:
  ```bash
  brew install --cask --no-quarantine marcussy34/beacon/beacon
  ```
  `--no-quarantine` skips the attribute that triggers the scary dialog. (Document this in the
  cask `caveats` and the README for the beta.)
- **Automation ("Go to") permission may reset between versions.** The ad-hoc signature changes
  every build, and macOS ties the granted Apple-Events permission to the app's signature. So
  testers may have to re-approve Automation after each update. A real Developer ID signature
  fixes this (stable identity → permission sticks).

**Steps for Path A:**

1. Align the version: `npm version 0.1.0 --no-git-tag-version` (cask already expects `0.1.0`).
2. Make the workflow tolerate "no secrets": confirm `release.yml` still runs when the `CSC_*`
   and `APPLE_*` secrets are empty. electron-builder will log "skipped signing/notarization"
   and still publish unsigned DMGs. (No code change expected — just verify on the first run.)
3. Tag + push → CI builds and publishes the unsigned `Beacon-0.1.0-{arm64,x64}.dmg` to a Release.
4. Create the **tap repo** and add the cask (see "The tap repo" below), with `--no-quarantine`
   noted in `caveats`.
5. Compute the real `sha256` of each DMG, paste into the tap's cask, commit.
6. Test: `brew install --cask --no-quarantine marcussy34/beacon/beacon` on a clean machine.

### Path B — Signed + notarized (the public release)

This is the "no warnings, permission sticks" version. The pipeline is **already built for it**;
you're only adding credentials. Full detail in [`RELEASING.md`](./RELEASING.md). In short:

1. **Apple Developer Program** — enroll ($99/yr).
2. **Developer ID Application certificate** — create it, export as `.p12`.
3. **Add 5 GitHub secrets** to the app repo: `CSC_LINK` (base64 of the `.p12`),
   `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
   (Or the App Store Connect API-key route — see RELEASING.md.)
4. **Re-cut the release** (e.g. `v0.1.1` or `v1.0.0`). Same `git tag` + push. The *identical*
   workflow now signs + notarizes + staples the DMGs.
5. **Update the cask**: new version + new checksums; **drop `--no-quarantine`** from the docs —
   it's no longer needed.

The only thing that changes between A and B is *which secrets exist* and *whether `--no-quarantine`
is in the instructions*. Code and workflow are unchanged → no rework.

---

## The tap repo (required for either path)

`brew install --cask marcussy34/beacon/beacon` can't resolve until this exists.

1. Create a **public** GitHub repo named exactly **`homebrew-beacon`** under `Marcussy34`.
2. Add the cask at `Casks/beacon.rb` (start from this repo's `Casks/beacon.rb` template).
3. Fill in:
   - `version` → the released version (e.g. `0.1.0`),
   - both `sha256` values → real checksums:
     ```bash
     shasum -a 256 Beacon-0.1.0-arm64.dmg   # → on_arm sha256
     shasum -a 256 Beacon-0.1.0-x64.dmg     # → on_intel sha256
     ```
   - (Path A only) add `--no-quarantine` guidance to `caveats`.
4. Commit + push.

The cask's download URLs already point at
`github.com/Marcussy34/beacon/releases/download/v#{version}/Beacon-#{version}-<arch>.dmg`,
which matches what the release workflow uploads — so once the Release exists and the checksums
are filled in, install works.

---

## Open choices (not yet decided)

These two don't block the design; pick when you're ready.

### 1. How to keep the cask updated each release

- **Automate via CI (recommended for low effort):** add a step (in `release.yml` or a follow-on
  workflow) that, after the build, computes the DMG checksums and commits/PRs the updated
  `Casks/beacon.rb` into the `homebrew-beacon` tap. One tag push then ships the app *and* updates
  Homebrew. Cost: a cross-repo write token (a fine-grained PAT or deploy key) stored as a secret.
- **Manual per release:** run `shasum` and hand-edit the tap's cask each time. Zero extra infra,
  a couple minutes per release. Already documented in `RELEASING.md`.

### 2. App icon (`build/icon.icns`)

Currently missing → the `.app`/DMG would show the generic Electron icon.

- **Provide a logo:** hand over a 1024×1024 PNG (or SVG); generate the multi-resolution `.icns`
  and drop it at `build/icon.icns` (electron-builder picks it up automatically).
- **Generate a placeholder:** derive a simple colored icon from the existing menu-bar glyph in
  `resources/` so the build looks intentional; swap later.
- **Skip for beta:** ship with the default icon, track as a TODO before the public/signed release.

---

## End-to-end checklist

Minimum to make `brew install` work (Path A / unsigned beta):

- [ ] Decide app-icon approach (or accept the default for beta)
- [ ] `npm version 0.1.0 --no-git-tag-version` (sync app version to the cask)
- [ ] `git tag v0.1.0 && git push --follow-tags`
- [ ] Confirm the Release workflow published `Beacon-0.1.0-arm64.dmg` + `-x64.dmg`
- [ ] Create `github.com/Marcussy34/homebrew-beacon` (public)
- [ ] Add `Casks/beacon.rb` there with real `version` + `sha256` (+ `--no-quarantine` note)
- [ ] Verify on a clean Mac: `brew install --cask --no-quarantine marcussy34/beacon/beacon`
- [ ] Confirm ⌘⇧Space summons Beacon (already wired — just sanity-check)

To upgrade to the public, warning-free release (Path B), additionally:

- [ ] Enroll in Apple Developer Program ($99/yr)
- [ ] Create Developer ID Application cert → export `.p12`
- [ ] Add the 5 signing/notarization secrets to the app repo
- [ ] Re-cut the release (new tag); the same workflow now signs + notarizes
- [ ] Update the cask version + checksums; **remove `--no-quarantine`** from the docs

---

## Pipeline at a glance

```
                ┌──────────────────────── app repo (Marcussy34/beacon) ───────────────────────┐
  git tag v0.1.0│                                                                              │
  ──────────────▶  release.yml  ──▶  electron-builder  ──▶  GitHub Release v0.1.0              │
                │   (on push)        (sign IF secrets,        ├─ Beacon-0.1.0-arm64.dmg        │
                │                     else unsigned)          └─ Beacon-0.1.0-x64.dmg          │
                └───────────────────────────────────────────────────────┬──────────────────────┘
                                                                         │ url + sha256
                ┌──────────────── tap repo (Marcussy34/homebrew-beacon) ─▼──────────────────────┐
                │   Casks/beacon.rb  ──▶  brew install --cask marcussy34/beacon/beacon           │
                └───────────────────────────────────────────────────────┬──────────────────────┘
                                                                         │
                                                          user's Mac  ◀──┘  ⌘⇧Space → Beacon
```

---

## See also

- [`RELEASING.md`](./RELEASING.md) — the detailed signing + notarization + per-release runbook.
- `Casks/beacon.rb` — the cask template (source of truth to copy into the tap).
- `electron-builder.yml` — build targets, signing, publish config.
- `.github/workflows/release.yml` — the tag-triggered release workflow.
- `src/main/shortcut.ts` — the ⌘⇧Space global shortcut.
