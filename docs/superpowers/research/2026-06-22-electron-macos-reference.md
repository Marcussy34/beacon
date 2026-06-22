# Beacon — Electron macOS Reference (verified 2026-06-22 against official docs)

Source research for the M3 plan. Verified against electronjs.org/docs, electron-vite.org, electron.build. Electron **42.4.1** (bundled Node **24.16.0**, Chromium 148) is latest stable.

## Build tooling
- **electron-vite + electron-builder** (canonical 2026). Scaffold template `react-ts`.
- Project layout: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/{App.tsx,main.tsx}`, `electron.vite.config.ts`, `electron-builder.yml`, `package.json` `"main": "./out/main/index.js"`, split tsconfigs (`tsconfig.node.json` main+preload, `tsconfig.web.json` renderer). Build output → `out/{main,preload,renderer}`.
- `electron.vite.config.ts` exports `{ main, preload, renderer }` (renderer gets `@vitejs/plugin-react`).
- Packaging: `electron-vite build && electron-builder --mac`. `electron-builder.yml` controls included files + `extraResources` + `mac.extendInfo`.
- Deps (upgrade electron to ^42): `electron@^42`, `electron-builder@^26`, `electron-vite@^5`, `@vitejs/plugin-react@^5`, `vite@^7`, `react@^19`, `react-dom@^19`, `@electron-toolkit/preload`, `@electron-toolkit/utils`.

## Activating all-Spaces panel (Electron 42)
- `new BrowserWindow({ show:false, frame:false, transparent:true, fullscreenable:false, skipTaskbar:true, focusable:true, alwaysOnTop:true, roundedCorners:true, hasShadow:true, vibrancy:'under-window'(optional), webPreferences:{ preload, contextIsolation:true, nodeIntegration:false, sandbox:true } })`.
- `win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen:true, skipTransformProcessType:true })` — both keys current. `skipTransformProcessType:true` is correct BECAUSE we set LSUIElement (already a UIElementApplication → avoid the flicker).
- `win.setAlwaysOnTop(true, 'screen-saver')` — valid levels normal/floating/torn-off-menu/modal-panel/main-menu/status/pop-up-menu/screen-saver. `screen-saver` floats over fullscreen.
- **Activating (Spotlight-style):** `win.show()` shows+focuses; for an LSUIElement app also call `app.focus({ steal:true })` to steal focus from the frontmost app. (Use steal sparingly — justified for a hotkey panel.) `showInactive()` = non-activating (not wanted).
- **Hide on blur** with devtools guard: `win.on('blur', () => { if (!win.webContents.isDevToolsFocused()) win.hide() })`. Also hide on Esc (renderer key handler → IPC, or `before-input-event`).

## No dock icon
- Set `LSUIElement: true` in `mac.extendInfo` (process starts as UIElementApplication; no dock, no Cmd-Tab). Optionally also `app.dock.hide()` defensively (redundant if LSUIElement). LSUIElement is why `skipTransformProcessType:true` is correct.

## Tray + badge
- `nativeImage.createFromPath('…/iconTemplate.png')` — filename MUST end `Template`; ship `iconTemplate.png` (16x16) + `iconTemplate@2x.png` (32x32), black+alpha only (macOS auto-inverts dark/light). Or `img.setTemplateImage(true)`. Do NOT content-hash the filename when bundling.
- Badge: no native macOS tray badge. Options: `tray.setTitle(text, {fontType:'monospacedDigit'})` (label next to icon) OR composite a NativeImage with the dot/count drawn and `tray.setImage()`. (`app.dock.setBadge` irrelevant — dock hidden.)
- Click toggle: `tray.on('click', (_e, bounds) => …)`. **CAVEAT:** setting a context menu via `tray.setContextMenu()` SUPPRESSES the `click` event on macOS — so for click-to-toggle, don't set a context menu (or use `mouse-up`).

## globalShortcut
- `const ok = globalShortcut.register('CommandOrControl+Shift+Space', cb)` → returns boolean; **failure is SILENT (false)** when combo taken — must check. `globalShortcut.isRegistered(acc)`. `globalShortcut.unregisterAll()` on `app.on('will-quit')`. (E42 adds `setSuspended`/`isSuspended` — optional.)

## Automation permission (osascript / Apple Events)
- Info.plist `NSAppleEventsUsageDescription` via `mac.extendInfo`. First osascript against another app triggers the per-target permission prompt. Denial → osascript non-zero exit + stderr contains `Not authorized to send Apple events`. **No preflight API** for Automation (Accessibility has `systemPreferences.isTrustedAccessibilityClient(false)` but that's a different permission). Detect denial from the Focuser's exec result and surface a toast + how-to-grant.

## Single instance
- `const lock = app.requestSingleInstanceLock(); if (!lock) app.quit(); else app.on('second-instance', …show/focus panel…)`. Call before `whenReady`.

## contextBridge / preload
- Expose WRAPPER functions only: `contextBridge.exposeInMainWorld('api', { getSnapshot:()=>ipcRenderer.invoke('snapshot'), onUpdate:(cb)=>{const h=(_e,d)=>cb(d); ipcRenderer.on('update',h); return ()=>ipcRenderer.removeListener('update',h)}, goto:(key)=>ipcRenderer.invoke('goto',key), markSeen:(key)=>ipcRenderer.invoke('markSeen',key) })`. NEVER expose raw `ipcRenderer` (comes through empty since E29).
- `sandbox:true` (default): preload has NO `fs`/`path`/`child_process`/`net` — only electron renderer modules + Buffer/process polyfills. That's fine: ALL Node work (socket, fs, watcher, child_process focuser, installer) lives in MAIN. Keep `sandbox:true`.

## Packaging
- `process.execPath` (packaged) = the Electron binary (`…/Beacon.app/Contents/MacOS/Beacon`). `process.resourcesPath` = `…/Contents/Resources/`. `app.isPackaged` boolean. `app.getAppPath()` = app.asar path.
- **ASAR can't execute bundled binaries.** Ship `beacon-hook.cjs` via `extraResources` (`from: out/hook/beacon-hook.cjs → to: beacon-hook.cjs`), resolve at `path.join(process.resourcesPath,'beacon-hook.cjs')`.
- **Packaged hook invocation (resolves the M2b gated double-add item):** the installed hook command becomes
  `ELECTRON_RUN_AS_NODE=1 "<execPath>" "<resourcesPath>/beacon-hook.cjs" --beacon-marker beacon <tool> <event>`
  (uses the bundled Electron-as-Node; no dependency on the user having `node` on PATH). `ELECTRON_RUN_AS_NODE` makes Electron run as plain Node. This invocation differs from the dev `node "…/dist/hook/beacon-hook.cjs"`, so the **installer idempotency/uninstall must move from exact-command match to tool+event+marker match in the SAME change** (else every existing user double-adds on first packaged reinstall).
- Spawning a bundled node worker: `spawn(process.execPath, [script], { env:{...process.env, ELECTRON_RUN_AS_NODE:'1'} })` (needs `runAsNode` fuse enabled — default).

## Breaking-change watch-outs (E40–42)
- `setTrafficLightPosition` removed → `setWindowButtonPosition`. Don't use `type:'textured'`. `ipcRenderer` can't cross contextBridge whole (E29+).
