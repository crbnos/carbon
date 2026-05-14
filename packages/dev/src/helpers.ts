import { existsSync, statSync } from "node:fs";
import net from "node:net";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";

// ---------------------------------------------------------------------------
// TCP readiness probes
// ---------------------------------------------------------------------------

/** Resolve true when host:port accepts a connection within `timeoutMs`. */
export function tryConnect(
  host: string,
  port: number,
  timeoutMs = 2000
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(timeoutMs, () => done(false));
  });
}

/** Poll `tryConnect` until it succeeds or `timeoutMs` elapses. */
export async function waitForPort(
  port: number,
  timeoutMs: number,
  host = "127.0.0.1"
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await tryConnect(host, port)) return;
    await sleep(500);
  }
  throw new Error(`timed out waiting for tcp:${port} after ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Streaming line reader
// ---------------------------------------------------------------------------

/**
 * Invoke `onLine` once per line from `stream`. Backed by node's native
 * `readline.createInterface`, which buffers in C++ and avoids the per-chunk
 * `buf += chunk.toString(); split('\n')` allocations we used to do by hand.
 */
export function readLines(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void
): void {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  rl.on("line", onLine);
}

// ---------------------------------------------------------------------------
// File mtime compare
// ---------------------------------------------------------------------------

/**
 * True when file `a` is at least as recently modified as `b`. False if either
 * is missing. Used to gate "is X already in sync with Y" decisions.
 */
export function isAtLeastAsNew(a: string, b: string): boolean {
  if (!existsSync(a) || !existsSync(b)) return false;
  try {
    return statSync(a).mtimeMs >= statSync(b).mtimeMs;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Env var coercion
// ---------------------------------------------------------------------------

/** Read `process.env[name]` as a number. Throws a clear error if missing or NaN. */
export function requireNumberEnv(name: string): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    throw new Error(`env var ${name} is missing`);
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`env var ${name} is not a number (got "${raw}")`);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Shutdown signal helper
// ---------------------------------------------------------------------------

const SHUTDOWN_SIGNALS = [
  "SIGINT",
  "SIGTERM",
  "SIGHUP",
  "SIGBREAK"
] as const satisfies readonly NodeJS.Signals[];

/**
 * Register a handler for SIGINT/SIGTERM/SIGHUP/SIGBREAK. Returns a cleanup
 * function that unregisters them all — pair with try/finally.
 */
export function onShutdown(
  handler: (signal: NodeJS.Signals) => void
): () => void {
  for (const s of SHUTDOWN_SIGNALS) process.on(s, handler);
  return () => {
    for (const s of SHUTDOWN_SIGNALS) process.off(s, handler);
  };
}
