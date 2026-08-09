# Claufy — intent

Why the thing is shaped the way it is. Written as decisions land, not after.

## What it is

One desktop window holding tiles. Tiles are terminals or web pages. Adding one
re-spaces the rest; the active one grows. Cross-platform by construction.

## Built

- Electron shell, TypeScript, esbuild. No UI framework — the whole UI is a grid
  and some tiles, and a framework would be more machinery than the problem has.
- Terminal tiles: `node-pty` + `xterm.js`, login shell so aliases and PATH match
  a real terminal.
- Layout: one CSS Grid. Sizes live in `grid-template-columns` / `-rows`.
- Three focus modes — Equal / Grow / Solo — persisted to `localStorage`.
- Page tiles via `<webview>`.
- Cat icon, drawn as SVG, rasterised by `npm run icons`.
- `CLAUFY_SMOKE=1` self-test that drives the real functions and prints JSON.

## Decisions, and why

**Animate grid tracks, not the tiles.** The obvious approach — transform/scale
the focused tile — blurs terminal text, because a scaled canvas is resampled.
Animating `grid-template-*` re-lays-out instead, so glyphs stay crisp at every
frame. Chromium interpolates `fr` values, so this is one property change.

**Solo mode is `0fr`, not `display:none`.** Hiding a tile cannot be animated and
tears down the terminal's size. Collapsing the track animates, and the shell
survives at zero width. Tiles need `min-width/height: 0` or the tracks refuse
to shrink — grid items default to `min-width: auto`.

**An app, not a window manager.** The earlier prototype drove real macOS
Terminal windows (see `~/.local/bin/claufy`). It worked, but: macOS-only,
scripted window close is refused when a process is live, `customTitle` is
overwritten by whatever runs inside, and tty numbers get recycled. Owning the
windows removes that whole class of problem and is the only route to Windows.

**Native apps are not embeddable — say so.** No cross-platform toolkit can
reparent another app's window. Pretending otherwise would mean a feature that
works on one OS and lies on the others, so those open in the OS instead.

**`spawn-helper` needs `chmod +x` on postinstall.** npm drops the execute bit
from node-pty's prebuild. The only symptom is `posix_spawnp failed.`, which
names neither file nor cause. Cost an hour; the repair script exists so it
never costs another.

**The theme is Terminal.app's, copied exactly.** Not "a dark theme that feels
similar" — the actual values from the user's Clear Dark profile, including all
sixteen ANSI colours and the font. A tile that is one shade off from the window
it replaces looks broken in a way a wholly different theme would not.
They are baked in as literals rather than read at launch, so the app looks the
same on a machine with no Terminal.app and does not need to parse a plist to
draw its first frame.

**Icon: white mass, black line, four shapes.** No mouth, no whiskers — thin
strokes turn to mush at 16px, which is the size that actually matters in a
Dock and a Spotlight row. Pointed ears carry the "cat" on their own. Verified
by counting pixels: zero non-grey pixels, ~79% white.

**Ad-hoc sign on install.** electron-builder leaves a bundle whose signature
block claims resources it does not have, so `spctl` reports it as *broken*
rather than merely unsigned. `codesign --sign -` costs nothing and avoids a
class of Gatekeeper weirdness that would be miserable to debug later.

## Decided, not built

- **Status-driven layout** — the tile that needs you gets the big one.
  `claude agents --json` reports `busy` / `idle` / needs-input, so the grid could
  be a queue rather than a grid. This is the strongest idea here and nothing
  else on the market does it.
- **Save and restore a workspace** — which folders were open, in what order.
- **Split a tile** rather than only adding to the grid.
- **Packaging** — electron-builder for `.dmg` / `.exe`. Runs from source today.
- **Drag to reorder tiles.**

## Order of work

1. Status-driven layout (needs the workspace concept below to be worth it).
2. Save/restore workspaces — without it you re-open everything each launch.
3. Packaging, once the above two settle the UI.

## Open questions

- Should page tiles get back/forward/reload, or stay deliberately bare?
- Does Solo want to remember the previous mode per tile, or globally? Currently
  global.
