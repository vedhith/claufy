# Claufy — handoff

Everything needed to pick this up cold. Written 2026-08-08.
Read alongside `PLAN.md` (why decisions were made) and `README.md` (how to run it).

---

## What Claufy is

A cross-platform **Electron desktop app**. One window holding **tiles**. A tile is a
real terminal or a web page. Adding a tile re-spaces the rest; the tile you're
working in **grows, animated**. Works on macOS, Windows and Linux.

Repo: `~/Developer/claufy` → **https://github.com/vedhith/claufy** (public, MIT),
branch `main`. Site: **https://claufy.pages.dev** (Cloudflare Pages, project
`claufy`, account `vedhithkrishnakumar@gmail.com`).

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
| Public repo, MIT licence | done — github.com/vedhith/claufy |
| CI release build (mac arm64 + x64, win, linux) | done, verified |
| v0.1.0 release with 6 installers | done, verified |
| Site live on Cloudflare Pages | done — claufy.pages.dev |
| Custom domain | **NOT STARTED — waiting on the domain purchase** |

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

What it has, top to bottom:

1. Hero with the pixel cat.
2. **Live interactive demo** — animates the same `grid-template-*` tracks the app
   animates (click a tile, add/remove tiles, Equal/Grow/Solo, keys 1-9 and Esc).
3. **"Every project gets its own agent view"** — the section that carries the
   pitch. Two panels of the *same twelve agents*: Claude Code's machine-wide list
   on the left, four folder-scoped Claufy tiles on the right. Hover or tap a
   folder and every row it cannot see dims, while the panel footer prints the real
   command (`claude agents --cwd ~/infra — 4 of 12 agents`). Under it, four use
   cases: one project per tile, see who needs you, long jobs stay visible, pin
   what the shell produces.
4. Four feature cards — real shells, **any web app tiles too** (and the honest
   note that native desktop apps cannot be embedded), text never blurs, all three
   OSes.
5. **"Why 'Claufy'?"** — the name is from Claude; the first version ran a stack of
   Claude terminals on a Mac, one per project.
6. OS-detected download buttons, copy-to-clipboard build commands, and the
   desktop-hint pill required by the user's standing rule.

Driven in a real browser via `npx electron scripts/check-site.cjs`, which clicks
through the demo *and* the agent-view panels and prints what it measured:

```
grow (default)   : 2.2fr 1fr
after click last : 1fr 2.2fr
tiles after +2   : 6 -> 1fr 1fr 2.2fr
solo             : 0fr 0fr 1fr   (5 tiles collapsed)
equal            : 1fr 1fr 1fr
after pressing 2 : 1fr 2.2fr 1fr
agent panels     : 12 rows, 4 folders
  unscoped       : 12 visible
  hover ~/infra  : 4 visible, all of them infra
  mouse out      : 12 visible again
os button        : Get Claufy for macOS
```

Narrow-viewport check at 390x780: `document.scrollWidth` is 390 with **zero**
elements past the right edge, cards and panels stack to one column, and the
desktop hint shows. At 1400 the cards are `533px 533px` — a 2x2, not 3 + an
orphan.

Two small traps found while building that section, both fixed in the CSS:
a `<button>` centres its content vertically, so the folder tiles needed
`flex-direction: column; justify-content: flex-start`; and JetBrains Mono fuses
`--` into one long dash, which made `--cwd` read as an em dash, so anything
showing a real command sets `font-variant-ligatures: none`.

**Launched.** All five of the old blockers are done: repo pushed, six installers
published, real URLs on the page, hosted on Cloudflare Pages, and Windows/Linux
builds proven by CI rather than assumed.

### How a release happens now

```bash
git tag -a v0.1.2 -m "..." && git push origin v0.1.2   # that is the whole thing
```

`.github/workflows/release.yml` then builds on macos / windows / ubuntu in
parallel and attaches the artifacts. Six of them:

```
Claufy-mac-arm64.dmg / .zip      Claufy-win-x64.exe
Claufy-mac-x64.dmg   / .zip      Claufy-linux-x86_64.AppImage
```

`artifactName` deliberately carries **no version**, which is what makes
`/releases/latest/download/<name>` a permanent link the site hardcodes.

**The AppImage is `x86_64`, not `x64`** — AppImage names itself after the kernel
arch string while every other target says x64. That mismatch shipped a 404 on the
Linux button for about ten minutes. `npm run check-links` now fetches every
GitHub URL on the page (including the ones built by string concatenation) and
exits non-zero on anything that is not a 200. **Run it after any release.**

### Verified how

The **downloaded** `Claufy-mac-arm64.dmg` was mounted and its bundle run with
`CLAUFY_SMOKE=1`, not just the local build:

```
bundle id dev.vedhith.claufy   version 0.1.0   Mach-O arm64
spawn-helper -rwxr-xr-x        <- the execute-bit trap survives packaging
ptyOk true   4/4 shells produced output   spawnErrors []   dead 0
```

Caveat: `curl` does not set `com.apple.quarantine`, so that run did **not**
exercise Gatekeeper. The right-click → Open instruction on the site and in the
README is the standard remedy for an unsigned app but has not been tested on a
machine that downloaded it through a browser.

### The repo moved accounts (2026-08-09)

It was created on **`kk-vp`**, which is reserved for visionAnchor. `gh repo
create` uses whatever account is *active* and kk-vp is the default, so nothing
in the command revealed the wrong owner.

It was **recreated** at `github.com/vedhith/claufy` rather than transferred: a
GitHub transfer between two personal accounts cannot be completed by an agent
(the receiving account must accept in the web UI — there is no API for it) and
it would leave a permanent redirect from the old path anyway. Full history, both
tags and both releases were rebuilt by CI under the new owner and verified.

The old repo has had its releases deleted and is now private — `kk-vp/claufy`
returns 404 — but it still exists. Deleting it needs the `delete_repo` scope,
which requires an interactive `gh auth refresh`. See "Still open".

A `PreToolUse` hook (`~/.claude/hooks/github-account-guard.py`) now blocks any
create/push aimed at kk-vp from a non-visionAnchor project.

**Still open:**

0. **Delete `kk-vp/claufy`.** Two commands, needs a browser once:
   `gh auth switch --user kk-vp && gh auth refresh -h github.com -s delete_repo`
   then `gh repo delete kk-vp/claufy --yes`, then switch back with
   `gh auth switch --user vedhithkrishnakumar-cell`.
1. **Custom domain** — the user is buying one. Attach with
   `wrangler pages domain add <domain> --project-name claufy`, then point the
   DNS at Cloudflare. Update `homepage` in `package.json` and the README header.
2. **Code signing.** Unsigned on all three platforms, so every OS shows a scare
   on first launch. Apple is $99/yr; Windows EV certs cost more. Documented
   rather than solved.
3. The Node 20 deprecation warning from the GitHub Actions runners is noise —
   the actions are already forced onto Node 24.

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

**Variant 1 of 12: "Pixel cat" — black 16x16 pixel cat on a white rounded
tile.** Chosen after three rejected directions (line-art cat, geometric
primitives, irregular silhouette). The user's brief settled on: *pixelated,
simple, like the Claude icon* — flat fill, one ink colour, no outlines.

> It shipped briefly as **variant 6**, the same sprite inverted (white cat,
> black tile), then the user asked for a black outline on a white background —
> which is exactly variant 1. Same artwork, opposite ink.

Consequence worth knowing: the two inline cats in `src/renderer/index.html`
**keep their tile now**. They used not to, because a black tile behind a white
cat was invisible against the app's dark bar. With the ink flipped, stripping
the tile would leave black pixels on a dark bar — nothing at all. `apply-icon.mjs`
therefore emits the full artwork, which also makes the in-app mark match the
Dock icon.

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
