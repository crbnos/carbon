// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { spawn } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { log } from "@clack/prompts";
import { execa } from "execa";
import { dirname, join } from "pathe";
import {
  COMPOSE_DEV_FILE,
  COMPOSE_DEV_FILE_LEGACY,
  COMPOSE_ISOLATED_FILE,
  isCloudDev
} from "../constants.js";
import { readLines } from "../helpers.js";
import {
  type JwtCreds,
  listSlugs,
  projectName,
  REDIS_DB_MAX,
  readStackMode,
  SHARED_REDIS_PORT
} from "../worktree.js";
import { ensureTemplate } from "./shared-db.js";

// Resolve the dev compose file for a given worktree root. Prefers the current
// location, falls back to the pre-move root path so older checkouts still work.
// Returns an absolute path (so `-f` is independent of cwd); the project dir is
// pinned separately via `--project-directory .`.
function composeFile(root: string): string {
  const current = join(root, COMPOSE_DEV_FILE);
  if (existsSync(current)) return current;
  const legacy = join(root, COMPOSE_DEV_FILE_LEGACY);
  if (existsSync(legacy)) return legacy;
  return current; // neither present — surface the current-path error
}

// The `-f` flags for a worktree's project. Shared mode runs the dev file
// alone; isolated mode adds the private services. `all` adds them whatever
// the mode, for teardowns: a worktree that switched modes still has them.
function composeFileArgs(root: string, slug: string, all = false): string[] {
  const args = ["-f", composeFile(root)];
  const isolated = join(root, COMPOSE_ISOLATED_FILE);
  const wanted = all || readStackMode(slug) === "isolated";
  if (wanted && existsSync(isolated)) args.push("-f", isolated);
  else if (wanted && !all) {
    // Without it an isolated stack starts with no Postgres or Storage.
    throw new Error(`${isolated} is missing: this worktree runs isolated.`);
  }
  return args;
}

// Shared redis runs as a single plain container (not a compose stack) — one per
// host, reused across worktrees via per-worktree logical DB indexes.
export const REDIS_CONTAINER = "carbon-redis";
const REDIS_VOLUME = "carbon-redis-data";

// Fail fast with an actionable message when the Docker daemon is unreachable,
// instead of a cryptic `Cannot connect to the Docker daemon` deep in the boot.
export async function ensureDockerRunning() {
  if (await dockerResponds()) return;
  if (await startDockerDaemon()) return;
  throw new Error(
    "Docker isn't running. Start Docker Desktop (or your docker daemon) and re-run `crbn up`."
  );
}

async function dockerResponds(): Promise<boolean> {
  const r = await execa("docker", ["info"], { reject: false, stdio: "ignore" });
  return r.exitCode === 0;
}

// Cloud containers only (`CARBON_DEV_CLOUD=1`), as root on Linux with `dockerd`
// installed and nothing running it: start the daemon ourselves instead of
// telling a user who is not there to start Docker Desktop. The daemon outlives
// crbn, so the next `crbn up` finds it running.
async function startDockerDaemon(): Promise<boolean> {
  if (!isCloudDev()) return false;
  if (process.platform !== "linux" || process.getuid?.() !== 0) return false;
  // The CLI talks to whatever DOCKER_HOST names; a local daemon answers only
  // on the local socket, so starting one for a remote endpoint waits 30 s for
  // nothing.
  const host = process.env.DOCKER_HOST;
  if (host && !host.startsWith("unix://")) {
    log.warn(`DOCKER_HOST is ${host}; not starting a local dockerd`);
    return false;
  }
  const dockerd = await execa("dockerd", ["--version"], {
    reject: false,
    stdio: "ignore"
  });
  if (dockerd.exitCode !== 0) return false;

  // A container image restored from a snapshot can carry pid files of daemons
  // that are not running; dockerd refuses to start while they name a live pid,
  // and after a container restart that pid belongs to some other process.
  clearStalePidFile("/var/run/docker.pid", ["dockerd"]);
  clearStalePidFile("/var/run/docker/containerd/containerd.pid", [
    "containerd"
  ]);

  const logDir = join(homedir(), ".carbon");
  mkdirSync(logDir, { recursive: true });
  const logFile = join(logDir, "dockerd.log");
  const fd = openSync(logFile, "a");
  try {
    // Docker Hub rate-limits anonymous pulls per IP and a container's egress IP
    // is shared: a cold boot once failed on a 429 for its first image. The
    // daemon tries a mirror before Docker Hub and falls back to Hub when the
    // mirror cannot answer. mirror.gcr.io serves Docker Hub's public images and
    // is reachable through the container proxy, blobs included.
    // CARBON_DEV_REGISTRY_MIRROR overrides it; set empty for none.
    const mirror =
      process.env.CARBON_DEV_REGISTRY_MIRROR ?? "https://mirror.gcr.io";
    const child = spawn(
      "dockerd",
      mirror ? [`--registry-mirror=${mirror}`] : [],
      { detached: true, stdio: ["ignore", fd, fd] }
    );
    child.unref();
  } finally {
    closeSync(fd);
  }
  log.info(`docker daemon not running — started dockerd (log: ${logFile})`);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await dockerResponds()) return true;
    await sleep(1000);
  }
  log.warn(`dockerd did not answer within 30 s — see ${logFile}`);
  return false;
}

// Remove a pid file unless its pid is a live process whose command is one of
// `owners` (then a daemon is starting and the file is its own).
function clearStalePidFile(file: string, owners: string[]) {
  let pid: number;
  try {
    pid = Number(readFileSync(file, "utf8").trim());
  } catch {
    return;
  }
  if (Number.isInteger(pid) && pid > 0) {
    let cmdline = "";
    try {
      cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8");
    } catch {
      // not a live process
    }
    // The process's own name only: a reused pid running `tail -f dockerd.log`
    // names the daemon in an argument and is not the daemon.
    const [argv0 = ""] = cmdline.split("\0");
    if (owners.includes(argv0.split("/").pop() ?? "")) return;
  }
  rmSync(file, { force: true });
}

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

// Every profile `bootStack` can enable. Compose treats profile-gated services
// as "not enabled" rather than orphans, so a `down` missing one silently
// leaves those containers running. `stopStack`'s sweep backstops drift here.
const COMPOSE_PROFILES = ["full", "studio", "mail"] as const;

// Which services a boot starts. Default: the stack the apps need plus Inbucket
// (login emails). `full` adds Studio, Postgres-Meta, the edge runtime and
// imgproxy — nothing in the apps calls the first three (~40% of a stack's
// memory) and imgproxy only converts HEIC. `studio` adds just Studio and the
// Postgres-Meta it reads through (picked as an app in `crbn up`). `minimal`
// drops Inbucket too (headless runs sign in by bypass).
export type StackSize = { minimal?: boolean; full?: boolean; studio?: boolean };

function profileArgs(opts?: StackSize): string[] {
  const profiles: string[] = [];
  if (opts?.full) profiles.push("full");
  else if (opts?.studio) profiles.push("studio");
  if (!opts?.minimal) profiles.push("mail");
  return profiles.flatMap((profile) => ["--profile", profile]);
}

// Exported for tests: the `docker compose … up -d` argv.
export function buildUpArgs(
  root: string,
  slug: string,
  opts?: StackSize & { services?: string[] }
): string[] {
  const args = devArgs(root, slug, "--env-file", ".env.local");
  // When specific services are requested, don't activate profiles — compose
  // starts only the named services (+ dependencies) regardless of profiles.
  if (!opts?.services) args.push(...profileArgs(opts));
  // --remove-orphans: a worktree that switched to shared mode stops its old
  // private containers. Their volumes stay.
  args.push("up", "-d", "--remove-orphans");
  if (opts?.services) args.push(...opts.services);
  return args;
}

// Exported for tests. Enables every profile unconditionally — one that was
// never booted matches nothing, while a missing one leaks containers.
export function buildDownArgs(
  root: string,
  slug: string,
  withVolumes: boolean
): string[] {
  const args = projectArgs(root, slug, true, "--env-file", ".env.local");
  for (const profile of COMPOSE_PROFILES) args.push("--profile", profile);
  args.push("down", "--remove-orphans");
  if (withVolumes) args.push("-v");
  return args;
}

export async function bootStack(
  root: string,
  slug: string,
  opts?: StackSize & { services?: string[] }
) {
  if (readStackMode(slug) === "isolated") {
    await assertPgMajor(
      `${projectName(slug)}_pgdata`,
      "Drop it with `crbn down --volumes` (this worktree's data), then `crbn up --isolated`."
    );
  }
  await execStrict("docker", buildUpArgs(root, slug, opts), root);
}

// The Postgres major of docker-compose.shared.yml and docker-compose.isolated.yml
// (compose.test.ts pins it): the one the US production project runs.
export const PG_MAJOR = 17;

/** The major a Postgres data volume was made with; null for none or empty. */
export async function volumePgMajor(volume: string): Promise<number | null> {
  // `docker run -v` would create a missing volume.
  const exists = await execa("docker", ["volume", "inspect", volume], {
    reject: false,
    stdio: "ignore"
  });
  if (exists.exitCode !== 0) return null;
  // redis:7-alpine is on every machine that boots crbn (the shared redis).
  const r = await execa(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${volume}:/data:ro`,
      "--entrypoint",
      "cat",
      "redis:7-alpine",
      "/data/PG_VERSION"
    ],
    { reject: false }
  );
  const major = Number.parseInt(r.stdout?.trim() ?? "", 10);
  return Number.isFinite(major) ? major : null;
}

// A volume another major made crash-loops the new server with an unclear
// "database files are incompatible" error. Fail first, with the way out.
async function assertPgMajor(volume: string, fix: string): Promise<void> {
  const major = await volumePgMajor(volume);
  if (major !== null && major !== PG_MAJOR) {
    throw new Error(
      `${volume} holds a Postgres ${major} database; this crbn runs Postgres ${PG_MAJOR}. ${fix}`
    );
  }
}

// Stop every container of the stack but keep them (and their volumes): the
// memory is freed and `bootStack` brings them back. All profiles, so a service
// started later with `crbn reload` is stopped too. 30s for Postgres to shut
// down cleanly before Docker kills it.
export async function sleepStack(root: string, slug: string) {
  const args = devArgs(root, slug, ...envFileArgs(root));
  for (const profile of COMPOSE_PROFILES) args.push("--profile", profile);
  args.push("stop", "--timeout", "30");
  await execStrict("docker", args, root);
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
  await execa("docker", devArgs(root, slug, "restart", ...services), {
    cwd: root,
    reject: false,
    stdio: "ignore"
  });
}

// Stops and removes these services' containers, so the next `up` creates them
// again. Throws on a failure: a container left running would keep its old state.
export async function removeServices(
  root: string,
  slug: string,
  services: string[]
) {
  if (services.length === 0) return;
  await execa("docker", devArgs(root, slug, "rm", "-s", "-f", ...services), {
    cwd: root,
    stdio: "ignore"
  });
}

// `docker compose up -d --force-recreate` a subset of services — reapplies
// compose/.env.local changes (image, env, memory, ports) to just those
// containers, leaving the rest of the stack (and the app dev servers) running.
// Unlike `restart`, this picks up edits to the compose file.
export async function recreateServices(
  root: string,
  slug: string,
  services: string[]
) {
  if (services.length === 0) return;
  await execStrict(
    "docker",
    devArgs(
      root,
      slug,
      "--env-file",
      ".env.local",
      "up",
      "-d",
      "--force-recreate",
      ...services
    ),
    root
  );
}

// Pull all images before `up -d` so `bootStack` doesn't block silently behind
// a multi-GB download. `--progress=plain` emits parseable per-line status to
// stderr (`<service> Pulling`, `<service> Pulled`); we stream the latest line
// via `onLine` so the caller can feed it into a spinner subtitle.
export async function pullStack(
  root: string,
  slug: string,
  onLine: (line: string) => void,
  opts?: StackSize
) {
  const args = devArgs(root, slug, "--env-file", ".env.local");
  args.push(...profileArgs(opts));
  args.push("--progress", "plain", "pull");
  const proc = execa("docker", args, { cwd: root, reject: false, all: true });

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
  slug: string,
  opts?: StackSize
): Promise<string[] | null> {
  const args = devArgs(root, slug, "--env-file", ".env.local");
  args.push(...profileArgs(opts));
  args.push("config", "--images");
  const r = await execa("docker", args, { cwd: root, reject: false });
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

// Returns the compose `down` exit code (0 = success). On compose-parse
// failures (missing .env.local, profile issues, renamed compose file), falls
// back to raw `docker rm -f` via destroyProject so the stack is always torn
// down even when compose can't parse the project to find its containers.
// Keyed on containers actually remaining, not the exit code alone: compose
// exits 0 after skipping services it had no profile for.
export async function stopStack(
  root: string,
  slug: string,
  withVolumes: boolean
): Promise<number> {
  const r = await execa("docker", buildDownArgs(root, slug, withVolumes), {
    cwd: root,
    reject: false
  });
  const project = projectName(slug);
  let remaining = await projectContainerIds(project);
  if (r.exitCode !== 0 || remaining.length > 0) {
    await destroyProject(project, withVolumes);
    // destroyProject swallows docker errors — re-read rather than assume.
    remaining = await projectContainerIds(project);
  }
  return teardownExitCode(r.exitCode, remaining.length);
}

// Describes the end state, not the compose invocation: `down` uses this only
// to warn that containers may still be running.
export function teardownExitCode(
  composeExit: number | undefined,
  remaining: number
): number {
  return remaining > 0 ? composeExit || 1 : 0;
}

// Container ids for a compose project, by label — works with no compose file.
async function projectContainerIds(project: string): Promise<string[]> {
  const r = await execa(
    "docker",
    [
      "ps",
      "-a",
      "-q",
      "--filter",
      `label=com.docker.compose.project=${project}`
    ],
    { reject: false }
  );
  return (r.stdout ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Shared containers (docker-compose.shared.yml, project `crbn-shared`)
// ---------------------------------------------------------------------------

// Not `carbon-*`: crbn's orphan cleanup force-removes any `carbon-*` project
// with no slot (compose.test.ts pins this).
export const SHARED_PROJECT = "crbn-shared";
export const SHARED_NETWORK = "carbon-shared";
const SHARED_ASSETS = [
  "docker-compose.shared.yml",
  "init.sql",
  "shared-init.sql"
];

// The shared files come from the crbn code that runs, not from the worktree:
// bin/crbn runs the main checkout's code in a worktree with no node_modules,
// and an older branch's worktree has none of these files.
const SHARED_SOURCE = fileURLToPath(new URL("../../docker", import.meta.url));

/** Where the shared containers' compose file and mounts live. */
export const sharedDir = () => join(homedir(), ".carbon", "shared");

// The shared compose file reads only ~/.carbon/shared/.env and its own
// defaults. crbn's environment holds the booting worktree's .env.local
// (PG_MAX_CONNECTIONS=100, MEM_*): passed through, it would size the shared
// Postgres by whichever worktree booted it, and a worktree with other values
// would make compose recreate the containers every worktree uses.
export function sharedComposeEnv(
  env: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  // SSH_AUTH_SOCK: a DOCKER_HOST=ssh://… connection authenticates with it.
  const keep =
    /^(PATH|HOME|USER|TMPDIR|LANG|LC_[A-Z]+|DOCKER_[A-Z_]+|SSH_AUTH_SOCK)$/;
  return Object.fromEntries(
    Object.entries(env).filter(
      (e): e is [string, string] => keep.test(e[0]) && e[1] !== undefined
    )
  );
}

const sharedExec = () => ({ extendEnv: false, env: sharedComposeEnv() });

const sharedComposeArgs = () => [
  "compose",
  "-f",
  join(sharedDir(), "docker-compose.shared.yml"),
  "-p",
  SHARED_PROJECT,
  "--env-file",
  join(sharedDir(), ".env")
];

// Both projects join it, and it outlives both: neither `compose down` removes it.
export async function ensureSharedNetwork(): Promise<void> {
  const r = await execa("docker", ["network", "create", SHARED_NETWORK], {
    reject: false
  });
  if (r.exitCode !== 0 && !/already exists/i.test(r.stderr ?? "")) {
    throw new Error(`docker network create ${SHARED_NETWORK}: ${r.stderr}`);
  }
}

async function sharedProjectRunning(): Promise<boolean> {
  const r = await execa(
    "docker",
    [
      "ps",
      "-q",
      "--filter",
      `label=com.docker.compose.project=${SHARED_PROJECT}`
    ],
    { reject: false }
  );
  return r.exitCode === 0 && r.stdout.trim() !== "";
}

// The files run from ~/.carbon/shared, not from a worktree, so the containers
// outlive any one worktree. If they run already and this branch's files
// differ, keep the running ones: a recreate would restart the shared Postgres
// under every worktree. Returns a warning for the caller to show, or null.
export async function bootSharedServices(
  jwt: JwtCreds
): Promise<string | null> {
  const dir = sharedDir();
  const running = await sharedProjectRunning();
  const changed = SHARED_ASSETS.filter((f) => {
    const target = join(dir, f);
    const source = readFileSync(join(SHARED_SOURCE, f), "utf8");
    return !existsSync(target) || readFileSync(target, "utf8") !== source;
  });
  let warning: string | null = null;
  if (running && changed.length > 0) {
    warning = `this branch's shared container files differ (${changed.join(", ")}); the running ones stay. To apply them, stop the shared containers with \`docker compose -p ${SHARED_PROJECT} down\` (their volumes stay), then run \`crbn up\` again. \`crbn up --isolated\` tries them in this worktree only.`;
  } else {
    for (const f of changed) {
      const target = join(dir, f);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(SHARED_SOURCE, f), target);
    }
  }
  writeFileSync(
    join(dir, ".env"),
    `SUPABASE_JWT_SECRET=${jwt.secret}\nSUPABASE_SERVICE_ROLE_KEY=${jwt.serviceKey}\n`,
    { mode: 0o600 }
  );
  await ensureSharedNetwork();
  await assertPgMajor(
    "carbon-postgres-data",
    `Drop it, and with it every worktree database, with \`docker compose -p ${SHARED_PROJECT} down -v\`, then \`crbn up\` again.`
  );
  await execStrict(
    "docker",
    [...sharedComposeArgs(), "up", "-d", "--wait", "--remove-orphans"],
    dir,
    sharedExec()
  );
  await ensureTemplate();
  return warning;
}

/** `crbn prune --all`: stops and removes the shared containers, keeps volumes. */
export async function stopSharedServices(): Promise<void> {
  if (!existsSync(join(sharedDir(), "docker-compose.shared.yml"))) return;
  await execa("docker", [...sharedComposeArgs(), "down", "--remove-orphans"], {
    cwd: sharedDir(),
    reject: false,
    ...sharedExec()
  });
}

/** The databases redis needs: the pool, or more for an index handed out
 *  when the pool was larger. */
export function redisDatabasesNeeded(slots: { redisDb?: number }[]): number {
  return Math.max(REDIS_DB_MAX, ...slots.map((s) => (s.redisDb ?? -1) + 1));
}

/** The `--databases` a redis container was started with: redis's default
 *  (16) when its command does not set it. */
export function redisDatabasesOf(cmd: string[]): number {
  const at = cmd.indexOf("--databases");
  return at >= 0 ? Number(cmd[at + 1]) || 16 : 16;
}

// One redis per host, run directly via `docker run` (no compose file).
// Idempotent: reuse a running container, start a stopped one, otherwise create.
// A container started with fewer DBs than the slot pool (made before the pool
// grew) is recreated on the same volume, so its data is kept.
export async function bootSharedRedis() {
  const state = await execa(
    "docker",
    [
      "container",
      "inspect",
      "-f",
      "{{.State.Running}} {{json .Config.Cmd}}",
      REDIS_CONTAINER
    ],
    { reject: false }
  );
  const [running = "", cmd = "[]"] = state.stdout.trim().split(/ (.*)/);
  // A slot keeps its index, and a pool that was larger (#2140 had 256) may
  // have handed out one past REDIS_DB_MAX: redis must hold it, or the app's
  // SELECT fails and ioredis falls back to DB 0, another worktree's.
  const databases = redisDatabasesNeeded(Object.values(listSlugs()));
  const tooFewDbs =
    state.exitCode === 0 &&
    redisDatabasesOf((JSON.parse(cmd) as string[] | null) ?? []) < databases;
  if (tooFewDbs) {
    log.info(`recreating shared redis with ${databases} DBs (data kept)`);
    // Stop first: a SIGTERM lets redis flush its AOF buffer, `rm -f` alone
    // would kill it with acknowledged writes still unwritten. `docker stop`
    // succeeds on a stopped container, so a failure means it may still run.
    const stopped = await execa("docker", ["stop", REDIS_CONTAINER], {
      reject: false
    });
    if (stopped.exitCode !== 0) {
      throw new Error(
        `Could not stop ${REDIS_CONTAINER} to resize it: ${stopped.stderr.trim()}`
      );
    }
    await execa("docker", ["rm", "-f", REDIS_CONTAINER], {
      reject: false,
      stdio: "ignore"
    });
  } else if (state.exitCode === 0) {
    if (running === "true") return;
    // Exists but stopped — try to start it; if that fails, recreate below.
    const started = await execa("docker", ["start", REDIS_CONTAINER], {
      reject: false,
      stdio: "ignore"
    });
    if (started.exitCode === 0) return;
    await execa("docker", ["rm", "-f", REDIS_CONTAINER], {
      reject: false,
      stdio: "ignore"
    });
  }

  const args = [
    "run",
    "-d",
    "--name",
    REDIS_CONTAINER,
    "--restart",
    "unless-stopped",
    "-p",
    `${SHARED_REDIS_PORT}:6379`,
    "-v",
    `${REDIS_VOLUME}:/data`,
    "--health-cmd",
    "redis-cli ping",
    "--health-interval",
    "5s",
    "--health-timeout",
    "3s",
    "--health-retries",
    "5",
    "redis:7-alpine",
    "redis-server",
    "--appendonly",
    "yes",
    "--databases",
    String(databases)
  ];
  // Recover from a stale container holding the name.
  let r = await execa("docker", args, { reject: false });
  if (r.exitCode !== 0 && /already in use/i.test(r.stderr ?? "")) {
    await execa("docker", ["rm", "-f", REDIS_CONTAINER], {
      reject: false,
      stdio: "ignore"
    });
    r = await execa("docker", args, { reject: false });
  }
  if (r.exitCode !== 0) {
    process.stderr.write(r.stderr ?? "");
    throw new Error(`shared redis up failed (exit ${r.exitCode})`);
  }
}

export async function destroyProjectVolumes(cwd: string, project: string) {
  await execa(
    "docker",
    [
      "compose",
      // Both files whatever the mode: `down -v` only removes the volumes
      // the given files declare.
      ...composeFileArgs(cwd, project, true),
      "--project-directory",
      ".",
      "--env-file",
      ".env.local",
      "-p",
      project,
      "down",
      "-v",
      "--remove-orphans"
    ],
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
  return parseContainers(
    await composeRead(
      root,
      devArgs(root, slug, ...envFileArgs(root), "ps", "-a", "--format", "json")
    )
  );
}

/** The crbn-shared containers. Empty when no `crbn up` started them here. */
export async function listSharedContainers(): Promise<Container[]> {
  if (!existsSync(join(sharedDir(), "docker-compose.shared.yml"))) return [];
  return parseContainers(
    await composeRead(sharedDir(), [
      ...sharedComposeArgs(),
      "ps",
      "-a",
      "--format",
      "json"
    ])
  );
}

function parseContainers(stdout: string): Container[] {
  if (!stdout.trim()) return [];
  const out: Container[] = [];
  for (const line of stdout.split("\n")) {
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
  slug: string,
  opts?: StackSize
): Promise<string[]> {
  const args = devArgs(root, slug, "--env-file", ".env.local");
  args.push(...profileArgs(opts));
  args.push("config", "--services");
  return (await composeRead(root, args))
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
    devArgs(
      root,
      slug,
      ...envFileArgs(root),
      "logs",
      "--tail",
      String(lines),
      "--no-color",
      service
    ),
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

// Destroy a compose project by force-removing its containers, volumes, and
// networks using raw docker commands. Works even when the compose file or
// worktree directory no longer exists (orphaned projects). When withVolumes is
// false (plain `crbn down`), preserves the project's data volumes.
export async function destroyProject(project: string, withVolumes = true) {
  // Find containers belonging to the project.
  const ids = await projectContainerIds(project);
  if (ids.length > 0) {
    await execa("docker", ["rm", "-f", ...ids], {
      reject: false,
      stdio: "ignore"
    });
  }

  // Remove networks prefixed with the project name (always — cheap, and stale
  // networks block the next `up` from reusing the project name cleanly).
  const net = await execa(
    "docker",
    ["network", "ls", "-q", "--filter", `name=${project}_`],
    {
      reject: false
    }
  );
  const nets = (net.stdout ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (nets.length > 0) {
    await execa("docker", ["network", "rm", ...nets], {
      reject: false,
      stdio: "ignore"
    });
  }

  if (!withVolumes) return;

  // Remove volumes prefixed with the project name.
  const vol = await execa(
    "docker",
    ["volume", "ls", "-q", "--filter", `name=${project}_`],
    {
      reject: false
    }
  );
  const vols = (vol.stdout ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (vols.length > 0) {
    await execa("docker", ["volume", "rm", "-f", ...vols], {
      reject: false,
      stdio: "ignore"
    });
  }
}

// List all docker compose project names that start with "carbon-".
export async function listCarbonProjects(): Promise<string[]> {
  const r = await execa(
    "docker",
    [
      "ps",
      "-a",
      "--format",
      '{{.Label "com.docker.compose.project"}}',
      "--filter",
      "label=com.docker.compose.project"
    ],
    { reject: false }
  );
  const all = new Set<string>();
  for (const line of (r.stdout ?? "").split("\n")) {
    const name = line.trim();
    if (name && name.startsWith("carbon-")) all.add(name);
  }
  return [...all];
}

// Every crbn stack on the machine, including ones whose containers are gone:
// `down` keeps volumes, so a deleted worktree's data outlives its containers.
// Matching on the `pgdata` volume keeps other "carbon-" compose projects out.
export async function listCarbonStacks(): Promise<string[]> {
  const r = await execa(
    "docker",
    [
      "volume",
      "ls",
      "--filter",
      "label=com.docker.compose.volume=pgdata",
      "--format",
      '{{.Label "com.docker.compose.project"}}'
    ],
    { reject: false }
  );
  const fromVolumes = (r.stdout ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter((name) => name.startsWith("carbon-"));
  return [...new Set([...fromVolumes, ...(await listCarbonProjects())])];
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

// Wipe one logical DB on shared redis via the container's bundled redis-cli —
// avoids requiring a host `redis-cli` install.
export async function flushDb(db: number) {
  const r = await execa(
    "docker",
    ["exec", REDIS_CONTAINER, "redis-cli", "-n", String(db), "FLUSHDB"],
    { reject: false, stdio: "ignore" }
  );
  if (r.exitCode !== 0) {
    log.warn(`redis flush of db ${db} failed (skipped)`);
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

// A compose command whose answer the caller reports as fact. A failure here is
// thrown with compose's own words: returning "nothing" instead made `crbn
// status` show an empty stack while eight containers ran, hiding the config
// error that caused it.
async function composeRead(root: string, args: string[]): Promise<string> {
  const r = await execa("docker", args, { cwd: root, reject: false });
  if (r.exitCode === 0) return r.stdout ?? "";
  const detail = (r.stderr ?? "")
    .split("\n")
    .filter((line) => line.trim() && !line.includes("level=warning"))
    .slice(-5)
    .join("\n");
  throw new Error(
    `docker ${args.slice(-3).join(" ")} failed (exit ${r.exitCode})\n${detail}`
  );
}

// Compose must interpolate the whole file before it will even list containers,
// and the file has values with no default (extra_hosts names). Read-only
// commands that run outside `crbn up` — where nothing has loaded .env.local
// into the process — need it passed explicitly, or they fail and report an
// empty stack.
function envFileArgs(root: string): string[] {
  return existsSync(join(root, ".env.local"))
    ? ["--env-file", ".env.local"]
    : [];
}

function devArgs(root: string, slug: string, ...rest: string[]): string[] {
  return projectArgs(root, slug, false, ...rest);
}

function projectArgs(
  root: string,
  slug: string,
  allFiles: boolean,
  ...rest: string[]
): string[] {
  // --project-directory . pins the project dir to the cwd (repo root) so the
  // compose file's ./packages/... mounts resolve from root even though the file
  // now lives under packages/dev/docker/.
  return [
    "compose",
    ...composeFileArgs(root, slug, allFiles),
    "--project-directory",
    ".",
    "-p",
    projectName(slug),
    ...rest
  ];
}

async function execStrict(
  cmd: string,
  args: string[],
  cwd: string,
  opts: { extendEnv?: boolean; env?: Record<string, string> } = {}
) {
  const r = await execa(cmd, args, {
    cwd,
    reject: false,
    preferLocal: true,
    ...opts
  });
  if (r.exitCode !== 0) {
    process.stderr.write(r.stderr?.toString() ?? "");
    process.stdout.write(r.stdout?.toString() ?? "");
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.exitCode})`);
  }
}
