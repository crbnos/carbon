// Tags SSR module-runner nodes that are alive but no longer in any runner's
// module map (left behind by a program reload) with a `LeakMarker` object, then
// writes a heap snapshot, so heap-retainers.mjs can print what keeps them.
//   node mark-old-modules.mjs <inspector-port> <snapshot-path> [apps/erp] [url-part]
// With url-part, marks every old node whose url contains it (one per old graph).

import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const [port, out, app = "apps/erp", urlPart = ""] = process.argv.slice(2);
const rrPkg = createRequire(join(resolve(app), "package.json")).resolve("@react-router/dev/package.json");
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
    pending.set(++id, (msg) => (msg.error ? fail(new Error(msg.error.message)) : ok(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
const call = async (objectId, fn, returnByValue = true) => {
  const r = await cdp("Runtime.callFunctionOn", { objectId, functionDeclaration: fn, returnByValue, objectGroup: "mark" });
  if (r.exceptionDetails) throw new Error(r.result.description);
  return r.result;
};

await cdp("HeapProfiler.collectGarbage");
const proto = (await cdp("Runtime.evaluate", {
  expression: `process.getBuiltinModule("module").createRequire(${JSON.stringify(rrPkg)})("vite/module-runner").ModuleRunner.prototype`,
  objectGroup: "mark"
})).result.objectId;
const runners = (await cdp("Runtime.queryObjects", { prototypeObjectId: proto, objectGroup: "mark" })).objects.objectId;
const nodeProto = await call(runners, `function () {
  for (const r of this) for (const m of r.evaluatedModules?.idToModuleMap.values() ?? []) return Object.getPrototypeOf(m);
}`, false);
const live = await call(runners, `function () {
  return this.flatMap((r) => [...(r.evaluatedModules?.idToModuleMap.values() ?? [])]);
}`, false);
const all = (await cdp("Runtime.queryObjects", { prototypeObjectId: nodeProto.objectId, objectGroup: "mark" })).objects.objectId;
const marked = await cdp("Runtime.callFunctionOn", {
  objectId: all,
  arguments: [{ objectId: live.objectId }],
  returnByValue: true,
  objectGroup: "mark",
  functionDeclaration: `function (live) {
    const URL_PART = ${JSON.stringify(urlPart)};
    const current = new Set(live);
    class LeakMarker {}
    const old = this.filter((m) => !current.has(m));
    // The server build first: it is what a request handler would hold.
    old.sort((a, b) => (b.url?.includes("server-build") ? 1 : 0) - (a.url?.includes("server-build") ? 1 : 0));
    const pick = URL_PART ? old.filter((m) => m.url?.includes(URL_PART)) : old.slice(0, 3);
    for (const m of pick) m.__leakMarker = new LeakMarker();
    return { alive: this.length, current: current.size, old: old.length, marked: pick.map((m) => m.url) };
  }`
});
console.log(JSON.stringify(marked.result.value));
await cdp("Runtime.releaseObjectGroup", { objectGroup: "mark" });
await cdp("HeapProfiler.collectGarbage");
const written = await cdp("Runtime.evaluate", {
  expression: `process.getBuiltinModule("v8").writeHeapSnapshot(${JSON.stringify(resolve(out))})`,
  returnByValue: true
});
console.log("snapshot", written.result.value);
ws.close();
