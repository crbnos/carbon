// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noNumericPrecision } from "./no-numeric-precision";

describe("noNumericPrecision", () => {
  it("flags NUMERIC(x,y)", () => {
    const v = noNumericPrecision.scan(
      "a.sql",
      "amount NUMERIC(18, 4) NOT NULL"
    );
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(1);
    expect(v[0]?.snippet.toLowerCase().replace(/\s/g, "")).toBe(
      "numeric(18,4)"
    );
  });

  it("replays acdbcad23e: journalLine.amount re-rounded posted lines to scale 4", () => {
    // packages/database/supabase/migrations/20230705033432_ledgers.sql before
    // acdbcad23e, which widened these columns in 20260811123614_widen-ledger-amounts.sql.
    const sql = `CREATE TABLE "journalLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "journalId" INTEGER NOT NULL,
  "accountNumber" TEXT NOT NULL,
  "description" TEXT,
  "amount" NUMERIC(19, 4) NOT NULL,
  "quantity" NUMERIC(12, 4) NOT NULL DEFAULT 1,`;
    expect(
      noNumericPrecision
        .scan("20230705033432_ledgers.sql", sql)
        .map((v) => [v.line, v.snippet])
    ).toEqual([
      [6, "NUMERIC(19, 4)"],
      [7, "NUMERIC(12, 4)"]
    ]);
    // The fix: bare NUMERIC.
    expect(
      noNumericPrecision.scan(
        "20260811123614_widen-ledger-amounts.sql",
        `ALTER TABLE "journalLine"
  ALTER COLUMN "amount" TYPE NUMERIC,
  ALTER COLUMN "quantity" TYPE NUMERIC;`
      )
    ).toHaveLength(0);
  });

  it("allows bare NUMERIC", () => {
    const v = noNumericPrecision.scan("a.sql", "amount NUMERIC NOT NULL");
    expect(v).toHaveLength(0);
  });

  it("reports the correct line across multiple lines", () => {
    const sql = ["id uuid,", "price NUMERIC(10,2),", "qty NUMERIC"].join("\n");
    const v = noNumericPrecision.scan("a.sql", sql);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(2);
  });

  it("is case-insensitive", () => {
    const v = noNumericPrecision.scan("a.sql", "x numeric(5,2)");
    expect(v).toHaveLength(1);
  });
});
