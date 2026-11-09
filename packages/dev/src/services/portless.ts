// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { execa, execaSync } from "execa";
import { join } from "pathe";
import {
  OAUTH_HOST,
  ROUTES,
  type RouteName,
  routeAlias,
  TLD
} from "../constants.js";
import { waitUntil } from "../helpers.js";
import { paths } from "../paths.js";
import { type PortMap, slugify } from "../worktree.js";

// portless refuses to run ("should not be run via npx or pnpm dlx") when it
// sees the npm_* / PNPM_* variables `pnpm exec tsx` sets.
function portlessEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("PNPM_") || k.startsWith("npm_")) continue;
    out[k] = v;
  }
  return out;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Runs portless and never throws. One call at a time: every alias change
 * rewrites portless's whole routes file, so two at once lose one.
 */
function runPortless(args: string[]) {
  const run = () =>
    execa("portless", args, {
      reject: false,
      preferLocal: true,
      extendEnv: false,
      env: portlessEnv()
    });
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

export async function detectPortlessVersion(): Promise<string | null> {
  const r = await runPortless(["--version"]);
  if (r.exitCode !== 0) return null;
  return r.stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
}

export function startProxyDaemon() {
  execa("portless", ["proxy", "start"], {
    detached: true,
    stdio: "ignore",
    preferLocal: true,
    extendEnv: false,
    env: portlessEnv()
  }).unref();
}

// ---------------------------------------------------------------------------
// Aliases: `<route>.<prefix>` → a port, served as https://<route>.<prefix>.dev
// ---------------------------------------------------------------------------

// The alias name portless takes is the host without the TLD.
const OAUTH_ALIAS = OAUTH_HOST.slice(0, -`.${TLD}`.length);

/** Every worktree — main included — gets its own `<app>.<prefix>.dev`
 *  hosts: the branch's last `/`-segment (`feat/boo` → `boo`), or `fallback`
 *  (the slug) on a detached HEAD. */
export function branchToPrefix(
  branch: string | null | undefined,
  fallback: string
): string {
  if (!branch || branch === "HEAD") return fallback;
  return slugify(branch.split("/").pop() ?? "") || fallback;
}

/** Points one alias at a port; false when portless refused. */
export async function setAlias(name: string, port: number): Promise<boolean> {
  const r = await runPortless(["alias", name, String(port), "--force"]);
  return r.exitCode === 0;
}

/**
 * Registers every route of a stack, and the shared OAuth host on its API.
 * `skip` leaves routes to a caller that points them elsewhere first.
 */
export async function registerAliases(
  prefix: string,
  ports: PortMap,
  skip: readonly RouteName[] = []
) {
  const aliases = [
    ...(Object.keys(ROUTES) as RouteName[])
      .filter((name) => !skip.includes(name))
      .map((name) => ({
        name: routeAlias(name, prefix),
        port: ports[ROUTES[name]]
      })),
    { name: OAUTH_ALIAS, port: ports.PORT_API }
  ];
  let registered = 0;
  for (const a of aliases) if (await setAlias(a.name, a.port)) registered++;
  return { registered, total: aliases.length };
}

type Route = { hostname: string; port: number; pid: number };

function readRoutes(): Route[] {
  const file = join(paths.portless(), "routes.json");
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, "utf8")) as Route[];
}

// A static alias (pid 0) of the `<route>.<prefix>.dev` shape crbn writes:
// [route, prefix], else null. The OAuth host is every worktree's.
function crbnAlias(r: Route): [RouteName, string] | null {
  if (r.pid !== 0 || r.hostname === OAUTH_HOST) return null;
  if (!r.hostname.endsWith(`.${TLD}`)) return null;
  const [route, ...rest] = r.hostname.slice(0, -`.${TLD}`.length).split(".");
  return route && route in ROUTES && rest.length > 0
    ? [route as RouteName, rest.join(".")]
    : null;
}

/**
 * The aliases of the stack whose own ports are `ownPorts`: every route of
 * each prefix pointing at one of them. Found from the routes, not the branch,
 * so a worktree that switched branches since, or is gone, loses its old ones.
 * Exported for tests.
 */
export function ownedAliasNames(routes: Route[], ownPorts: Set<number>) {
  const prefixes = new Set(
    routes.flatMap((r) => {
      const alias = crbnAlias(r);
      return alias && ownPorts.has(r.port) ? [alias[1]] : [];
    })
  );
  return routes.flatMap((r) => {
    const alias = crbnAlias(r);
    return alias && prefixes.has(alias[1]) ? [routeAlias(...alias)] : [];
  });
}

/** crbn aliases whose port no live slot owns: `portless prune` only reaps
 *  routes that have a process. Exported for tests. */
export function staleAliasNames(routes: Route[], livePorts: Set<number>) {
  return routes.flatMap((r) => {
    const alias = crbnAlias(r);
    return alias && !livePorts.has(r.port) ? [routeAlias(...alias)] : [];
  });
}

async function removeAliases(names: string[]) {
  for (const name of names) await runPortless(["alias", "--remove", name]);
}

/** Removes the aliases of the stack that owns these ports. */
export async function releaseAliases(ownPorts: number[]) {
  await removeAliases(ownedAliasNames(readRoutes(), new Set(ownPorts)));
}

/** Removes crbn aliases whose port no live slot owns; returns their names. */
export async function removeStaleAliases(livePorts: Set<number>) {
  const stale = staleAliasNames(readRoutes(), livePorts);
  await removeAliases(stale);
  return stale;
}

/** portless's own cleanup: dev servers of crashed sessions and their routes. */
export async function pruneStaleRoutes() {
  await runPortless(["prune"]);
}

const proxyFile = (name: string) => join(paths.portless(), name);

function proxyPid(): number | null {
  const file = proxyFile("proxy.pid");
  if (!existsSync(file)) return null;
  return Number(readFileSync(file, "utf8").trim()) || null;
}

// EPERM: a root-owned proxy is alive even though this user can't signal it.
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Why the proxy can't serve `*.dev` without a port suffix, or null. */
export function proxyIssue(): string | null {
  const pid = proxyPid();
  const portFile = proxyFile("proxy.port");
  if (!pid || !existsSync(portFile) || !isProcessAlive(pid)) {
    return "portless proxy not running";
  }
  const port = Number(readFileSync(portFile, "utf8").trim());
  return port && port !== 80 && port !== 443
    ? `proxy on :${port} (not :443; URLs would need port suffix)`
    : null;
}

// A root proxy watches routes.json (fs.watch) and writes /etc/hosts itself.
export function proxyRunsAsRoot(): boolean {
  const pid = proxyPid();
  if (!pid) return false;
  const r = execaSync("ps", ["-p", String(pid), "-o", "user="], {
    reject: false
  });
  return r.stdout.trim() === "root";
}

/** Every route's hostname is in /etc/hosts's portless block. */
export function hostsFileInSync(): boolean {
  let desired: string[];
  let etcHosts: string;
  try {
    desired = readRoutes().map((r) => r.hostname);
    etcHosts = readFileSync("/etc/hosts", "utf8");
  } catch {
    return false;
  }
  if (desired.length === 0) return true;
  // Outside the portless block is the user's.
  const start = etcHosts.indexOf("# portless-start");
  const end = etcHosts.indexOf("# portless-end");
  if (start === -1 || end < start) return false;
  const present = new Set(
    etcHosts
      .slice(start, end)
      .split("\n")
      .map((line) => line.match(/^\s*\d+\.\d+\.\d+\.\d+\s+(\S+)/)?.[1])
  );
  return desired.every((h) => present.has(h));
}

export async function waitForProxyReady(timeoutMs = 30_000) {
  const ready = async () => {
    const pid = proxyPid();
    return (
      pid !== null && existsSync(proxyFile("proxy.tld")) && isProcessAlive(pid)
    );
  };
  if (await waitUntil(ready, { timeoutMs, intervalMs: 500 })) {
    // It writes the files a moment before it serves.
    await sleep(500);
    return;
  }
  // A silent return would report "proxy listening" and the apps would then
  // fail with NXDOMAIN.
  throw new Error(
    `portless proxy did not start within ${timeoutMs / 1_000}s. Check \`portless proxy start\` manually, or run \`crbn up --no-portless\` for localhost URLs.`
  );
}
