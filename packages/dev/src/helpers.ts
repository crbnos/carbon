// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, statSync } from "node:fs";
import net from "node:net";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";

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

/**
 * Polls `probe` until it is true, `timeoutMs` passes, or `stopped()` turns
 * true. Resolves whether the probe succeeded.
 */
export async function waitUntil(
  probe: () => Promise<boolean>,
  opts: { timeoutMs: number; intervalMs: number; stopped?: () => boolean }
): Promise<boolean> {
  const deadline = Date.now() + opts.timeoutMs;
  while (!opts.stopped?.() && Date.now() < deadline) {
    if (await probe()) return true;
    await sleep(opts.intervalMs);
  }
  return false;
}

/** Poll `tryConnect` until it succeeds or `timeoutMs` elapses. */
export async function waitForPort(
  port: number,
  timeoutMs: number,
  host = "127.0.0.1"
): Promise<void> {
  const open = () => tryConnect(host, port);
  if (!(await waitUntil(open, { timeoutMs, intervalMs: 500 }))) {
    throw new Error(`timed out waiting for tcp:${port} after ${timeoutMs}ms`);
  }
}

/** A dev server on this port answers HTTP. Any status counts, a redirect
 *  too (following one would leave 127.0.0.1 for the app's portless URL) —
 *  but not crbn's own stand-in, which marks its answers `x-crbn-waking`. */
export async function httpResponds(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      redirect: "manual",
      signal: AbortSignal.timeout(4000)
    });
    return !res.headers.has("x-crbn-waking");
  } catch {
    return false;
  }
}

/**
 * Invoke `onLine` once per line from `stream`.
 *
 * Returns a disposer — call it (e.g. on child exit) to close the interface and
 * drop its listeners. Long-lived, restarting children (the app supervisor)
 * would otherwise leak a readline interface per respawn. A stream `error`
 * (child killed mid-read) closes the interface instead of going uncaught.
 */
export function readLines(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void
): () => void {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  rl.on("line", onLine);
  const close = () => rl.close();
  stream.on("error", close);
  return close;
}

// Most output Node may hold for one sink before lines are dropped.
const MAX_PENDING_OUTPUT = 4 * 1024 * 1024;

const lineWriters = new WeakMap<
  NodeJS.WritableStream,
  (text: string) => void
>();

/**
 * Writes the apps' log lines to `sink` without letting them pile up. A pipe
 * (Conductor, an agent, `crbn up | tee`) is written asynchronously on macOS,
 * and a reader that falls behind left everything in crbn's memory: 200 MB of
 * logs into a reader stalled for 2 s queued 207 MB. Past `max` bytes queued, a
 * line is dropped and counted; the count is reported once the sink drains.
 * Waiting for the sink instead would stall the dev servers behind it. A
 * terminal is written synchronously, so nothing queues there.
 *
 * One writer per sink, shared by every app writing to it.
 */
export function lineWriter(
  sink: NodeJS.WritableStream & { writableLength: number },
  max = MAX_PENDING_OUTPUT
): (text: string) => void {
  const existing = lineWriters.get(sink);
  if (existing) return existing;
  let dropped = 0;
  sink.on("drain", () => {
    if (dropped === 0) return;
    const count = dropped;
    dropped = 0;
    sink.write(
      `crbn | ${count} log line${count === 1 ? "" : "s"} dropped: the output fell behind\n`
    );
  });
  const write = (text: string) => {
    if (sink.writableLength > max) {
      dropped++;
      return;
    }
    sink.write(text);
  };
  lineWriters.set(sink, write);
  return write;
}

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

/** Signals a detached child's whole process group, else the child alone.
 *  Best effort: it may have exited already. */
export function killGroup(
  child: { pid?: number; kill: (signal: NodeJS.Signals) => boolean },
  signal: NodeJS.Signals = "SIGTERM"
): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // gone
    }
  }
}
