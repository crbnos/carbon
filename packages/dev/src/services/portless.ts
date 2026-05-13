import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { confirm, isCancel, log, spinner } from "@clack/prompts";
import { execa, execaSync } from "execa";
import pc from "picocolors";
import {
  ALIAS_SERVICES,
  type AppId,
  PORTLESS_MIN_VERSION
} from "../constants.js";
import type { PortMap } from "../worktree.js";

// Strip npm_* / PNPM_* so portless doesn't refuse with "should not be run via
// npx or pnpm dlx" when invoked from `pnpm exec tsx`. Pair with
// `extendEnv: false` on the execa call.
function portlessEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("PNPM_") || k.startsWith("npm_")) continue;
    out[k] = v;
  }
  return out;
}

// `sudo` preserves HOME so portless state lands in the user's ~/.portless
// rather than /var/root/.portless.
function sudoPortless(args: string[]): string[] {
  return [`HOME=${homedir()}`, "portless", ...args];
}

export async function ensurePortlessInstalled() {
  const installed = await detectPortlessVersion();
  if (installed && cmpSemver(installed, PORTLESS_MIN_VERSION) >= 0) return;

  if (!installed) {
    log.warn(
      `portless is not installed globally. Required for app routing (${PORTLESS_MIN_VERSION}+).`
    );
  } else {
    log.warn(
      `portless v${installed} is too old. Need ${PORTLESS_MIN_VERSION}+ for monorepo + package.json config.`
    );
  }

  // Auto-yes paths: non-TTY stdin (we were invoked from a script/pipe) or
  // explicit env override. Otherwise interactive confirm.
  const autoYes = process.env.CARBON_DEV_YES === "1" || !process.stdin.isTTY;
  if (!autoYes) {
    const ok = await confirm({
      message: "Install portless@latest globally now?",
      initialValue: true
    });
    if (isCancel(ok) || !ok) {
      throw new Error(
        `Aborted. Install manually: ${pc.cyan("npm install -g portless@latest")} (or bun/pnpm equivalent).`
      );
    }
  } else {
    log.info("auto-installing portless (non-interactive / CARBON_DEV_YES=1)");
  }

  const s = spinner();
  s.start("installing portless@latest globally (pnpm add -g)");
  const r = await execa("pnpm", ["add", "-g", "portless@latest"], {
    reject: false
  });
  if (r.exitCode !== 0) {
    s.stop("✗ install failed");
    const stderr = r.stderr ?? "";
    const stdout = r.stdout ?? "";
    const combined = `${stderr}\n${stdout}`;

    // Fresh dev box: pnpm has no global bin dir. Surface pnpm's setup fix.
    if (/ERR_PNPM_NO_GLOBAL_BIN_DIR/.test(combined)) {
      log.error("pnpm has no global bin directory configured.");
      log.message(
        [
          "To fix this, run pnpm's one-time setup (creates ~/.local/share/pnpm",
          "and writes PNPM_HOME to your shell rc), then re-run `crbn up`:",
          "",
          `    ${pc.cyan("pnpm setup")}`,
          `    ${pc.cyan("source ~/.zshrc   # or open a new shell")}`,
          `    ${pc.cyan("crbn up")}`,
          "",
          "Alternative — install portless via npm instead:",
          "",
          `    ${pc.cyan("npm install -g portless@latest")}`
        ].join("\n")
      );
      throw new Error("portless install aborted: pnpm global bin dir missing");
    }

    process.stderr.write(stderr);
    throw new Error(
      `pnpm add -g portless failed (exit ${r.exitCode}). Manual fallback: ${pc.cyan("npm install -g portless@latest")}`
    );
  }
  const after = await detectPortlessVersion();
  s.stop(`portless v${after ?? "?"} installed`);
}

export function startProxyDaemon(root: string) {
  execa("portless", ["proxy", "start"], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    preferLocal: true,
    extendEnv: false,
    env: portlessEnv()
  }).unref();
}

// Must match render-env.ts hostnames + the api.carbon.dev OAuth alias.
const PORTLESS_TLD = "dev";

type PrivilegeIssue =
  | { kind: "wrong_port"; port: number }
  | { kind: "not_running" };

function detectPrivilegeIssues(): PrivilegeIssue[] {
  const issues: PrivilegeIssue[] = [];
  const portFile = `${homedir()}/.portless/proxy.port`;
  const pidFile = `${homedir()}/.portless/proxy.pid`;

  if (!existsSync(portFile) || !existsSync(pidFile)) {
    issues.push({ kind: "not_running" });
    return issues;
  }
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  if (!isProcessAlive(pid)) {
    issues.push({ kind: "not_running" });
    return issues;
  }
  const port = Number(readFileSync(portFile, "utf8").trim());
  if (port && port !== 80 && port !== 443) {
    issues.push({ kind: "wrong_port", port });
  }
  return issues;
}

// Treat EPERM as alive — root-owned portless daemon is still serving even
// when we (normal user) can't signal it.
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function describeIssues(issues: PrivilegeIssue[]): string {
  return issues
    .map((i) =>
      i.kind === "not_running"
        ? "portless proxy not running"
        : `proxy on :${i.port} (not :443; URLs would need port suffix)`
    )
    .join("\n  • ");
}

// portless needs sudo to bind :443 and write /etc/hosts. `.dev` is a public
// HSTS-preloaded TLD so we rely on /etc/hosts (no /etc/resolver/<tld> for
// public TLDs).
export async function ensureProxyPrivileges() {
  const issues = detectPrivilegeIssues();
  if (issues.length === 0) return;

  log.warn(
    [
      "portless needs a privileged proxy to serve `*.dev` cleanly:",
      "",
      `  • ${describeIssues(issues)}`,
      "",
      "Without :443 + /etc/hosts entries, browsers hit the public `.dev` TLD",
      "(NXDOMAIN) or you'd have to type `:<port>` after every URL."
    ].join("\n")
  );

  const proceed = await confirm({
    message:
      "Set it up now? Will run sudo to bind :443, install the local CA, and write /etc/hosts entries.",
    initialValue: true
  });
  if (isCancel(proceed) || !proceed) {
    throw new Error(
      "Aborted. Run manually: `sudo portless proxy stop && sudo portless proxy start --tld dev && sudo portless trust`. Then re-run `crbn up`."
    );
  }

  log.info("running sudo commands — you'll be prompted for your password");

  await execa("sudo", sudoPortless(["proxy", "stop"]), {
    stdio: "inherit",
    reject: false
  });

  const start = await execa(
    "sudo",
    sudoPortless(["proxy", "start", "--tld", PORTLESS_TLD]),
    {
      stdio: "inherit",
      reject: false
    }
  );
  if (start.exitCode !== 0) {
    throw new Error(`portless proxy start failed (exit ${start.exitCode})`);
  }

  const trust = await execa("sudo", sudoPortless(["trust"]), {
    stdio: "inherit",
    reject: false
  });
  if (trust.exitCode !== 0) {
    log.warn(
      `portless trust failed (exit ${trust.exitCode}); browsers may show cert warnings until you run it manually.`
    );
  }

  const remaining = detectPrivilegeIssues();
  if (remaining.length > 0) {
    throw new Error(
      `portless setup still incomplete:\n  • ${describeIssues(remaining)}`
    );
  }

  log.success("portless proxy on :443");
}

// Push registered routes into /etc/hosts. Needs sudo; idempotent.
export async function syncHostsFile() {
  const r = await execa("sudo", sudoPortless(["hosts", "sync"]), {
    stdio: "inherit",
    reject: false
  });
  if (r.exitCode !== 0) {
    throw new Error(
      `sudo portless hosts sync failed (exit ${r.exitCode}). Run it manually to fix DNS.`
    );
  }
}

// Root proxy daemon watches routes.json (fs.watch) and writes /etc/hosts
// itself — skip our manual sudo sync.
export function proxyRunsAsRoot(): boolean {
  const pidFile = `${homedir()}/.portless/proxy.pid`;
  if (!existsSync(pidFile)) return false;
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  if (!pid) return false;
  try {
    const r = execaSync("ps", ["-p", String(pid), "-o", "user="]);
    return r.stdout.trim() === "root";
  } catch {
    return false;
  }
}

// True when every routes.json hostname appears inside /etc/hosts's
// portless-managed block. Lets `crbn up` skip the sudo sync on unchanged runs.
export function hostsFileInSync(): boolean {
  const routesPath = `${homedir()}/.portless/routes.json`;
  if (!existsSync(routesPath)) return true; // nothing to sync

  let hosts: { hostname: string }[];
  try {
    hosts = JSON.parse(readFileSync(routesPath, "utf8"));
  } catch {
    return false;
  }
  const desired = new Set(hosts.map((h) => h.hostname));
  if (desired.size === 0) return true;

  let etcHosts: string;
  try {
    etcHosts = readFileSync("/etc/hosts", "utf8");
  } catch {
    return false;
  }
  // Only check inside portless-managed block; outside is user-controlled.
  const startIdx = etcHosts.indexOf("# portless-start");
  const endIdx = etcHosts.indexOf("# portless-end");
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return false;
  const block = etcHosts.slice(startIdx, endIdx);
  const present = new Set<string>();
  for (const line of block.split("\n")) {
    const m = line.match(/^\s*\d+\.\d+\.\d+\.\d+\s+(\S+)/);
    if (m && m[1]) present.add(m[1]);
  }
  for (const h of desired) {
    if (!present.has(h)) return false;
  }
  return true;
}

export async function waitForProxyReady(timeoutMs = 30_000) {
  const tldFile = `${homedir()}/.portless/proxy.tld`;
  const pidFile = `${homedir()}/.portless/proxy.pid`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(tldFile) && existsSync(pidFile)) {
      const pid = Number(readFileSync(pidFile, "utf8").trim());
      if (isProcessAlive(pid)) {
        await sleep(500);
        return;
      }
    }
    await sleep(500);
  }
}

export async function registerAliases(
  root: string,
  branchPrefix: string,
  ports: PortMap
) {
  const aliases = aliasMap(branchPrefix, ports);
  await Promise.all(
    aliases.map((a) =>
      execa("portless", ["alias", a.name, String(a.port), "--force"], {
        cwd: root,
        reject: false,
        stdio: "ignore",
        preferLocal: true,
        extendEnv: false,
        env: portlessEnv()
      })
    )
  );
  return aliases.length;
}

export async function unregisterAliases(root: string, branchPrefix: string) {
  await Promise.all(
    ALIAS_SERVICES.map((s) => withPrefix(s, branchPrefix)).map((name) =>
      execa("portless", ["alias", "--remove", name], {
        cwd: root,
        reject: false,
        stdio: "ignore",
        preferLocal: true,
        extendEnv: false,
        env: portlessEnv()
      })
    )
  );
}

// Pre-empt `<prefix>.<app>.{dev,localhost}` routes before spawning apps.
// Orphan portless processes from a prior `crbn up` keep entries alive,
// causing `RouteConflictError` on the next run. SIGTERM → 400ms poll →
// SIGKILL stragglers, then drop matching entries.
export async function claimAppHosts(
  branchPrefix: string,
  appIds: readonly AppId[]
): Promise<number> {
  const path = `${homedir()}/.portless/routes.json`;
  if (!existsSync(path)) return 0;

  let routes: { hostname: string; port: number; pid: number }[];
  try {
    routes = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return 0;
  }

  const ourHosts = new Set(
    appIds.flatMap((id) => {
      const name = withPrefix(id, branchPrefix);
      return [`${name}.dev`, `${name}.localhost`];
    })
  );

  const pidsToKill = new Set<number>();
  for (const r of routes) {
    if (ourHosts.has(r.hostname) && r.pid > 0 && isProcessAlive(r.pid)) {
      pidsToKill.add(r.pid);
    }
  }

  for (const pid of pidsToKill) {
    try {
      process.kill(pid, "SIGTERM");
      // biome-ignore lint/suspicious/noEmptyBlockStatements: ignored using `--suppress`
    } catch {}
  }

  const deadline = Date.now() + 400;
  while (Date.now() < deadline) {
    let allGone = true;
    for (const pid of pidsToKill) {
      if (isProcessAlive(pid)) {
        allGone = false;
        break;
      }
    }
    if (allGone) break;
    await sleep(50);
  }
  for (const pid of pidsToKill) {
    if (isProcessAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
        // biome-ignore lint/suspicious/noEmptyBlockStatements: ignored using `--suppress`
      } catch {}
    }
  }

  const filtered = routes.filter((r) => !ourHosts.has(r.hostname));
  if (filtered.length !== routes.length) {
    writeFileSync(path, JSON.stringify(filtered, null, 2));
  }

  return pidsToKill.size;
}

// Drop stale alias entries (pid=0, our hostname pattern) from routes.json.
export function pruneStaleRoutes(branchPrefix: string) {
  const path = `${homedir()}/.portless/routes.json`;
  if (!existsSync(path)) return 0;
  let routes: { hostname: string; pid: number }[];
  try {
    routes = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return 0;
  }
  const ourHosts = ALIAS_SERVICES.flatMap((s) => {
    const name = withPrefix(s, branchPrefix);
    return [`${name}.dev`, `${name}.localhost`];
  });
  const before = routes.length;
  const filtered = routes.filter(
    (r) => !(r.pid === 0 && ourHosts.includes(r.hostname))
  );
  if (filtered.length !== before) {
    writeFileSync(path, JSON.stringify(filtered, null, 2));
    return before - filtered.length;
  }
  return 0;
}

// Branch-independent OAuth callback host. Last `crbn up` wins. Keep in sync
// with SUPABASE_AUTH_EXTERNAL_*_REDIRECT_URI in render-env.ts.
const STABLE_OAUTH_ALIAS = "api.carbon";

// Always prefix with the branch name (last `/`-segment, sanitized) so every
// worktree — including main — gets a distinct `<branch>.<app>.dev` host.
// Bare hosts (`erp.dev`, `api.dev`) are forbidden; falls back to `fallback`
// (typically the worktree slug) when branch is missing/HEAD-detached.
// e.g. `feat/boo` → `boo`, `main` → `main`.
export function branchToPrefix(
  branch: string | null | undefined,
  fallback: string
): string {
  if (!branch || branch === "HEAD") return fallback;
  const last = branch.split("/").pop() ?? "";
  const sanitized = last
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return sanitized || fallback;
}

function withPrefix(name: string, prefix: string): string {
  return `${prefix}.${name}`;
}

// Compose-service host:port aliases mirroring portless's app-host shape.
function aliasMap(
  branchPrefix: string,
  ports: PortMap
): { name: string; port: number }[] {
  return [
    { name: withPrefix("api", branchPrefix), port: ports.PORT_API },
    { name: withPrefix("studio", branchPrefix), port: ports.PORT_STUDIO },
    { name: withPrefix("mail", branchPrefix), port: ports.PORT_INBUCKET },
    { name: withPrefix("inngest", branchPrefix), port: ports.PORT_INNGEST },
    { name: STABLE_OAUTH_ALIAS, port: ports.PORT_API }
  ];
}

async function detectPortlessVersion(): Promise<string | null> {
  const r = await execa("portless", ["--version"], {
    reject: false,
    extendEnv: false,
    env: portlessEnv()
  });
  if (r.exitCode !== 0) return null;
  const m = r.stdout.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? m[0] : null;
}

function cmpSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}
