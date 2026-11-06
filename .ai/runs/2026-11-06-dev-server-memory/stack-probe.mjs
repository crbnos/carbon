// Checks that server stack traces still point at source lines: writes a module
// that throws from a known TypeScript line, imports it through the running
// SSR module runner and prints the stack's first frames.
//   node stack-probe.mjs <inspector-port> [apps/erp]

import { rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const [port, app = "apps/erp"] = process.argv.slice(2);
const root = resolve(app);
const file = join(root, "app", "__stack_probe__.ts");
// Types and blank lines shift the emitted JS, so a mapped frame must say line 8.
writeFileSync(
  file,
  `type Probe = { reason: string };\n\nconst probe: Probe = { reason: "x" };\n\nexport function explode(): never {\n  // a comment\n  const why: string = probe.reason;\n  throw new Error("stack-probe " + why);\n}\n`
);
try {
  const rrPkg = createRequire(join(root, "package.json")).resolve("@react-router/dev/package.json");
  const [target] = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok) => (ws.onopen = ok));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    pending.get(msg.id)?.(msg.result);
  };
  const cdp = (method, params) =>
    new Promise((ok) => {
      pending.set(++id, ok);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const proto = await cdp("Runtime.evaluate", {
    expression: `process.getBuiltinModule("module").createRequire(${JSON.stringify(rrPkg)})("vite/module-runner").ModuleRunner.prototype`,
    objectGroup: "probe"
  });
  const runners = await cdp("Runtime.queryObjects", { prototypeObjectId: proto.result.objectId, objectGroup: "probe" });
  const out = await cdp("Runtime.callFunctionOn", {
    objectId: runners.objects.objectId,
    awaitPromise: true,
    returnByValue: true,
    objectGroup: "probe",
    functionDeclaration: `async function () {
      const runner = this.find((r) => r.evaluatedModules?.idToModuleMap.size > 0);
      const mod = await runner.import("/app/__stack_probe__.ts");
      try { mod.explode(); } catch (error) { return String(error.stack).split("\\n").slice(0, 3).join("\\n"); }
    }`
  });
  await cdp("Runtime.releaseObjectGroup", { objectGroup: "probe" });
  console.log(out.result.value ?? JSON.stringify(out));
  ws.close();
} finally {
  rmSync(file, { force: true });
}
