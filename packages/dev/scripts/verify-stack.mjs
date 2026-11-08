// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Checks one crbn stack through its API gateway. With a second worktree root,
// it also checks that the 2 worktrees can't see each other's data.
// usage: node packages/dev/scripts/verify-stack.mjs <root> [<second root>]
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const [rootA, rootB] = process.argv.slice(2);
const loadEnv = (root) =>
  Object.fromEntries(
    readFileSync(`${root}/.env.local`, "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
  );
// Resolved from this checkout: a root under test may have no packages installed.
const require = createRequire(new URL("../../database/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const pg = require("pg");

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const adminClient = async (env) => {
  const url = new URL(env.SUPABASE_DB_URL);
  url.username = "supabase_admin";
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  return c;
};

// The public probe functions must not outlive the run: `crbn up`'s authz sync
// refuses public objects with no rule. The Realtime probe table lives in its
// own schema and stays: dropping it changes the publication, and Realtime then
// stops streaming until its next once-a-minute check.
const cleanups = [];
async function cleanupProbes(env, userId, paths) {
  const c = await adminClient(env);
  await c.query(`
    drop function if exists public.probe_rows();
    drop function if exists public.probe_search_path();
    notify pgrst, 'reload schema';`);
  await c.end();
  const admin = createClient(`http://127.0.0.1:${env.PORT_API}`, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  if (paths.length) await admin.storage.from("private").remove(paths);
  if (userId) await admin.auth.admin.deleteUser(userId);
}

async function insertProbe(env, note) {
  const c = await adminClient(env);
  await c.query(`insert into crbn_verify."realtimeProbe" (note) values ($1)`, [note]);
  await c.end();
}

async function setupProbes(env) {
  const c = await adminClient(env);
  await c.query(`
    create or replace function public.probe_rows() returns setof int language sql stable as $$ select generate_series(1, 1500) $$;
    create or replace function public.probe_search_path() returns text language sql stable as $$ select current_setting('search_path') $$;
    create schema if not exists crbn_verify;
    grant usage on schema crbn_verify to service_role;
    create table if not exists crbn_verify."realtimeProbe" (id bigint generated always as identity primary key, note text);
    grant select on crbn_verify."realtimeProbe" to service_role;
    notify pgrst, 'reload schema';`);
  await c
    .query(`alter publication supabase_realtime add table crbn_verify."realtimeProbe"`)
    .catch(() => {});
  await c.end();
  await sleep(2000);
}

async function verify(root) {
  const env = loadEnv(root);
  await setupProbes(env);
  const probe = { userId: undefined, paths: [] };
  cleanups.push(() => cleanupProbes(env, probe.userId, probe.paths));
  const api = `http://127.0.0.1:${env.PORT_API}`;
  const anon = env.SUPABASE_ANON_KEY;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  const auth = { apikey: service, Authorization: `Bearer ${service}`, "content-type": "application/json" };
  const status = async (path, headers = {}) => (await fetch(api + path, { headers })).status;

  check("REST without apikey is refused", (await status("/rest/v1/item?select=id&limit=1")) === 401);
  check("REST with anon key", (await status("/rest/v1/item?select=id&limit=1", { apikey: anon })) === 200);
  check("OpenAPI refused to anon", (await status("/rest/v1/", { apikey: anon })) !== 200);
  check("OpenAPI served to service role", (await status("/rest/v1/", { apikey: service })) === 200);
  check("Realtime tenants API blocked", (await status("/realtime/v1/api/tenants", { apikey: service })) >= 400);
  check("auth health", (await status("/auth/v1/health", { apikey: anon })) === 200);

  const rows = await fetch(`${api}/rest/v1/rpc/probe_rows`, { method: "POST", headers: auth, body: "{}" }).then((r) => r.json());
  check("PostgREST caps reads at 1000 rows", Array.isArray(rows) && rows.length === 1000, `${rows.length} rows`);
  const sp = await fetch(`${api}/rest/v1/rpc/probe_search_path`, { method: "POST", headers: auth, body: "{}" }).then((r) => r.json());
  check("PostgREST search path includes extensions", String(sp).includes("extensions"), String(sp));

  const admin = createClient(api, service, { auth: { persistSession: false } });
  const email = `verify-${Date.now()}@carbon.local`;
  const created = await admin.auth.admin.createUser({ email, password: "password", email_confirm: true });
  probe.userId = created.data.user?.id;
  probe.paths.push(`verify/${email}.bin`, `verify/${email}.tus`);
  check("admin creates a user", !created.error, created.error?.message);
  const user = createClient(api, anon, { auth: { persistSession: false } });
  const signIn = await user.auth.signInWithPassword({ email, password: "password" });
  check("password sign-in", !!signIn.data.session, signIn.error?.message);

  const path = `verify/${email}.bin`;
  const body = new Uint8Array(4 * 1024 * 1024).fill(97);
  const up = await admin.storage.from("private").upload(path, body, { upsert: true });
  check("storage upload", !up.error, up.error?.message);
  const down = await admin.storage.from("private").download(path);
  check("storage download", down.data?.size === body.length, String(down.data?.size));

  const tus = await fetch(`${api}/storage/v1/upload/resumable`, {
    method: "POST",
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      "Tus-Resumable": "1.0.0",
      "Upload-Length": "11",
      "Upload-Metadata": `bucketName ${btoa("private")},objectName ${btoa(`verify/${email}.tus`)}`
    }
  });
  const location = tus.headers.get("location") ?? "";
  check("resumable upload created", tus.status === 201, String(tus.status));
  check("resumable URL is the public API URL", location.startsWith(`${env.SUPABASE_URL}/storage/v1/upload/resumable/`), location);
  if (location) {
    const patch = await fetch(location.replace(/^https?:\/\/[^/]+/, api), {
      method: "PATCH",
      headers: {
        apikey: service,
        Authorization: `Bearer ${service}`,
        "Tus-Resumable": "1.0.0",
        "Upload-Offset": "0",
        "Content-Type": "application/offset+octet-stream"
      },
      body: "hello world"
    });
    check("resumable upload completes", patch.status === 204, String(patch.status));
  }
  return { env, api, admin, path };
}

async function subscribe(api, service, events) {
  const rt = createClient(api, service, { auth: { persistSession: false } });
  const ok = await new Promise((resolve) => {
    rt.channel(`verify-${Math.random()}`)
      .on("postgres_changes", { event: "INSERT", schema: "crbn_verify", table: "realtimeProbe" }, (p) => events.push(p))
      .subscribe((s) => s === "SUBSCRIBED" && resolve(true));
    setTimeout(() => resolve(false), 15000);
  });
  return { rt, ok };
}

try {
const a = await verify(rootA);
const eventsA = [];
const subA = await subscribe(a.api, a.env.SUPABASE_SERVICE_ROLE_KEY, eventsA);
check("realtime subscribe", subA.ok);
// The first run on a worktree adds the probe table to the publication, which
// Realtime picks up at its once-a-minute check. Later runs return at once.
// Insert until A's own event arrives, then count afresh.
let warm = false;
for (let waited = 0; !warm && waited < 75000; waited += 2500) {
  await insertProbe(a.env, "warm-up");
  for (let w = 0; eventsA.length === 0 && w < 2500; w += 250) await sleep(250);
  warm = eventsA.length > 0;
}
check("realtime streams the worktree's own inserts", warm);
await sleep(1000);
eventsA.length = 0;

let b;
if (rootB) {
  b = await verify(rootB);
  await insertProbe(b.env, "from B");
  const crossRead = await b.admin.storage.from("private").download(a.path);
  check("worktree B can't read worktree A's object", !!crossRead.error);
}

await sleep(35000);
await insertProbe(a.env, "from A after 35 s");
// Delivery takes longer with several stacks up. B's insert came 35 s earlier,
// so an event that leaked from B is already here when A's arrives.
for (let waited = 0; eventsA.length === 0 && waited < 15000; waited += 250) await sleep(250);
await sleep(500);
check(
  "realtime gets only its own worktree's event after 35 s",
  eventsA.length === 1 && eventsA[0].new?.note === "from A after 35 s",
  eventsA.map((e) => e.new?.note).join(", ") || "no events"
);
await subA.rt.removeAllChannels();
} catch (err) {
  check("verify ran to the end", false, err.message);
} finally {
  for (const cleanup of cleanups) await cleanup().catch((e) => check("cleanup", false, e.message));
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
