// Live census of what Vite holds, over the inspector. Used by bench.mjs, or
// against any server started with --inspect:
//   node census.mjs <inspector-port> [apps/erp]

import { createRequire } from "node:module";
import { join, resolve } from "node:path";

// What Vite holds, read live over the inspector: every DevEnvironment's module
// graph (transform results: code, map, sourcesContent) and every SSR module
// runner's evaluated modules, plus how many EvaluatedModuleNode objects are
// still alive in total (more than the runners list = retained old modules).
export async function census(cdp, erp) {
  // The Vite copy React Router runs the server on, which need not be the one
  // the app resolves (pnpm peer variants).
  const rrPkg = createRequire(join(erp, "package.json")).resolve("@react-router/dev/package.json");
  const req = `process.getBuiltinModule("module").createRequire(${JSON.stringify(rrPkg)})`;
  const proto = async (expression) =>
    (await cdp("Runtime.evaluate", { expression, objectGroup: "census" })).result.result.objectId;
  const instances = async (objectId) =>
    (await cdp("Runtime.queryObjects", { prototypeObjectId: objectId, objectGroup: "census" })).result.objects.objectId;
  const call = async (objectId, fn, byValue = true) =>
    (await cdp("Runtime.callFunctionOn", { objectId, functionDeclaration: fn, returnByValue: byValue, objectGroup: "census" })).result.result;

  const envs = await instances(await proto(`${req}("vite").DevEnvironment.prototype`));
  const environments = (await call(envs, `function () {
    const mb = (n) => Math.round(n / 1048576);
    return this.filter((env) => env.moduleGraph).map((env) => {
      let modules = 0, code = 0, mappings = 0, sourcesContent = 0, transformed = 0;
      for (const mod of env.moduleGraph.idToModuleMap.values()) {
        modules++;
        const r = mod.transformResult;
        if (!r) continue;
        transformed++;
        code += r.code?.length ?? 0;
        const map = r.map;
        if (map && typeof map === "object") {
          mappings += map.mappings?.length ?? 0;
          for (const c of map.sourcesContent ?? []) sourcesContent += c?.length ?? 0;
        }
      }
      return { name: env.name, server: env.config?.root?.split('/').slice(-2).join('/'), configFile: env.config?.configFile?.split('/').pop() ?? null, modules, transformed, codeMB: mb(code), mappingsMB: mb(mappings), sourcesContentMB: mb(sourcesContent) };
    });
  }`)).value;

  const runners = await instances(await proto(`${req}("vite/module-runner").ModuleRunner.prototype`));
  const runnerStats = (await call(runners, `function () {
    return this.filter((r) => r.evaluatedModules).map((r) => {
      let code = 0;
      for (const m of r.evaluatedModules.idToModuleMap.values()) code += m.meta?.code?.length ?? 0;
      return { modules: r.evaluatedModules.idToModuleMap.size, codeMB: Math.round(code / 1048576), closed: r.isClosed?.() ?? null };
    });
  }`)).value;
  const nodeProto = await call(runners, `function () {
    for (const r of this) for (const m of r.evaluatedModules?.idToModuleMap.values() ?? []) return Object.getPrototypeOf(m);
  }`, false);
  const evaluatedNodes = nodeProto.objectId
    ? (await call(await instances(nodeProto.objectId), "function () { return this.length; }")).value
    : 0;
  // Remote handles keep their objects alive; never let the census retain a module.
  await cdp("Runtime.releaseObjectGroup", { objectGroup: "census" });
  return { environments, runners: runnerStats, evaluatedModuleNodesAlive: evaluatedNodes };
}

if (import.meta.main) {
  const [port, app = "apps/erp"] = process.argv.slice(2);
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
  await cdp("HeapProfiler.collectGarbage");
  console.log(JSON.stringify(await census(cdp, resolve(app)), null, 2));
  ws.close();
}
