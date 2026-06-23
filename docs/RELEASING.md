# Releasing Beacon

How to ship a signed, notarized macOS build that installs without Gatekeeper warnings.

There are two halves: a **one-time setup** (Apple account + secrets) and a **per-release**
flow (tag → automated build → cask bump). The automated path (GitHub Actions) means the
signing certificate never has to live on your laptop.

---

## Why signing + notarization is required

Beacon requests **Apple Events** (to focus your terminal/editor on "Go to"). An unsigned,
un-notarized app that asks for those permissions is blocked by macOS Gatekeeper with a scary
"Apple cannot verify this app is free of malware" dialog. Signing + notarization removes that —
it is the gate between "works on my machine" and "anyone can install it."

---

## One-time setup

### 1. Enroll in the Apple Developer Program
- https://developer.apple.com/programs/ — **$99/year**. Required to get a Developer ID cert.

### 2. Create a "Developer ID Application" certificate
- Xcode → Settings → Accounts → your team → **Manage Certificates** → **+** → *Developer ID Application*.
- Or via https://developer.apple.com/account/resources/certificates.
- Export it from **Keychain Access** as a `.p12` (right-click the cert → Export), set an export password.

### 3. Encode the cert and grab the values for CI
```bash
# base64 of the .p12 — this becomes the CSC_LINK secret
base64 -i DeveloperID.p12 | pbcopy
```
- Your **Team ID**: https://developer.apple.com/account → Membership (a 10-char string like `AB12CD34EF`).
- An **app-specific password** for notarization: https://appleid.apple.com → Sign-In & Security →
  App-Specific Passwords → generate one (used for `APPLE_APP_SPECIFIC_PASSWORD`).

### 4. Add the GitHub repo secrets
Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret                        | Value                                              |
| ----------------------------- | -------------------------------------------------- |
| `CSC_LINK`                    | base64 of your `.p12` (step 3)                     |
| `CSC_KEY_PASSWORD`            | the `.p12` export password (step 2)                |
| `APPLE_ID`                    | your Apple ID email                                |
| `APPLE_APP_SPECIFIC_PASSWORD` | the app-specific password (step 3)                 |
| `APPLE_TEAM_ID`               | your 10-char Team ID (step 3)                      |

(`GITHUB_TOKEN` is provided automatically — no action needed.)

> Prefer the App Store Connect **API key** route over an Apple ID password? Set `APPLE_API_KEY`
> (path to the `.p8`), `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER` instead of the three `APPLE_*`
> secrets, and adjust `.github/workflows/release.yml` to write the key file from a secret. Apple
> recommends this route; the Apple ID route above is simpler for a first release.

---

## Per-release flow (automated — recommended)

```bash
# 1. Bump the version in package.json (no tag yet)
npm version 0.1.0 --no-git-tag-version

# 2. Commit, tag, and push the tag
git commit -am "chore: release v0.1.0"
git tag v0.1.0
git push --follow-tags
```

The `Release` workflow (`.github/workflows/release.yml`) then runs on the tag and:
- builds `Beacon-0.1.0-arm64.dmg` + `Beacon-0.1.0-x64.dmg` (and matching `.zip` files),
- signs them with your Developer ID cert,
- notarizes + staples them with Apple, and
- uploads them to a **GitHub Release** for tag `v0.1.0`.

### Update the Homebrew cask
After the release assets exist, update `Casks/beacon.rb` in the `Marcussy34/homebrew-beacon` tap:
```bash
shasum -a 256 Beacon-0.1.0-arm64.dmg   # → on_arm sha256
shasum -a 256 Beacon-0.1.0-x64.dmg     # → on_intel sha256
```
Bump `version` and paste the two checksums, then commit. Users install with:
```bash
brew install --cask marcussy34/beacon/beacon
```

---

## Local builds

```bash
# Signed build on your own machine (needs the cert in your keychain + APPLE_* env vars
# exported for notarization). Produces dist/Beacon-<version>-<arch>.dmg, no upload.
npm run dist:mac

# Unsigned build, NO Apple account needed — for local smoke-testing only. Produces an
# unpacked .app under dist/mac*/ with hardened runtime disabled so it launches locally.
npm run pack:mac
```

---

## Still TODO before the first public release

- **App icon:** add `build/icon.icns` so the `.app`/DMG show a branded icon instead of the
  default Electron icon. (The menu-bar tray icon in `resources/` is separate and already set.)

> For the full "zero → `brew install`" picture (including shipping an unsigned beta before the
> signed release), see [HOMEBREW-DISTRIBUTION.md](./HOMEBREW-DISTRIBUTION.md).
