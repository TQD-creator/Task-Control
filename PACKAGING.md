# Packaging & Commercial Deployment

Everything done to turn `desktop-app/` from a "runs on my machine" dev project into
a **distributable Windows product**, plus the runbook to rebuild it and the
remaining steps before a paid public release.

Set up: 2026-08-01. Toolchain: `electron-builder@24.13.3`, target **Windows NSIS
installer**, `electron@31`.

---

## 1. What was added

### 1.1 `electron-builder` + build scripts (`desktop-app/package.json`)

```jsonc
"scripts": {
  "pack":     "npm run build && electron-builder --dir",      // unpacked app, no installer (fast sanity)
  "dist:app": "npm run build && electron-builder --win nsis"  // full NSIS installer
}
```

Both first run `vite build` (the renderer must exist in `dist/` before it's
bundled), then invoke electron-builder.

### 1.2 electron-builder config (top-level `"build"` key)

```jsonc
"build": {
  "appId": "com.taskcontrol.app",          // Windows AppUserModelID / uninstall identity
  "productName": "Task Control",            // installed app + shortcut name
  "copyright": "Copyright © 2026 Task Control",
  "directories": {
    "output": "release",                    // installers land here (git-ignored)
    "buildResources": "build-assets"        // deliberately NOT "build", so build/tray.png
                                            //   and build/icon.ico are treated as normal
                                            //   project files, not auto-excluded resources
  },
  "files": [                                // exactly what ships inside app.asar
    "electron/**/*",                        //   main process + preload + services
    "dist/**/*",                            //   the built renderer (index.html + widget.html)
    "build/tray.png",                       //   runtime tray icon (main.js loads it)
    "package.json"
  ],
  "asarUnpack": [
    "**/node_modules/sql.js/dist/*.wasm"    // the WASM must be a real file on disk (see §3)
  ],
  "win": { "target": ["nsis"], "icon": "build/icon.ico" },
  "nsis": {
    "oneClick": false,                      // real installer wizard, not silent
    "perMachine": false,                    // per-user install → no admin prompt
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "shortcutName": "Task Control",
    "uninstallDisplayName": "Task Control"
  }
}
```

### 1.3 Dependency hygiene (`package.json`)

- **`react` / `react-dom` moved to `devDependencies`.** They are only needed at
  *build* time — Vite inlines React into `dist/assets/*.js`. The Node main process
  never `require`s them. electron-builder bundles only production `dependencies`
  into the app, so this trims React out of the shipped `node_modules`. The only
  runtime dependency is **`sql.js`**.
- Added `description`, `author`, `license` — electron-builder **requires an
  `author`** to stamp the installer's publisher metadata (NSIS fails without it).

### 1.4 Application icon (the "slot") — `desktop-app/build/icon.ico`

A real multi-size `.ico` (**256/128/64/48/32/16 px**, PNG-compressed entries) was
generated with a zero-dependency script — a rounded `#2563eb` square with a white
check, matching the app accent. It is embedded into `Task Control.exe` at build
time via `rcedit`.

> **To rebrand:** drop your own `build/icon.ico` (must include a 256×256 frame) in
> place and rerun `npm run dist:app`. Nothing else needs to change. The generator
> lives at `scratchpad/gen-app-icon.mjs` if you want to tweak the placeholder.

While making the icon, a latent bug was found and fixed in the **tray** icon
generator (`build/tray.png`): stroke offsets were fractional, so the white check
computed non-integer pixel indices and never drew — the tray showed a **blank blue
square**. Both icons now render the check correctly.

### 1.5 `.gitignore`

- `desktop-app/release/` — ignore all built installers/unpacked output.
- `!desktop-app/build/icon.ico` — the committed icon is kept (the `build/` dir is
  otherwise ignored except `tray.png`).

---

## 2. How to build the installer

```bash
cd desktop-app
npm install            # first time — pulls electron-builder
npm run dist:app       # → release/Task Control Setup 1.0.0.exe
```

Output in `desktop-app/release/`:

| Artifact | Size | What it is |
|---|---|---|
| `Task Control Setup 1.0.0.exe` | ~79 MB | The **NSIS installer** to ship |
| `Task Control Setup 1.0.0.exe.blockmap` | ~85 KB | Delta-update map (used by auto-update) |
| `win-unpacked/Task Control.exe` | ~173 MB | The unpacked app (for local testing) |

The version comes from `package.json` `"version"`. Bump it before each release so
the installer filename and the app's About/updater version stay in sync.

---

## 3. Packaging gotchas that were handled

These are the things that silently break a naïvely-packaged Electron app; all are
resolved in the config above.

1. **Renderer assets under `file://`** — Vite must emit *relative* asset URLs or the
   packaged app loads a blank window. `vite.config.js` already sets `base: './'`. ✅
2. **`sql.js` WASM** — `database.js` loads it via
   `require.resolve('sql.js/dist/sql-wasm.wasm')`. Inside `app.asar` that resolves to
   an archive path; `asarUnpack` copies the `.wasm` to `app.asar.unpacked/…` and
   Electron's patched `fs` transparently redirects the read there. Verified the file
   is present under `resources/app.asar.unpacked/…`. ✅
3. **`build/tray.png` at runtime** — `main.js` reads it via
   `path.join(__dirname, '..', 'build', 'tray.png')`; it is explicitly listed in
   `files` so it ends up in the asar, and `nativeImage.createFromPath` reads it from
   there. ✅
4. **Dev-vs-prod window load** — `main.js` uses `loadURL('localhost:5173')` in dev
   and `loadFile('../dist/index.html')` when packaged (`isDev` gate). ✅

### 3.1 The one environment blocker: `winCodeSign` symlink extraction

On this machine the first build failed with:

```
ERROR: Cannot create symbolic link : A required privilege is not held by the client.
  …winCodeSign…/darwin/10.12/lib/libcrypto.dylib
```

**Cause (not a config problem):** electron-builder unpacks a `winCodeSign` bundle
that contains **macOS** symlinks. Creating symlinks on Windows needs either
**Developer Mode** or an **elevated (Admin) shell**; a normal shell can't, so the
7-Zip extraction aborts and the build stops — even for `--dir`.

**Permanent fixes (pick one):**
- **Enable Windows Developer Mode** — Settings → Privacy & security → For developers
  → *Developer Mode: On*. Then `npm run dist:app` works unmodified. *(Recommended.)*
- **Run the build from an Administrator terminal.**

**The workaround applied here (no admin needed)** — pre-extract the bundle without
the macOS symlinks into the exact cache folder electron-builder expects, so it skips
its own failing extraction:

```bash
CACHE="$LOCALAPPDATA/electron-builder/Cache/winCodeSign"
SEVENZ="desktop-app/node_modules/7zip-bin/win/x64/7za.exe"
# Any of the downloaded *.7z in $CACHE is the same 5.6 MB bundle:
"$SEVENZ" x -bd -y "$CACHE/<any-number>.7z" "-o$CACHE/winCodeSign-2.6.0" -xr!darwin
rm -rf "$CACHE"/[0-9]*.7z "$CACHE"/[0-9]*/    # clear the failed temp dirs
```

`-xr!darwin` drops the macOS-only tools (never used for a Windows build); the
Windows tooling (`signtool`, `rcedit`, `openssl`) extracts cleanly. After this the
NSIS build completes normally. This only has to be done once per machine (the cache
persists).

---

## 4. Verification performed (2026-08-01)

| Check | Result |
|---|---|
| `vite build` (renderer, both HTML entries) | ✅ clean |
| `npm run dist:app` produced the NSIS installer | ✅ `Task Control Setup 1.0.0.exe` (79 MB) |
| `sql-wasm.wasm` unpacked outside the asar | ✅ `app.asar.unpacked/node_modules/sql.js/dist/` |
| asar contains `dist/index.html`, `dist/widget.html`, `electron/main.js`, `build/tray.png`, `sql.js` | ✅ all present (62 entries) |
| `react` excluded from the shipped app | ✅ not in asar |
| App icon embedded (256-px multi-size `.ico`) | ✅ visually confirmed |

> **Not yet done:** a click-through of the *installed* app on a clean Windows
> profile. The package's static integrity is verified; a human should still run the
> installer once and confirm the window, tray, timer widget, and reminders behave
> before shipping.

---

## 5. Remaining steps before a paid public release

The app is now *distributable*; these make it *commercially trustworthy*. None block
producing an installer today, but each removes friction or legal risk.

| Step | Why it matters | How |
|---|---|---|
| **Code signing** (Authenticode) | Unsigned installers trigger SmartScreen "unknown publisher" warnings that tank install rates | Buy an OV/EV cert; set `CSC_LINK` (`.pfx`) + `CSC_KEY_PASSWORD` env vars — electron-builder signs automatically |
| **Auto-update** | Ship fixes without users re-downloading | Add `electron-updater` + a `publish` provider (GitHub Releases, S3, or generic). The `.blockmap` for delta updates is already emitted |
| **LICENSE / EULA** | Legal basis to distribute; `license` is currently `UNLICENSED` | Choose a license (proprietary EULA for commercial, or an OSS license) and set `package.json` `license` + ship a `LICENSE` file |
| **Privacy statement** | Local-first is a selling point — say it explicitly | One page: data stays in `%APPDATA%\task-control-desktop\`; only opt-in Ollama/Tavily calls leave the machine |
| **macOS / Linux targets** | Broaden the market | Add `mac` (`dmg`, needs Apple notarization) and `linux` (`AppImage`/`deb`) targets; the config is cross-platform-ready |
| **Bundle size** | 79 MB is Electron-baseline; fine, but trimmable | Optional: `asar` maximum compression, prune unused locales via `electron-builder` `electronLanguages` |

---

## 6. File-by-file change log

| File | Change |
|---|---|
| `desktop-app/package.json` | `pack`/`dist:app` scripts; `build` config; React→devDeps; `description`/`author`/`license`; `electron-builder` devDep |
| `desktop-app/build/icon.ico` | **New** — multi-size app icon (embedded in the exe) |
| `desktop-app/build/tray.png` | Regenerated — fixed the invisible-check bug |
| `.gitignore` | Ignore `desktop-app/release/`; keep `build/icon.ico` |
| `desktop-app/node_modules/**` | `electron-builder` + toolchain installed (dev-only, not shipped) |
