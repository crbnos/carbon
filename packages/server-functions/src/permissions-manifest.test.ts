// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ServerFn } from "./define-server-fn";
import { serverFnNames } from "./invoke";

/**
 * Every server function's declared `permissions`, pinned. A change here is a
 * change to who may run the function: review the diff, then update the
 * snapshot with `vitest -u`.
 */
describe("server function permissions", () => {
  it("match the reviewed manifest", async () => {
    const dirs = readdirSync(__dirname).filter((entry) =>
      existsSync(join(__dirname, entry, "index.ts"))
    );
    // Every function is reachable through `serverFns`, under its own name.
    expect([...serverFnNames].sort()).toEqual(dirs.sort());

    const manifest: Record<string, unknown> = {};
    for (const dir of dirs) {
      const mod = (await import(`./${dir}/index.ts`)) as {
        default: ServerFn<never, unknown>;
      };
      expect(mod.default.serverFnName).toBe(dir);
      manifest[dir] = mod.default.permissions;
    }
    expect(manifest).toMatchSnapshot();
  }, 60_000);
});
