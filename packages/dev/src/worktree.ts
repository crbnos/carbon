// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import net from "node:net";
import { basename, dirname, join, normalize } from "pathe";
import { paths } from "./paths.js";
import {
  ISOLATED_DATABASE,
  REDIS_DB_MAX,
  SHARED_DB_PORT,
  SHARED_INBUCKET_PORT,
  SHARED_POOLER_PORT,
  type StackMode
} from "./topology.js";

export const PORT_NAMES = [
  "PORT_DB",
  "PORT_API",
  "PORT_STUDIO",
  "PORT_INBUCKET",
  "PORT_INNGEST",
  "PORT_ERP",
  "PORT_MES",
  "PORT_ASSEMBLER",
  "PORT_EMAIL",
  "PORT_POOLER"
] as const;
type PortName = (typeof PORT_NAMES)[number];

const OPTIONAL_PORT_NAMES: readonly PortName[] = ["PORT_EMAIL", "PORT_POOLER"];

export type PortMap = Record<PortName, number>;
export type JwtCreds = { secret: string; anonKey: string; serviceKey: string };
export type Slot = {
  worktreeRoot: string;
  ports: PortMap;
  redisDb: number;
  jwt: JwtCreds;
};
type Registry = Record<string, Slot>;

const SLUG_FILE = ".carbon-worktree";

// ---------------------------------------------------------------------------
// Shared dev stack: the machine-wide JWT, the worktree database, the mode
// ---------------------------------------------------------------------------
// None of these live in the registry's own fields. Older crbn versions in
// other worktrees rewrite ~/.carbon/dev-ports.json: they drop an entry without
// `jwt` and write back only the fields they know.

// Postgres caps identifiers at 63 bytes.
const MAX_DB_NAME = 63;

export function worktreeDatabaseName(slug: string): string {
  const name = `wt_${slug.replace(/[^a-z0-9]/g, "_")}`;
  // A slug from `slugify` maps to a unique name. Anything else, or a name
  // that is too long, gets a hash so two slugs can't share a database.
  if (/^[a-z0-9-]+$/.test(slug) && name.length <= MAX_DB_NAME) return name;
  const hash = createHash("sha1").update(slug).digest("hex").slice(0, 6);
  return `${name.slice(0, MAX_DB_NAME - hash.length - 1)}_${hash}`;
}

/** The database a stack runs: the worktree's own in shared mode. */
export function stackDatabase(slug: string, mode: StackMode): string {
  return mode === "shared" ? worktreeDatabaseName(slug) : ISOLATED_DATABASE;
}

/** The ports a stack uses: the shared containers own 3 of them. */
export function stackPorts(ports: PortMap, mode: StackMode): PortMap {
  return mode === "shared"
    ? {
        ...ports,
        PORT_DB: SHARED_DB_PORT,
        PORT_POOLER: SHARED_POOLER_PORT,
        PORT_INBUCKET: SHARED_INBUCKET_PORT
      }
    : ports;
}

// One JWT secret and key pair for every worktree, so the shared Storage
// registers each tenant with the same keys. 2 first boots may both mint a
// pair: the hard link publishes only the first, and both return it.
export function readDevJwt(): JwtCreds {
  const path = paths.devJwt();
  if (!existsSync(path)) {
    const creds = generateJwtCreds();
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 });
    try {
      linkSync(tmp, path);
    } catch (err) {
      if ((err as { code?: string }).code !== "EEXIST") throw err;
    } finally {
      unlinkSync(tmp);
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    parsed = null;
  }
  // New keys would sign every worktree's users out, so never replace a file
  // we can't read.
  if (!isJwtCreds(parsed)) {
    throw new Error(`${path} is not valid JWT creds. Fix it or delete it.`);
  }
  return parsed;
}

/** The mode `crbn up` last wrote. null when no version with modes ran `up`
 *  here (such a worktree has no wt_ database, and its volumes are live), or
 *  when the file holds neither mode: commands that delete data need a mode. */
export function recordedStackMode(slug: string): StackMode | null {
  try {
    const mode = readFileSync(paths.stackMode(slug), "utf8").trim();
    return mode === "isolated" || mode === "shared" ? mode : null;
  } catch {
    return null;
  }
}

export function writeStackMode(slug: string, mode: StackMode): void {
  const path = paths.stackMode(slug);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${mode}\n`);
  renameSync(tmp, path);
}

export function resolveSlug(worktreeRoot: string): string {
  const fromEnv = process.env.CARBON_WORKTREE?.trim();
  if (fromEnv) return slugify(fromEnv);

  const filePath = join(worktreeRoot, SLUG_FILE);
  if (existsSync(filePath)) {
    const fromFile = readFileSync(filePath, "utf8").trim();
    if (fromFile) return slugify(fromFile);
  }

  return slugify(basename(worktreeRoot));
}

export function persistSlug(worktreeRoot: string, slug: string) {
  writeFileSync(join(worktreeRoot, SLUG_FILE), `${slug}\n`);
}

/** A worktree's directory name: `<repo>-<branch>`, beside the main checkout
 *  (`crbn new`, `crbn checkout`). `<repo>` drops a suffix the main
 *  checkout's own directory may carry. */
export function worktreeDirName(mainRoot: string, branch: string): string {
  const repoBase = basename(mainRoot).replace(/-[a-z0-9-]+$/i, "");
  return `${repoBase}-${slugify(branch)}`;
}

/** Where `crbn new` and `crbn checkout` put a branch's worktree: beside the
 *  main checkout. */
export const worktreePath = (mainRoot: string, branch: string) =>
  join(dirname(mainRoot), worktreeDirName(mainRoot, branch));

// The slug `crbn init` gives a worktree: its directory name as crbn would
// name it, whatever it is really called (a Conductor codename like `moscow`,
// a bare `git worktree add`), so it never collides with the main checkout's.
// The directory's own name when HEAD is detached.
export function canonicalSlug(opts: {
  worktreeRoot: string;
  mainRoot: string;
  branch: string;
}): string {
  return slugify(
    opts.branch
      ? worktreeDirName(opts.mainRoot, opts.branch)
      : basename(opts.worktreeRoot)
  );
}

// So a worktree reached through a symlink compares equal to its real path.
function canonicalWorktreePath(input: string): string {
  let p = input.trim();
  try {
    p = realpathSync.native(p);
  } catch {
    // Best-effort: fall through to string normalization.
  }
  return normalize(p).replace(/\/+$/, "");
}

export function sameWorktreePath(a: string, b: string): boolean {
  return canonicalWorktreePath(a) === canonicalWorktreePath(b);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export async function resolveSlot(
  slug: string,
  worktreeRoot: string
): Promise<{ ports: PortMap; redisDb: number; jwt: JwtCreds }> {
  const unlock = lockRegistry();
  try {
    return await resolveSlotLocked(slug, worktreeRoot);
  } finally {
    unlock();
  }
}

async function resolveSlotLocked(
  slug: string,
  worktreeRoot: string
): Promise<{ ports: PortMap; redisDb: number; jwt: JwtCreds }> {
  const registry = readRegistry();
  const existing = registry[slug];
  // The entry keeps a copy of the machine-wide creds: older crbn versions
  // drop an entry without `jwt`.
  const jwt = readDevJwt();

  if (existing && sameWorktreePath(existing.worktreeRoot, worktreeRoot)) {
    await backfillMissingPorts(registry, slug, existing);
    if (existing.jwt.secret !== jwt.secret) {
      existing.jwt = jwt;
      writeRegistry(registry);
    }
    const allFree = await portsAvailable(Object.values(existing.ports));
    if (allFree) {
      return { ports: existing.ports, redisDb: existing.redisDb, jwt };
    }
  }

  const { claimedPorts, claimedDbs } = collectClaims(registry, slug);
  const ports = await pickPorts(claimedPorts);
  const redisDb = pickRedisDb(claimedDbs);

  registry[slug] = { worktreeRoot, ports, redisDb, jwt };
  writeRegistry(registry);
  return { ports, redisDb, jwt };
}

async function backfillMissingPorts(
  registry: Registry,
  slug: string,
  entry: Slot
): Promise<void> {
  const missing = OPTIONAL_PORT_NAMES.filter(
    (n) => entry.ports[n] === undefined
  );
  if (missing.length === 0) return;
  const { claimedPorts } = collectClaims(registry, slug);
  for (const p of Object.values(entry.ports)) claimedPorts.add(p);
  for (const name of missing) {
    entry.ports[name] = await pickFreePort(claimedPorts);
  }
  writeRegistry(registry);
}

function collectClaims(
  registry: Registry,
  excludeSlug: string
): { claimedPorts: Set<number>; claimedDbs: Set<number> } {
  const claimedPorts = new Set<number>();
  const claimedDbs = new Set<number>();
  for (const [s, entry] of Object.entries(registry)) {
    if (s === excludeSlug) continue;
    for (const p of Object.values(entry.ports)) claimedPorts.add(p);
    claimedDbs.add(entry.redisDb);
  }
  return { claimedPorts, claimedDbs };
}

export function getSlot(slug: string): Slot | null {
  return readRegistry()[slug] ?? null;
}

export function listSlugs(): Registry {
  return readRegistry();
}

// A raw `===` misses worktrees under symlinked parents (macOS /var, /tmp), so
// `crbn remove`/`list` wouldn't find the slug and would leak the stack/ports.
export function slugForWorktreePath(
  worktreeRoot: string,
  registry: Registry = readRegistry()
): string | null {
  for (const [slug, entry] of Object.entries(registry)) {
    if (sameWorktreePath(entry.worktreeRoot, worktreeRoot)) return slug;
  }
  return null;
}

export function removeSlot(slug: string) {
  // The mode and hibernation state go with the slot: a stale `shared` would
  // make a later prune treat a private stack an older crbn starts here as an
  // old volume.
  rmSync(paths.stackDir(slug), { recursive: true, force: true });
  const unlock = lockRegistry();
  try {
    const registry = readRegistry();
    if (!(slug in registry)) return;
    delete registry[slug];
    writeRegistry(registry);
  } finally {
    unlock();
  }
}

function readRegistry(): Registry {
  if (!existsSync(paths.registry())) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(paths.registry(), "utf8"));
  } catch {
    return {};
  }
  return parseRegistry(raw);
}

// Drop entries that don't match the expected shape rather than letting silently
// corrupt JSON poison `crbn up`. Returning {} on outer failure would re-allocate
// fresh slots and break running stacks — drop-bad-entries preserves the good
// ones and only forces re-allocation for the corrupt slugs.
function parseRegistry(raw: unknown): Registry {
  if (!raw || typeof raw !== "object") return {};
  const out: Registry = {};
  for (const [slug, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = parseSlot(value);
    if (entry) out[slug] = entry;
  }
  return out;
}

function parseSlot(raw: unknown): Slot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.worktreeRoot !== "string") return null;
  if (!isPortMap(r.ports)) return null;
  if (typeof r.redisDb !== "number" || !Number.isInteger(r.redisDb))
    return null;
  if (!isJwtCreds(r.jwt)) return null;
  return {
    worktreeRoot: r.worktreeRoot,
    ports: r.ports,
    redisDb: r.redisDb,
    jwt: r.jwt
  };
}

function isPortMap(v: unknown): v is PortMap {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  for (const name of PORT_NAMES) {
    if (o[name] === undefined && OPTIONAL_PORT_NAMES.includes(name)) continue;
    if (typeof o[name] !== "number" || !Number.isInteger(o[name])) return false;
  }
  return true;
}

function isJwtCreds(v: unknown): v is JwtCreds {
  if (!v || typeof v !== "object") return false;
  const j = v as Record<string, unknown>;
  return (
    typeof j.secret === "string" &&
    j.secret.length > 0 &&
    typeof j.anonKey === "string" &&
    typeof j.serviceKey === "string"
  );
}

// Temp file + rename, so a reader never sees a half-written registry.
function writeRegistry(registry: Registry) {
  mkdirSync(dirname(paths.registry()), { recursive: true });
  const tmp = `${paths.registry()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(registry, null, 2));
  renameSync(tmp, paths.registry());
}

// Every change to the registry is read → decide → write, and several `crbn up`
// start at once (Conductor boots workspaces concurrently). Without a lock two
// of them read the same file and hand out the same ports and redis db. `mkdir`
// is the lock: it is atomic, and it either creates the directory or fails.
const lockPath = () => `${paths.registry()}.lock`;
const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 20_000;

function lockRegistry(): () => void {
  mkdirSync(dirname(lockPath()), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(lockPath());
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    // A holder that was killed leaves the directory behind. Nothing holds the
    // lock for more than a second, so one this old has no owner.
    try {
      if (Date.now() - statSync(lockPath()).mtimeMs > LOCK_STALE_MS) {
        rmdirSync(lockPath());
        continue;
      }
    } catch {
      continue; // released between the mkdir and the stat
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for the slot registry lock (${lockPath()}). If no other crbn is running, delete that directory.`
      );
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  return () => {
    try {
      rmdirSync(lockPath());
    } catch {
      // already gone (taken over as stale) — nothing to release
    }
  };
}

function pickRedisDb(taken: Set<number>): number {
  for (let i = 0; i < REDIS_DB_MAX; i++) {
    if (!taken.has(i)) return i;
  }
  throw new Error(
    `Redis DB pool exhausted (max ${REDIS_DB_MAX}). Free a slot with \`crbn down --purge\` in a worktree you no longer use, \`crbn remove\`, or \`crbn prune\` (worktrees whose folder is gone).`
  );
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function portsAvailable(ports: number[]): Promise<boolean> {
  const results = await Promise.all(ports.map(isPortAvailable));
  return results.every(Boolean);
}

async function pickPorts(claimed: Set<number>): Promise<PortMap> {
  const ports = {} as PortMap;
  for (const name of PORT_NAMES) {
    ports[name] = await pickFreePort(claimed);
  }
  return ports;
}

async function pickFreePort(taken: Set<number>): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (typeof addr === "object" && addr) {
          const p = addr.port;
          server.close(() => resolve(p));
        } else {
          server.close();
          reject(new Error("could not determine port"));
        }
      });
    });
    if (!taken.has(port)) {
      taken.add(port);
      return port;
    }
  }
  throw new Error("Failed to allocate a free port after 100 attempts");
}

// Supabase's well-known dev token shape, so all downstream services
// (gotrue, postgrest, the API gateway, storage, studio) accept them without further config.
function generateJwtCreds(): JwtCreds {
  const secret = randomBytes(32).toString("hex");
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 10 * 365 * 24 * 60 * 60;
  const anonKey = signJwt(
    { iss: "supabase-demo", role: "anon", iat, exp },
    secret
  );
  const serviceKey = signJwt(
    { iss: "supabase-demo", role: "service_role", iat, exp },
    secret
  );
  return { secret, anonKey, serviceKey };
}

function signJwt(payload: object, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const data = `${h}.${p}`;
  const sig = b64url(createHmac("sha256", secret).update(data).digest());
  return `${data}.${sig}`;
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
