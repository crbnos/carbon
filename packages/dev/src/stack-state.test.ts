// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { afterEach, beforeEach, expect, it } from "vitest";
import { bootingFile, isBootingIn } from "../stack-state.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stack-state-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it("holds requests while the booting crbn up is alive", () => {
  writeFileSync(bootingFile(dir), String(process.pid));
  expect(isBootingIn(dir)).toBe(true);
});

// Above Linux's pid_max ceiling (2^22) and macOS's 99999: never a process.
const NO_SUCH_PID = 2 ** 22 + 1;

it.each([String(NO_SUCH_PID), "", "0", "-1", "not a pid"])(
  "drops a booting marker holding %j, which names no live crbn up",
  (content) => {
    writeFileSync(bootingFile(dir), content);
    expect(isBootingIn(dir)).toBe(false);
    expect(existsSync(bootingFile(dir))).toBe(false);
  }
);
