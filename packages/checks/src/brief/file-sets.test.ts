// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { CHECKS } from "../checks";
import { repoRoot } from "../sources/migrations";
import { FILE_SETS, type FileCheck, type FileSet } from "./file-sets";

const root = repoRoot();
const MIGRATIONS_DIR = "packages/database/supabase/migrations";
const set = (name: FileSet["name"]) => {
  const found = FILE_SETS.find((s) => s.name === name);
  if (!found) throw new Error(`No file set ${name}`);
  return found;
};

describe("FILE_SETS matches the loader of each set", () => {
  it.each(FILE_SETS.map((s) => [s.name, s] as const))(
    "%s includes every file its loader returns",
    (name, fileSet) => {
      const files = fileSet
        .loader(root)
        .map((f) =>
          name === "migrations" ? `${MIGRATIONS_DIR}/${f.file}` : f.file
        );
      expect(files.length).toBeGreaterThan(0);
      expect(files.filter((file) => !fileSet.includes(file))).toEqual([]);
    }
  );
});

describe("FILE_SETS excludes files outside each set", () => {
  const outside: [FileSet["name"], string][] = [
    ["migrations", "packages/database/supabase/migrations/nested/a.sql"],
    ["migrations", "packages/database/src/a.sql"],
    ["server", "apps/erp/app/modules/sales/ui/Card.tsx"],
    ["server", "packages/jobs/src/a.test.ts"],
    ["typescript", "apps/erp/app/routes/x+/a.test.tsx"],
    ["typescript", "packages/ee/node_modules/x/a.ts"],
    ["request-handling", "packages/react/src/Button.tsx"],
    ["routes", "apps/erp/app/modules/sales/sales.server.ts"],
    ["untimed-fetch", "packages/react/src/Button.tsx"],
    ["license", "docs/README.md"],
    ["tests", "packages/checks/src/run.test.ts"],
    ["tests", "apps/erp/app/modules/sales/sales.service.ts"]
  ];

  it.each(outside)("%s does not include %s", (name, path) => {
    expect(set(name).includes(path)).toBe(false);
  });
});

it("brief runs every file check except the ones one file cannot show", () => {
  const inSets = new Set(
    FILE_SETS.flatMap((s) => s.checks()).map((check) => check.id)
  );
  const fileChecks = CHECKS.filter(
    (check): check is FileCheck =>
      "scan" in check && typeof check.scan === "function"
  );
  // An edge function is checked as its whole folder joined into one file.
  expect(
    fileChecks
      .map((check) => check.id)
      .filter((id) => !inSets.has(id))
      .sort()
  ).toEqual(["edge-function-authorizes-caller"]);
});
