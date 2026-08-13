#!/usr/bin/env node
/**
 * claufy — set up and drive the Claufy desktop app from a terminal.
 *
 * Claufy is an Electron app of terminal tiles. The pieces that break are almost
 * never the UI — they are the native ones: node-pty compiled against the wrong
 * Electron ABI, pty helper permissions, missing icons. `claufy doctor` checks
 * those directly instead of making you read a stack trace.
 *
 * What this CANNOT do yet: talk to a *running* Claufy. The app's main process
 * exposes ipcMain handlers, which are reachable only from its own renderer —
 * there is no socket or port an outside process can open. Sending a command
 * into a live tile needs a control channel added to the app first; see the
 * README for the shape that would take.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const VERSION = '0.1.0'

// ── output ──────────────────────────────────────────────────────────────────

const plain = Boolean(process.env.NO_COLOR) || !process.stdout.isTTY
const c = (code: string, s: string) => (plain ? s : `\x1b[${code}m${s}\x1b[0m`)
const bold = (s: string) => c('1', s)
const dim = (s: string) => c('2', s)
const green = (s: string) => c('32', s)
const yellow = (s: string) => c('33', s)
const red = (s: string) => c('31', s)

function die(msg: string): never {
  console.error(`${red('claufy:')} ${msg}`)
  process.exit(1)
}

// ── finding the repo ────────────────────────────────────────────────────────

/**
 * Walks up from a starting directory looking for Claufy's own package.json.
 * Checking the name matters — otherwise running this inside any other project
 * would happily build that instead.
 */
function findRepo(): string | null {
  const explicit = process.env.CLAUFY_HOME
  if (explicit) return isClaufy(explicit) ? resolve(explicit) : null

  let dir = process.cwd()
  for (;;) {
    if (isClaufy(dir)) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  const guess = join(homedir(), 'Developer', 'claufy')
  return isClaufy(guess) ? guess : null
}

function isClaufy(dir: string): boolean {
  const pkg = join(dir, 'package.json')
  if (!existsSync(pkg)) return false
  try {
    return JSON.parse(readFileSync(pkg, 'utf8')).name === 'claufy'
  } catch {
    return false
  }
}

function requireRepo(): string {
  const repo = findRepo()
  if (!repo) {
    die(
      'could not find the Claufy repo.\n' +
        `  Run this from inside it, or set ${bold('CLAUFY_HOME=/path/to/claufy')}.`,
    )
  }
  return repo
}

// ── running npm scripts ─────────────────────────────────────────────────────

function run(repo: string, script: string, extra: string[] = []): void {
  const child = spawn('npm', ['run', script, ...(extra.length ? ['--', ...extra] : [])], {
    cwd: repo,
    stdio: 'inherit',
    // npm is a shell script on Windows; without this the spawn fails there.
    shell: process.platform === 'win32',
  })
  child.on('error', (err) => die(`could not run npm — ${err.message}`))
  child.on('exit', (code) => process.exit(code ?? 0))
}

// ── doctor ──────────────────────────────────────────────────────────────────

type Check = { label: string; ok: boolean; note: string }

function doctor(): void {
  const checks: Check[] = []
  const repo = findRepo()

  const major = Number(process.versions.node.split('.')[0])
  checks.push({
    label: 'Node 20+',
    ok: major >= 20,
    note: `v${process.versions.node}`,
  })

  checks.push({
    label: 'Claufy repo',
    ok: Boolean(repo),
    note: repo ?? 'not found — set CLAUFY_HOME',
  })

  if (repo) {
    const modules = join(repo, 'node_modules')
    checks.push({
      label: 'dependencies',
      ok: existsSync(modules),
      note: existsSync(modules) ? 'installed' : 'run npm install',
    })

    const electron = join(modules, 'electron')
    checks.push({
      label: 'electron',
      ok: existsSync(electron),
      note: existsSync(electron) ? version(electron) : 'missing',
    })

    // node-pty is the one that actually breaks. It ships C++ that has to be
    // compiled against Electron's ABI, not plain Node's, so a fresh `npm
    // install` leaves a binary that loads in `node` and explodes in Electron.
    const pty = join(modules, 'node-pty')
    const built = existsSync(pty) && hasNativeBinary(pty)
    checks.push({
      label: 'node-pty built',
      ok: built,
      note: built ? 'native binary present' : 'run npm run rebuild',
    })

    const built2 = join(repo, 'dist')
    checks.push({
      label: 'app built',
      ok: existsSync(built2),
      note: existsSync(built2) ? 'dist/ present' : 'run claufy build',
    })
  }

  console.log()
  for (const check of checks) {
    const mark = check.ok ? green('✓') : yellow('✗')
    console.log(`  ${mark} ${check.label.padEnd(16)} ${dim(check.note)}`)
  }

  const bad = checks.filter((check) => !check.ok)
  console.log()
  if (!bad.length) {
    console.log(`  ${green('Everything checks out.')} ${dim('claufy start')}\n`)
    return
  }
  console.log(`  ${yellow(`${bad.length} thing${bad.length === 1 ? '' : 's'} to fix`)} — see the notes above.\n`)
  process.exitCode = 1
}

function version(moduleDir: string): string {
  try {
    return `v${JSON.parse(readFileSync(join(moduleDir, 'package.json'), 'utf8')).version}`
  } catch {
    return 'present'
  }
}

/** node-pty's compiled output lands in build/Release as a .node file. */
function hasNativeBinary(ptyDir: string): boolean {
  const release = join(ptyDir, 'build', 'Release')
  if (!existsSync(release)) return false
  try {
    return readdirSync(release).some((f) => f.endsWith('.node'))
  } catch {
    return false
  }
}

// ── entry ───────────────────────────────────────────────────────────────────

function help(): void {
  console.log(`
${bold('claufy')} ${dim(`v${VERSION}`)} — terminal tiles, set up from a terminal.

${bold('Usage')}
  claufy doctor           Check the setup — node-pty, electron, build state
  claufy start            Build, then launch the app
  claufy dev              Build in watch mode
  claufy build            Build once
  claufy dist [--release] Package the app
  claufy site             Serve the marketing site
  claufy where            Which repo this is operating on

${bold('Options')}
  -h, --help / -v, --version

${bold('Environment')}
  CLAUFY_HOME   Path to the Claufy repo, if it is not above the current folder
  NO_COLOR      Turn colour off

${bold('Not yet')}
  Sending a command into a running tile. The app has no control channel an
  outside process can open — see the README.
`)
}

function main(argv: string[]): void {
  const [cmd, ...rest] = argv

  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') return help()
  if (cmd === '-v' || cmd === '--version') {
    console.log(VERSION)
    return
  }

  switch (cmd) {
    case 'doctor':
      return doctor()
    case 'where':
      console.log(requireRepo())
      return
    case 'start':
      return run(requireRepo(), 'start')
    case 'dev':
      return run(requireRepo(), 'dev')
    case 'build':
      return run(requireRepo(), 'build')
    case 'site':
      return run(requireRepo(), 'site')
    case 'dist':
      return run(requireRepo(), rest.includes('--release') ? 'dist:release' : 'dist')
    default:
      die(`unknown command "${cmd}". Try ${bold('claufy --help')}.`)
  }
}

main(process.argv.slice(2))
