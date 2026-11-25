// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  accountFkClassified,
  accountFkRestrict,
  scanJournalStatusFilter,
  parseReferencePolicy
} from "./accounting";

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
});

describe("journal-status-filter", () => {
  it("flags a not-Draft journal filter in a new migration", () => {
    const sql = `SELECT SUM(jl."amount")
FROM "journalLine" jl
JOIN "journal" j ON j."id" = jl."journalId"
WHERE j."status" <> 'Draft';`;
    const violations = scanJournalStatusFilter(
      "20261010000000_new-reader.sql",
      sql
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(4);
    expect(violations[0]?.message).toContain("GL_JOURNAL_STATUSES");
  });

  it("replays c0cf421500: get_inventory_tie_out's not-Draft GL read, restated in the GL readers migration", () => {
    // packages/database/supabase/migrations/20260925121735_rpc-function-guards.sql
    // before c0cf421500. c0cf421500 restated the function in
    // 20261009005144_journal-gl-status-readers.sql with the filter changed;
    // restated unchanged, the old reader is what the check flags. The gl CTE
    // is written as a whole statement, since the check reads parsed SQL.
    const before = `  WITH gl AS (
    SELECT jl."accountId" AS "account", SUM(jl."amount") AS "balance"
    FROM "journal" j
    INNER JOIN "journalLine" jl
      ON jl."journalId" = j."id" AND jl."companyId" = j."companyId"
    WHERE j."companyId" = company_id
      AND j."status" <> 'Draft'
      AND j."postingDate" <= v_as_of
      AND jl."accountId" IN (v_rm_account, v_fg_account)
    GROUP BY jl."accountId"
  )
  SELECT * FROM gl;`;
    const file = "20261009005144_journal-gl-status-readers.sql";
    expect(
      scanJournalStatusFilter(file, before).map((v) => [v.line, v.snippet])
    ).toEqual([[7, "j.status is not 'Draft'"]]);
    const after = before.replace(
      `j."status" <> 'Draft'`,
      `j."status" IN ('Posted', 'Reversed')`
    );
    expect(scanJournalStatusFilter(file, after)).toHaveLength(0);
  });

  it("reads the journalLines view as the journal, quoted or not", () => {
    const file = "20261010000000_new-reader.sql";
    expect(
      scanJournalStatusFilter(
        file,
        `SELECT * FROM "journalLines" jl WHERE jl."status" <> 'Draft';`
      ).map((v) => v.snippet)
    ).toEqual(["jl.status is not 'Draft'"]);
    expect(
      scanJournalStatusFilter(
        file,
        `SELECT * FROM journalLines WHERE journalLines.status <> 'Draft';`
      ).map((v) => v.snippet)
    ).toEqual(["journallines.status is not 'Draft'"]);
  });

  it("skips a migration older than the GL readers migration", () => {
    const sql = `SELECT * FROM "journal" j WHERE j."status" <> 'Draft';`;
    expect(
      scanJournalStatusFilter("20260101000000_old-reader.sql", sql)
    ).toHaveLength(0);
  });

  it("skips a SQL comment that describes the old filter", () => {
    const sql = `-- Each of these read \`status <> 'Draft'\`.
SELECT * FROM "journal";`;
    expect(
      scanJournalStatusFilter("20261010000000_new-reader.sql", sql)
    ).toHaveLength(0);
  });

  it("flags a not-Draft filter in a TS file that reads journal", () => {
    const ts = `const { data } = await client
  .from("journal")
  .select("id")
  .neq("status", "Draft");`;
    const violations = scanJournalStatusFilter("a.ts", ts);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(4);
  });

  it("flags a Kysely not-Draft filter in a TS file that reads journal", () => {
    const ts = `await db.selectFrom("journal").where("status", "<>", "Draft");`;
    expect(scanJournalStatusFilter("a.ts", ts)).toHaveLength(1);
  });

  it("flags a qualified status in a Kysely chain", () => {
    const ts = `const rows = await db
  .selectFrom("journalLine")
  .innerJoin("journal", "journal.id", "journalLine.journalId")
  .where("journal.status", "<>", "Draft")
  .execute();`;
    const violations = scanJournalStatusFilter("a.ts", ts);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(4);
  });

  it("flags an aliased journal table", () => {
    const ts = `await db
  .selectFrom("journal as j")
  .where("j.status", "!=", "Draft")
  .where("j.companyId", "=", companyId)
  .execute();`;
    expect(scanJournalStatusFilter("a.ts", ts)).toHaveLength(1);
  });

  it("flags a not-in list that excludes Draft", () => {
    const ts = `await db.selectFrom("journal as j").where("j.status", "not in", ["Draft"]).execute();`;
    expect(scanJournalStatusFilter("a.ts", ts)).toHaveLength(1);
  });

  it("flags an unquoted, aliased SQL join", () => {
    const sql = `SELECT SUM(jl.amount)
FROM "journalLine" jl
JOIN journal j ON j.id = jl."journalId"
WHERE j.status != 'Draft';`;
    const violations = scanJournalStatusFilter(
      "20261010000000_new-reader.sql",
      sql
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(4);
  });

  it("flags a NOT IN that excludes Draft in SQL", () => {
    const sql = `SELECT * FROM journal j WHERE j.status NOT IN ('Draft', 'Superseded');`;
    expect(
      scanJournalStatusFilter("20261010000000_new-reader.sql", sql)
    ).toHaveLength(1);
  });

  it("flags raw SQL in a sql template", () => {
    const ts = `const result = await sql<{ total: number }>\`
  SELECT SUM(jl."amount") AS total
  FROM "journalLine" jl
  JOIN "journal" j ON j."id" = jl."journalId"
  WHERE j."status" <> 'Draft'
\`.execute(db);`;
    const violations = scanJournalStatusFilter("a.ts", ts);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(5);
  });

  it("flags raw SQL in a client.query string", () => {
    const ts = `await client.query(
  "SELECT id FROM journal WHERE status <> 'Draft' AND \"companyId\" = $1",
  [companyId]
);`;
    expect(scanJournalStatusFilter("a.ts", ts)).toHaveLength(1);
  });

  it("does not flag a Draft guard on another table in a file that reads journal", () => {
    // The charge and reimbursement guards of 20261009145057: a trigger body
    // that tests the CHARGE's status, in a migration that also reads journal.
    const sql = `CREATE OR REPLACE FUNCTION public.check_charge_draft_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_journal TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'Draft' THEN
      RAISE EXCEPTION 'Charge must be created in Draft status';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'Draft' THEN
      RAISE EXCEPTION 'Charge cannot be deleted';
    END IF;
  END IF;
  SELECT "journalId" INTO v_journal FROM "journal" WHERE "id" = NEW."journalId";
  RETURN OLD;
END;
$function$;`;
    expect(
      scanJournalStatusFilter(
        "20261009145057_accounting-cutover-guards.sql",
        sql
      )
    ).toHaveLength(0);
  });

  it("does not flag a TS Draft filter on another table in a file that reads journal", () => {
    const ts = `const journals = await db.selectFrom("journal").select("id").execute();
const charges = await client.from("charge").select("id").neq("status", "Draft");`;
    expect(scanJournalStatusFilter("a.ts", ts)).toHaveLength(0);
  });

  it("does not flag another table's status in a statement that joins journal", () => {
    const sql = `SELECT i.*
FROM "salesInvoices" i
JOIN "journal" j ON j."documentId" = i."id"
WHERE j."status" IN ('Posted', 'Reversed')
  AND i."status" NOT IN ('Draft', 'Pending', 'Voided');`;
    expect(
      scanJournalStatusFilter("20261010000000_new-reader.sql", sql)
    ).toHaveLength(0);
    const ts = `await db
  .selectFrom("purchaseInvoice as invoice")
  .innerJoin("journal as j", "j.documentId", "invoice.id")
  .where("invoice.status", "not in", ["Draft", "Pending", "Voided"])
  .execute();`;
    expect(scanJournalStatusFilter("a.ts", ts)).toHaveLength(0);
  });

  it("replays c0cf421500: the account ledger's not-Draft read of the journalLines view", () => {
    // apps/erp/app/modules/accounting/accounting.service.ts before c0cf421500.
    // The view carries each line's journal status, so the filter let
    // Provisional and Superseded journals into the account ledger.
    const ts = `let query = client
    .from("journalLines" as any)
    .select("*", { count: "exact" })
    .eq("accountId", args.accountId)
    .neq("status", "Draft")
    .gte("postingDate", args.startDate);`;
    expect(
      scanJournalStatusFilter("accounting.service.ts", ts).map((v) => v.line)
    ).toEqual([5]);
  });

  it("does not take journalLine for journal", () => {
    const sql = `SELECT * FROM "journalLine" jl WHERE jl.status <> 'Draft';`;
    expect(
      scanJournalStatusFilter("20261010000000_new-reader.sql", sql)
    ).toHaveLength(0);
  });

  it.each([
    [`j."sourceType" <> 'Draft'`],
    [`lower(j."description") <> 'Draft'`]
  ])(
    "does not flag a not-Draft test on something other than status: %s",
    (test) => {
      const sql = `SELECT * FROM "journal" j WHERE ${test};`;
      expect(
        scanJournalStatusFilter("20261010000000_new-reader.sql", sql)
      ).toHaveLength(0);
    }
  );

  it("does not flag an unqualified status in a statement that does not read journal", () => {
    const sql = `UPDATE "charge" SET "updatedAt" = now() WHERE "status" <> 'Draft';
SELECT "id" FROM "journal";`;
    expect(
      scanJournalStatusFilter("20261010000000_new-reader.sql", sql)
    ).toHaveLength(0);
  });

  it("reports a SQL line once when it holds two not-Draft filters", () => {
    const sql = `SELECT * FROM "journal" j WHERE j."status" <> 'Draft' AND "status" NOT IN ('Draft', 'Superseded');`;
    expect(
      scanJournalStatusFilter("20261010000000_new-reader.sql", sql)
    ).toHaveLength(1);
  });

  it("skips a TS file that does not read journal", () => {
    const ts = `await client.from("salesOrder").select("id").neq("status", "Draft");`;
    expect(scanJournalStatusFilter("a.ts", ts)).toHaveLength(0);
  });
});
