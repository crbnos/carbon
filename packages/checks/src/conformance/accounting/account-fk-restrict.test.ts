// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { accountFkRestrict } from "./account-fk-restrict";

const FILE = "20261201000000_x.sql";
const restrict = (sql: string, file = FILE) =>
  accountFkRestrict.scan(file, sql);

/** A column or constraint clause as the one entry of a CREATE TABLE. */
const inTable = (clause: string) => {
  if (/^(ALTER|--|\/\*)/.test(clause)) return clause;
  const entry = clause.replace(/[,;]\s*$/, "");
  const column = entry.startsWith("REFERENCES") ? `"a" TEXT ${entry}` : entry;
  return `CREATE TABLE "t" (${column});`;
};

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
        snippet: "project.costAccountId REFERENCES account"
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
    expect(restrict(inTable(sql))).toHaveLength(1);
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
    expect(restrict(inTable(sql))).toEqual([]);
  });

  it("skips migrations from before the rule", () => {
    const sql = '"a" TEXT REFERENCES "account"("id") ON DELETE SET NULL,';
    expect(restrict(inTable(sql), "20261013004600_planning.sql")).toEqual([]);
  });
});
