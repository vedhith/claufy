# Claufy — handoff

Everything needed to pick this up cold. Written 2026-08-08.
Read alongside `PLAN.md` (why decisions were made) and `README.md` (how to run it).

---

## What Claufy is

A cross-platform **Electron desktop app**. One window holding **tiles**. A tile is a
real terminal or a web page. Adding a tile re-spaces the rest; the tile you're
working in **grows, animated**. Works on macOS, Windows and Linux.

Repo: `~/Developer/claufy` — git, branch `master`, **no remote yet**.

> Earlier there was a macOS-only shell version that drove real Terminal.app
> windows. It still exists at `~/.local/bin/claufy` (+ `claufy.js`) and still
> works, but the Electron app superseded it. See "The shell-era tools" below.

---

## Current state — what is DONE and VERIFIED

| Thing | State |
| --- | --- |
| Tiled terminals (real login shells) | done, verified |
| Auto re-space when a tile is added | done, verified |
| Focus modes Equal / Grow / Solo, animated | done, verified |
| Theme copied from Terminal.app "Clear Dark" | done, verified |
| Per-tile folder-scoped `claude agents` | done, verified |
| Icon — pixel cat, **variant 6** (white cat on black tile) | done |
| Packaged `.app` + installed to `~/Applications` | done, verified |
| Spotlight finds it by typing "claufy" | done, verified |
| Landing page with live demo | done, verified |
| Publishing the site / hosted builds | **NOT STARTED — next task** |

### Verified how

`CLAUFY_SMOKE=1 npx electron .` boots the app, drives the real functions, prints
JSON, exits. Last good run:

```
shells : 5 / 5      spawn errors: none
font   : True "JetBrainsMono NFP Thin"    bg: rgb(25, 29, 39)
equal  : 1fr 1fr        grow: 1fr 2.2fr       solo: 0fr 1fr
scope probe inside a tile on "git pop":
  DIR=/Users/vedhith/Developer/git pop
  WRAPPED=2               <- claude agents is wrapped with --cwd
  ISFUNC=claude: function
```

Add `CLAUFY_PROBE_DIR="/some/folder"` to run the scope probe.

---

## NEXT TASK — publish

The landing page is **built and verified** at `site/index.html`. Serve it with
`npm run site` (port 400; `/prototypes` still serves the icon set).

What it has: hero with the pixel cat, a **live interactive demo** that animates
the same `grid-template-*` tracks the app animates (click a tile, add/remove
tiles, switch Equal/Grow/Solo, keys 1-9 and Esc), three feature cards, OS-detected
download buttons, copy-to-clipboard build commands, and the desktop-hint pill
required by the user's standing rule.

Driven in a real browser via `npx electron scripts/check-site.cjs`, which clicks
through the demo and prints the grid templates it produced:

```
grow (default)   : 2.2fr 1fr
after click last : 1fr 2.2fr
tiles after +2   : 6 -> 1fr 1fr 2.2fr
solo             : 0fr 0fr 1fr   (5 tiles collapsed)
equal            : 1fr 1fr 1fr
after pressing 2 : 1fr 2.2fr 1fr
os button        : Get Claufy for macOS
```

**Still to do before launch:**

1. **Push the repo.** There is no git remote. Nothing else can proceed without it.
2. **Publish builds.** `site/index.html` has `const RELEASES = null`; the download
   buttons currently toast "not published yet" and scroll to the build commands.
   Set `RELEASES` to `{mac, win, linux}` URLs once GitHub Releases exist.
3. **Fill in the clone URL** — the code block says `<repo>` in two places
   (the visible block and the `copy` handler's string).
4. Decide the host (Cloudflare Pages fits; the page is one static file).
5. Windows and Linux builds have never actually been produced — `npm run dist`
   has only run for macOS arm64. The config exists (`nsis`, `AppImage`) but is
   unproven.

## Commands

```bash
cd ~/Developer/claufy

npm install          # also repairs node-pty spawn-helper permissions
npm start            # build + run
npm run build        # esbuild only
npm run typecheck    # tsc --noEmit
npm run icons        # cat.svg -> pngs + icon.icns
npm run dist         # build Claufy.app into release/
npm run install-app  # copy to ~/Applications, ad-hoc sign, tell Spotlight

node scripts/apply-icon.mjs 6      # bake prototype N into the shipped icon
npm run site                       # landing page at http://localhost:400
                                   # icon prototypes at /prototypes
node prototypes/sheet.mjs          # render prototypes/sheet.png contact sheet
npx electron scripts/check-site.cjs   # drive the landing page demo, print results
```

---

## Layout

```
src/main/index.ts       window, ptys, per-tile scoping, smoke hook
src/main/preload.ts     the only bridge between tiles and shells
src/renderer/index.ts   grid maths, tiles, focus animation, TERM_THEME
src/renderer/styles.css palette tokens (all from Clear Dark)
src/renderer/index.html markup; the two inline cats are GENERATED
site/index.html         the landing page, one self-contained file
scripts/serve.mjs       dev server: / = site, /prototypes = icon set
scripts/check-site.cjs  drives the landing demo in a real browser
prototypes/variants.mjs the 12 icon prototypes — single source of truth
scripts/apply-icon.mjs  bakes a prototype into assets/cat.svg + index.html
scripts/build.mjs       esbuild: main, preload, renderer + static copy
scripts/make-icons.mjs  sharp -> pngs, iconutil -> .icns
scripts/fix-pty-perms.mjs  postinstall repair, see traps
scripts/install-app.mjs    install to ~/Applications + ad-hoc sign
```

---

## The theme — Terminal.app "Clear Dark"

Read out of `~/Library/Preferences/com.apple.Terminal.plist`. Baked in as
literals in `TERM_THEME` (`src/renderer/index.ts`) and as tokens at the top of
`styles.css`. **Do not invent colours; every value came from that profile.**

```
background #191d27   text #e0e0e0   bold #ededed   selection #273d4c
ANSI       black #35424c  red #b45648  green #6caa71  yellow #c4ac62
           blue #6d96b4   magenta #bd7bcd  cyan #7ccbcd  white #dee5eb
bright     black #465c6d  red #df6c5a  green #79be7e  yellow #e5c872
           blue #67b5ed   magenta #d389e5  cyan #84dde0  white #e5eff5
font       "JetBrainsMono NFP Thin" 12pt   (PostScript: JetBrainsMonoNFP-Thin)
accent used for UI: #67b5ed (ANSIBrightBlue). There is NO purple any more.
```

To retarget another profile: the colours are `NSKeyedArchiver` blobs whose
`NSRGB` field is a **null-terminated byte string of floats** — not a number
array. That detail is the whole trick.

---

## The icon

**Variant 6 of 12: "Pixel cat, inverted" — white 16x16 pixel cat on a black
rounded tile.** Chosen after three rejected directions (line-art cat, geometric
primitives, irregular silhouette). The user's brief settled on: *pixelated,
simple, like the Claude icon* — flat fill, one ink colour, no outlines.

All 12 prototypes still live in `prototypes/variants.mjs`. To switch:
`node scripts/apply-icon.mjs <n> && npm run icons && npm run dist && npm run install-app`.

The in-app cats in `index.html` are **generated** by that script — hand-editing
them will be overwritten.

---

## Traps that cost real time — do not rediscover these

1. **node-pty's `spawn-helper` ships without the execute bit.** Every shell fails
   with `posix_spawnp failed.`, which names neither file nor cause. Fixed by
   `scripts/fix-pty-perms.mjs` on postinstall. If terminals ever die again, check
   this first.

2. **Animate `grid-template-*`, never transform the tiles.** Scaling a terminal
   resamples and blurs the glyphs. Chromium interpolates `fr` values, so the grid
   animates for free and text stays crisp.

3. **Solo mode uses `0fr`, and tiles need `min-width/height: 0`.** Grid items
   default to `min-width: auto` and refuse to collapse otherwise.

4. **A PATH shim cannot scope `claude`.** The user's `~/.zshrc` prepends
   `~/.local/bin` *and* defines a `claude()` function, and a function beats any
   binary. Claufy instead points **ZDOTDIR** at a generated rc that sources the
   real `~/.zshenv`/`.zprofile`/`.zshrc` first, then wraps whatever `claude`
   ended up being — preserving the user's own function. Non-zsh falls back to a
   PATH shim. Windows gets neither.

5. **electron-builder rejects unknown keys**, including `"// comment"` keys in
   the `build` block. Do not put comments in there.

6. **electron-builder leaves a signature that `spctl` calls broken**, not merely
   unsigned. `install-app.mjs` ad-hoc signs (`codesign --sign -`) to avoid it.

7. **The smoke test's `rects` are captured before the scope probe opens its
   tile**, so anything comparing against `activeId` must tolerate a miss. It
   threw `Cannot read properties of undefined (reading 'w')` once for this.

---

## The shell-era tools (still installed, still working)

Superseded by the app but independently useful:

- `~/.local/bin/claufy` + `claufy.js` — opens one real Terminal window per
  folder, each showing that folder's agent view, then tiles them with `sen`.
  `claufy --watch` re-spaces whenever any window opens or closes.
- `~/.local/bin/sen` — tiles Terminal windows into an even grid.
- `agents` function in `~/.zshrc` — `claude agents --cwd "$PWD"`.

**macOS Terminal scripting traps** (recorded in the user's memory files too):
Claude Code overwrites a tab's `customTitle` while running, so track windows by
**id**; Terminal refuses a scripted `close()` on a window with a live process
and silently queues a Terminate sheet; close is applied asynchronously so
re-probe before reporting; `pkill -t` matches nothing on macOS — use
`ps -t <tty> -o pid=` then `kill`; **tty numbers get recycled**, so verify the
tty is still running the expected command before killing anything.

---

## The discovery underneath all of this

Claude Code's agent view (left arrow) is **machine-wide** and there is **no
setting** to narrow it — only `leftArrowOpensAgents` and `defaultToAgentsView`,
both on/off. But **`claude agents --cwd <dir>` scopes it**, undocumented, found
by reading strings in the v2.1.226 binary. Measured: 3 sessions in one folder vs
8 unfiltered. `claude agents --json` gives the same list machine-readably and is
how Claufy auto-detects folders.

Related keys found in the binary: **ctrl+S** cycles grouping state → directory
(persists as `fleetViewGroupMode`), **ctrl+A** toggles all-projects in the
session picker, ctrl+B branch filter, ctrl+W worktree filter.

This is the strongest thing to lead with if the project is ever written up.

---

## Decided but NOT built

- **Status-driven layout** — the tile whose session needs *you* gets the big
  tile. `claude agents --json` already reports `busy` / `idle` / needs-input.
  Nothing on the market does this; it is the best remaining idea.
- Save/restore a workspace (which folders were open, in what order).
- Splitting a tile rather than only adding to the grid.
- Drag to reorder tiles.
- Publishing: the user leaned yes, as a small open-source CLI/app, with the
  writeup — not as a product competing with Clave or Conductor.
