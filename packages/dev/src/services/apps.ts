import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { parse } from "dotenv";
import { type ExecaChildProcess, execa } from "execa";
import { join } from "pathe";
import pc from "picocolors";
import { isAtLeastAsNew, onShutdown, readLines } from "../helpers.js";
import type { PortMap } from "../worktree.js";

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
