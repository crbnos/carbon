// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { findIgnoredColumnDrift } from "./event-ignored-columns";

const auditConfig = {
  file: "audit.config.ts",
  contents: `export const auditConfig = {
  skipFields: ["updatedAt", "updatedBy", "embedding"],
  retentionDays: 30
} as const;`
};

const fn = (name: string, columns: string | null) => ({
  file: `${name}.sql`,
  contents: `CREATE OR REPLACE FUNCTION public.${name}() RETURNS trigger AS $$
DECLARE
${columns === null ? "" : `  ignored_columns CONSTANT TEXT[] := ARRAY[${columns}];\n`}BEGIN
END;
$$;`
});

const drift = (...functions: ReturnType<typeof fn>[]) =>
  findIgnoredColumnDrift(functions, auditConfig).map((v) => v.file);

describe("findIgnoredColumnDrift", () => {
  it("accepts the same columns in any order, and functions without the list", () => {
    expect(
      drift(
        fn("log_table_changes", "'embedding', 'updatedAt', 'updatedBy'"),
        fn("get_audit_log", null)
      )
    ).toEqual([]);
  });

  it.each([
    ["an extra column", "'updatedAt', 'updatedBy', 'embedding', 'loadedAt'"],
    ["a missing column", "'updatedAt', 'updatedBy'"]
  ])("flags a trigger with %s", (_, columns) => {
    expect(drift(fn("dispatch_event_batch", columns))).toEqual([
      "dispatch_event_batch.sql"
    ]);
  });
});
