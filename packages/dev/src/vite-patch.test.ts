// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// What patches/vite@8.3.3.patch changes. These fail when the patch stops
// applying (a regenerated patch that lost a hunk, a Vite upgrade without it).
describe("patched Vite", () => {
  const base = mkdtempSync(join(tmpdir(), "vite-patch-"));
  const root = join(base, "app");
  const file = join(base, "package", "shared.js");
  let server: ViteDevServer;
  let adds = 0;

  beforeAll(async () => {
    mkdirSync(root);
    mkdirSync(join(base, "package"));
    writeFileSync(file, "export const value = 1;\n");
    server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      server: { middlewareMode: true, ws: false }
    });
    const add = server.watcher.add.bind(server.watcher);
    server.watcher.add = (paths, ...rest) => {
      if ([paths].flat().includes(file)) adds++;
      return add(paths, ...rest);
    };
  });

  afterAll(async () => {
    await server?.close();
    rmSync(base, { recursive: true, force: true });
  });

  it("adds a file outside the root to the watcher once, however often it is transformed", async () => {
    const ssr = server.environments.ssr;
    const url = `/@fs${file}`;
    for (let i = 0; i < 3; i++) {
      await ssr.transformRequest(url);
      const mod = await ssr.moduleGraph.getModuleByUrl(url);
      if (mod) ssr.moduleGraph.invalidateModule(mod);
    }
    expect(adds).toBe(1);
  });

  it("adds a file again after the watcher reports it deleted", async () => {
    const ssr = server.environments.ssr;
    const url = `/@fs${file}`;
    const before = adds;
    server.watcher.emit("unlink", file);
    const mod = await ssr.moduleGraph.getModuleByUrl(url);
    if (mod) ssr.moduleGraph.invalidateModule(mod);
    await ssr.transformRequest(url);
    expect(adds).toBe(before + 1);
  });

  it("maps SSR stack traces itself, not through Node's source maps", () => {
    const ssr = server.environments.ssr as unknown as {
      runner: { options: { sourcemapInterceptor: unknown } };
    };
    expect(ssr.runner.options.sourcemapInterceptor).toEqual({
      retrieveFile: expect.any(Function)
    });
  });

  it("maps an SSR stack trace back to the TypeScript line", async () => {
    const thrower = join(root, "boom.ts");
    writeFileSync(
      thrower,
      'type Unused = { a: number };\n\nexport function boom(): never {\n  throw new Error("boom");\n}\n'
    );
    const ssr = server.environments.ssr as unknown as {
      runner: { import(url: string): Promise<{ boom(): never }> };
    };
    const { boom } = await ssr.runner.import("/boom.ts");
    expect(() => boom()).toThrow(
      expect.objectContaining({ stack: expect.stringContaining("boom.ts:4:") })
    );
  });
});
