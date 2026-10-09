// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { journalStatusFilter } from "./journal-status-filter";

describe("journal-status-filter", () => {
  it("flags a not-Draft journal filter in a new migration", () => {
    const sql = `SELECT SUM(jl."amount")
FROM "journalLine" jl
JOIN "journal" j ON j."id" = jl."journalId"
WHERE j."status" <> 'Draft';`;
    const violations = journalStatusFilter.scan(
      "20261010000000_new-reader.sql",
      sql
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(4);
    expect(violations[0]?.message).toContain("GL_JOURNAL_STATUSES");
  });

  it("skips a migration older than the GL readers migration", () => {
    const sql = `SELECT * FROM "journal" j WHERE j."status" <> 'Draft';`;
    expect(
      journalStatusFilter.scan("20260101000000_old-reader.sql", sql)
    ).toHaveLength(0);
  });

  it("skips a SQL comment that describes the old filter", () => {
    const sql = `-- Each of these read \`status <> 'Draft'\`.
SELECT * FROM "journal";`;
    expect(
      journalStatusFilter.scan("20261010000000_new-reader.sql", sql)
    ).toHaveLength(0);
  });

  it("flags a not-Draft filter in a TS file that reads journal", () => {
    const ts = `const { data } = await client
  .from("journal")
  .select("id")
  .neq("status", "Draft");`;
    const violations = journalStatusFilter.scan("a.ts", ts);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(4);
  });

  it("flags a Kysely not-Draft filter in a TS file that reads journal", () => {
    const ts = `await db.selectFrom("journal").where("status", "<>", "Draft");`;
    expect(journalStatusFilter.scan("a.ts", ts)).toHaveLength(1);
  });

  it("flags a qualified status in a Kysely chain", () => {
    const ts = `const rows = await db
  .selectFrom("journalLine")
  .innerJoin("journal", "journal.id", "journalLine.journalId")
  .where("journal.status", "<>", "Draft")
  .execute();`;
    const violations = journalStatusFilter.scan("a.ts", ts);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(4);
  });

  it("flags an aliased journal table", () => {
    const ts = `await db
  .selectFrom("journal as j")
  .where("j.status", "!=", "Draft")
  .where("j.companyId", "=", companyId)
  .execute();`;
    expect(journalStatusFilter.scan("a.ts", ts)).toHaveLength(1);
  });

  it("flags a not-in list that excludes Draft", () => {
    const ts = `await db.selectFrom("journal as j").where("j.status", "not in", ["Draft"]).execute();`;
    expect(journalStatusFilter.scan("a.ts", ts)).toHaveLength(1);
  });

  it("flags an unquoted, aliased SQL join", () => {
    const sql = `SELECT SUM(jl.amount)
FROM "journalLine" jl
JOIN journal j ON j.id = jl."journalId"
WHERE j.status != 'Draft';`;
    const violations = journalStatusFilter.scan(
      "20261010000000_new-reader.sql",
      sql
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(4);
  });

  it("flags a NOT IN that excludes Draft in SQL", () => {
    const sql = `SELECT * FROM journal j WHERE j.status NOT IN ('Draft', 'Superseded');`;
    expect(
      journalStatusFilter.scan("20261010000000_new-reader.sql", sql)
    ).toHaveLength(1);
  });

  it("flags raw SQL in a sql template", () => {
    const ts = `const result = await sql<{ total: number }>\`
  SELECT SUM(jl."amount") AS total
  FROM "journalLine" jl
  JOIN "journal" j ON j."id" = jl."journalId"
  WHERE j."status" <> 'Draft'
\`.execute(db);`;
    const violations = journalStatusFilter.scan("a.ts", ts);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(5);
  });

  it("flags raw SQL in a client.query string", () => {
    const ts = `await client.query(
  "SELECT id FROM journal WHERE status <> 'Draft' AND \"companyId\" = $1",
  [companyId]
);`;
    expect(journalStatusFilter.scan("a.ts", ts)).toHaveLength(1);
  });

  it("does not flag a Draft guard on another table in a file that reads journal", () => {
    // The charge and reimbursement guards of 20261009145057: a trigger body
    // that tests the CHARGE's status, in a migration that also reads journal.
    const sql = `CREATE OR REPLACE FUNCTION public.check_charge_draft_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
      journalStatusFilter.scan(
        "20261009145057_accounting-cutover-guards.sql",
        sql
      )
    ).toHaveLength(0);
  });

  it("does not flag a TS Draft filter on another table in a file that reads journal", () => {
    const ts = `const journals = await db.selectFrom("journal").select("id").execute();
const charges = await client.from("charge").select("id").neq("status", "Draft");`;
    expect(journalStatusFilter.scan("a.ts", ts)).toHaveLength(0);
  });

  it("does not flag another table's status in a statement that joins journal", () => {
    const sql = `SELECT i.*
FROM "salesInvoices" i
JOIN "journal" j ON j."documentId" = i."id"
WHERE j."status" IN ('Posted', 'Reversed')
  AND i."status" NOT IN ('Draft', 'Pending', 'Voided');`;
    expect(
      journalStatusFilter.scan("20261010000000_new-reader.sql", sql)
    ).toHaveLength(0);
    const ts = `await db
  .selectFrom("purchaseInvoice as invoice")
  .innerJoin("journal as j", "j.documentId", "invoice.id")
  .where("invoice.status", "not in", ["Draft", "Pending", "Voided"])
  .execute();`;
    expect(journalStatusFilter.scan("a.ts", ts)).toHaveLength(0);
  });

  it("does not take journalLine for journal", () => {
    const sql = `SELECT * FROM "journalLine" jl WHERE jl.status <> 'Draft';`;
    expect(
      journalStatusFilter.scan("20261010000000_new-reader.sql", sql)
    ).toHaveLength(0);
  });

  it("skips a TS file that does not read journal", () => {
    const ts = `await client.from("salesOrder").select("id").neq("status", "Draft");`;
    expect(journalStatusFilter.scan("a.ts", ts)).toHaveLength(0);
  });
});
