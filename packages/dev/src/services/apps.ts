// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter } from "node:path";
import { parse } from "dotenv";
import { type ExecaChildProcess, execa } from "execa";
import { dirname, join } from "pathe";
import pc from "picocolors";
import { isAtLeastAsNew, onShutdown, readLines } from "../helpers.js";
import { type PortMap, sameWorktreePath } from "../worktree.js";

const APP_COLORS: Record<string, (s: string) => string> = {
  erp: pc.cyan,
  mes: pc.magenta
};

// Drop portless banners (`-- ...`), pnpm script-echo (`> ...`), blanks.
// Vite "Local:", "ready in …", and errors pass through.
const NOISE_PATTERNS: RegExp[] = [/^\s*--\s/, /^\s*>\s/, /^\s*$/];

function isNoiseLine(line: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ignored using `--suppress`
  const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
  return NOISE_PATTERNS.some((re) => re.test(plain));
}

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

const APP_PORT_KEYS: Partial<Record<string, keyof PortMap>> = {
  erp: "PORT_ERP",
  mes: "PORT_MES"
};

const APP_URL_ENV_KEYS: Partial<Record<string, string>> = {
  erp: "ERP_URL",
  mes: "MES_URL"
};

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
}): Promise<void> {
  const { root, apps, ports, portless } = opts;
  const buildCommand =
    opts.command ?? (({ port }) => reactRouterDevCommand(port));

  // When portless is active, apps talk to Supabase over HTTPS using
  // portless's self-signed CA. Tell Node to trust it.
  const caPath = join(homedir(), ".portless", "ca.pem");
  const extraCaEnv =
    portless && existsSync(caPath) ? { NODE_EXTRA_CA_CERTS: caPath } : {};

  let shuttingDown = false;

  // The live child per app slot; supervisors swap these on restart and
  // `shutdown()` signals whatever is current.
  const current: (ExecaChildProcess | undefined)[] = new Array(apps.length);

  const spawnOne = (id: string): ExecaChildProcess => {
    const color = APP_COLORS[id] ?? ((s: string) => s);
    // Spawn apps directly with assigned ports. Hostnames are registered via
    // `portless alias` (in registerAliases) so we control the exact format
    // (`<app>.<prefix>.dev`) without portless auto-prefix mangling.
    const portKey = APP_PORT_KEYS[id];
    const port = portKey ? ports[portKey] : undefined;
    const appEnv = spawnAppEnv(root, id);
    // Each app needs its own VERCEL_URL so auth redirects (magic link,
    // OAuth callback) return to the correct app, not always ERP.
    const urlKey = APP_URL_ENV_KEYS[id];
    const vercelUrl = urlKey ? appEnv[urlKey] : undefined;
    const { file, args } = buildCommand({ id, port });
    const child = execa(file, args, {
      cwd: join(root, "apps", id),
      env: {
        ...appEnv,
        ...extraCaEnv,
        HOST: "127.0.0.1",
        ...(port !== undefined ? { PORT: String(port) } : {}),
        ...(vercelUrl ? { VERCEL_URL: vercelUrl } : {})
      },
      reject: false,
      stdin: "ignore",
      detached: true
    });

    const prefix = color(pc.bold(`${id.padEnd(3)} | `));
    const disposers: Array<() => void> = [];
    const pipe = (
      stream: NodeJS.ReadableStream | null,
      sink: NodeJS.WriteStream
    ) => {
      if (!stream) return;
      disposers.push(
        readLines(stream, (line) => {
          // Mute shutdown noise (EPIPE, ELIFECYCLE 143, esbuild "stopped").
          if (shuttingDown || isNoiseLine(line)) return;
          sink.write(`${prefix}${line}\n`);
        })
      );
    };
    pipe(child.stdout, process.stdout);
    pipe(child.stderr, process.stderr);
    // Close the readline interfaces when this child exits so a restarting
    // (crash-looping) app doesn't leak one per respawn.
    child.once("exit", () => {
      for (const dispose of disposers) dispose();
    });

    return child;
  };

  let killTimer: NodeJS.Timeout | undefined;

  const shutdown = (signal: "SIGTERM" | "SIGKILL") => {
    for (const c of current) {
      if (!c || c.exitCode !== null || !c.pid) continue;
      try {
        process.kill(-c.pid, signal);
      } catch {
        try {
          c.kill(signal);
          // biome-ignore lint/suspicious/noEmptyBlockStatements: ignored using `--suppress`
        } catch {}
      }
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

function trackAuxChild(child: ExecaChildProcess): void {
  auxChildren.add(child);
  child.once("exit", () => auxChildren.delete(child));
}

export function stopAuxApps(): void {
  for (const child of auxChildren) {
    if (child.exitCode !== null || !child.pid) continue;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
        // biome-ignore lint/suspicious/noEmptyBlockStatements: best-effort kill
      } catch {}
    }
  }
}

export function whenAuxAppExits(): Promise<void> {
  return new Promise<void>((resolve) => {
    for (const child of auxChildren) child.once("exit", () => resolve());
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

  const pipe = (
    stream: NodeJS.ReadableStream | null,
    sink: NodeJS.WriteStream
  ) => {
    if (!stream) return;
    readLines(stream, (line) => {
      if (isNoiseLine(line)) return;
      sink.write(`${prefix}${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);

  trackAuxChild(child);
  onShutdown(() => stopAuxApps());

  return child;
}

const EMAIL_PREFIX = pc.green(pc.bold("eml | "));

const EMAIL_STARTUP_PATTERNS: RegExp[] = [
  /^\s*React Email\b/,
  /^\s*Running preview at:/,
  /Getting react-email preview server ready/,
  /^\s*[✔✓]\s*Ready in\b/
];

function isEmailStartupLine(line: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strip SGR codes
  const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
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

  const pipe = (
    stream: NodeJS.ReadableStream | null,
    sink: NodeJS.WriteStream
  ) => {
    if (!stream) return;
    readLines(stream, (line) => {
      if (isNoiseLine(line) || isEmailStartupLine(line)) return;
      sink.write(`${EMAIL_PREFIX}${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);

  trackAuxChild(child);
  onShutdown(() => stopAuxApps());

  return child;
}

// Detached + reject:false so the caller owns the lifecycle: kill the whole
// process group on teardown (apps mode) or `unref()` it to outlive crbn
// (services-only mode). Previously fire-and-forget `.unref()`, which orphaned
// the listener across `crbn down`.
export function spawnStripeListener(root: string): ExecaChildProcess {
  return execa("pnpm", ["run", "dev:stripe"], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    reject: false
  });
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

// ---------------------------------------------------------------------------
// Orphan cleanup — used by `crbn down` to kill host processes that survived
// a crashed `crbn up`. Dev servers and the stripe listener are spawned
// `detached: true` so they outlive the parent; without this, orphaned
// processes hold the worktree's ports and block the next `crbn up`.
// ---------------------------------------------------------------------------

// Kill processes listening on PORT_ERP / PORT_MES. Port-based lookup is
// reliable since ports are unique per worktree (allocated in the slot
// registry). Best-effort — silently skips ports with nothing listening.
export async function killOrphanedApps(ports: PortMap): Promise<void> {
  const appPorts = [ports.PORT_ERP, ports.PORT_MES, ports.PORT_EMAIL].filter(
    (p) => typeof p === "number"
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
        // biome-ignore lint/suspicious/noEmptyBlockStatements: best-effort kill
      } catch {}
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
        // biome-ignore lint/suspicious/noEmptyBlockStatements: best-effort kill
      } catch {}
    }
  }
}

// Resolve a process's current working directory via lsof (macOS + Linux).
// Returns null if the process is gone or lsof isn't available.
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
