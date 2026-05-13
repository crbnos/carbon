import { type ExecaChildProcess, execa } from "execa";
import { join } from "pathe";
import pc from "picocolors";
import { isAtLeastAsNew, onShutdown, readLines } from "../helpers.js";

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

// Invoke portless directly per app, bypassing the per-app `dev` script.
// Older branches still have `dev: portless` which recurses into itself in
// portless default mode, racing to register `<prefix>.<app>.dev`.
export function spawnApps(opts: {
  root: string;
  apps: string[];
}): Promise<void> {
  const { root, apps } = opts;

  let shuttingDown = false;

  const children: ExecaChildProcess[] = apps.map((id) => {
    const color = APP_COLORS[id] ?? ((s: string) => s);
    // detached: own process group so `process.kill(-pid, sig)` reaches the
    // whole subtree (portless → react-router → vite → esbuild).
    const child = execa("portless", ["--script", "dev:app", "run", "--force"], {
      cwd: join(root, "apps", id),
      preferLocal: true,
      reject: false,
      stdin: "ignore",
      detached: true
    });

    const prefix = color(pc.bold(`${id.padEnd(3)} | `));
    const pipe = (
      stream: NodeJS.ReadableStream | null,
      sink: NodeJS.WriteStream
    ) => {
      if (!stream) return;
      readLines(stream, (line) => {
        // Mute shutdown noise (EPIPE, ELIFECYCLE 143, esbuild "stopped").
        if (shuttingDown || isNoiseLine(line)) return;
        sink.write(`${prefix}${line}\n`);
      });
    };
    pipe(child.stdout, process.stdout);
    pipe(child.stderr, process.stderr);

    return child;
  });

  let killTimer: NodeJS.Timeout | undefined;

  const shutdown = (signal: "SIGTERM" | "SIGKILL") => {
    for (const c of children) {
      if (c.exitCode !== null || !c.pid) continue;
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

  return Promise.all(children)
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      if (killTimer) clearTimeout(killTimer);
      detach();
    });
}

export function spawnStripeListener(root: string) {
  execa("pnpm", ["run", "dev:stripe"], {
    cwd: root,
    detached: true,
    stdio: "ignore"
  }).unref();
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
