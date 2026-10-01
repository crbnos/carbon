// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadModules } from "./modules";

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
});
