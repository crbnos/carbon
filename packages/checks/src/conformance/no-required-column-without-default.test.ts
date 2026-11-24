// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noRequiredColumnWithoutDefault } from "./no-required-column-without-default";

const scan = (sql: string) => noRequiredColumnWithoutDefault.scan("m.sql", sql);

describe("no-required-column-without-default", () => {
  it("allows a new NOT NULL column that ships a DEFAULT", () => {
    expect(
      scan(
        `ALTER TABLE "item" ADD COLUMN "unitOfMeasure" TEXT NOT NULL DEFAULT 'EA';`
      )
    ).toEqual([]);
  });

  it("flags a new NOT NULL column with no DEFAULT, on the right line", () => {
    const sql = [
      `-- widen the item table`,
      ``,
      `ALTER TABLE "item" ADD COLUMN "unitOfMeasure" TEXT NOT NULL;`
    ].join("\n");

    const violations = scan(sql);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(3);
    expect(violations[0]?.snippet).toContain("ADD COLUMN");
    expect(violations[0]?.message).toContain("unrestorable");
  });

  it("allows a nullable new column", () => {
    expect(scan(`ALTER TABLE "item" ADD COLUMN "notes" TEXT;`)).toEqual([]);
  });

  it("does not let a LATER column's DEFAULT excuse an earlier one", () => {
    // The bounded span is what makes this work: without it, the DEFAULT on
    // "b" would satisfy the lookahead for "a" and the real violation would
    // pass silently.
    const violations = scan(
      `ALTER TABLE "item" ADD COLUMN "a" TEXT NOT NULL, ADD COLUMN "b" TEXT NOT NULL DEFAULT '';`
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.snippet).toContain(`"a"`);
  });

  it("ignores NOT NULL appearing outside an ADD COLUMN", () => {
    const sql = [
      `CREATE TABLE "thing" ("id" TEXT NOT NULL, "companyId" TEXT NOT NULL);`,
      `ALTER TABLE "thing" ADD CONSTRAINT "thing_check" CHECK ("id" IS NOT NULL);`
    ].join("\n");
    expect(scan(sql)).toEqual([]);
  });

  it.each([
    // From 20250115041610_backfill-release-date.sql, made NOT NULL: a backup
    // can never supply a generated column, and the `IS NOT NULL` inside the
    // expression is a predicate, not this column's constraint.
    [
      "a generated column",
      `"secondsToComplete" DECIMAL GENERATED ALWAYS AS ( CASE WHEN "releasedDate" IS NOT NULL THEN 1 ELSE 0 END ) STORED NOT NULL`
    ],
    ["an identity column", `"n" INTEGER GENERATED ALWAYS AS IDENTITY NOT NULL`],
    ["a serial column", `"n" BIGSERIAL NOT NULL`]
  ])(
    "allows a NOT NULL column that supplies its own value: %s",
    (_, column) => {
      expect(scan(`ALTER TABLE "job" ADD COLUMN ${column};`)).toEqual([]);
    }
  );
});
