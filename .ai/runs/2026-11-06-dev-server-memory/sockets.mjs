// Lists the open TCP sockets of a process with unsent bytes, by remote end,
// to find a client that stopped reading (its writes pile up in memory).
//   node sockets.mjs <inspector-port>

const [port] = process.argv.slice(2);
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
  expression: 'process.getBuiltinModule("node:net").Socket.prototype',
  objectGroup: "sockets"
});
const all = await cdp("Runtime.queryObjects", { prototypeObjectId: proto.result.objectId, objectGroup: "sockets" });
const out = await cdp("Runtime.callFunctionOn", {
  objectId: all.objects.objectId,
  returnByValue: true,
  objectGroup: "sockets",
  functionDeclaration: `function () {
    return this.filter((s) => !s.destroyed).map((s) => ({
      local: s.localPort,
      remote: (s.remoteAddress ?? "") + ":" + (s.remotePort ?? ""),
      unsentKB: Math.round((s.writableLength ?? 0) / 1024),
      upgraded: !!s._httpMessage?.upgrade || s.listenerCount?.("data") > 0 && !s.parser,
      idleMs: s.timeout ?? null
    })).sort((a, b) => b.unsentKB - a.unsentKB).slice(0, 12);
  }`
});
await cdp("Runtime.releaseObjectGroup", { objectGroup: "sockets" });
console.table(out.result.value);
ws.close();
