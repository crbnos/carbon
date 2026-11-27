// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadModuleServerFiles,
  loadModules,
  wrappedBuildingBlocks
} from "./modules";

describe("loadModules", () => {
  it("returns one entry per subdirectory with its top-level names", () => {
    const root = mkdtempSync(join(tmpdir(), "mods-"));
    mkdirSync(join(root, "sales"));
    writeFileSync(join(root, "sales", "sales.service.ts"), "");
    mkdirSync(join(root, "sales", "ui"));
    writeFileSync(join(root, "README.md"), "");
    const mods = loadModules(root);
    expect(mods.map((m) => m.name)).toEqual(["sales"]);
    expect(mods[0]?.entries.sort()).toEqual(["sales.service.ts", "ui"]);
  });

  it("returns nothing for a folder that does not exist", () => {
    const root = mkdtempSync(join(tmpdir(), "mods-"));
    expect(loadModules(join(root, "missing"))).toEqual([]);
  });
});

describe("loadModuleServerFiles", () => {
  it("pairs a module's server file with its service file, and skips a module that lacks one", () => {
    const root = mkdtempSync(join(tmpdir(), "mods-"));
    const modules = join(root, "apps/erp/app/modules");
    mkdirSync(join(modules, "sales"), { recursive: true });
    writeFileSync(join(modules, "sales", "sales.server.ts"), "// server");
    writeFileSync(join(modules, "sales", "sales.service.ts"), "// service");
    mkdirSync(join(modules, "shared"));
    writeFileSync(join(modules, "shared", "shared.service.ts"), "");
    expect(loadModuleServerFiles(root)).toEqual([
      {
        server: {
          file: "apps/erp/app/modules/sales/sales.server.ts",
          contents: "// server"
        },
        service: {
          file: "apps/erp/app/modules/sales/sales.service.ts",
          contents: "// service"
        }
      }
    ]);
  });
});

describe("wrappedBuildingBlocks", () => {
  it("reads the wrapped building blocks off the server files", () => {
    const wrapped = wrappedBuildingBlocks([
      {
        file: "apps/erp/app/modules/sales/sales.server.ts",
        contents: `export const getCustomer = defineServiceFn({
  async run(ctx, input) {
    return unwrap(ctx, await service.getCustomer(ctx.asCaller.supabase, input.customerId));
  }
});`
      }
    ]);
    expect([...wrapped]).toEqual(["sales.getCustomer"]);
  });
});
