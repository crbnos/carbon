// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { loadAccountReferencePolicy } from "../sources/cross-file";
import { repoRoot } from "../sources/migrations";
import {
  accountFkClassified,
  accountFkRestrict,
  parseReferencePolicy
} from "./account-fk-restrict";

const FILE = "20261201000000_x.sql";
const restrict = (sql: string, file = FILE) =>
  accountFkRestrict.scan(file, sql);

describe("accountFkRestrict", () => {
  it("fails the SET NULL constraint added to project in 20261021000300_projects-workspace.sql", () => {
    const sql = [
      'ALTER TABLE "project"',
      `  ADD CONSTRAINT "project_identifier_check" CHECK ("identifier" IS NULL OR "identifier" ~ '^[A-Z][A-Z0-9]{1,5}$'),`,
      '  ADD CONSTRAINT "project_costAccount_fkey" FOREIGN KEY ("costAccountId") REFERENCES "account"("id") ON DELETE SET NULL,',
      '  ADD CONSTRAINT "project_customer_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE SET NULL;'
    ].join("\n");
    expect(
      restrict(sql).map(({ line, snippet }) => ({ line, snippet }))
    ).toEqual([
      {
        line: 3,
        snippet:
          'ADD CONSTRAINT "project_costAccount_fkey" FOREIGN KEY ("costAccountId") REFERENCES "account"("id") ON DELETE SET NULL'
      }
    ]);
  });

  it("fails the SET NULL column of projectElement in 20261021000300_projects-workspace.sql", () => {
    const sql = [
      'CREATE TABLE IF NOT EXISTS "projectElement" (',
      '  "costAccountId" TEXT REFERENCES "account"("id") ON DELETE SET NULL,',
      '  "itemId" TEXT',
      ");"
    ].join("\n");
    expect(restrict(sql).map((v) => v.line)).toEqual([2]);
  });

  it("fails the SET NULL constraint of purchaseOrderLineVersion in 20261105210039_purchase-order-versions.sql", () => {
    const sql = [
      'CREATE TABLE "purchaseOrderLineVersion" (',
      '  "accountId" TEXT,',
      '  CONSTRAINT "purchaseOrderLineVersion_accountId_fkey"',
      '    FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE,',
      '  CONSTRAINT "purchaseOrderLineVersion_assetId_fkey"',
      '    FOREIGN KEY ("assetId") REFERENCES "fixedAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE',
      ");"
    ].join("\n");
    expect(restrict(sql).map((v) => v.line)).toEqual([4]);
  });

  it("fails the SET NULL journalLine and purchaseOrderLine keys that a3c398b5f9 made RESTRICT", () => {
    // 20260315000000_reset-chart-of-accounts.sql before a3c398b5f9: deleting
    // an account emptied the account of every Draft journal line. Replayed
    // under a file name from after the rule, because older migrations are
    // skipped on purpose.
    const sql = [
      "-- journalLine",
      'ALTER TABLE "journalLine" ADD CONSTRAINT "journalLine_accountId_fkey"',
      '  FOREIGN KEY ("accountId") REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE SET NULL;',
      "",
      "-- purchaseOrderLine",
      'ALTER TABLE "purchaseOrderLine" ADD CONSTRAINT "purchaseOrderLine_accountId_fkey"',
      '  FOREIGN KEY ("accountId") REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE SET NULL;'
    ].join("\n");
    expect(restrict(sql).map((v) => v.line)).toEqual([3, 7]);
  });

  it("passes the RESTRICT key from a3c398b5f9 (20261013005642_account-delete-restrict.sql)", () => {
    const sql = [
      'ALTER TABLE "journalLine" ADD CONSTRAINT "journalLine_accountId_fkey"',
      '  FOREIGN KEY ("accountId") REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE RESTRICT',
      "  NOT VALID;"
    ].join("\n");
    expect(restrict(sql, "20261013005642_account-delete-restrict.sql")).toEqual(
      []
    );
  });

  it.each([
    [
      "no ON DELETE",
      'ALTER TABLE "t" ADD COLUMN "a" TEXT REFERENCES "account"("id");'
    ],
    ["NO ACTION", '"a" TEXT REFERENCES "account"("id") ON DELETE NO ACTION,'],
    ["CASCADE", '"a" TEXT REFERENCES account (id) ON DELETE CASCADE,'],
    [
      "a public. prefix",
      '"a" TEXT REFERENCES public."account"("id") ON DELETE SET NULL,'
    ],
    [
      "upper case, unquoted",
      '"a" TEXT REFERENCES PUBLIC . ACCOUNT ON DELETE SET NULL,'
    ]
  ])("fails a foreign key to account with %s", (_, sql) => {
    expect(restrict(sql)).toHaveLength(1);
  });

  it.each([
    [
      "ON DELETE RESTRICT",
      '"a" TEXT REFERENCES "account"("id") ON DELETE RESTRICT,'
    ],
    [
      "RESTRICT on the next line",
      'FOREIGN KEY ("a") REFERENCES "account"(id)\n  ON DELETE RESTRICT ON UPDATE CASCADE;'
    ],
    [
      "ON UPDATE first",
      'REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE RESTRICT'
    ],
    [
      "accountingPeriod",
      '"p" TEXT REFERENCES "accountingPeriod"("id") ON DELETE SET NULL,'
    ],
    [
      "accountDefault",
      'REFERENCES "accountDefault"("companyId") ON DELETE CASCADE,'
    ],
    [
      "an unquoted accounting table",
      "REFERENCES accounting_period(id) ON DELETE SET NULL,"
    ],
    [
      "a quoted Account, another table",
      'REFERENCES "Account"("id") ON DELETE SET NULL,'
    ],
    [
      "another schema's account",
      "REFERENCES audit.account(id) ON DELETE SET NULL,"
    ],
    [
      "a line comment",
      '-- "a" TEXT REFERENCES "account"("id") ON DELETE SET NULL,'
    ],
    ["a block comment", '/* REFERENCES "account"("id") ON DELETE SET NULL */']
  ])("passes %s", (_, sql) => {
    expect(restrict(sql)).toEqual([]);
  });

  it("skips migrations from before the rule", () => {
    const sql = '"a" TEXT REFERENCES "account"("id") ON DELETE SET NULL,';
    expect(restrict(sql, "20261013004600_planning.sql")).toEqual([]);
  });
});

describe("accountFkClassified", () => {
  const classified = (sql: string) =>
    accountFkClassified({
      classified: new Set(["listed.accountId"]),
      unclassified: ["accountDefault", "account.parentId"]
    })
      .scan(FILE, sql)
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

describe("parseReferencePolicy", () => {
  it("reads one-line and multi-line entries of REFERENCE_POLICY only", () => {
    const source = [
      'const OTHER = [{ table: "other", column: "x", policy: "repoint" }];',
      "export const REFERENCE_POLICY: readonly AccountReference[] = [",
      '  { table: "charge", column: "cardAccountId", policy: "repoint" },',
      "  {",
      '    table: "journalLine",',
      '    column: "accountId",',
      '    policy: "repoint-if-parent-status"',
      "  }",
      "];",
      'const LATER = [{ table: "later", column: "y" }];',
      "export const UNCLASSIFIED_ACCOUNT_REFERENCES: readonly string[] = [",
      '  "accountDefault",',
      '  "account.parentId"',
      "];"
    ].join("\n");
    const { classified, unclassified } = parseReferencePolicy(source);
    expect([...classified]).toEqual([
      "charge.cardAccountId",
      "journalLine.accountId"
    ]);
    expect(unclassified).toEqual(["accountDefault", "account.parentId"]);
  });

  it("throws when either list is gone, rather than flag every column", () => {
    expect(() => parseReferencePolicy("export const X = [];")).toThrow(
      /REFERENCE_POLICY not found/
    );
    expect(() =>
      parseReferencePolicy("export const REFERENCE_POLICY = [\n];")
    ).toThrow(/UNCLASSIFIED_ACCOUNT_REFERENCES not found/);
  });

  it("reads both lists from account-import.ts", () => {
    const { classified, unclassified } = loadAccountReferencePolicy(repoRoot());
    expect(classified.size).toBeGreaterThan(0);
    expect(unclassified).toContain("account.parentId");
  });
});
