// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { accountFkClassified } from "./account-fk-classified";

const FILE = "20261201000000_x.sql";

describe("accountFkClassified", () => {
  const classified = (sql: string) =>
    accountFkClassified
      .find({
        files: [{ file: FILE, contents: sql }],
        policy: {
          classified: new Set(["listed.accountId"]),
          unclassified: ["accountDefault", "account.parentId"]
        }
      })
      .map((v) => v.message.split(" ")[0]);

  it("names the column of an inline, an added and a table-level foreign key", () => {
    const sql = [
      'CREATE TABLE "pool" (',
      '  "id" TEXT NOT NULL DEFAULT id(),',
      '  "appliedAccountId" TEXT NOT NULL REFERENCES "account"("id") ON DELETE RESTRICT',
      ");",
      'ALTER TABLE "line"',
      '  ADD COLUMN IF NOT EXISTS "a" TEXT REFERENCES "account"("id") ON DELETE RESTRICT,',
      '  ADD COLUMN IF NOT EXISTS "b" TEXT REFERENCES "account"("id") ON DELETE RESTRICT;',
      "DO $x$ BEGIN",
      "  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '\"other\"'::regclass) THEN",
      '    ALTER TABLE "statement" ADD CONSTRAINT "s_fkey"',
      '      FOREIGN KEY ("accountId", "companyId") REFERENCES "account"("id", "companyId") ON DELETE RESTRICT;',
      "  END IF;",
      "END $x$;"
    ].join("\n");
    expect(classified(sql)).toEqual([
      "pool.appliedAccountId",
      "line.a",
      "line.b",
      "statement.accountId"
    ]);
  });

  it("passes a listed column, an unclassified table and an unclassified column", () => {
    const sql = [
      'ALTER TABLE "listed" ADD COLUMN "accountId" TEXT REFERENCES "account"("id") ON DELETE RESTRICT;',
      'ALTER TABLE "accountDefault" ADD COLUMN "x" TEXT REFERENCES "account"("id") ON DELETE RESTRICT;',
      'ALTER TABLE "account" ADD COLUMN "parentId" TEXT REFERENCES "account"("id") ON DELETE RESTRICT;'
    ].join("\n");
    expect(classified(sql)).toEqual([]);
  });

  it("does not stretch an unclassified column to its table, or a table to a longer name", () => {
    const sql = [
      'ALTER TABLE "account" ADD COLUMN "otherId" TEXT REFERENCES "account"("id") ON DELETE RESTRICT;',
      'ALTER TABLE "accountDefaultHistory" ADD COLUMN "x" TEXT REFERENCES "account"("id") ON DELETE RESTRICT;'
    ].join("\n");
    expect(classified(sql)).toEqual([
      "account.otherId",
      "accountDefaultHistory.x"
    ]);
  });
});
