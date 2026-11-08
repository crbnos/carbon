// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from "node:http";
import {
  activityFile,
  asleepFile,
  isAsleepIn,
  WAKE_TIMEOUT_MS
} from "../../stack-state.js";
import { httpResponds, waitUntil } from "../helpers.js";
import { paths } from "../paths.js";
import { setAlias } from "./portless.js";

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
// The files are stack-state.js's, which the Vite plugin reads too.

type StackState = "awake" | "asleep" | "deep";
type Step = "sleep" | "deepen" | "wake";

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

function watchIdle(opts: {
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

/** The default quiet spells, in minutes, before the containers and then the
 *  dev servers stop (CRBN_IDLE_MINUTES, CRBN_APPS_IDLE_MINUTES). */
export const IDLE_MINUTES = 30;
export const APPS_IDLE_MINUTES = 120;

export const isAsleep = (slug: string) => isAsleepIn(paths.stackDir(slug));

// For crbn commands that need the database: ask the watching `crbn up` to
// start the stack the same way a request does, and wait for it.
export async function wakeIfAsleep(slug: string): Promise<boolean> {
  if (!isAsleep(slug)) return false;
  writeFileSync(activityFile(paths.stackDir(slug)), "");
  const awake = async () => !isAsleep(slug);
  if (await waitUntil(awake, { timeoutMs: WAKE_TIMEOUT_MS, intervalMs: 250 })) {
    return true;
  }
  throw new Error(
    "the stack is hibernated and did not wake — check the terminal running `crbn up`"
  );
}

// What a browser sees while the dev servers boot. The script keeps asking for
// the same URL — through the moment the port is closed between this listener
// stopping and the dev server binding it — and reloads once a response comes
// back without the waking header.
const holdingPage = (
  title: string,
  text: string
) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0;color:#666">
<p>${text}</p>
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

const WAKING_PAGE = holdingPage(
  "Waking…",
  "Waking the dev stack — this page reloads when it is ready."
);
const BOOTING_PAGE = holdingPage(
  "Starting…",
  "Starting the dev server — the first load bundles the app and can take a minute. This page reloads when it is ready."
);

// Answers like a held app: a page that polls and reloads for a browser, a 503
// for anything else. The `x-crbn-waking` header is what the page waits to lose.
function holdingResponse(
  req: IncomingMessage,
  res: ServerResponse,
  page: string,
  state: "waking" | "starting"
) {
  const html = req.headers.accept?.includes("text/html");
  res.writeHead(503, {
    "content-type": html ? "text/html; charset=utf-8" : "application/json",
    "cache-control": "no-store",
    "retry-after": "5",
    "x-crbn-waking": "1"
  });
  res.end(html ? page : `{"error":"dev stack is ${state}"}`);
}

// Stands in for a stopped dev server on its port. A request is the signal to
// wake; it cannot be handed to the dev server (which needs this very port), so
// a browser gets a page that waits and reloads, and anything else a 503.
// Not traffic: Inngest's poll, and the Vite client of an open tab probing for
// its server over a WebSocket — answering those would wake the stack the
// moment it went to sleep.
function startWaker(port: number, onWake: () => void) {
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/api/inngest")) {
      res.writeHead(503).end();
      return;
    }
    onWake();
    holdingResponse(req, res, WAKING_PAGE, "waking");
  });
  server.on("upgrade", (_req, socket) => socket.destroy());
  // The dev server's process tree can hold the port for a moment after its
  // parent has exited; keep trying until it lets go.
  let stopped = false;
  let retry: NodeJS.Timeout | undefined;
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (stopped || err.code !== "EADDRINUSE") return;
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

// Stands in for the dev servers while they boot. It cannot take their ports
// (they bind those), so it listens on a free one and the portless aliases
// point here until each app answers (`holdRoutes`).
function startBootPage(): Promise<{
  port: number;
  stop: () => Promise<void>;
}> {
  const server = createServer((req, res) =>
    holdingResponse(req, res, BOOTING_PAGE, "starting")
  );
  server.on("upgrade", (_req, socket) => socket.destroy());
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        port,
        stop: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          })
      });
    });
  });
}

export type Hold = { released: Promise<void>; stop: () => Promise<void> };

/**
 * Points each alias at a "starting" page while its dev server boots, and back
 * at the dev server once it answers a request — the request that also makes
 * Vite bundle the app. Without it the URL shows portless's 502 until then.
 * `released` resolves once every alias points back; `stop` gives up the hold
 * and leaves the aliases to the teardown, which removes them.
 */
export async function holdRoutes(
  targets: { alias: string; port: number }[]
): Promise<Hold> {
  if (targets.length === 0) {
    return { released: Promise.resolve(), stop: () => Promise.resolve() };
  }
  const page = await startBootPage();
  for (const t of targets) await setAlias(t.alias, page.port);
  let stopped = false;
  const released = Promise.all(
    targets.map(async (t) => {
      await waitUntil(() => httpResponds(t.port), {
        timeoutMs: 600_000,
        intervalMs: 1000,
        stopped: () => stopped
      });
      // Past the deadline too: portless's 502 beats a page that never reloads.
      if (!stopped) await setAlias(t.alias, t.port);
    })
  ).then(() => page.stop());
  return {
    released,
    stop: async () => {
      stopped = true;
      await released;
    }
  };
}

/**
 * Hibernates an idle stack (see the top of this file): stops its containers
 * after `idleMs` without traffic and, after `deepMs`, its dev servers, whose
 * ports it then answers itself. Resolves to the stop, which waits for a step
 * in progress: a wake still running would start the containers again behind
 * the teardown that follows.
 */
export function superviseIdle(opts: {
  stateDir: string;
  idleMs: number;
  deepMs: number;
  appPorts: number[];
  stopContainers: () => Promise<void>;
  startContainers: () => Promise<void>;
  /** Stop the dev servers; resolves once they exited. */
  parkApps: () => Promise<void>;
  resumeApps: () => void;
  /** Hold the app URLs while the dev servers boot (portless only). */
  holdUrls?: () => Promise<Hold>;
  log: (line: string) => void;
}): () => Promise<void> {
  let wakers: Array<() => Promise<void>> = [];
  let hold: Hold | undefined;
  let stopping = false;
  const stopWakers = async () => {
    await Promise.all(wakers.map((stop) => stop()));
    wakers = [];
  };
  const stopWatching = watchIdle({
    dir: opts.stateDir,
    idleMs: opts.idleMs,
    deepMs: opts.deepMs,
    sleep: opts.stopContainers,
    deepen: async () => {
      await opts.parkApps();
      wakers = opts.appPorts.map((port) =>
        startWaker(port, () => writeFileSync(activityFile(opts.stateDir), ""))
      );
    },
    wake: async (from) => {
      try {
        await opts.startContainers();
      } finally {
        // Whatever happened to the containers, never leave the apps parked
        // behind a listener that can no longer wake them.
        if (from === "deep") {
          hold = await opts.holdUrls?.();
          await stopWakers();
          opts.resumeApps();
          // Awake means the dev servers answer again: until then the idle
          // clock must not run.
          await (hold?.released ??
            waitUntil(
              async () =>
                (await Promise.all(opts.appPorts.map(httpResponds))).every(
                  Boolean
                ),
              { timeoutMs: 180_000, intervalMs: 500, stopped: () => stopping }
            ));
          hold = undefined;
        }
      }
    },
    log: opts.log
  });
  return async () => {
    stopping = true;
    await hold?.stop();
    await stopWatching();
    await stopWakers();
  };
}
