// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { LIST_TABLES, loadListSources } from "./list-tables";

describe("loadListSources", () => {
  it("reads each module's service file and the list tables that exist", () => {
    const root = mkdtempSync(join(tmpdir(), "lists-"));
    const write = (path: string, contents: string) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), contents);
    };
    write("apps/erp/app/modules/items/items.service.ts", "// items");
    mkdirSync(join(root, "apps/erp/app/modules/shared"));
    const parts = LIST_TABLES.PARTS_LIST_COLUMNS ?? "";
    write(parts, "// parts");
    expect(loadListSources(root)).toEqual({
      services: [
        {
          file: "apps/erp/app/modules/items/items.service.ts",
          contents: "// items"
        }
      ],
      tables: [{ file: parts, contents: "// parts" }]
    });
  });
});
