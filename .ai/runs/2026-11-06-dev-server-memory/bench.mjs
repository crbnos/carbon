// Repeatable memory benchmark for the ERP dev server.
//
//   node .ai/runs/2026-11-06-dev-server-memory/bench.mjs <label> [--hmr-minutes 10] [--snapshot] [--node-flags "..."]
//
// Starts its own `react-router dev` (never the one `crbn up` runs) on PORT_ERP_BENCH
// (default 54690) against the stack in the worktree's .env.local, then samples
// footprint, RSS and V8 heap (after a forced GC, over the inspector) at:
//   boot   — server listening, no request yet
//   pages  — logged in and loaded the pages in PAGES through a headless browser
//   hmr    — after N minutes of edits to the HMR_FILES (restored afterwards)
// Results go to out/<label>.json. Needs agent-browser on PATH.

import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { census } from "./census.mjs";
import { parseArgs, parseEnv as parse } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "hmr-minutes": { type: "string", default: "10" },
    "node-flags": { type: "string", default: "" },
    snapshot: { type: "boolean", default: false },
    sampling: { type: "boolean", default: false },
    census: { type: "boolean", default: false }
  }
});
const label = positionals[0] ?? "run";
const root = join(import.meta.dirname, "../../..");
const erp = join(root, "apps/erp");
const outDir = join(import.meta.dirname, "out");
mkdirSync(outDir, { recursive: true });

const env = { ...process.env };
for (const f of [
  join(erp, ".env"),
  join(erp, ".env.local"),
  join(root, ".env"),
  join(root, ".env.local")
]) {
  if (existsSync(f)) Object.assign(env, parse(readFileSync(f, "utf8")));
}
const port = Number(env.PORT_ERP_BENCH ?? 54690);
const inspectPort = port + 1;
const base = `http://127.0.0.1:${port}`;
const ca = join(homedir(), ".portless", "ca.pem");
if (existsSync(ca)) env.NODE_EXTRA_CA_CERTS = ca;
env.PORT = String(port);
// The stack's DOMAIN scopes the session cookie to its HTTPS host; on a bare
// 127.0.0.1 port it would never be sent back.
env.DOMAIN = "localhost";

// Record ids are from the demo dataset this ran against; override with BENCH_PAGES.
const PAGES = (
  env.BENCH_PAGES ??
  [
    "/x",
    "/x/items/parts",
    "/x/part/item_NN5oJLSWqzKqpa2EKDcv4h",
    "/x/sales/orders",
    "/x/sales-order/so_5JVys8j3KR1jE6P2d6P9Vw",
    "/x/production/jobs",
    "/x/job/job_JQGwnjHaARLmCpmRCrypiB",
    "/x/purchasing/orders"
  ].join(",")
)
  .split(",")
  .filter(Boolean);
const HMR_FILES = [
  "apps/erp/app/modules/items/items.service.ts",
  "apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderHeader.tsx",
  "apps/erp/app/components/Layout/Topbar/Topbar.tsx",
  "packages/react/src/Button.tsx"
];

const browser = (...args) =>
  execFileSync("agent-browser", ["--session", "devmem", ...args], {
    encoding: "utf8",
    timeout: 120_000
  });

// A tab left open by an earlier run would reconnect and load pages during "boot".
try {
  browser("close");
} catch {}

// --- server ---------------------------------------------------------------
const nodeFlags = values["node-flags"].split(" ").filter(Boolean);
const server = spawn(
  process.execPath,
  [
    ...nodeFlags,
    `--inspect=127.0.0.1:${inspectPort}`,
    "./node_modules/@react-router/dev/bin.js",
    "dev",
    "--port",
    String(port),
    "--host",
    "127.0.0.1"
  ],
  { cwd: erp, env, stdio: ["ignore", "pipe", "pipe"] }
);
let log = "";
const logFile = join(outDir, `${label}.log`);
writeFileSync(logFile, "");
const onOutput = (d) => {
  log += d;
  appendFileSync(logFile, d);
};
server.stdout.on("data", onOutput);
server.stderr.on("data", onOutput);
server.on("exit", (code, signal) => {
  console.log(`server exited code=${code} signal=${signal}`);
  ws?.close();
});
const started = Date.now();

// --- inspector -------------------------------------------------------------
let ws;
let nextId = 1;
const pending = new Map();
async function connectInspector() {
  for (let i = 0; i < 100; i++) {
    try {
      const [target] = await (
        await fetch(`http://127.0.0.1:${inspectPort}/json/list`)
      ).json();
      ws = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((ok, fail) => {
        ws.onopen = ok;
        ws.onerror = fail;
      });
      ws.onclose = () => {
        for (const settle of pending.values())
          settle({ error: { message: "inspector closed" } });
        pending.clear();
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id && pending.has(msg.id)) {
          pending.get(msg.id)(msg);
          pending.delete(msg.id);
        } else if (msg.method === "HeapProfiler.addHeapSnapshotChunk") {
          snapshotChunks.push(msg.params.chunk);
        }
      };
      return;
    } catch {
      await sleep(200);
    }
  }
  throw new Error("inspector did not come up");
}
const cdp = (method, params = {}) =>
  new Promise((ok, fail) => {
    const id = nextId++;
    const timer = setTimeout(() => fail(new Error(`${method} timed out`)), 600_000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      msg.error ? fail(new Error(`${method}: ${msg.error.message}`)) : ok(msg);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });


let snapshotChunks = [];

async function sample(stage) {
  await cdp("HeapProfiler.collectGarbage");
  await cdp("HeapProfiler.collectGarbage");
  const { result } = await cdp("Runtime.evaluate", {
    expression: "JSON.stringify(process.memoryUsage())",
    returnByValue: true
  });
  const mem = JSON.parse(result.result.value);
  const fp = execFileSync("footprint", [String(server.pid)], {
    encoding: "utf8"
  }).match(/Footprint: ([\d.]+) (MB|GB)/);
  const footprintMB = fp ? Number(fp[1]) * (fp[2] === "GB" ? 1024 : 1) : null;
  const mb = (n) => Math.round(n / 1048576);
  const row = {
    stage,
    seconds: Math.round((Date.now() - started) / 1000),
    footprintMB: Math.round(footprintMB),
    rssMB: mb(mem.rss),
    heapUsedMB: mb(mem.heapUsed),
    heapTotalMB: mb(mem.heapTotal),
    externalMB: mb(mem.external)
  };
  if (values.census) row.census = await census(cdp, erp);
  console.log(JSON.stringify(row));
  return row;
}

async function snapshot(stage) {
  snapshotChunks = [];
  await cdp("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
  const file = join(outDir, `${label}-${stage}.heapsnapshot`);
  writeFileSync(file, snapshotChunks.join(""));
  console.log(`snapshot ${file}`);
}

// Warmup (dep scan, icon scan, dataset assets) runs after "listening"; wait
// for the process to go quiet so "boot" means the same thing every run.
async function waitForIdle() {
  const cpu = () => {
    const [m, sec] = execFileSync("ps", ["-o", "time=", "-p", String(server.pid)], { encoding: "utf8" })
      .trim().split(":").map(Number);
    return m * 60 + sec;
  };
  let last = cpu();
  let quiet = 0;
  for (let i = 0; i < 180 && quiet < 3; i++) {
    await sleep(1000);
    const now = cpu();
    quiet = now - last < 0.05 ? quiet + 1 : 0;
    last = now;
  }
}

async function saveSampling(stage) {
  const { result } = await cdp("HeapProfiler.getSamplingProfile");
  const file = join(outDir, `${label}-${stage}.heapprofile`);
  writeFileSync(file, JSON.stringify(result.profile));
  console.log(`sampling profile ${file}`);
}

async function waitForServer() {
  for (let i = 0; i < 600; i++) {
    if (server.exitCode !== null) throw new Error(`server exited\n${log}`);
    if (log.includes(`127.0.0.1:${port}`)) return;
    await sleep(200);
  }
  throw new Error(`server never listened\n${log}`);
}

async function visit(path) {
  const t = Date.now();
  browser("open", base + path);
  try {
    browser("wait", "--load", "networkidle");
  } catch {
    await sleep(3000);
  }
  const url = browser("get", "url").trim();
  console.log(`visit ${path} -> ${url} ${Date.now() - t} ms`);
  if (url.includes("/login") && !path.includes("/login"))
    throw new Error("not logged in");
}

async function login() {
  // The first request imports every route; give it time outside the browser.
  const t = Date.now();
  await fetch(`${base}/login`, { signal: AbortSignal.timeout(300_000) });
  console.log(`first request ${Date.now() - t} ms`);
  browser("open", `${base}/login`);
  await sleep(2000);
  await sleep(2000);
  browser("fill", 'input[name="email"]', env.DEV_BYPASS_EMAIL ?? "test@carbon.ms");
  browser("click", 'button[type="submit"]');
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    if (!browser("get", "url").includes("/login")) return;
  }
  throw new Error("login did not redirect");
}

// --- run ---------------------------------------------------------------------
const originals = new Map(
  HMR_FILES.map((f) => [f, readFileSync(join(root, f), "utf8")])
);
const restore = () => {
  for (const [f, text] of originals) writeFileSync(join(root, f), text);
};
process.on("exit", restore);
process.on("SIGINT", () => {
  restore();
  server.kill("SIGKILL");
  process.exit(130);
});

const rows = [];
try {
  await connectInspector();
  if (values.sampling)
    await cdp("HeapProfiler.startSampling", { samplingInterval: 65536 });
  await waitForServer();
  await waitForIdle();
  rows.push(await sample("boot"));
  if (values.snapshot) await snapshot("boot");

  try {
    browser("close");
  } catch {}
  await login();
  for (const p of PAGES) await visit(p);
  rows.push(await sample("pages"));
  if (values.snapshot) await snapshot("pages");
  if (values.sampling) await saveSampling("pages");

  const minutes = Number(values["hmr-minutes"]);
  if (minutes > 0) {
    const end = Date.now() + minutes * 60_000;
    let n = 0;
    let slow = 0;
    let nextSample = Date.now() + 120_000;
    while (Date.now() < end) {
      const f = HMR_FILES[n % HMR_FILES.length];
      writeFileSync(join(root, f), `${originals.get(f)}\n// hmr-bench ${n}\n`);
      n++;
      await sleep(4000);
      // Every round of edits, reload a page so SSR re-imports the changed graph.
      if (n % HMR_FILES.length === 0) {
        const page = PAGES[(n / HMR_FILES.length) % PAGES.length];
        try {
          await visit(page);
        } catch (error) {
          slow++;
          console.log(`visit ${page} failed: ${String(error.message).split("\n")[0]}`);
        }
      } else await sleep(4000);
      if (Date.now() >= nextSample) {
        rows.push({ ...(await sample(`hmr+${n}`)), edits: n });
        nextSample += 120_000;
      }
    }
    restore();
    await sleep(5000);
    console.log(`hmr edits: ${n}, failed visits: ${slow}`);
    rows.push({ ...(await sample("hmr")), edits: n, failedVisits: slow });
    if (values.snapshot) await snapshot("hmr");
    if (values.sampling) await saveSampling("hmr");
  }
} finally {
  restore();
  writeFileSync(
    join(outDir, `${label}.json`),
    JSON.stringify({ label, nodeFlags, pages: PAGES, rows }, null, 2)
  );
  try {
    browser("close");
  } catch {}
  server.kill("SIGTERM");
  await sleep(1000);
  if (server.exitCode === null) server.kill("SIGKILL");
}
console.table(rows);
process.exit(0);
