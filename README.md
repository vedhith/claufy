<h1 align="center">Claufy</h1>

<p align="center">
  Every window you're working in, on one screen.<br>
  Tiles that space themselves — and the one you're using grows.
</p>

<p align="center">
  <a href="https://claufy.pages.dev">claufy.pages.dev</a> ·
  <a href="https://github.com/kk-vp/claufy/releases/latest">Download</a> ·
  MIT
</p>

---

## Download

| | |
| --- | --- |
| **macOS** (Apple Silicon) | [`Claufy-mac-arm64.dmg`](https://github.com/kk-vp/claufy/releases/latest/download/Claufy-mac-arm64.dmg) |
| **macOS** (Intel) | [`Claufy-mac-x64.dmg`](https://github.com/kk-vp/claufy/releases/latest/download/Claufy-mac-x64.dmg) |
| **Windows** | [`Claufy-win-x64.exe`](https://github.com/kk-vp/claufy/releases/latest/download/Claufy-win-x64.exe) |
| **Linux** | [`Claufy-linux-x64.AppImage`](https://github.com/kk-vp/claufy/releases/latest/download/Claufy-linux-x64.AppImage) |

The builds are **not code-signed** — a signing certificate costs money and this
is free. Every OS therefore puts up a scare the first time:

- **macOS** — right-click the app and choose *Open*, then *Open* again. Or
  `xattr -dr com.apple.quarantine /Applications/Claufy.app`.
- **Windows** — SmartScreen: *More info* → *Run anyway*.
- **Linux** — `chmod +x Claufy-linux-x64.AppImage`, then run it.

Building from source skips all of that, and is two commands (see below).

---

Claufy is a desktop app that holds your terminals (and web pages) as tiles.
Open another one and everything re-spaces itself. Click a tile and it grows,
smoothly, because you're working in it.

It is not a window manager and it does not take over your OS. It is one app
window with tiles inside, so it works the same on **macOS, Windows and Linux**.

## Run it

```bash
npm install     # also repairs node-pty's spawn-helper permissions
npm start
```

## Install it (macOS)

```bash
npm run dist         # builds Claufy.app
npm run install-app  # copies to ~/Applications, ad-hoc signs, tells Spotlight
```

Then type **claufy** in Spotlight or Finder. Use `npm run install-app -- --system`
for `/Applications` instead (needs an admin password).

## How it looks

The palette, the font and the whole ANSI table are read out of Terminal.app's
**Clear Dark** profile, so a tile looks like the terminal window it replaces:
background `#191d27`, text `#e0e0e0`, selection `#273d4c`, JetBrainsMono NFP
Thin at 12pt. To retarget it at a different profile, decode
`~/Library/Preferences/com.apple.Terminal.plist` — the colours are
`NSKeyedArchiver` blobs whose `NSRGB` field is a null-terminated string of
floats — and replace `TERM_THEME` in `src/renderer/index.ts` plus the tokens at
the top of `src/renderer/styles.css`.

## Keys

| Key | Does |
| --- | --- |
| `Cmd/Ctrl` + `T` | New terminal tile |
| `Cmd/Ctrl` + `W` | Close the active tile |
| `Cmd/Ctrl` + `Enter` | Blow the active tile up to fill the window, and back |
| `Cmd/Ctrl` + `1…9` | Jump to a tile |
| `Esc` | Leave full-window mode |
| Double-click a tile's header | Same as `Cmd/Ctrl` + `Enter` |

## The three focus modes

Set this in the top bar. It is remembered.

| Mode | What happens when you click a tile |
| --- | --- |
| **Equal** | Nothing — every tile stays the same size |
| **Grow** | Its row and column expand; **Size** sets how much |
| **Solo** | It takes the whole window, the others collapse away |

All three animate, because the layout is one CSS Grid and the sizes live in
`grid-template-columns` / `grid-template-rows`. Chromium interpolates those, so
the browser animates the tracks for us. Nothing is transformed or scaled, which
matters: scaling a terminal would blur the text.

## What can be a tile

- **Terminals** — a real login shell via `node-pty`, in any folder you pick.
- **Web pages** — anything that loads in a browser, including your dev server.
- **Native apps** — *no.* No cross-platform app can host another app's window
  inside itself; the APIs simply do not exist. Claufy opens those in your OS
  instead of pretending. This is a real limit, not a to-do.

## Gotcha worth knowing

npm publishes node-pty's prebuilt `spawn-helper` **without the execute bit**.
Every attempt to open a shell then dies with `posix_spawnp failed.` — which
names neither the file nor the permission. `scripts/fix-pty-perms.mjs` runs on
`postinstall` and restores it.

## Checking it works

```bash
CLAUFY_SMOKE=1 npx electron .
```

Boots the app, opens four terminals, drives all three focus modes, prints a
JSON report and exits. It calls the same functions the buttons do, so a pass
means the real paths work.

## Layout

```
src/main/index.ts      app window + pseudo-terminals
src/main/preload.ts    the only bridge between tiles and shells
src/renderer/          the grid, the tiles, the animation
scripts/               build, icons, the spawn-helper repair
assets/cat.svg         the cat
```
