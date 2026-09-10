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

  it("ignores IS NOT NULL inside a generated column's expression", () => {
    // Real false positive from 20250115041610_backfill-release-date.sql: the
    // `IS NOT NULL` here is a predicate, not a column constraint, and a backup
    // can never supply a generated column anyway.
    expect(
      scan(
        `ALTER TABLE "job" ADD COLUMN "secondsToComplete" DECIMAL GENERATED ALWAYS AS ( CASE WHEN "releasedDate" IS NOT NULL THEN 1 ELSE 0 END ) STORED;`
      )
    ).toEqual([]);
  });

  it("ignores IS NOT NULL in a plain added column's expression", () => {
    expect(
      scan(
        `ALTER TABLE "job" ADD COLUMN "flag" BOOLEAN DEFAULT ("releasedDate" IS NOT NULL);`
      )
    ).toEqual([]);
  });

  it("handles ADD COLUMN IF NOT EXISTS", () => {
    expect(
      scan(`ALTER TABLE "item" ADD COLUMN IF NOT EXISTS "x" TEXT NOT NULL;`)
    ).toHaveLength(1);
    expect(
      scan(
        `ALTER TABLE "item" ADD COLUMN IF NOT EXISTS "x" TEXT NOT NULL DEFAULT '';`
      )
    ).toEqual([]);
  });
});
