// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquire,
  isLockStale,
  isSingleCommand,
  type LockOwner,
  lockDir
} from "./heavy-lock.js";

const owner = (over: Partial<LockOwner> = {}): LockOwner => ({
  pid: 100,
  cwd: "/repo",
  command: "tsc --noEmit",
  startedAt: 0,
  ...over
});

describe("isLockStale", () => {
  const alive = (pids: number[]) => (pid: number) => pids.includes(pid);

  it("keeps a lock whose wrapper is alive", () => {
    expect(isLockStale(owner(), 60_000, alive([100]))).toBe(false);
  });

  it("keeps a lock whose command outlived a killed wrapper", () => {
    expect(isLockStale(owner({ childPid: 200 }), 60_000, alive([200]))).toBe(
      false
    );
  });

  it("clears a lock when neither process runs", () => {
    expect(isLockStale(owner({ childPid: 200 }), 60_000, alive([]))).toBe(true);
  });

  it("waits on an ownerless lock until its holder had time to write the owner", () => {
    expect(isLockStale(null, 2_000, alive([]))).toBe(false);
    expect(isLockStale(null, 11_000, alive([]))).toBe(true);
  });
});

describe("isSingleCommand", () => {
  it("accepts one command with arguments", () => {
    expect(isSingleCommand("tsx scripts/generate-mcp.ts --flag")).toBe(true);
  });

  it.each(["a && b", "a || b", "a | b", "a; b", "a &"])(
    "rejects the chain %s, whose stop signal would reach only the shell",
    (command) => expect(isSingleCommand(command)).toBe(false)
  );
});

describe("acquire", () => {
  let home: string;
  let savedHome: string | undefined;

  beforeEach(() => {
    savedHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), "heavy-lock-"));
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = savedHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("takes over a lock left by a process that was killed", async () => {
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
    mkdirSync(lockDir(), { recursive: true });
    writeFileSync(
      join(lockDir(), "owner.json"),
      JSON.stringify(owner({ pid: deadPid }))
    );

    const release = await acquire(owner({ pid: process.pid }), () => {});
    expect(release).not.toBeNull();
    release?.();
    expect(existsSync(lockDir())).toBe(false);
  });

  it("makes a second caller wait until the first releases", async () => {
    const releaseFirst = await acquire(owner({ pid: process.pid }), () => {});
    let secondHasIt = false;
    const second = acquire(
      owner({ pid: process.pid, startedAt: 1 }),
      () => {}
    ).then((release) => {
      secondHasIt = true;
      return release;
    });
    await new Promise((r) => setTimeout(r, 1_200));
    expect(secondHasIt).toBe(false);

    releaseFirst?.();
    (await second)?.();
    expect(secondHasIt).toBe(true);
  });

  it("stops the command when the wrapper is stopped, then frees the lock", async () => {
    const script = fileURLToPath(new URL("./heavy-lock.ts", import.meta.url));
    const wrapper = spawn(process.execPath, [script, "sleep", "30"], {
      env: { ...process.env, HOME: home },
      stdio: "ignore"
    });
    let childPid: number | undefined;
    while (childPid === undefined) {
      await new Promise((r) => setTimeout(r, 50));
      try {
        childPid = JSON.parse(
          readFileSync(join(lockDir(), "owner.json"), "utf8")
        ).childPid;
      } catch {}
    }
    const exited = new Promise((r) => wrapper.on("exit", r));
    wrapper.kill("SIGTERM");
    await exited;

    expect(() => process.kill(childPid as number, 0)).toThrow();
    expect(existsSync(lockDir())).toBe(false);
  });
});
