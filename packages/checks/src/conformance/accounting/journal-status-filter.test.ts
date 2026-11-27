// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { journalStatusFilter } from "./journal-status-filter";

// The check tells a migration from TypeScript by its `.sql` name.
const scanJournalStatusFilter = (file: string, contents: string) =>
  journalStatusFilter.find({
    migrations: [{ file, contents }],
    typescript: []
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
