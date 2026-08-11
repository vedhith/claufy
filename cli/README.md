# claufy

Terminal tiles — set up and launched from a terminal.

```
npm install -g claufy
```

## Use it

```
claufy doctor            Check the setup — node-pty, electron, build state
claufy start             Build, then launch the app
claufy dev               Build in watch mode
claufy build             Build once
claufy dist [--release]  Package the app
claufy site              Serve the marketing site
claufy where             Which repo this is operating on
```

## Why `doctor` exists

Claufy's UI is rarely what breaks. The native pieces are:

```
$ claufy doctor

  ✓ Node 20+         v22.22.3
  ✓ Claufy repo      /Users/you/Developer/claufy
  ✓ dependencies     installed
  ✓ electron         v43.3.0
  ✓ node-pty built   native binary present
  ✓ app built        dist/ present
```

**node-pty is the usual culprit.** It ships C++ that has to be compiled against
Electron's ABI, not plain Node's — so a fresh `npm install` leaves a binary that
loads fine under `node` and explodes under Electron. `doctor` checks for the
compiled `.node` file directly and tells you to run `npm run rebuild`, instead
of letting you find out from a stack trace at launch.

It exits non-zero when something is wrong, so it works in a script.

## Finding the repo

Walks up from the current directory looking for Claufy's own `package.json` —
it checks the package *name*, so running it inside another project won't build
that by mistake. Falls back to `~/Developer/claufy`. Override with
`CLAUFY_HOME`.

## What this cannot do yet

**Send a command into a running tile.** Claufy's main process exposes its
terminals over Electron `ipcMain`, which only its own renderer can reach —
there is no socket or port an outside process can open.

Making terminal-to-terminal work needs a control channel added to the app
first. The shape that fits: a unix domain socket at `~/.claufy/control.sock`,
created `0600` so only the owning user can connect, speaking newline-delimited
JSON (`{"cmd":"tiles"}`, `{"cmd":"write","id":"…","data":"…"}`) and reusing the
`pty:*` handlers that already exist.

That is a real change to the app with a real security surface — anything running
as you could then drive your terminals — so it is a decision to make
deliberately, not something to bolt on quietly. Until it exists, no command here
pretends to do it.

## Building

```
npm run build
npm run typecheck
```
