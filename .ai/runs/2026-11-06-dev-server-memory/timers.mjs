// Lists the live Node timers of a running process by duration, with the first
// lines of each callback, to find which code schedules the long-lived ones.
//   node timers.mjs <inspector-port> [min-ms]

const [port, min = "60000"] = process.argv.slice(2);
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
  expression: "(() => { const t = setTimeout(() => {}, 0); clearTimeout(t); return Object.getPrototypeOf(t); })()",
  objectGroup: "timers"
});
const all = await cdp("Runtime.queryObjects", { prototypeObjectId: proto.result.objectId, objectGroup: "timers" });
const out = await cdp("Runtime.callFunctionOn", {
  objectId: all.objects.objectId,
  returnByValue: true,
  objectGroup: "timers",
  functionDeclaration: `function () {
    const groups = new Map();
    for (const t of this) {
      if (t._destroyed || !(t._idleTimeout >= ${Number(min)})) continue;
      const fn = t._onTimeout;
      const src = String(fn).replace(/\\s+/g, " ").slice(0, 160);
      const key = t._idleTimeout + " " + (fn?.name || "(anonymous)") + " :: " + src;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    return [...groups].sort((a, b) => b[1] - a[1]).slice(0, 15);
  }`
});
await cdp("Runtime.releaseObjectGroup", { objectGroup: "timers" });
for (const [key, count] of out.result.value ?? []) console.log(String(count).padStart(6), key);
ws.close();
