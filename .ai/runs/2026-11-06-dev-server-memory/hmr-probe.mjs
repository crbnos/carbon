// One kind of edit, N times, against a server already running with --inspect
// and a logged-in agent-browser tab open on a page. Prints heap (after GC) and
// the Vite census after each edit, so each edit kind's cost is measured alone.
//   node hmr-probe.mjs <inspector-port> <file> <edits> [page-url]
// With page-url the tab is reopened on it after each edit (as a developer
// would reload); without, only the tab's own HMR/reload runs.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { resolve } from "node:path";
import { census } from "./census.mjs";

const [port, file, count = "5", page] = process.argv.slice(2);
const original = readFileSync(file, "utf8");
const restore = () => writeFileSync(file, original);
process.on("exit", restore);
process.on("SIGINT", () => process.exit(130));

const [target] = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok) => (ws.onopen = ok));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  pending.get(msg.id)?.(msg);
};
const cdp = (method, params = {}) =>
  new Promise((ok, fail) => {
    pending.set(++id, (msg) => (msg.error ? fail(new Error(msg.error.message)) : ok(msg)));
    ws.send(JSON.stringify({ id, method, params }));
  });

async function measure(label) {
  await cdp("HeapProfiler.collectGarbage");
  await cdp("HeapProfiler.collectGarbage");
  const { result } = await cdp("Runtime.evaluate", {
    expression: "process.memoryUsage().heapUsed",
    returnByValue: true
  });
  const c = await census(cdp, resolve("apps/erp"));
  const envs = c.environments
    .filter((e) => e.transformed > 0)
    .map((e) => `${e.name}:${e.transformed}/${e.codeMB}MB`)
    .join(" ");
  console.log(
    `${label} heap=${Math.round(result.result.value / 1048576)}MB ${envs} runner=${c.runners.map((r) => r.modules).join(",")} nodesAlive=${c.evaluatedModuleNodesAlive}`
  );
}

await measure("start");
for (let n = 1; n <= Number(count); n++) {
  writeFileSync(file, `${original}\n// hmr-probe ${n}\n`);
  await sleep(6000);
  if (page) {
    execFileSync("agent-browser", ["--session", "devmem", "open", page], { timeout: 120_000 });
    await sleep(4000);
  }
  await measure(`edit ${n}`);
}
restore();
ws.close();
