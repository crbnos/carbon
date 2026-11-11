// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// One heavy check at a time per machine, across every worktree. The ERP
// typecheck peaks near 10 GB and `generate:mcp` near 5 GB; parallel agents
// running them together exhaust the machine. Node builtins only: scripts run
// this file with plain `node` (type stripping), before or without an install.
//
// Usage: node packages/dev/src/heavy-lock.ts <command...>
// One command, never a chain: the shell runs a lone command in its own
// process, so a stop signal reaches it. In a chain it reaches only the shell.

import { spawn } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { constants, homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface LockOwner {
  pid: number;
  childPid?: number;
  cwd: string;
  command: string;
  startedAt: number;
}

const POLL_MS = 500;
const NOTICE_EVERY_MS = 30_000;
/** A lock directory with no owner file yet is a holder between mkdir and write. */
const OWNERLESS_GRACE_MS = 10_000;

export const lockDir = () => join(homedir(), ".carbon", "heavy-check.lock");
const ownerFile = () => join(lockDir(), "owner.json");

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists but belongs to another user.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** A chain (`a && b`, `a | b`, `a; b`) would put a shell between us and the work. */
export function isSingleCommand(command: string): boolean {
  return !/[;&|]/.test(command);
}

/** A lock is stale when neither the wrapper nor the command it ran is alive. */
export function isLockStale(
  owner: LockOwner | null,
  lockAgeMs: number,
  isAlive: (pid: number) => boolean
): boolean {
  if (!owner) return lockAgeMs > OWNERLESS_GRACE_MS;
  if (isAlive(owner.pid)) return false;
  return owner.childPid === undefined || !isAlive(owner.childPid);
}

function readOwner(): LockOwner | null {
  try {
    return JSON.parse(readFileSync(ownerFile(), "utf8")) as LockOwner;
  } catch {
    return null;
  }
}

function writeOwner(owner: LockOwner) {
  writeFileSync(ownerFile(), JSON.stringify(owner));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function describeOwner(owner: LockOwner | null, now: number): string {
  if (!owner) return "another heavy check";
  const secs = Math.round((now - owner.startedAt) / 1000);
  return `"${owner.command}" in ${owner.cwd} (pid ${owner.pid}, running ${secs}s)`;
}

/**
 * Waits for the machine-wide lock and takes it. Returns null when the lock
 * cannot be used here (no writable home directory): the caller runs unlocked.
 */
export async function acquire(
  owner: LockOwner,
  log: (line: string) => void = (l) => process.stderr.write(`${l}\n`)
): Promise<(() => void) | null> {
  try {
    mkdirSync(join(lockDir(), ".."), { recursive: true });
  } catch (err) {
    log(
      `heavy-lock: cannot use ${lockDir()} (${(err as Error).message}); running without the lock`
    );
    return null;
  }
  let lastNotice = 0;
  for (;;) {
    try {
      mkdirSync(lockDir());
      writeOwner(owner);
      return () => rmSync(lockDir(), { recursive: true, force: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    const current = readOwner();
    let ageMs = 0;
    try {
      ageMs = Date.now() - statSync(lockDir()).mtimeMs;
    } catch {
      continue; // released between the mkdir and the stat
    }
    if (isLockStale(current, ageMs, isProcessAlive)) {
      // Another waiter may have cleared it and taken it since we read it.
      const again = readOwner();
      if (
        again?.pid === current?.pid &&
        again?.startedAt === current?.startedAt
      ) {
        log(
          `heavy-lock: clearing a lock left by a process that no longer runs (${describeOwner(current, Date.now())})`
        );
        rmSync(lockDir(), { recursive: true, force: true });
      }
      continue;
    }
    const now = Date.now();
    if (now - lastNotice >= NOTICE_EVERY_MS) {
      log(`heavy-lock: waiting for ${describeOwner(current, now)} to finish…`);
      lastNotice = now;
    }
    await sleep(POLL_MS);
  }
}

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

export async function runWithHeavyLock(command: string): Promise<number> {
  const owner: LockOwner = {
    pid: process.pid,
    cwd: process.cwd(),
    command,
    startedAt: Date.now()
  };
  let release: (() => void) | null = null;
  // Stopped while waiting: nothing to clean up yet.
  const onWaitSignal = (s: NodeJS.Signals) =>
    process.exit(128 + constants.signals[s]);
  for (const s of SIGNALS) process.on(s, onWaitSignal);
  release = await acquire(owner);
  for (const s of SIGNALS) process.off(s, onWaitSignal);

  const releaseOnce = () => {
    release?.();
    release = null;
  };
  process.on("exit", releaseOnce);

  const child = spawn(command, {
    shell: true,
    stdio: "inherit"
  });
  if (release && child.pid !== undefined) {
    owner.childPid = child.pid;
    writeOwner(owner);
  }
  // The child shares the terminal and gets Ctrl+C itself; forward the rest.
  for (const s of SIGNALS) process.on(s, () => child.kill(s));

  return new Promise((resolve) => {
    child.on("error", (err) => {
      process.stderr.write(`heavy-lock: ${err.message}\n`);
      releaseOnce();
      resolve(1);
    });
    child.on("exit", (code, signal) => {
      releaseOnce();
      resolve(code ?? 128 + (signal ? constants.signals[signal] : 0));
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv.slice(2).join(" ").trim();
  if (!command || !isSingleCommand(command)) {
    process.stderr.write(
      "Usage: node packages/dev/src/heavy-lock.ts <command...> (one command, no && | ; chains)\n"
    );
    process.exit(2);
  }
  runWithHeavyLock(command).then((code) => process.exit(code));
}
