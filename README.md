<h1 align="center">Claufy</h1>

<p align="center">
  Every window you're working in, on one screen.<br>
  Tiles that space themselves — and the one you're using grows.
</p>

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
