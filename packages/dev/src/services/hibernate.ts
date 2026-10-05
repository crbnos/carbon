// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "pathe";

// A stack whose apps nobody is using still holds ~1 GB. The ERP and MES dev
// servers report each request by touching `activity` (the `stackActivity` Vite
// plugin); `crbn up` stops the containers after a quiet spell and leaves an
// `asleep` marker. The plugin holds the next request while the marker exists,
// and its touch is what tells this watcher to start the containers again.
// The dev servers themselves keep running: they are what receives the request
// that wakes the stack.
//
// Keyed by slug, not worktree, so a `--borrow`ing worktree reports to the
// stack it is actually using.
export function stackStateDir(slug: string): string {
  return join(homedir(), ".carbon", "stacks", slug);
}

export const activityFile = (dir: string) => join(dir, "activity");
export const asleepFile = (dir: string) => join(dir, "asleep");

export type StackState = "awake" | "asleep";

// Exported for tests. `since` is when the current state began: a request held
// during the stop touches `activity` after it, and that is the wake signal.
export function nextStep(
  state: StackState,
  now: number,
  lastActivity: number,
  since: number,
  idleMs: number
): "sleep" | "wake" | null {
  if (state === "awake") return now - lastActivity >= idleMs ? "sleep" : null;
  return lastActivity > since ? "wake" : null;
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
  sleep: () => Promise<void>;
  wake: () => Promise<void>;
  log: (line: string) => void;
}): () => void {
  const { dir, idleMs, log } = opts;
  mkdirSync(dir, { recursive: true });
  rmSync(asleepFile(dir), { force: true });
  writeFileSync(activityFile(dir), "");

  let state: StackState = "awake";
  let since = Date.now();
  let busy = false;

  const tick = async () => {
    if (busy) return;
    const step = nextStep(
      state,
      Date.now(),
      mtime(activityFile(dir)),
      since,
      idleMs
    );
    if (!step) return;
    busy = true;
    try {
      if (step === "sleep") {
        // Marker first: a request that arrives mid-stop must be held, not
        // served against half-stopped containers.
        since = Date.now();
        writeFileSync(asleepFile(dir), "");
        state = "asleep";
        await opts.sleep();
        log(
          `stack hibernated after ${Math.round(idleMs / 60_000)} min without ERP/MES traffic — the next request wakes it`
        );
      } else {
        const started = Date.now();
        log("request received — waking the stack");
        await opts.wake();
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

  const timer = setInterval(() => void tick(), 1000);
  return () => {
    clearInterval(timer);
    rmSync(asleepFile(dir), { force: true });
  };
}
