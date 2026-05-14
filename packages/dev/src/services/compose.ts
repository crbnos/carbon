import { log } from "@clack/prompts";
import { execa } from "execa";
import { COMPOSE_DEV_FILE, COMPOSE_SHARED_FILE } from "../constants.js";
import { readLines } from "../helpers.js";
import { projectName } from "../worktree.js";

type Publisher = { PublishedPort: number; TargetPort: number };

// Normalized shape. `parseContainer` ensures Health is always string|null and
// Publishers is always an array — downstream code (ui.ts) doesn't have to
// re-check for null/undefined, and the V8 hidden class stays stable across
// every parsed entry.
export type Container = {
  Service: string;
  Name: string;
  State: string;
  Status: string;
  Health: string | null;
  Publishers: Publisher[];
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function bootStack(root: string, slug: string) {
  await execStrict(
    "docker",
    devArgs(slug, "--env-file", ".env.local", "up", "-d"),
    root
  );
}

// `docker compose restart` a subset of services. Used by the storage-stuck
// heal path: after re-applying init.sql we restart storage/gotrue/postgrest so
// they reconnect with the freshly-rotated supabase role passwords.
export async function restartServices(
  root: string,
  slug: string,
  services: string[]
) {
  if (services.length === 0) return;
  await execa("docker", devArgs(slug, "restart", ...services), {
    cwd: root,
    reject: false,
    stdio: "ignore"
  });
}

// Pull all images before `up -d` so `bootStack` doesn't block silently behind
// a multi-GB download. `--progress=plain` emits parseable per-line status to
// stderr (`<service> Pulling`, `<service> Pulled`); we stream the latest line
// via `onLine` so the caller can feed it into a spinner subtitle.
export async function pullStack(
  root: string,
  slug: string,
  onLine: (line: string) => void
) {
  const proc = execa(
    "docker",
    devArgs(slug, "--env-file", ".env.local", "--progress", "plain", "pull"),
    { cwd: root, reject: false, all: true }
  );

  if (proc.all) {
    readLines(proc.all, (line) => {
      const trimmed = line.trim();
      if (trimmed) onLine(trimmed);
    });
  }

  const r = await proc;
  if (r.exitCode !== 0) {
    process.stderr.write(r.all?.toString() ?? "");
    throw new Error(`docker compose pull failed (exit ${r.exitCode})`);
  }
}

/** Resolved image refs for the dev compose file (tags as pinned in compose). */
export async function devComposeImageRefs(
  root: string,
  slug: string
): Promise<string[] | null> {
  const r = await execa(
    "docker",
    devArgs(slug, "--env-file", ".env.local", "config", "--images"),
    { cwd: root, reject: false }
  );
  if (r.exitCode !== 0) return null;
  const refs = (r.stdout ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return refs.length > 0 ? refs : null;
}

/** True when `docker image inspect` succeeds for every ref (parallel). */
export async function allImagesPresentLocally(
  refs: string[]
): Promise<boolean> {
  const results = await Promise.all(
    refs.map((ref) =>
      execa("docker", ["image", "inspect", ref], {
        stdio: "ignore",
        reject: false
      }).then((x) => x.exitCode === 0)
    )
  );
  return results.every(Boolean);
}

export async function stopStack(
  root: string,
  slug: string,
  withVolumes: boolean
) {
  const args = devArgs(slug, "down");
  if (withVolumes) args.push("-v");
  await execa("docker", args, { cwd: root, stdio: "ignore", reject: false });
}

// One redis per host; recover from stale `carbon-redis` leftovers.
export async function bootSharedRedis(root: string) {
  const args = ["compose", "-f", COMPOSE_SHARED_FILE, "up", "-d", "redis"];
  let r = await execa("docker", args, { cwd: root, reject: false });
  if (r.exitCode !== 0 && /already in use/i.test(r.stderr ?? "")) {
    await execa("docker", ["rm", "-f", "carbon-redis"], {
      reject: false,
      stdio: "ignore"
    });
    r = await execa("docker", args, { cwd: root, reject: false });
  }
  if (r.exitCode !== 0) {
    process.stderr.write(r.stderr ?? "");
    throw new Error(`shared redis up failed (exit ${r.exitCode})`);
  }
}

export async function destroyProjectVolumes(cwd: string, project: string) {
  await execa(
    "docker",
    ["compose", "-f", COMPOSE_DEV_FILE, "-p", project, "down", "-v"],
    { cwd, stdio: "ignore", reject: false }
  );
}

// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------

export async function listContainers(
  root: string,
  slug: string
): Promise<Container[]> {
  const r = await execa(
    "docker",
    devArgs(slug, "ps", "-a", "--format", "json"),
    { cwd: root, reject: false }
  );
  if (r.exitCode !== 0 || !r.stdout?.trim()) return [];
  const out: Container[] = [];
  for (const line of r.stdout.split("\n")) {
    if (!line) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const c = parseContainer(raw);
    if (c) out.push(c);
  }
  return out;
}

function parseContainer(raw: unknown): Container | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.Service !== "string" ||
    typeof r.Name !== "string" ||
    typeof r.State !== "string" ||
    typeof r.Status !== "string"
  ) {
    return null;
  }
  return {
    Service: r.Service,
    Name: r.Name,
    State: r.State,
    Status: r.Status,
    Health: typeof r.Health === "string" ? r.Health : null,
    Publishers: parsePublishers(r.Publishers)
  };
}

function parsePublishers(raw: unknown): Publisher[] {
  if (!Array.isArray(raw)) return [];
  const out: Publisher[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const pp = (p as Record<string, unknown>).PublishedPort;
    const tp = (p as Record<string, unknown>).TargetPort;
    if (typeof pp !== "number" || typeof tp !== "number") continue;
    out.push({ PublishedPort: pp, TargetPort: tp });
  }
  return out;
}

// Names of services declared in the dev compose file, resolved via
// `docker compose config --services` so we don't drift if services are added.
export async function listComposeServices(
  root: string,
  slug: string
): Promise<string[]> {
  const r = await execa(
    "docker",
    devArgs(slug, "--env-file", ".env.local", "config", "--services"),
    { cwd: root, reject: false }
  );
  if (r.exitCode !== 0) return [];
  return (r.stdout ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Tail logs for a single compose service. Returns merged stdout/stderr —
// docker compose writes log content to stderr on some versions. Empty string
// if the call fails; callers use this for best-effort diagnostics.
export async function tailServiceLogs(
  root: string,
  slug: string,
  service: string,
  lines: number
): Promise<string> {
  const r = await execa(
    "docker",
    devArgs(slug, "logs", "--tail", String(lines), "--no-color", service),
    { cwd: root, reject: false }
  );
  return ((r.stdout ?? "") + (r.stderr ?? "")).trim();
}

export async function dockerProjectStates(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const r = await execa(
    "docker",
    [
      "ps",
      "-a",
      "--format",
      '{{.Label "com.docker.compose.project"}}\t{{.State}}'
    ],
    { reject: false }
  );
  for (const line of (r.stdout ?? "").split("\n")) {
    const [project, state] = line.split("\t");
    if (!project || !state) continue;
    if (state === "running") out.set(project, "running");
    else if (!out.has(project)) out.set(project, state);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

// Wipe one logical DB on shared redis via the container's bundled redis-cli —
// avoids requiring a host `redis-cli` install.
export async function flushDb(db: number) {
  const r = await execa(
    "docker",
    ["exec", "carbon-redis", "redis-cli", "-n", String(db), "FLUSHDB"],
    { reject: false, stdio: "ignore" }
  );
  if (r.exitCode !== 0) {
    log.warn(`redis flush of db ${db} failed (skipped)`);
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function devArgs(slug: string, ...rest: string[]): string[] {
  return ["compose", "-f", COMPOSE_DEV_FILE, "-p", projectName(slug), ...rest];
}

async function execStrict(cmd: string, args: string[], cwd: string) {
  const r = await execa(cmd, args, { cwd, reject: false, preferLocal: true });
  if (r.exitCode !== 0) {
    process.stderr.write(r.stderr?.toString() ?? "");
    process.stdout.write(r.stdout?.toString() ?? "");
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.exitCode})`);
  }
}
