// Evaluate an expression in a running Node process over its inspector.
//   node cdp.mjs <inspector-port> '<expression>'
// The expression may use `await`; the result is printed as JSON.

const [port, expression] = process.argv.slice(2);
const [target] = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok) => (ws.onopen = ok));
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id !== 1) return;
  const { result, exceptionDetails } = msg.result ?? {};
  console.log(
    exceptionDetails
      ? `error: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`
      : JSON.stringify(result.value, null, 2)
  );
  ws.close();
};
ws.send(
  JSON.stringify({
    id: 1,
    method: "Runtime.evaluate",
    params: {
      expression: `(async () => { return ${expression}; })()`,
      awaitPromise: true,
      returnByValue: true,
      includeCommandLineAPI: true
    }
  })
);
