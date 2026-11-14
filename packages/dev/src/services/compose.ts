// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { log } from "@clack/prompts";
import { execa } from "execa";
import { basename, join } from "pathe";
import { isCloudDev } from "../../stack-state.js";
import { readLines, waitUntil } from "../helpers.js";
import { paths } from "../paths.js";
import { withExponentialBackoff } from "../retry.js";
import type { Stack } from "../stack.js";
import {
  COMPOSE_DEV_FILE,
  COMPOSE_ISOLATED_FILE,
  PG_MAJOR,
  PROJECT_PREFIX,
  projectName,
  REDIS_DB_MAX,
  SHARED_CONTAINERS,
  SHARED_NETWORK,
  SHARED_POSTGRES_VOLUME,
  SHARED_PROJECT,
  SHARED_REDIS_IMAGE,
  SHARED_REDIS_VOLUME
} from "../topology.js";
import { type JwtCreds, listSlugs, sameWorktreePath } from "../worktree.js";

/** What a compose command needs to know about a worktree's stack. */
export type StackRef = Pick<Stack, "root" | "slug" | "mode">;

// The `-f` flags for a worktree's project. Shared mode runs the dev file
// alone; isolated mode adds the private services. `all` adds them whatever
// the mode, for teardowns: a worktree that switched modes still has them.
function composeFileArgs(stack: StackRef, all = false): string[] {
  const args = ["-f", join(stack.root, COMPOSE_DEV_FILE)];
  const isolated = join(stack.root, COMPOSE_ISOLATED_FILE);
  const wanted = all || stack.mode === "isolated";
  if (wanted && existsSync(isolated)) args.push("-f", isolated);
  else if (wanted && !all) {
    // Without it an isolated stack starts with no Postgres or Storage.
    throw new Error(`${isolated} is missing: this worktree runs isolated.`);
  }
  return args;
}

/** Refuses a slug whose project another worktree's containers already run. */
export async function ensureSlugAvailable(slug: string, worktreeRoot: string) {
  const project = projectName(slug);
  let runningPath: string | null = null;
  try {
    const r = await execa(
      "docker",
      [
        "ps",
        "--filter",
        `label=com.docker.compose.project=${project}`,
        "--format",
        '{{.Label "com.docker.compose.project.working_dir"}}'
      ],
      { reject: false }
    );
    const out = r.stdout.trim();
    if (out) runningPath = out.split("\n")[0] ?? null;
  } catch {
    return;
  }
  if (runningPath && !sameWorktreePath(runningPath, worktreeRoot)) {
    throw new Error(
      `Slug "${slug}" is already in use by another worktree at:\n  ${runningPath}\n\nSet CARBON_WORKTREE to a unique slug for this worktree, or stop the other stack.`
    );
  }
}

// Fail fast with an actionable message when the Docker daemon is unreachable,
// instead of a cryptic `Cannot connect to the Docker daemon` deep in the boot.
export async function ensureDockerRunning() {
  if (await dockerResponds()) return;
  if (await startDockerDaemon()) return;
  throw new Error(
    isCloudDev()
      ? `Docker isn't running and dockerd did not start — see ${DOCKERD_LOG}.`
      : "Docker isn't running. Start Docker Desktop (or your docker daemon) and re-run `crbn up`."
  );
}

const DOCKERD_LOG = join(homedir(), ".carbon", "dockerd.log");

async function dockerResponds(): Promise<boolean> {
  const r = await execa("docker", ["info"], { reject: false, stdio: "ignore" });
  return r.exitCode === 0;
}

// A cloud container has no Docker Desktop and nobody to start one, so crbn
// starts dockerd itself.
async function startDockerDaemon(): Promise<boolean> {
  if (!isCloudDev()) return false;
  if (process.platform !== "linux" || process.getuid?.() !== 0) return false;
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
  // that are not running. dockerd refuses to start while they name a live pid,
  // and after a container restart that pid belongs to some other process.
  clearStalePidFile("/var/run/docker.pid", ["dockerd"]);
  clearStalePidFile("/var/run/docker/containerd/containerd.pid", [
    "containerd"
  ]);

  mkdirSync(join(homedir(), ".carbon"), { recursive: true });
  const fd = openSync(DOCKERD_LOG, "a");
  let exited = false;
  try {
    // Docker Hub allows 100 anonymous pulls an hour per IP, and a cloud
    // container shares its IP with other sessions. Google's mirror of Docker
    // Hub serves the same digests; dockerd falls back to Docker Hub on a miss.
    // dockerd refuses the flag when daemon.json already sets mirrors.
    const daemonJson = "/etc/docker/daemon.json";
    const mirrorSet =
      existsSync(daemonJson) &&
      readFileSync(daemonJson, "utf8").includes("registry-mirrors");
    const args = mirrorSet ? [] : ["--registry-mirror=https://mirror.gcr.io"];
    const child = spawn("dockerd", args, {
      detached: true,
      stdio: ["ignore", fd, fd]
    });
    child.on("error", (err) => {
      exited = true;
      log.warn(`dockerd did not start: ${err.message}`);
    });
    child.on("exit", () => {
      exited = true;
    });
    child.unref();
  } finally {
    closeSync(fd);
  }
  log.info(`docker daemon not running — started dockerd (log: ${DOCKERD_LOG})`);
  const up = await waitUntil(dockerResponds, {
    timeoutMs: 30_000,
    intervalMs: 1000,
    stopped: () => exited
  });
  if (!up) log.warn(`dockerd is not answering — see ${DOCKERD_LOG}`);
  return up;
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
    // The process's own name. A reused pid running `tail -f dockerd.log`
    // names the daemon in an argument and is not the daemon.
    const [argv0 = ""] = cmdline.split("\0");
    if (owners.includes(argv0.split("/").pop() ?? "")) return;
  }
  rmSync(file, { force: true });
}

type Publisher = { PublishedPort: number; TargetPort: number };

// `docker compose ps --format json`, with Health always string|null and
// Publishers always an array.
export type Container = {
  Service: string;
  Name: string;
  State: string;
  Status: string;
  Health: string | null;
  Publishers: Publisher[];
};

// Every profile `bootStack` can enable. Compose treats profile-gated services
// as "not enabled" rather than orphans, so a `down` missing one silently
// leaves those containers running. `stopStack`'s sweep backstops drift here.
const COMPOSE_PROFILES = ["full", "studio", "mail"] as const;

// Which services a boot starts. Default: the stack the apps need plus Inbucket
// (login emails). `full` adds Studio, Postgres-Meta, a private edge runtime
// (the gateway prefers it to crbn-shared's, for editing functions) and
// imgproxy — the first three were ~40% of a stack's memory, and imgproxy only
// converts HEIC. `studio` adds just Studio and the
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
  stack: StackRef,
  opts?: StackSize & { services?: string[] }
): string[] {
  const args = devArgs(stack, "--env-file", ".env.local");
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
export function buildDownArgs(stack: StackRef): string[] {
  const args = projectArgs(stack, true, "--env-file", ".env.local");
  for (const profile of COMPOSE_PROFILES) args.push("--profile", profile);
  args.push("down", "--remove-orphans");
  return args;
}

export async function bootStack(
  stack: StackRef,
  opts?: StackSize & { services?: string[] }
) {
  if (stack.mode === "isolated") {
    await assertPgMajor(
      `${projectName(stack.slug)}_pgdata`,
      "Drop it with `crbn down --volumes` (this worktree's data), then `crbn up --isolated`."
    );
  }
  await execStrict("docker", buildUpArgs(stack, opts), stack.root);
}

/** The major a Postgres data volume was made with; null for none or empty. */
async function volumePgMajor(volume: string): Promise<number | null> {
  // `docker run -v` would create a missing volume.
  const exists = await execa("docker", ["volume", "inspect", volume], {
    reject: false,
    stdio: "ignore"
  });
  if (exists.exitCode !== 0) return null;
  // The shared redis's image is on every machine that boots crbn.
  const r = await execa(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${volume}:/data:ro`,
      "--entrypoint",
      "cat",
      SHARED_REDIS_IMAGE,
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
export async function sleepStack(stack: StackRef) {
  const { root } = stack;
  const args = devArgs(stack, ...envFileArgs(root));
  for (const profile of COMPOSE_PROFILES) args.push("--profile", profile);
  args.push("stop", "--timeout", "30");
  await execStrict("docker", args, root);
}

// The storage-stuck heal in `crbn up` restarts storage, gotrue and postgrest
// after re-applying init.sql, so they reconnect with the rotated role passwords.
export async function restartServices(stack: StackRef, services: string[]) {
  const { root } = stack;
  if (services.length === 0) return;
  await execa("docker", devArgs(stack, "restart", ...services), {
    cwd: root,
    reject: false,
    stdio: "ignore"
  });
}

// Stops and removes these services' containers, so the next `up` creates them
// again. Throws on a failure: a container left running would keep its old state.
export async function removeServices(stack: StackRef, services: string[]) {
  const { root } = stack;
  if (services.length === 0) return;
  await execa("docker", devArgs(stack, "rm", "-s", "-f", ...services), {
    cwd: root,
    stdio: "ignore"
  });
}

// Reapplies compose/.env.local changes (image, env, memory, ports) to just
// these containers; the rest of the stack and the dev servers keep running.
// Unlike `restart`, this picks up edits to the compose file.
export async function recreateServices(stack: StackRef, services: string[]) {
  const { root } = stack;
  if (services.length === 0) return;
  await execStrict(
    "docker",
    devArgs(
      stack,
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
  stack: StackRef,
  onLine: (line: string) => void,
  opts?: StackSize
) {
  const { root } = stack;
  const args = devArgs(stack, "--env-file", ".env.local");
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
    const output = r.all?.toString() ?? "";
    process.stderr.write(output);
    throw Object.assign(
      new Error(`docker compose pull failed (exit ${r.exitCode})`),
      { output }
    );
  }
}

// What a registry answers when it throttles anonymous pulls or the network
// drops: worth waiting for. A missing tag or a refused login is not.
const TRANSIENT_PULL =
  /toomanyrequests|too many requests|\b429\b|\b50[234]\b|timeout|timed out|connection reset|unexpected EOF|TLS handshake/i;

export function isTransientPullError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { output, stderr } = error as { output?: string; stderr?: string };
  return TRANSIENT_PULL.test(
    `${error.message}\n${output ?? ""}${stderr ?? ""}`
  );
}

/** Resolved image refs for the dev compose file (tags as pinned in compose). */
export async function devComposeImageRefs(
  stack: StackRef,
  opts?: StackSize
): Promise<string[] | null> {
  const { root } = stack;
  const args = devArgs(stack, "--env-file", ".env.local");
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

export async function allImagesPresentLocally(
  refs: string[]
): Promise<boolean> {
  return (await missingImages(refs)).length === 0;
}

async function missingImages(refs: string[]): Promise<string[]> {
  const present = await Promise.all(
    refs.map((ref) =>
      execa("docker", ["image", "inspect", ref], {
        stdio: "ignore",
        reject: false
      }).then((x) => x.exitCode === 0)
    )
  );
  return refs.filter((_, i) => !present[i]);
}

// The images a compose file names, with the arguments and environment its
// `up` gets.
async function composeImages(
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; extendEnv?: boolean }
): Promise<string[]> {
  const r = await execa("docker", [...args, "config", "--images"], {
    reject: false,
    ...opts
  });
  if (r.exitCode !== 0) {
    throw new Error(`cannot list the images: ${r.stderr.trim()}`);
  }
  return r.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

// `docker compose up` pulls a missing image once and fails on a throttled
// registry; this retries each one.
async function pullMissingImages(refs: string[]): Promise<void> {
  const missing = await missingImages([...new Set(refs)]);
  if (missing.length === 0) return;
  log.info(`pulling ${missing.length} images`);
  const failed = (
    await Promise.allSettled(
      missing.map((ref) =>
        withExponentialBackoff(() => execa("docker", ["pull", "-q", ref]), {
          retryIf: isTransientPullError
        })
      )
    )
  ).filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    throw new Error(
      `${failed.length} of ${missing.length} images did not pull`
    );
  }
}

/**
 * Pulls the images a default `crbn up` boots (the dev file with its default
 * profiles, and crbn-shared) that are not present yet. For an environment's
 * setup step (`cloud-dev.sh --prepare`), before this checkout has a stack.
 */
export async function pullDefaultImages(root: string): Promise<void> {
  await pullMissingImages([
    ...(await composeImages(
      ["compose", "-f", join(root, COMPOSE_DEV_FILE), ...profileArgs()],
      // Only `extra_hosts` reads these two, and compose wants them non-empty.
      { cwd: root, env: { DOMAIN: "localhost", INNGEST_TLS_HOST: "localhost" } }
    )),
    ...(await composeImages(
      ["compose", "-f", join(SHARED_SOURCE, "docker-compose.shared.yml")],
      { cwd: root, ...sharedExec() }
    ))
  ]);
}

async function pullSharedImages(services: string[] = []): Promise<void> {
  await pullMissingImages(
    await composeImages([...sharedComposeArgs(), ...services], {
      cwd: sharedDir(),
      ...sharedExec()
    })
  );
}

// Compose first, then by label: compose can't stop a project whose files it
// fails to read (no .env.local, a renamed file), and exits 0 having skipped
// a service whose profile it was not given.
export async function stopStack(stack: StackRef): Promise<void> {
  const r = await execa("docker", buildDownArgs(stack), {
    cwd: stack.root,
    reject: false
  });
  const project = projectName(stack.slug);
  if (r.exitCode !== 0 || (await projectContainerIds(project)).length > 0) {
    await destroyProject(project, false);
  }
}

// By label, so it works with no compose file.
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

const SHARED_ASSETS = [
  "docker-compose.shared.yml",
  "init.sql",
  "shared-init.sql"
];

// The shared files come from the crbn code that runs, not from the worktree:
// bin/crbn runs the main checkout's code in a worktree with no node_modules,
// and an older branch's worktree has none of these files.
const SHARED_SOURCE = fileURLToPath(new URL("../../docker", import.meta.url));

const sharedDir = paths.shared;

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

// The services this crbn starts from the shared file, beyond Postgres and the
// rest it always had. A running project whose file lacks one gets the new file.
const LATER_SHARED_SERVICES = ["redis", "edge-runtime"];

/** The services in LATER_SHARED_SERVICES a shared compose file lacks. */
export function missingSharedServices(composeText: string): string[] {
  return LATER_SHARED_SERVICES.filter(
    (name) => !new RegExp(`^ {2}${name}:\\s*$`, "m").test(composeText)
  );
}

// The shared edge runtime mounts these. Each copy goes into a directory named
// after its content (`functions-<digest>`), and .env names the one to mount:
// a running runtime keeps its files until compose has recreated it on the new
// ones (the mount path changed), and `pruneSharedDirs` removes old copies only
// after that `up` succeeded.
const SHARED_DIRS = [
  {
    name: "edge-main",
    env: "EDGE_MAIN_DIR",
    source: join(SHARED_SOURCE, "edge-main")
  },
  {
    name: "functions",
    env: "FUNCTIONS_DIR",
    source: join(SHARED_SOURCE, "../../database/supabase/functions")
  }
];

// What the runtime serves: no dotfiles and no symlinks. crbn's env sync links
// .env and .env.local into supabase/functions (for `supabase functions
// serve`); counted, every .env.local rewrite would recreate the shared runtime,
// and copied, they would point it at one worktree's secrets.
function servedEntry(path: string): boolean {
  return !basename(path).startsWith(".") && !lstatSync(path).isSymbolicLink();
}

/** A hash of every served file under `dir`, by relative path and content. */
export function treeDigest(dir: string): string {
  const hash = createHash("sha1");
  if (!existsSync(dir)) return hash.digest("hex");
  const files: string[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(join(dir, rel))) {
      const child = rel ? `${rel}/${name}` : name;
      const path = join(dir, child);
      if (!servedEntry(path)) continue;
      if (statSync(path).isDirectory()) walk(child);
      else files.push(child);
    }
  };
  walk("");
  files.sort();
  for (const rel of files) {
    hash.update(`${rel}\0`);
    hash.update(readFileSync(join(dir, rel)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** The directory name a copy of `name` with this content gets. */
export function sharedDirName(name: string, digest: string): string {
  return `${name}-${digest.slice(0, 12)}`;
}

/** Copies SHARED_DIRS into ~/.carbon/shared, each under its content's name.
 *  Returns the env value per directory (`FUNCTIONS_DIR=functions-<digest>`). */
function syncSharedDirs(): Record<string, string> {
  const dirs: Record<string, string> = {};
  for (const { name, env, source } of SHARED_DIRS) {
    const dirName = sharedDirName(name, treeDigest(source));
    const target = join(sharedDir(), dirName);
    // The name is the content, so an existing one is this copy. A temporary
    // directory renamed into place keeps a half-copied one from passing as it.
    if (!existsSync(target)) {
      const tmp = `${target}.tmp-${process.pid}`;
      rmSync(tmp, { recursive: true, force: true });
      cpSync(source, tmp, {
        recursive: true,
        filter: (path) => path === source || servedEntry(path)
      });
      renameSync(tmp, target);
    }
    dirs[env] = dirName;
  }
  return dirs;
}

/** Copies of SHARED_DIRS that `keep` and live temporary copies don't cover. */
export function staleSharedDirs(
  entries: string[],
  keep: Set<string>,
  isLive: (pid: number) => boolean
): string[] {
  const names = SHARED_DIRS.map((d) => d.name).join("|");
  const pattern = new RegExp(
    `^(?:${names})(?:-[0-9a-f]{12})?(?:\\.tmp-(\\d+))?$`
  );
  return entries.filter((entry) => {
    const match = pattern.exec(entry);
    if (!match || keep.has(entry)) return false;
    // Another crbn may be copying right now.
    return !(match[1] && isLive(Number(match[1])));
  });
}

function pidIsLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: string }).code === "EPERM";
  }
}

// After a successful `up`: removes the copies no runtime mounts. Kept: this
// boot's and whatever carbon-edge-runtime mounts now (another worktree's boot
// may have recreated it on its own copy since).
async function pruneSharedDirs(current: Record<string, string>) {
  const keep = new Set(Object.values(current));
  const mounts = await execa(
    "docker",
    [
      "container",
      "inspect",
      "-f",
      "{{range .Mounts}}{{println .Source}}{{end}}",
      SHARED_CONTAINERS.edgeRuntime
    ],
    { reject: false }
  );
  for (const source of (mounts.stdout ?? "").split("\n")) {
    if (source.trim()) keep.add(basename(source.trim()));
  }
  const stale = staleSharedDirs(readdirSync(sharedDir()), keep, pidIsLive);
  for (const entry of stale) {
    rmSync(join(sharedDir(), entry), { recursive: true, force: true });
  }
}

/** ~/.carbon/shared/.env: what the shared compose file interpolates. */
export function renderSharedEnv(
  jwt: JwtCreds,
  redisDatabases: number,
  dirs: Record<string, string>
): string {
  return [
    `SUPABASE_JWT_SECRET=${jwt.secret}`,
    `SUPABASE_ANON_KEY=${jwt.anonKey}`,
    `SUPABASE_SERVICE_ROLE_KEY=${jwt.serviceKey}`,
    `REDIS_DATABASES=${redisDatabases}`,
    ...Object.entries(dirs).map(([env, dirName]) => `${env}=${dirName}`),
    ""
  ].join("\n");
}

/** Whether to copy this branch's shared files over the ones on disk, and
 *  the warning to show when not. `missing` is null when there is no file. */
export function planSharedFiles(state: {
  running: boolean;
  changed: string[];
  missing: string[] | null;
}): { copy: boolean; warning: string | null } {
  const complete = state.missing !== null && state.missing.length === 0;
  if (state.running && state.changed.length > 0 && complete) {
    return {
      copy: false,
      warning: `this branch's shared container files differ (${state.changed.join(", ")}); the running ones stay. To apply them, stop the shared containers with \`docker compose -p ${SHARED_PROJECT} down\` (their volumes stay), then run \`crbn up\` again. \`crbn up --isolated\` tries them in this worktree only.`
    };
  }
  return { copy: true, warning: null };
}

// The files run from ~/.carbon/shared, not from a worktree, so the containers
// outlive any one worktree. If they run already and this branch's files
// differ, keep the running ones: a recreate would restart the shared Postgres
// under every worktree. The exception is a file missing a service added since
// (redis, the edge runtime): it is replaced, or that service would never
// start. Compose recreates only the services whose definition changed. The
// edge runtime's directories are always synced.
async function prepareShared(
  jwt: JwtCreds
): Promise<{ warning: string | null; dirs: Record<string, string> }> {
  const dir = sharedDir();
  mkdirSync(dir, { recursive: true });
  const running = await sharedProjectRunning();
  const changed = SHARED_ASSETS.filter((f) => {
    const target = join(dir, f);
    const source = readFileSync(join(SHARED_SOURCE, f), "utf8");
    return !existsSync(target) || readFileSync(target, "utf8") !== source;
  });
  const composeTarget = join(dir, "docker-compose.shared.yml");
  const { copy, warning } = planSharedFiles({
    running,
    changed,
    missing: existsSync(composeTarget)
      ? missingSharedServices(readFileSync(composeTarget, "utf8"))
      : null
  });
  if (copy) {
    for (const f of changed) copyFileSync(join(SHARED_SOURCE, f), join(dir, f));
  }
  // A slot keeps its index, and an older, larger pool (256) may have handed
  // out one past REDIS_DB_MAX: redis must hold it, or the app's
  // SELECT fails and ioredis falls back to DB 0, another worktree's.
  const databases = redisDatabasesNeeded(Object.values(listSlugs()));
  const dirs = syncSharedDirs();
  writeFileSync(join(dir, ".env"), renderSharedEnv(jwt, databases, dirs), {
    mode: 0o600
  });
  await ensureSharedNetwork();
  await ensureRedisVolume();
  await removeStandaloneRedis();
  return { warning, dirs };
}

// The volume is external in the compose file (it predates it): create it here.
// `docker volume create` keeps an existing volume and its data.
async function ensureRedisVolume(): Promise<void> {
  const r = await execa("docker", ["volume", "create", SHARED_REDIS_VOLUME], {
    reject: false
  });
  if (r.exitCode !== 0) {
    throw new Error(`docker volume create ${SHARED_REDIS_VOLUME}: ${r.stderr}`);
  }
}

// Older crbn ran redis with `docker run` under the same name, which compose
// can't create over. Stop it first (a SIGTERM lets redis flush its AOF buffer;
// `rm -f` alone would drop acknowledged writes), then remove it. The volume
// stays, so compose's redis starts with the same keys.
async function removeStandaloneRedis(): Promise<void> {
  const r = await execa(
    "docker",
    [
      "container",
      "inspect",
      "-f",
      '{{index .Config.Labels "com.docker.compose.project"}}',
      SHARED_CONTAINERS.redis
    ],
    { reject: false }
  );
  if (r.exitCode !== 0 || r.stdout.trim() === SHARED_PROJECT) return;
  log.info(
    `moving ${SHARED_CONTAINERS.redis} into ${SHARED_PROJECT} (data kept)`
  );
  const stopped = await execa("docker", ["stop", SHARED_CONTAINERS.redis], {
    reject: false
  });
  if (stopped.exitCode !== 0) {
    throw new Error(
      `Could not stop ${SHARED_CONTAINERS.redis}: ${stopped.stderr.trim()}`
    );
  }
  await execa("docker", ["rm", "-f", SHARED_CONTAINERS.redis], {
    reject: false,
    stdio: "ignore"
  });
}

/** Shared mode: start every crbn-shared container, redis included. */
export async function bootSharedServices(
  jwt: JwtCreds
): Promise<string | null> {
  const dir = sharedDir();
  const { warning, dirs } = await prepareShared(jwt);
  await assertPgMajor(
    SHARED_POSTGRES_VOLUME,
    `Drop it, and with it every worktree database, with \`docker compose -p ${SHARED_PROJECT} down -v\`, then \`crbn up\` again.`
  );
  await pullSharedImages();
  await execStrict(
    "docker",
    [...sharedComposeArgs(), "up", "-d", "--wait", "--remove-orphans"],
    dir,
    sharedExec()
  );
  await pruneSharedDirs(dirs);
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

/** The crbn-shared services an isolated stack uses too. */
const ISOLATED_SHARED_SERVICES = ["redis", "edge-runtime"];

/** Isolated mode: start only crbn-shared's redis and edge runtime.
 *  `--no-deps` and named services leave the shared Postgres and the rest as
 *  they are (or absent). */
export async function bootSharedForIsolated(
  jwt: JwtCreds
): Promise<string | null> {
  const { warning, dirs } = await prepareShared(jwt);
  await pullSharedImages(ISOLATED_SHARED_SERVICES);
  await execStrict(
    "docker",
    [
      ...sharedComposeArgs(),
      "up",
      "-d",
      "--wait",
      "--no-deps",
      ...ISOLATED_SHARED_SERVICES
    ],
    sharedDir(),
    sharedExec()
  );
  await pruneSharedDirs(dirs);
  return warning;
}

export async function listContainers(stack: StackRef): Promise<Container[]> {
  const { root } = stack;
  return parseContainers(
    await composeRead(
      root,
      devArgs(stack, ...envFileArgs(root), "ps", "-a", "--format", "json")
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
  stack: StackRef,
  opts?: StackSize
): Promise<string[]> {
  const { root } = stack;
  const args = devArgs(stack, "--env-file", ".env.local");
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
  stack: StackRef,
  service: string,
  lines: number
): Promise<string> {
  const { root } = stack;
  const r = await execa(
    "docker",
    devArgs(
      stack,
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

/** The last `lines` of a crbn-shared container's log; best effort, for
 *  diagnostics. */
export async function tailSharedLogs(
  service: keyof typeof SHARED_CONTAINERS,
  lines: number
): Promise<string> {
  const r = await execa(
    "docker",
    ["logs", "--tail", String(lines), SHARED_CONTAINERS[service]],
    { reject: false, all: true }
  );
  return r.all ?? "";
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

  if (withVolumes) {
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
  // Every docker call above ignores its own failure: check what is left.
  const left = await projectContainerIds(project);
  if (left.length > 0) {
    throw new Error(
      `${left.length} container(s) of ${project} are still there`
    );
  }
}

export async function listVolumes(): Promise<string[]> {
  return (await composeRead(".", ["volume", "ls", "-q"]))
    .split("\n")
    .filter(Boolean);
}

export async function removeVolumes(names: string[]): Promise<void> {
  if (names.length > 0) {
    await execStrict("docker", ["volume", "rm", ...names], process.cwd());
  }
}

/** The compose projects that have a container for `service`. */
export async function projectsWithService(service: string): Promise<string[]> {
  return (
    await composeRead(".", [
      "ps",
      "-a",
      "--filter",
      `label=com.docker.compose.service=${service}`,
      "--format",
      '{{.Label "com.docker.compose.project"}}'
    ])
  )
    .split("\n")
    .filter(Boolean);
}

// Every worktree compose project with a container.
async function listCarbonProjects(): Promise<string[]> {
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
    if (name.startsWith(PROJECT_PREFIX)) all.add(name);
  }
  return [...all];
}

// Every crbn stack on the machine, including ones whose containers are gone:
// `down` keeps volumes, so a deleted worktree's data outlives its containers.
// Matching on the `pgdata` volume keeps other projects of the prefix out.
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
    .filter((name) => name.startsWith(PROJECT_PREFIX));
  return [...new Set([...fromVolumes, ...(await listCarbonProjects())])];
}

// Wipe one logical DB on shared redis via the container's bundled redis-cli —
// avoids requiring a host `redis-cli` install. Callers release the slot next,
// and its index goes to another worktree, which would read these keys (same
// template users, so cached permissions too). Redis is down after a Docker
// restart (`restart: on-failure`) or `crbn prune --all`, so start it first.
export async function flushDb(db: number) {
  const flush = () =>
    execa(
      "docker",
      [
        "exec",
        SHARED_CONTAINERS.redis,
        "redis-cli",
        "-n",
        String(db),
        "FLUSHDB"
      ],
      { reject: false, stdio: "ignore" }
    );
  let r = await flush();
  if (r.exitCode !== 0 && (await startSharedRedis())) r = await flush();
  if (r.exitCode !== 0) {
    throw new Error(
      `its keys stay, and the next worktree given index ${db} reads them. Run \`docker exec ${SHARED_CONTAINERS.redis} redis-cli -n ${db} FLUSHDB\` once redis runs`
    );
  }
}

// crbn-shared's redis alone, from the files the last boot copied. False when
// there are none (no `crbn up` ran here) or compose fails.
async function startSharedRedis(): Promise<boolean> {
  const dir = sharedDir();
  if (!existsSync(join(dir, "docker-compose.shared.yml"))) return false;
  if (!existsSync(join(dir, ".env"))) return false;
  const r = await execa(
    "docker",
    [...sharedComposeArgs(), "up", "-d", "--wait", "--no-deps", "redis"],
    { cwd: dir, reject: false, ...sharedExec() }
  );
  return r.exitCode === 0;
}

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

function devArgs(stack: StackRef, ...rest: string[]): string[] {
  return projectArgs(stack, false, ...rest);
}

function projectArgs(
  stack: StackRef,
  allFiles: boolean,
  ...rest: string[]
): string[] {
  // --project-directory . pins the project dir to the cwd (repo root) so the
  // compose file's ./packages/... mounts resolve from root, though the file
  // lives under packages/dev/docker/.
  return [
    "compose",
    ...composeFileArgs(stack, allFiles),
    "--project-directory",
    ".",
    "-p",
    projectName(stack.slug),
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
