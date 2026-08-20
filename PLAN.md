# Claufy — intent

Why the thing is shaped the way it is. Written as decisions land, not after.

## What it is

One desktop window holding tiles. Tiles are terminals or web pages. By default
one tile is at full size in the middle and the rest sit small down the sides,
still live; picking a small one trades places with the middle. Cross-platform by
construction.

## Built

- Electron shell, TypeScript, esbuild. No UI framework — the whole UI is a grid
  and some tiles, and a framework would be more machinery than the problem has.
- Terminal tiles: `node-pty` + `xterm.js`, login shell so aliases and PATH match
  a real terminal.
- Layout: one CSS Grid. Sizes live in `grid-template-columns` / `-rows`.
- Four focus modes — Stage / Grow / Equal / Solo — persisted to `localStorage`.
- Stage: one tile in the middle, the rest in rails either side, and a swap that
  moves exactly two tiles.
- Page tiles via `<webview>`.
- Cat icon, drawn as SVG, rasterised by `npm run icons`.
- `CLAUFY_SMOKE=1` self-test that drives the real functions and prints JSON.
- Versioned workspace persistence: tile order, terminal folders, page URLs,
  active tile and the tile occupying the Stage slot survive relaunches.

- Terminal parity: copy, paste, select all, clear, a native right-click menu,
  clickable URLs, drag-a-file-to-type-its-path, middle-click paste, text size,
  50k scrollback, and platform-correct accelerators.

## Decisions, and why

**Animate grid tracks, not the tiles.** The obvious approach — transform/scale
the focused tile — blurs terminal text, because a scaled canvas is resampled.
Animating `grid-template-*` re-lays-out instead, so glyphs stay crisp at every
frame. Chromium interpolates `fr` values, so this is one property change.

**Stage swaps two tiles; it never re-spaces the window.** Grow's cost is that
every tile moves when you pick one, so after each switch you have to re-find the
thing you were reading. Stage fixes the geometry instead: slot 0 is the middle,
slots 1..n-1 are the rails, and picking a tile swaps two slot numbers. Two tiles
fly, every other one is untouched — measured in the smoke test as
`restStayedPut`, not eyeballed. This is also why Stage is the default: it is the
mode that matches what the app is for, one project per tile with one of them
under your hands.

**The side tiles stay live. That is the difference from Solo.** Solo already
collapses everything to `0fr` for when you want one thing and nothing else, and
duplicating that would be a second answer to a question already answered. Stage
exists for the other case — you want one big and you still want to see the build
finish. So a rail tile keeps a real shell, refits, and stays readable.

**The flight is a translate plus a width/height change, never a scale.** The
obvious FLIP is transform-only, which means scaling, which resamples the
terminal canvas and blurs the glyphs for the whole animation — the same trap
recorded below for Grow. Animating the frame's width and height instead clips
and reveals the content, and a plain translate carries it across, so the text is
sharp on every frame. Grid items take an animated width without disturbing the
tracks, because the tracks are `fr` and `clamp()`, never `auto`.

**A rail tile gets a click sheet over it, because a `<webview>` eats clicks.**
Pointer events inside a webview never reach the embedder, so a *page* tile on a
rail could only be promoted by its header — and "click the small one" has to
mean clicking the thing, not its title bar. A transparent sheet over the body,
shown only on a rail, takes the click instead. It has to carry a `z-index`: it
is created before the terminal host or the webview, so paint order alone would
bury it. On the middle tile there is no sheet, so a page there is fully
interactive. This also makes the rule uniform — on a rail, a click promotes,
whatever the tile happens to be.

**Rails alternate right, left, right, left.** Filling one rail first would slide
the middle tile sideways every time the count changed. Alternating keeps it
centred from three tiles up; two tiles hang a single rail off the right, which is
better than a centred stage with an empty column beside it that reads as a bug.
The last tile in a short rail spans to the bottom so the column has no hole.

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

**The demo on the page opens in Stage.** The page's job is to show the thing
that is hard to describe, and "they trade places" is exactly that: a sentence
about it sounds like every other tiling tool, one click of it does not. The
demo runs the same slot maths and the same flight the app runs, so what the page
shows is what arrives.

**The landing page leads with the agent view, not the tiling.** Tiling is easy to
copy and easy to dismiss — "so it's tmux". Per-folder agent scoping is the thing
nothing else does, and it is the reason the app exists. The page therefore draws
the difference instead of describing it: the same twelve agents shown twice, Claude
Code's machine-wide list beside four folder-scoped tiles, and pointing at a folder
dims every row that folder cannot see. "Scoped" is a word people skim past; a list
going dark is not.

**Say on the page what it cannot do.** Web apps tile; native desktop apps cannot be
embedded by any cross-platform toolkit, so the card says exactly that. A download
page that oversells comes back as a bug report, and the honest limit costs nothing
because the tiles people actually want next to a shell are web pages anyway.

**Keep the name story visible.** Claufy is named after Claude because the first
version existed to run a stack of Claude terminals on a Mac, uniformly, one per
project. That is also the clearest one-paragraph explanation of who the app is for,
so it earns its place on the page rather than living only in a README.

**Every editing command is a message to the renderer, never an Electron
`role`.** This is the root cause of "copy doesn't work". Claufy had no menu of
its own, so Electron's default one was in charge, and its Copy is a `role` —
Chromium's Copy, which copies the *document* selection. A terminal's selection
belongs to xterm, is drawn by xterm, and is invisible to the document, so Cmd+C
ran, succeeded, and copied nothing. Copy now asks xterm for `getSelection()`;
paste reads the clipboard and hands it to `term.paste()` so bracketed-paste
mode is respected and a pasted block is not executed line by line.

**The clipboard goes through the main process, not `navigator.clipboard`.** The
async read needs a permission and a user gesture, and a menu accelerator
reliably has neither. Electron's `clipboard` is synchronous, always available,
and is the only way to reach X11's primary selection, which is what middle-click
pastes on Linux.

**Windows and Linux may not use bare Ctrl chords, and Electron's default menu
does.** That inherited menu bound Copy to Ctrl+C, Select All to Ctrl+A and
Reload to Ctrl+R. In a terminal those are interrupt, start-of-line, and history
search — so a shell in a tile could not be interrupted, and Ctrl+R reloaded the
whole app out from under every running shell. The app now takes Ctrl+Shift
there (GNOME Terminal's and Windows Terminal's convention) and leaves every
bare Ctrl chord to the pty. macOS is the opposite case: the terminal never sees
Cmd, so Cmd+C/V/A/K are free and are what Terminal.app itself uses. The smoke
test asserts no menu item binds `Ctrl+<letter>`, which is why the mac-only
items spell out `Cmd` rather than `CommandOrControl` — otherwise the check
cannot tell a legitimate Cmd+Q from a Ctrl+Q that would break flow control.

**A dropped file types its path; it does not navigate.** Dropping a file on an
Electron window navigates to it by default, which replaces the entire app and
takes every running shell with it. `will-navigate` is refused outright, and a
drop on a tile is quoted and pasted the way Terminal.app does it.

**Links need a modifier.** Clicking a tile to focus it is the most common click
in the app, and a plain-click link would open a browser every time one landed
on a URL. Hover still underlines, and right-click offers Open Link.

**`requestAnimationFrame` is not a timer, and this was a real bug.** Opening a
tile waited on a double rAF before measuring it, then spawned the shell. When
the window is occluded or minimised Chromium stops firing rAF entirely, so a
tile opened while Claufy sat behind another window never got past that line:
no shell, no error, just an empty tile that only woke up if you happened to
bring the window forward. It is now raced against a 250ms timer. It surfaced as
a smoke test that hung at the step which opens terminals, about half the time,
depending on whether the window was frontmost.

**The workspace record is separate from settings, and the smoke profile is
separate from both.** Focus mode, Grow ratio and text size keep their existing
`claufy:settings` record. The open tile list lives in its own versioned,
validated record so an old or malformed workspace can fall back to first-run
behavior without disturbing those settings. `CLAUFY_SMOKE` runs in a temporary
in-memory Electron partition; its real serialization and restoration checks
therefore cannot read or overwrite a person's workspace.

## Decided, not built

- **Status-driven layout** — the tile that needs you gets the big one.
  `claude agents --json` reports `busy` / `idle` / needs-input, so the grid could
  be a queue rather than a grid. This is the strongest idea here and nothing
  else on the market does it.
- **Split a tile** rather than only adding to the grid.
- **Packaging** — electron-builder for `.dmg` / `.exe`. Runs from source today.
- **Drag to reorder tiles.**

## Order of work

1. Status-driven layout (needs the workspace concept below to be worth it).
2. Packaging, once status-driven layout settles the UI.

## Open questions

- Should page tiles get back/forward/reload, or stay deliberately bare?
- Does Solo want to remember the previous mode per tile, or globally? Currently
  global.
- Should the rail width be a control rather than a `clamp()`? The **Size** slider
  is Grow-only and idle in Stage, so it is sitting right there.
- Should a rail tile be draggable to a different rail slot? The slot model would
  take it; nothing else would have to change.

## Design phase (at end — global pipeline 2026-08-20, design/PIPELINE.md)
- Runs AFTER the build is complete; until then the site stays a 3-colour text skeleton.
- 5 elaborate theme concepts → pick → 3 refinements → pick → apply. 3 colours max, no AI-look defaults.
- Feedback layer: visual ack <50 ms + subtle haptics where supported (never heavy).
- Gates: vision critic → pairwise judge → AI device-matrix simulation (PC/laptop/tablet/phone)
  → his devices; findings become GLOBAL library fixes, not local patches.
- Perf: click ack <50 ms, perceived load ≤100 ms, Lighthouse ≥95, INP p75 <100 ms.
