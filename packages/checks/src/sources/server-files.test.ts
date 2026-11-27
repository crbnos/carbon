// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadServerFiles } from "./server-files";

/** A temp checkout holding the given repo-relative files. */
function checkout(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "server-files-"));
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), contents);
  }
  return root;
}

describe("loadServerFiles", () => {
  it("returns nothing for a checkout that has none of the server folders", () => {
    expect(loadServerFiles(checkout({ "README.md": "" }))).toEqual([]);
  });

  it("walks nested folders, skipping node_modules, dot folders and tests", () => {
    const root = checkout({
      "packages/jobs/src/a.ts": "a",
      "packages/jobs/src/tasks/deep/b.ts": "b",
      "packages/jobs/src/tasks/b.test.ts": "",
      "packages/jobs/src/node_modules/dep/index.ts": "",
      "packages/jobs/src/.cache/c.ts": "",
      "packages/jobs/src/notes.md": ""
    });
    expect(loadServerFiles(root)).toEqual([
      { file: "packages/jobs/src/a.ts", contents: "a" },
      { file: "packages/jobs/src/tasks/deep/b.ts", contents: "b" }
    ]);
  });

  it("takes only the service and server files of an ERP module", () => {
    const root = checkout({
      "apps/erp/app/modules/sales/sales.service.ts": "",
      "apps/erp/app/modules/sales/sales.server.ts": "",
      "apps/erp/app/modules/sales/sales.models.ts": "",
      "apps/erp/app/modules/sales/ui/columns.ts": ""
    });
    expect(loadServerFiles(root).map((f) => f.file)).toEqual([
      "apps/erp/app/modules/sales/sales.server.ts",
      "apps/erp/app/modules/sales/sales.service.ts"
    ]);
  });
});
