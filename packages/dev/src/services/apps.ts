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

export function spawnApps(opts: {
  root: string;
  apps: string[];
  ports: PortMap;
  portless: boolean;
}): Promise<void> {
  const { root, apps, ports, portless } = opts;

  // When portless is active, apps talk to Supabase over HTTPS using
  // portless's self-signed CA. Tell Node to trust it.
  const caPath = join(homedir(), ".portless", "ca.pem");
  const extraCaEnv =
    portless && existsSync(caPath) ? { NODE_EXTRA_CA_CERTS: caPath } : {};

  let shuttingDown = false;

  const children: ExecaChildProcess[] = apps.map((id) => {
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
    const child = execa(
      "pnpm",
      [
        "exec",
        "react-router",
        "dev",
        ...(port !== undefined ? ["--port", String(port)] : []),
        "--host",
        "127.0.0.1"
      ],
      {
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
      }
    );

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
