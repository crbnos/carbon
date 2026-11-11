// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";

const script = fileURLToPath(new URL("../bin/heavy-lock", import.meta.url));
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "heavy-lock-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const run = (...args: string[]) => {
  const started = performance.now();
  const child = spawn(script, args, { env: { ...process.env, HOME: home } });
  return new Promise<{ code: number | null; ms: number }>((resolve) =>
    child.on("exit", (code) =>
      resolve({ code, ms: performance.now() - started })
    )
  );
};

// tsc replaces its process (execve), which drops every inherited fd, so the
// lock must be held by heavy-lock itself, not by the command.
it("holds the lock while a command that replaces its process runs", async () => {
  const first = run(
    process.execPath,
    "-e",
    "process.execve('/bin/sleep', ['sleep', '1.5'])"
  );
  await new Promise((r) => setTimeout(r, 300));
  const second = await run("true");
  expect(second.code).toBe(0);
  expect(second.ms).toBeGreaterThan(900);
  expect((await first).code).toBe(0);
});

it("passes the command's exit code through", async () => {
  expect((await run("sh", "-c", "exit 7")).code).toBe(7);
});
