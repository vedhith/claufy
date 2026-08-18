<h1 align="center">Claufy</h1>

<p align="center">
  Every window you're working in, on one screen.<br>
  One at full size in the middle, the rest live down the sides —<br>
  click a small one and the two trade places.
</p>

<p align="center">
  <a href="https://claufy.pages.dev">claufy.pages.dev</a> ·
  <a href="https://github.com/vedhith/claufy/releases/latest">Download</a> ·
  MIT
</p>

---

## Download

| | |
| --- | --- |
| **macOS** (Apple Silicon) | [`Claufy-mac-arm64.dmg`](https://github.com/vedhith/claufy/releases/latest/download/Claufy-mac-arm64.dmg) |
| **macOS** (Intel) | [`Claufy-mac-x64.dmg`](https://github.com/vedhith/claufy/releases/latest/download/Claufy-mac-x64.dmg) |
| **Windows** | [`Claufy-win-x64.exe`](https://github.com/vedhith/claufy/releases/latest/download/Claufy-win-x64.exe) |
| **Linux** | [`Claufy-linux-x86_64.AppImage`](https://github.com/vedhith/claufy/releases/latest/download/Claufy-linux-x86_64.AppImage) |

The builds are **not code-signed** — a signing certificate costs money and this
is free. Every OS therefore puts up a scare the first time:

- **macOS** — right-click the app and choose *Open*, then *Open* again. Or
  `xattr -dr com.apple.quarantine /Applications/Claufy.app`.
- **Windows** — SmartScreen: *More info* → *Run anyway*.
- **Linux** — `chmod +x Claufy-linux-x86_64.AppImage`, then run it.

Building from source skips all of that, and is two commands (see below).

---

Claufy is a desktop app that holds your terminals (and web pages) as tiles.
One of them is at full size in the middle and the rest sit small down the sides,
still running. Click a small one and the two swap places — nothing else on
screen moves.

It is not a window manager and it does not take over your OS. It is one app
window with tiles inside, so it works the same on **macOS, Windows and Linux**.

## Run it

```bash
npm install     # also repairs node-pty's spawn-helper permissions
npm start
```

Claufy saves the open tile list and order as it changes. A normal relaunch
restores terminal folders, page URLs, the active tile and the tile that occupied
the middle Stage slot. Focus mode, Grow size and text size remain remembered as
before.

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

## A tile behaves like the terminal it replaces

| You do | It does |
| --- | --- |
| Select, then Copy | Copies what xterm has selected — **not** the page selection |
| Paste | Goes in through bracketed paste, so a pasted block is not run line by line |
| `Ctrl` + `C` on Windows/Linux | Interrupts. Copies only when text is selected, then drops the selection |
| Right-click | Copy / Paste / Select All / Clear / Open Link — a real native menu |
| `Cmd`/`Ctrl`-click a URL | Opens it. URLs are underlined, including ones wrapped over several rows |
| Drag a file or folder in | Types its path, quoted, exactly like Terminal.app |
| Middle-click (Linux) | Pastes the primary selection, which selecting in a tile fills |
| `Shift` + `Insert` / `Ctrl` + `Insert` | Paste / copy, the older convention |
| Text size | `Cmd/Ctrl` + `+` / `-` / `0`, remembered |
| Scrollback | 50,000 lines, so the top of a build log survives |

## Keys

The two platforms cannot share a table, and that is the point. On macOS the
terminal never sees `Cmd`, so the app takes `Cmd`. On Windows and Linux every
bare `Ctrl` chord belongs to the shell — `Ctrl+C` interrupts, `Ctrl+R` searches
history, `Ctrl+A` goes to the start of the line — so the app takes `Ctrl+Shift`
and leaves all of them alone.

| Does | macOS | Windows / Linux |
| --- | --- | --- |
| New terminal tile | `Cmd`+`T` | `Ctrl`+`Shift`+`T` |
| New terminal in a folder | `Cmd`+`Shift`+`T` | `Ctrl`+`Shift`+`O` |
| Close the active tile | `Cmd`+`W` | `Ctrl`+`Shift`+`W` |
| Copy / Paste / Select All | `Cmd`+`C` / `V` / `A` | `Ctrl`+`Shift`+`C` / `V` / `A` |
| Clear | `Cmd`+`K` | `Ctrl`+`Shift`+`K` |
| Fill the window with one tile, and back | `Cmd`+`Enter` | `Ctrl`+`Enter` |
| Jump to a tile — in Stage, swap it into the middle | `Cmd`+`1…9` | `Alt`+`1…9` |
| Next / previous tile | `Cmd`+`Alt`+`←`/`→` | `Ctrl`+`Alt`+`←`/`→` |
| Leave full-window mode | `Esc` | `Esc` |

Double-clicking a tile's header fills the window with it, same as the key.

Reload is deliberately **not** on `Cmd/Ctrl`+`R`: that is history search in
every shell, and Electron's default menu binding it there meant `Ctrl+R`
reloaded the app out from under four running terminals.

## The four focus modes

Set this in the top bar. It is remembered.

| Mode | What happens when you click a tile |
| --- | --- |
| **Stage** *(default)* | It trades places with the tile in the middle. Nothing else moves |
| **Grow** | Its row and column expand; **Size** sets how much |
| **Equal** | Nothing — every tile stays the same size |
| **Solo** | It takes the whole window, the others collapse away |

Grow, Equal and Solo animate the grid tracks: the sizes live in
`grid-template-columns` / `grid-template-rows` and Chromium interpolates those,
so the browser animates them for us.

**Stage** is the odd one out and the reason the app is worth using. One tile
sits at full size in the middle; the rest are small down the rails either side,
still running, still readable. Click a small one and exactly two tiles move —
the one you picked flies to the middle, the middle one drops into the slot it
came from. Everything else stays where you left it, so you never have to
re-find anything.

Nothing is ever transformed by scale, in any mode. A swap animates the tile's
width and height and slides it with a plain translate, so its text is clipped
and revealed rather than resampled. Scaling a terminal blurs the glyphs; this
does not.

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

Boots the app, opens four terminals, drives all four focus modes, performs a
real Stage swap and measures the boxes either side of it, prints a JSON report
and exits. It calls the same functions the buttons do, so a pass means the real
paths work — `stageSwap.restStayedPut` is the claim that nothing but the two
tiles moved.

The report also serializes and restores a real mixed terminal/page workspace,
checks its order, URLs, working directories and Stage focus, and rejects
malformed records. Smoke runs in a non-persistent in-memory Electron partition,
so it neither reads nor changes the workspace or settings in the normal app
profile.

It also copies what a shell actually printed to the **real system clipboard**
and reads it back, pastes a probe string in and finds it in the buffer, clicks
the real menu items and checks the commands arrive, and lists every accelerator
so the chords a shell needs can be seen to be free.

## Layout

```
src/main/index.ts      app window + pseudo-terminals
src/main/preload.ts    the only bridge between tiles and shells
src/renderer/          the grid, the tiles, the animation
scripts/               build, icons, the spawn-helper repair
assets/cat.svg         the cat
```
