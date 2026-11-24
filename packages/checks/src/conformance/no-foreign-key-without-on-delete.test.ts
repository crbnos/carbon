// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noForeignKeyWithoutOnDelete } from "./no-foreign-key-without-on-delete";

const NEW = "20261201000000_new-table.sql";
const OLD = "20261001000000_old-table.sql";

describe("noForeignKeyWithoutOnDelete", () => {
  const scan = (file: string, src: string) =>
    noForeignKeyWithoutOnDelete.scan(file, src);

  it("flags a column reference with no ON DELETE in a new migration", () => {
    const v = scan(
      NEW,
      `CREATE TABLE "x" (\n  "jobId" TEXT REFERENCES "job"("id"),\n  "y" TEXT\n);`
    );
    expect(v).toHaveLength(1);
    expect(v[0]!.line).toBe(2);
  });

  it("flags a table-level FOREIGN KEY with no ON DELETE", () => {
    const v = scan(
      NEW,
      `CREATE TABLE "x" (\n  "jobId" TEXT,\n  FOREIGN KEY ("jobId") REFERENCES "job"("id")\n);`
    );
    expect(v).toHaveLength(1);
  });

  it("accepts an ON DELETE clause on the same line", () => {
    expect(
      scan(NEW, `"jobId" TEXT REFERENCES "job"("id") ON DELETE CASCADE,`)
    ).toHaveLength(0);
  });

  it("accepts an ON DELETE clause on a following line", () => {
    expect(
      scan(
        NEW,
        `"jobId" TEXT REFERENCES "job"("id")\n  ON DELETE SET NULL,\n"y" TEXT`
      )
    ).toHaveLength(0);
  });

  it("ignores REFERENCES inside a SQL comment", () => {
    expect(
      scan(NEW, `-- was REFERENCES "job"("id") before\nSELECT 1;`)
    ).toHaveLength(0);
  });

  it("does not apply to migrations older than the cutoff", () => {
    expect(scan(OLD, `"jobId" TEXT REFERENCES "job"("id"),`)).toHaveLength(0);
  });

  it("flags the productionQuantity event links that blocked deleting a time card before c476c942de", () => {
    // packages/database/supabase/migrations/20241002012019_production-quantities.sql
    // as it stood before c476c942de, under a file name past the cutoff (the
    // check leaves applied history alone). With no ON DELETE, a quantity that
    // named a production event made that event impossible to delete.
    const before = `CREATE TABLE "productionQuantity" (
  "setupProductionEventId" TEXT,
  "laborProductionEventId" TEXT,
  "machineProductionEventId" TEXT,
  CONSTRAINT "productionQuantity_setupProductionEventId_fkey" FOREIGN KEY ("setupProductionEventId") REFERENCES "productionEvent" ("id"),
  CONSTRAINT "productionQuantity_laborProductionEventId_fkey" FOREIGN KEY ("laborProductionEventId") REFERENCES "productionEvent" ("id"),
  CONSTRAINT "productionQuantity_machineProductionEventId_fkey" FOREIGN KEY ("machineProductionEventId") REFERENCES "productionEvent" ("id")
);`;
    expect(scan(NEW, before).map((v) => v.line)).toEqual([5, 6, 7]);
    // The fix (20260702174233_production-quantity-event-fk-set-null.sql).
    expect(
      scan(
        NEW,
        `ALTER TABLE "productionQuantity"
  ADD CONSTRAINT "productionQuantity_setupProductionEventId_fkey"
  FOREIGN KEY ("setupProductionEventId") REFERENCES "productionEvent"("id")
  ON DELETE SET NULL;`
      )
    ).toEqual([]);
  });
});
