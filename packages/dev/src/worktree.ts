import { createHmac, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from "node:fs";
import net from "node:net";
import { homedir } from "node:os";
import { execa } from "execa";
import { basename, dirname, join, normalize } from "pathe";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

export const PORT_NAMES = [
  "PORT_DB",
  "PORT_API",
  "PORT_STUDIO",
  "PORT_INBUCKET",
  "PORT_INNGEST"
] as const;
type PortName = (typeof PORT_NAMES)[number];

export type PortMap = Record<PortName, number>;
export type JwtCreds = { secret: string; anonKey: string; serviceKey: string };
type RegistryEntry = {
  worktreeRoot: string;
  ports: PortMap;
  redisDb: number;
  jwt: JwtCreds;
};
type Registry = Record<string, RegistryEntry>;

export const SHARED_REDIS_PORT = 6379;
const REDIS_DB_MAX = 16;
const SLUG_FILE = ".carbon-worktree";
const REGISTRY_PATH = join(homedir(), ".carbon", "dev-ports.json");

// ---------------------------------------------------------------------------
// Worktree identity (slug)
// ---------------------------------------------------------------------------

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

export async function getWorktreeRoot(): Promise<string> {
  try {
    const r = await execa("git", ["rev-parse", "--show-toplevel"]);
    return r.stdout.trim();
  } catch {
    return process.cwd();
  }
}

export function projectName(slug: string): string {
  return `carbon-${slug}`;
}

// Resolve symlinks + normalize separators / trailing slashes so two strings
// pointing at the same worktree compare equal (e.g. /tmp/x vs symlinked path).
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

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

// ---------------------------------------------------------------------------
// Per-worktree slot (ports + redis db + jwt creds)
// ---------------------------------------------------------------------------

export async function resolveSlot(
  slug: string,
  worktreeRoot: string
): Promise<{ ports: PortMap; redisDb: number; jwt: JwtCreds }> {
  const registry = readRegistry();
  const existing = registry[slug];

  // Fast path: registry entry is valid and points at this worktree.
  if (existing && sameWorktreePath(existing.worktreeRoot, worktreeRoot)) {
    return {
      ports: existing.ports,
      redisDb: existing.redisDb,
      jwt: existing.jwt
    };
  }

  // Slug collision (different path) or no entry — allocate fresh.
  // JWT creds tie to data signed/stored in postgres; reuse when present so
  // existing sessions stay valid.
  const { claimedPorts, claimedDbs } = collectClaims(registry, slug);
  const ports = await pickPorts(claimedPorts);
  const redisDb = pickRedisDb(claimedDbs);
  const jwt = existing?.jwt ?? generateJwtCreds();

  registry[slug] = { worktreeRoot, ports, redisDb, jwt };
  writeRegistry(registry);
  return { ports, redisDb, jwt };
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

export function getSlot(slug: string): RegistryEntry | null {
  return readRegistry()[slug] ?? null;
}

export function listSlugs(): Registry {
  return readRegistry();
}

export function removeSlot(slug: string) {
  const registry = readRegistry();
  if (!(slug in registry)) return;
  delete registry[slug];
  writeRegistry(registry);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function readRegistry(): Registry {
  if (!existsSync(REGISTRY_PATH)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
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
    const entry = parseRegistryEntry(value);
    if (entry) out[slug] = entry;
  }
  return out;
}

function parseRegistryEntry(raw: unknown): RegistryEntry | null {
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

function writeRegistry(registry: Registry) {
  mkdirSync(dirname(REGISTRY_PATH), { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
}

function pickRedisDb(taken: Set<number>): number {
  for (let i = 0; i < REDIS_DB_MAX; i++) {
    if (!taken.has(i)) return i;
  }
  throw new Error(
    `Redis DB pool exhausted (max ${REDIS_DB_MAX}). Free a slot via \`crbn remove\`.`
  );
}

async function pickPorts(claimed: Set<number>): Promise<PortMap> {
  const ports = {} as PortMap;
  for (const name of PORT_NAMES) {
    ports[name] = await pickFreePort(claimed);
  }
  return ports;
}

async function pickFreePort(taken: Set<number>): Promise<number> {
  // OS-assigned ephemeral via listen(0); retry on collision with other
  // worktrees' claimed-set.
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

// Mint a fresh JWT_SECRET + the matching `anon` and `service_role` HS256 JWTs.
// Mirrors supabase's well-known dev token shape so all downstream services
// (gotrue, postgrest, kong, storage, studio) accept them without further config.
function generateJwtCreds(): JwtCreds {
  // 32-byte (256-bit) secret, hex-encoded — matches HS256 key strength.
  const secret = randomBytes(32).toString("hex");
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 10 * 365 * 24 * 60 * 60; // 10 years
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
