// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { join } from "pathe";

// A stack whose apps nobody is using still holds ~1 GB. The ERP and MES dev
// servers report each request by touching `activity` (the `stackActivity` Vite
// plugin); `crbn up` stops the containers after a quiet spell and leaves an
// `asleep` marker. The plugin holds the next request while the marker exists,
// and its touch is what tells this watcher to start the containers again.
// The dev servers keep running at first: they are what receives the request
// that wakes the stack, and the wake costs seconds.
//
// They hold more memory than the containers, though (about 1.1 GB each
// against 0.9 GB for the stack), so after a much longer quiet spell `crbn up`
// stops them as well and listens on their ports itself (`startWaker`). That
// wake is slower: the dev servers boot from cold.
//
// Keyed by slug, not worktree, so a `--borrow`ing worktree reports to the
// stack it is actually using.
export function stackStateDir(slug: string): string {
  return join(homedir(), ".carbon", "stacks", slug);
}

export const activityFile = (dir: string) => join(dir, "activity");
export const asleepFile = (dir: string) => join(dir, "asleep");

export type StackState = "awake" | "asleep" | "deep";
export type Step = "sleep" | "deepen" | "wake";

// Exported for tests. `since` is when the current state began: a request held
// during the stop touches `activity` after it, and that is the wake signal.
export function nextStep(
  state: StackState,
  now: number,
  lastActivity: number,
  since: number,
  idleMs: number,
  // 0: never stop the dev servers.
  deepMs = 0
): Step | null {
  if (state === "awake") return now - lastActivity >= idleMs ? "sleep" : null;
  if (lastActivity > since) return "wake";
  if (state === "asleep" && deepMs > 0 && now - lastActivity >= deepMs)
    return "deepen";
  return null;
}

function mtime(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

export function watchIdle(opts: {
  dir: string;
  idleMs: number;
  deepMs?: number;
  sleep: () => Promise<void>;
  /** Stop the dev servers too; the stack is already asleep. */
  deepen?: () => Promise<void>;
  wake: (from: StackState) => Promise<void>;
  log: (line: string) => void;
}): () => Promise<void> {
  const { dir, idleMs, log } = opts;
  const deepMs = opts.deepen ? (opts.deepMs ?? 0) : 0;
  const minutes = (ms: number) => Math.round(ms / 60_000);
  mkdirSync(dir, { recursive: true });
  rmSync(asleepFile(dir), { force: true });
  writeFileSync(activityFile(dir), "");

  let state: StackState = "awake";
  let since = Date.now();
  let busy = false;
  let stopped = false;
  let inFlight: Promise<void> = Promise.resolve();

  const tick = async () => {
    if (busy || stopped) return;
    const step = nextStep(
      state,
      Date.now(),
      mtime(activityFile(dir)),
      since,
      idleMs,
      deepMs
    );
    if (!step) return;
    busy = true;
    try {
      if (step === "sleep") {
        // Marker first: a request that arrives mid-stop must be held, not
        // served against half-stopped containers.
        since = Date.now();
        writeFileSync(asleepFile(dir), String(process.pid));
        state = "asleep";
        await opts.sleep();
        log(
          `stack hibernated after ${minutes(idleMs)} min without ERP/MES traffic — the next request wakes it`
        );
      } else if (step === "deepen") {
        state = "deep";
        await opts.deepen?.();
        log(
          `dev servers stopped after ${minutes(deepMs)} min idle — the next request starts them again (slower: they boot from cold)`
        );
      } else {
        const from = state;
        const started = Date.now();
        log("request received — waking the stack");
        await opts.wake(from);
        log(`stack awake (${Math.round((Date.now() - started) / 1000)}s)`);
        state = "awake";
        since = Date.now();
        writeFileSync(activityFile(dir), "");
        rmSync(asleepFile(dir), { force: true });
      }
    } catch (err) {
      // Let held requests through to fail visibly rather than hang, and keep
      // watching: the next quiet spell or request tries again.
      log(`hibernation ${step} failed: ${(err as Error).message}`);
      state = "awake";
      since = Date.now();
      writeFileSync(activityFile(dir), "");
      rmSync(asleepFile(dir), { force: true });
    } finally {
      busy = false;
    }
  };

  // Only a tick that can start a step replaces `inFlight`: one that returns at
  // once because a step is running must not hide that step from the disposer.
  const timer = setInterval(() => {
    if (!busy) inFlight = tick();
  }, 1000);
  // Resolves once a step that was already running has finished: the caller
  // tears the stack down next, and a wake still in progress would start the
  // containers again behind it.
  return async () => {
    stopped = true;
    clearInterval(timer);
    await inFlight;
    rmSync(asleepFile(dir), { force: true });
  };
}

// The marker holds the pid of the `crbn up` that will do the waking. One that
// was killed leaves its marker behind with nobody to act on it.
export function isAsleep(slug: string): boolean {
  const marker = asleepFile(stackStateDir(slug));
  if (!existsSync(marker)) return false;
  try {
    process.kill(Number(readFileSync(marker, "utf8")), 0);
    return true;
  } catch {
    rmSync(marker, { force: true });
    return false;
  }
}

// For crbn commands that need the database: ask the watching `crbn up` to
// start the stack the same way a request does, and wait for it.
export async function wakeIfAsleep(
  slug: string,
  timeoutMs = 120_000
): Promise<boolean> {
  if (!isAsleep(slug)) return false;
  const dir = stackStateDir(slug);
  writeFileSync(activityFile(dir), "");
  const deadline = Date.now() + timeoutMs;
  while (isAsleep(slug)) {
    if (Date.now() > deadline) {
      throw new Error(
        "the stack is hibernated and did not wake — check the terminal running `crbn up`"
      );
    }
    await sleep(250);
  }
  return true;
}

// What a browser sees while the dev servers boot. The script keeps asking for
// the same URL — through the moment the port is closed between this listener
// stopping and the dev server binding it — and reloads once a response comes
// back without the waking header.
const WAKING_PAGE = `<!doctype html><meta charset="utf-8"><title>Waking…</title>
<body style="font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0;color:#666">
<p>Waking the dev stack — this page reloads when it is ready.</p>
<script>
let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    const res = await fetch(location.href, { cache: "no-store" });
    if (!res.headers.get("x-crbn-waking")) location.reload();
  } catch {}
  busy = false;
}, 1500);
</script>`;

// Stands in for a stopped dev server on its port. A request is the signal to
// wake; it cannot be handed to the dev server (which needs this very port), so
// a browser gets a page that waits and reloads, and anything else a 503.
// Not traffic: Inngest's poll, and the Vite client of an open tab probing for
// its server over a WebSocket — answering those would wake the stack the
// moment it went to sleep.
export function startWaker(port: number, onWake: () => void) {
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/api/inngest")) {
      res.writeHead(503).end();
      return;
    }
    onWake();
    const html = req.headers.accept?.includes("text/html");
    res.writeHead(503, {
      "content-type": html ? "text/html; charset=utf-8" : "application/json",
      "cache-control": "no-store",
      "retry-after": "5",
      "x-crbn-waking": "1"
    });
    res.end(html ? WAKING_PAGE : '{"error":"dev stack is waking"}');
  });
  server.on("upgrade", (_req, socket) => socket.destroy());
  // The dev server's process tree can hold the port for a moment after its
  // parent has exited; keep trying until it lets go.
  let stopped = false;
  let retry: NodeJS.Timeout | undefined;
  server.on("error", () => {
    if (stopped) return;
    retry = setTimeout(() => {
      if (!stopped) server.listen(port, "127.0.0.1");
    }, 250);
  });
  server.listen(port, "127.0.0.1");
  return () =>
    new Promise<void>((resolve) => {
      // A retry left pending would bind the port after the stop and keep the
      // respawned dev server off it.
      stopped = true;
      clearTimeout(retry);
      server.closeAllConnections();
      if (server.listening) server.close(() => resolve());
      else resolve();
    });
}
