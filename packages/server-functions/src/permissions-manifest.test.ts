import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ServerFn } from "./define-server-fn";

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
    const manifest: Record<string, unknown> = {};
    for (const dir of dirs.sort()) {
      const mod = (await import(`./${dir}/index.ts`)) as Record<
        string,
        unknown
      >;
      for (const value of Object.values(mod)) {
        if (typeof value === "function" && "serverFnName" in value) {
          const fn = value as ServerFn<never, unknown>;
          manifest[fn.serverFnName] = fn.permissions;
        }
      }
    }
    expect(Object.keys(manifest)).toHaveLength(dirs.length);
    expect(manifest).toMatchSnapshot();
  }, 60_000);
});
