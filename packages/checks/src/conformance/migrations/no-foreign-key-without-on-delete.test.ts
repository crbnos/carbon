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
    expect(v[0]?.line).toBe(2);
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
      scan(
        NEW,
        `CREATE TABLE "x" ("jobId" TEXT REFERENCES "job"("id") ON DELETE CASCADE, "y" TEXT);`
      )
    ).toHaveLength(0);
  });

  it("ignores REFERENCES inside a SQL comment", () => {
    expect(
      scan(NEW, `-- was REFERENCES "job"("id") before\nSELECT 1;`)
    ).toHaveLength(0);
  });

  it("does not apply to migrations older than the cutoff", () => {
    expect(
      scan(OLD, `CREATE TABLE "x" ("jobId" TEXT REFERENCES "job"("id"));`)
    ).toHaveLength(0);
  });

  it("accepts a written ON DELETE NO ACTION, with a comment before it", () => {
    expect(
      scan(
        NEW,
        `CREATE TABLE "x" (\n"jobId" TEXT REFERENCES "job"("id") -- kept\n  ON DELETE NO ACTION\n);`
      )
    ).toHaveLength(0);
  });

  it("does not take the next column's ON DELETE for this one", () => {
    const v = scan(
      NEW,
      `CREATE TABLE "x" (\n"a" TEXT REFERENCES "job"("id"),\n"b" TEXT REFERENCES "job"("id") ON DELETE CASCADE\n);`
    );
    expect(v.map((x) => x.line)).toEqual([2]);
  });
  it("reads only the foreign keys among a table's constraints", () => {
    const v = scan(
      NEW,
      `CREATE TABLE "x" (\n"id" TEXT PRIMARY KEY,\n"n" INT NOT NULL CHECK ("n" > 0),\n"jobId" TEXT REFERENCES "job"("id")\n);`
    );
    expect(v.map((x) => x.line)).toEqual([4]);
  });
});
