// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { journalStatusFilter } from "./journal-status-filter";

describe("journal-status-filter", () => {
  it("flags a not-Draft journal filter in a new migration", () => {
    const sql = `SELECT SUM(jl."amount")
FROM "journalLine" jl
JOIN "journal" j ON j."id" = jl."journalId"
WHERE j."status" <> 'Draft';`;
    const violations = journalStatusFilter.scan(
      "20261010000000_new-reader.sql",
      sql
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(4);
    expect(violations[0]?.message).toContain("GL_JOURNAL_STATUSES");
  });

  it("skips a migration older than the GL readers migration", () => {
    const sql = `SELECT * FROM "journal" j WHERE j."status" <> 'Draft';`;
    expect(
      journalStatusFilter.scan("20260101000000_old-reader.sql", sql)
    ).toHaveLength(0);
  });

  it("skips a SQL comment that describes the old filter", () => {
    const sql = `-- Each of these read \`status <> 'Draft'\`.
SELECT * FROM "journal";`;
    expect(
      journalStatusFilter.scan("20261010000000_new-reader.sql", sql)
    ).toHaveLength(0);
  });

  it("flags a not-Draft filter in a TS file that reads journal", () => {
    const ts = `const { data } = await client
  .from("journal")
  .select("id")
  .neq("status", "Draft");`;
    const violations = journalStatusFilter.scan("a.ts", ts);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(4);
  });

  it("flags a Kysely not-Draft filter in a TS file that reads journal", () => {
    const ts = `await db.selectFrom("journal").where("status", "<>", "Draft");`;
    expect(journalStatusFilter.scan("a.ts", ts)).toHaveLength(1);
  });

  it("skips a TS file that does not read journal", () => {
    const ts = `await client.from("salesOrder").select("id").neq("status", "Draft");`;
    expect(journalStatusFilter.scan("a.ts", ts)).toHaveLength(0);
  });
});
