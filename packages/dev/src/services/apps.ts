// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { parse } from "dotenv";
import { type ExecaChildProcess, execa } from "execa";
import { dirname, join } from "pathe";
import pc from "picocolors";
import { STACK_STATE_ENV } from "../../stack-state.js";
import { APPS, ROUTE_STYLE, ROUTES, type RouteName } from "../constants.js";
import {
  isAtLeastAsNew,
  killGroup,
  lineWriter,
  onShutdown,
  readLines
} from "../helpers.js";
import { paths } from "../paths.js";
import { type PortMap, sameWorktreePath } from "../worktree.js";

const isRoute = (id: string): id is RouteName => id in ROUTES;

// Drop portless banners (`-- ...`), pnpm script-echo (`> ...`), blanks.
// Vite "Local:", "ready in …", and errors pass through.
const NOISE_PATTERNS: RegExp[] = [/^\s*--\s/, /^\s*>\s/, /^\s*$/];

function isNoiseLine(line: string): boolean {
  const plain = stripVTControlCharacters(line);
  return NOISE_PATTERNS.some((re) => re.test(plain));
}

// Copies a child's output to ours, each line prefixed, `skip`ped lines left
// out. The readers close when it exits, so a crash-looping app leaks none.
function prefixOutput(
  child: ExecaChildProcess,
  prefix: string,
  skip: (line: string) => boolean
): void {
  const disposers: Array<() => void> = [];
  for (const [stream, sink] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr]
  ] as const) {
    if (!stream) continue;
    const write = lineWriter(sink);
    disposers.push(
      readLines(stream, (line) => {
        if (!skip(line)) write(`${prefix}${line}\n`);
      })
    );
  }
  child.once("exit", () => {
    for (const dispose of disposers) dispose();
  });
}

// Rolldown pre-bundles dependencies with one worker per core, and its allocator
// keeps what the workers freed: on a 14-core Mac about 1 GB stayed in each dev
// server after a re-bundle, 320 MB with these (rolldown/rolldown#10985,
// #11233). Read when the binding loads, so they must be set before Node starts.
// Only for the react-router dev servers `crbn` spawns: the assembler's planner
// uses rayon too, and an app's own `dev` script does not get them. The shell or
// a `.env` file overrides them.
const ROLLDOWN_MEMORY_ENV = {
  MIMALLOC_ARENA_PURGE_MULT: "0",
  ROLLDOWN_WORKER_THREADS: "4",
  ROLLDOWN_MAX_BLOCKING_THREADS: "4",
  RAYON_NUM_THREADS: "4"
};

// `portless` inherits `crbn`'s `process.env`; a stale shell `SUPABASE_URL`
// (e.g. `http://127.0.0.1:54321`) would otherwise win over `crbn`'s repo-root
// `.env.local`. Merge the same `.env*` stack as ERP Vite (app then repo, last
// wins) so spawned dev servers always see worktree URLs.
function spawnAppEnv(repoRoot: string, appId: string): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = { ...process.env };
  const appRoot = join(repoRoot, "apps", appId);
  const mergeFile = (abs: string) => {
    if (!existsSync(abs)) return;
    Object.assign(env, parse(readFileSync(abs, "utf8")));
  };
  mergeFile(join(appRoot, ".env"));
  mergeFile(join(appRoot, ".env.local"));
  mergeFile(join(repoRoot, ".env"));
  mergeFile(join(repoRoot, ".env.local"));
  return env as NodeJS.ProcessEnv;
}

type AppCommand = { file: string; args: string[] };

function reactRouterDevCommand(port: number | undefined): AppCommand {
  return {
    file: "pnpm",
    args: [
      "exec",
      "react-router",
      "dev",
      ...(port !== undefined ? ["--port", String(port)] : []),
      "--host",
      "127.0.0.1"
    ]
  };
}

export function spawnApps(opts: {
  root: string;
  apps: string[];
  ports: PortMap;
  portless: boolean;
  // What each app runs; defaults to `pnpm exec react-router dev`. Override to
  // run a different process (the integration tests point this at a controllable
  // node script).
  command?: (ctx: { id: string; port: number | undefined }) => AppCommand;
  // Programmatic teardown in addition to OS signals: abort to stop the stack.
  signal?: AbortSignal;
  /** The stack whose hibernation the dev servers report traffic to. */
  stateDir?: string;
}): Promise<void> {
  const { root, apps, ports, portless } = opts;
  const stateEnv = opts.stateDir ? { [STACK_STATE_ENV]: opts.stateDir } : {};
  const buildCommand =
    opts.command ?? (({ port }) => reactRouterDevCommand(port));

  // When portless is active, apps talk to Supabase over HTTPS using
  // portless's self-signed CA. Tell Node to trust it.
  const caPath = join(paths.portless(), "ca.pem");
  const extraCaEnv =
    portless && existsSync(caPath) ? { NODE_EXTRA_CA_CERTS: caPath } : {};

  let shuttingDown = false;

  // The live child per app slot; supervisors swap these on restart and
  // `shutdown()` signals whatever is current.
  const current: (ExecaChildProcess | undefined)[] = new Array(apps.length);

  const spawnOne = (id: string): ExecaChildProcess => {
    const color = isRoute(id) ? pc[ROUTE_STYLE[id].color] : (s: string) => s;
    // Hostnames come from `portless alias` (registerAliases), not portless's
    // own naming, which would mangle the `<app>.<prefix>.dev` format.
    const app = APPS.find((a) => a.id === id);
    const port = isRoute(id) ? ports[ROUTES[id]] : undefined;
    const appEnv = spawnAppEnv(root, id);
    // Each app needs its own VERCEL_URL so auth redirects (magic link,
    // OAuth callback) return to the correct app, not always ERP.
    const vercelUrl = app && "urlEnv" in app ? appEnv[app.urlEnv] : undefined;
    const { file, args } = buildCommand({ id, port });
    const child = execa(file, args, {
      cwd: join(root, "apps", id),
      env: {
        ...ROLLDOWN_MEMORY_ENV,
        ...appEnv,
        ...extraCaEnv,
        ...stateEnv,
        HOST: "127.0.0.1",
        ...(port !== undefined ? { PORT: String(port) } : {}),
        ...(vercelUrl ? { VERCEL_URL: vercelUrl } : {})
      },
      reject: false,
      stdin: "ignore",
      detached: true
    });

    // Mute shutdown noise (EPIPE, ELIFECYCLE 143, esbuild "stopped").
    prefixOutput(
      child,
      color(pc.bold(`${id.padEnd(3)} | `)),
      (line) => shuttingDown || isNoiseLine(line)
    );

    return child;
  };

  let killTimer: NodeJS.Timeout | undefined;

  const shutdown = (signal: "SIGTERM" | "SIGKILL") => {
    for (const c of current) {
      if (c && c.exitCode === null) killGroup(c, signal);
    }
  };

  const onSignal = () => {
    if (shuttingDown) {
      if (killTimer) clearTimeout(killTimer);
      shutdown("SIGKILL");
      return;
    }
    shuttingDown = true;
    process.stderr.write("\nstopping apps…\n");
    shutdown("SIGTERM");
    killTimer = setTimeout(() => shutdown("SIGKILL"), 3_000);
  };

  const detach = onShutdown(onSignal);
  opts.signal?.addEventListener("abort", onSignal, { once: true });

  // Auto-recover a dev server that dies (a bad rebuild after `git pull`, OOM, a
  // boot-time crash). Restart it in place with backoff so the surviving apps
  // keep their state. A genuinely broken tree would crash-loop, so cap it: more
  // than MAX_RESTARTS within RESTART_WINDOW_MS means give up and tear the stack
  // down for a clean `crbn up` rerun, rather than respawning forever.
  const MAX_RESTARTS = 3;
  const RESTART_WINDOW_MS = 10_000;

  const supervise = (id: string, slot: number): Promise<void> =>
    new Promise<void>((resolve) => {
      const crashes: number[] = [];
      const launch = () => {
        if (shuttingDown) return resolve();
        const child = spawnOne(id);
        current[slot] = child;
        child.on("exit", (code, signal) => {
          if (shuttingDown) return resolve();
          const reason = signal ? signal : `code ${code}`;
          const now = Date.now();
          crashes.push(now);
          let oldest = crashes[0];
          while (oldest !== undefined && now - oldest > RESTART_WINDOW_MS) {
            crashes.shift();
            oldest = crashes[0];
          }
          if (crashes.length > MAX_RESTARTS) {
            process.stderr.write(
              `\n${id} dev server crashed ${crashes.length}× in ${RESTART_WINDOW_MS / 1_000}s (${reason}); giving up. Fix it and rerun \`crbn up\`.\n`
            );
            resolve();
            onSignal();
            return;
          }
          const delay = Math.min(500 * 2 ** (crashes.length - 1), 4_000);
          process.stderr.write(
            `\n${id} dev server exited (${reason}); restarting in ${delay}ms…\n`
          );
          setTimeout(launch, delay);
        });
      };
      launch();
    });

  return Promise.all(apps.map((id, i) => supervise(id, i)))
    .then(() => undefined)
    .finally(() => {
      if (killTimer) clearTimeout(killTimer);
      detach();
    });
}

const ASSEMBLER_PREFIX = pc.yellow(pc.bold("asm | "));

/** Where the one-time OCCT build lives: per machine, shared by every worktree. */
function occtPrefix(): string {
  return (
    process.env.OCCT_PREFIX ||
    join(homedir(), ".cache", "carbon-occt", "8.0.0-p1")
  );
}

/**
 * The cargo the assembler runs with: the first on PATH, else rustup's default
 * home — a shell started before Rust was installed has not sourced
 * `~/.cargo/env` yet, and that must not read as "Rust is missing".
 */
export function cargoBinary(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir && existsSync(join(dir, "cargo"))) return join(dir, "cargo");
  }
  const fallback = join(
    env.CARGO_HOME || join(homedir(), ".cargo"),
    "bin",
    "cargo"
  );
  return existsSync(fallback) ? fallback : null;
}

/**
 * The FCL headers the `collision` crate compiles against, at the prefix its
 * build.rs resolves (`FCL_PREFIX`, else Homebrew's `opt` layout on macOS, else
 * `/usr`). Missing, the assembler build fails minutes in on a C++ include.
 */
function fclInstalled(env: NodeJS.ProcessEnv = process.env): boolean {
  const prefix =
    env.FCL_PREFIX ||
    (process.platform === "darwin"
      ? process.arch === "arm64"
        ? "/opt/homebrew/opt/fcl"
        : "/usr/local/opt/fcl"
      : "/usr");
  return existsSync(join(prefix, "include", "fcl"));
}

/**
 * What the assembler still needs on this machine, as the message that says how
 * to install it, or null when Rust, FCL and the OCCT build are all present.
 * `crbn up` checks it before booting anything, because `cargo run --release`
 * would otherwise fail minutes in on a missing tool, header or library. It
 * never installs or builds them itself.
 */
export function assemblerMissingPrerequisite(): string | null {
  const instead = "  then re-run, or run without the assembler app.";
  if (cargoBinary() === null) {
    return [
      "Assembler selected, but Rust (cargo) isn't installed.",
      "  install it once per machine:",
      "    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh",
      instead
    ].join("\n");
  }
  if (!fclInstalled()) {
    return [
      "Assembler selected, but the FCL collision library isn't installed.",
      "  install it once per machine (pulls libccd, eigen, octomap):",
      "    brew install fcl            # Linux: libfcl-dev, or set FCL_PREFIX",
      instead
    ].join("\n");
  }
  if (!existsSync(occtPrefix())) {
    return [
      "Assembler selected, but its OCCT dependency isn't built.",
      `  expected: ${occtPrefix()}`,
      "  build it once per machine (~15-30 min, every worktree shares it):",
      "    brew install cmake ninja   # once; the script needs cmake",
      "    apps/assembler/scripts/build-occt.sh",
      instead
    ].join("\n");
  }
  return null;
}

/**
 * Cargo's build directory for the assembler. Every worktree builds the same
 * crates, so one shared directory turns each new worktree's first
 * `cargo run --release` (minutes, several GB) into an incremental build of
 * what its branch changed. Cargo locks the directory, so two worktrees
 * building at once wait for each other rather than corrupt it. A
 * `CARGO_TARGET_DIR` the developer set (shell or `.env*`) wins.
 */
export function assemblerCargoTargetDir(env: NodeJS.ProcessEnv): string {
  return (
    env.CARGO_TARGET_DIR || join(homedir(), ".cache", "carbon-cargo-target")
  );
}

const auxChildren = new Set<ExecaChildProcess>();
// The ones whose exit ends a run with no dev servers: not the stripe listener.
const watchedChildren = new Set<ExecaChildProcess>();

let auxShutdownHooked = false;

// The processes crbn spawns beside the dev servers. A Ctrl+C stops them.
function trackAuxChild(
  child: ExecaChildProcess,
  watched = true
): ExecaChildProcess {
  auxChildren.add(child);
  if (watched) watchedChildren.add(child);
  child.once("exit", () => {
    auxChildren.delete(child);
    watchedChildren.delete(child);
  });
  if (!auxShutdownHooked) {
    onShutdown(() => stopAuxApps());
    auxShutdownHooked = true;
  }
  return child;
}

export function stopAuxApps(): void {
  for (const child of auxChildren) {
    if (child.exitCode === null) killGroup(child);
  }
}

export function whenAuxAppExits(): Promise<void> {
  return new Promise<void>((resolve) => {
    for (const child of watchedChildren) child.once("exit", () => resolve());
  });
}

export function spawnAssembler(opts: {
  root: string;
  ports: PortMap;
}): ExecaChildProcess | null {
  const { root, ports } = opts;
  const port = ports.PORT_ASSEMBLER;
  const prefix = ASSEMBLER_PREFIX;

  // `cargo run --release` compiles-if-stale then runs, so a Rust change is
  // picked up on the next `crbn up` (the CLI does not watch/rebuild otherwise).
  // First build is slow (OCCT/FCL); incremental is quick, and the build
  // directory is shared across worktrees (`assemblerCargoTargetDir`). Run from
  // the workspace root so cargo resolves the `assembler` package.
  const cargo = cargoBinary();
  const file = cargo ?? "cargo";
  const args = ["run", "--release", "-p", "assembler"];
  const cwd = root;
  // Merge the worktree .env* stack so the assembler shares the same REDIS_URL as
  // the apps (keys are asm:-prefixed, so sharing the logical DB is safe).
  const appEnv = spawnAppEnv(root, "assembler");
  // ASSEMBLER_DEV_MODE=true also disables TLS verification in the service, so
  // portless's self-signed CA needs no extra trust wiring. Passing
  // REDIS_URL points the service at the stateless Redis-backed job +
  // result store; unset (no worktree REDIS_URL) => in-memory, single-process.
  // Put cargo's own directory first on PATH, so rustc and the rustup proxies
  // resolve even when cargo was found only in ~/.cargo/bin.
  const pathEnv = appEnv.PATH ?? process.env.PATH ?? "";
  const extraEnv: NodeJS.ProcessEnv = {
    ...(cargo ? { PATH: `${dirname(cargo)}${delimiter}${pathEnv}` } : {}),
    CARGO_TARGET_DIR: assemblerCargoTargetDir({ ...process.env, ...appEnv }),
    PORT: String(port),
    ASSEMBLER_SERVICE_API_KEY: "dev-local-key",
    ASSEMBLER_DEV_MODE: "true",
    ...(appEnv.REDIS_URL ? { REDIS_URL: appEnv.REDIS_URL } : {})
  };
  process.stderr.write(
    `${prefix}${pc.dim(
      appEnv.REDIS_URL
        ? "cargo run --release (redis store)"
        : "cargo run --release"
    )}\n`
  );

  const child = execa(file, args, {
    cwd,
    env: {
      ...appEnv,
      ...extraEnv
    },
    reject: false,
    stdin: "ignore",
    detached: true
  });

  prefixOutput(child, prefix, isNoiseLine);

  return trackAuxChild(child);
}

const EMAIL_PREFIX = pc.green(pc.bold("eml | "));

const EMAIL_STARTUP_PATTERNS: RegExp[] = [
  /^\s*React Email\b/,
  /^\s*Running preview at:/,
  /Getting react-email preview server ready/,
  /^\s*[✔✓]\s*Ready in\b/
];

function isEmailStartupLine(line: string): boolean {
  const plain = stripVTControlCharacters(line);
  return EMAIL_STARTUP_PATTERNS.some((re) => re.test(plain));
}

export function spawnEmailPreview(opts: {
  root: string;
  ports: PortMap;
  command?: () => { file: string; args: string[] };
}): ExecaChildProcess {
  const { root, ports, command } = opts;
  const port = ports.PORT_EMAIL;
  const { file, args } = command?.() ?? {
    file: "pnpm",
    args: ["run", "email:previews"]
  };

  const child = execa(file, args, {
    cwd: join(root, "packages", "documents"),
    env: { ...process.env, EMAIL_DEV_PORT: String(port) },
    reject: false,
    stdin: "ignore",
    detached: true
  });

  prefixOutput(
    child,
    EMAIL_PREFIX,
    (line) => isNoiseLine(line) || isEmailStartupLine(line)
  );

  return trackAuxChild(child);
}

// Stopped with the other helper processes; services-only mode `unref()`s it
// to outlive crbn, and `crbn down` stops it then.
export function spawnStripeListener(root: string): ExecaChildProcess {
  return trackAuxChild(
    execa("pnpm", ["run", "dev:stripe"], {
      cwd: root,
      detached: true,
      stdio: "ignore",
      reject: false
    }),
    false
  );
}

// Skip when node_modules/.modules.yaml is newer than pnpm-lock.yaml (pnpm's
// post-install marker). Returns true when install actually ran.
export async function installDeps(root: string): Promise<boolean> {
  if (depsInSync(root)) return false;

  const r = await execa("pnpm", ["install", "--prefer-offline"], {
    cwd: root,
    stdio: "inherit",
    reject: false,
    extendEnv: true
  });
  if (r.exitCode !== 0) {
    throw new Error(`pnpm install failed (exit ${r.exitCode})`);
  }
  return true;
}

function depsInSync(root: string): boolean {
  const lockfile = join(root, "pnpm-lock.yaml");
  const marker = join(root, "node_modules", ".modules.yaml");
  return isAtLeastAsNew(marker, lockfile);
}

export async function syncEnvSymlinks(root: string) {
  const r = await execa("tsx", [join("scripts", "setup-env-files.ts")], {
    cwd: root,
    reject: false,
    preferLocal: true
  });
  if (r.exitCode !== 0) {
    process.stderr.write(r.stderr?.toString() ?? "");
    throw new Error(`setup-env-files failed (exit ${r.exitCode})`);
  }
}

// Re-link .ai/ rules and skills into the .claude/ and .codex/ harness dirs.
// Those symlinks are gitignored, so a fresh worktree has none until this runs;
// and `pnpm install`'s `prepare` hook only fires when the lockfile changes, so
// `crbn up` can't lean on it to keep them fresh. The script is idempotent and
// fast (just recreates symlinks) — safe to run on every boot. Non-fatal: skills
// are dev tooling, so a failure warns rather than aborting the stack boot.
export async function installSkills(root: string): Promise<boolean> {
  const script = join(root, ".ai", "scripts", "install-skills.sh");
  if (!existsSync(script)) return false;
  const r = await execa("bash", [script], { cwd: root, reject: false });
  if (r.exitCode !== 0) {
    process.stderr.write(r.stderr?.toString() ?? "");
    return false;
  }
  return true;
}

// Dev servers and the stripe listener are spawned `detached: true`, so they
// survive a crashed `crbn up` and hold the worktree's ports until killed.

// Kill what listens on the ports of the processes crbn spawns (every app but a
// compose service). The slot registry hands each worktree its own ports.
export async function killOrphanedApps(ports: PortMap): Promise<void> {
  const appPorts = APPS.filter((a) => a.kind !== "service").map(
    (a) => ports[ROUTES[a.id]]
  );
  for (const port of appPorts) {
    const r = await execa("lsof", ["-ti", `:${port}`], { reject: false });
    if (r.exitCode !== 0) continue;
    const pids = r.stdout
      .split("\n")
      .map((s) => Number(s.trim()))
      .filter((n) => n > 0);
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // exited since lsof
      }
    }
  }
}

// Kill the stripe listener (`tsx ./stripe.dev.ts`) whose cwd matches this
// worktree. Cloud-edition only — silently no-ops when nothing matches.
export async function killOrphanedStripe(root: string): Promise<void> {
  const r = await execa("pgrep", ["-f", "stripe.dev.ts"], { reject: false });
  if (r.exitCode !== 0) return;
  const pids = r.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const pidStr of pids) {
    const pid = Number(pidStr);
    if (!pid) continue;
    const cwd = await processCwd(pid);
    if (cwd && sameWorktreePath(cwd, root)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // exited since pgrep
      }
    }
  }
}

async function processCwd(pid: number): Promise<string | null> {
  const r = await execa("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
    reject: false
  });
  if (r.exitCode !== 0) return null;
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("n")) return line.slice(1);
  }
  return null;
}
