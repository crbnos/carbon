// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { loadSqlFiles, migrationsDir, repoRoot } from "../sources/migrations";
import { GENERATED_AUTHZ_MIGRATION } from "./authz";
import {
  findDroppedFunctionChanges,
  migrationReplaySafe,
  noDerivedPercentColumn,
  noForeignKeyWithoutOnDelete,
  noNumericPrecision,
  noRequiredColumnWithoutDefault,
  noViewWithoutInvoker,
  tenantFkComposite,
  tenantFkCompositeScan,
  tenantKeysFromMigrations
} from "./migrations";

describe("noNumericPrecision", () => {
  it("flags NUMERIC(x,y)", () => {
    const v = noNumericPrecision.scan(
      "a.sql",
      "CREATE TABLE t (amount NUMERIC(18, 4) NOT NULL);"
    );
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(1);
    expect(v[0]?.snippet.toLowerCase().replace(/\s/g, "")).toBe(
      "numeric(18,4)"
    );
  });

  it("allows bare NUMERIC", () => {
    const v = noNumericPrecision.scan(
      "a.sql",
      "CREATE TABLE t (amount NUMERIC NOT NULL);"
    );
    expect(v).toHaveLength(0);
  });

  it("reports the correct line across multiple lines", () => {
    const sql = [
      "CREATE TABLE t (",
      "id uuid,",
      "price NUMERIC(10,2),",
      "qty NUMERIC);"
    ].join("\n");
    const v = noNumericPrecision.scan("a.sql", sql);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(3);
  });

  it("reads a function's arguments, its declared variables and its body", () => {
    const sql = [
      "CREATE FUNCTION f(a NUMERIC(10,2)) RETURNS void LANGUAGE plpgsql AS $$",
      "DECLARE",
      "  total NUMERIC(12, 4);",
      "BEGIN",
      "  PERFORM g(a::decimal(5,2));",
      "END $$;"
    ].join("\n");
    expect(
      noNumericPrecision.scan("a.sql", sql).map((v) => [v.line, v.snippet])
    ).toEqual([
      [1, "NUMERIC(10,2)"],
      [3, "NUMERIC(12,4)"],
      [5, "NUMERIC(5,2)"]
    ]);
  });

  it("ignores a type named in a comment or a string", () => {
    const sql = "-- was NUMERIC(10,2)\nSELECT 'NUMERIC(10,2)';";
    expect(noNumericPrecision.scan("a.sql", sql)).toHaveLength(0);
  });
});

describe("no-derived-percent-column", () => {
  it("flags a generated percent column that divides", () => {
    const sql = `ALTER TABLE "purchaseOrderLine" ADD COLUMN "taxPercent" NUMERIC GENERATED ALWAYS AS (
  CASE
    WHEN ("supplierUnitPrice" * "purchaseQuantity" + "supplierShippingCost") = 0 THEN 0
    ELSE "supplierTaxAmount" / ("supplierUnitPrice" * "purchaseQuantity" + "supplierShippingCost")
  END
) STORED;`;
    const violations = noDerivedPercentColumn.scan("a.sql", sql);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(1);
    expect(violations[0]?.snippet).toContain("taxPercent");
  });

  it("flags a rate column derived on a single line", () => {
    const sql = `ALTER TABLE "t" ADD COLUMN "marginRate" NUMERIC GENERATED ALWAYS AS ("profit" / "revenue") STORED;`;
    expect(noDerivedPercentColumn.scan("a.sql", sql)).toHaveLength(1);
  });

  it("allows a generated percent column without division", () => {
    const sql = `ALTER TABLE "t" ADD COLUMN "combinedPercent" NUMERIC GENERATED ALWAYS AS ("aPercent" + "bPercent") STORED;`;
    expect(noDerivedPercentColumn.scan("a.sql", sql)).toHaveLength(0);
  });

  it("allows plain stored percent columns", () => {
    const sql = `ALTER TABLE "t" ADD COLUMN "taxPercent" NUMERIC NOT NULL DEFAULT 0;`;
    expect(noDerivedPercentColumn.scan("a.sql", sql)).toHaveLength(0);
  });

  it("allows generated non-percent columns that divide", () => {
    const sql = `ALTER TABLE "t" ADD COLUMN "unitPrice" NUMERIC GENERATED ALWAYS AS ("supplierUnitPrice" / "exchangeRate") STORED;`;
    expect(noDerivedPercentColumn.scan("a.sql", sql)).toHaveLength(0);
  });
});

const scanRequired = (sql: string) =>
  noRequiredColumnWithoutDefault.scan("m.sql", sql);

describe("no-required-column-without-default", () => {
  it("allows a new NOT NULL column that ships a DEFAULT", () => {
    expect(
      scanRequired(
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

    const violations = scanRequired(sql);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(3);
    expect(violations[0]?.snippet).toContain("ADD COLUMN");
    expect(violations[0]?.message).toContain("unrestorable");
  });

  it("allows a nullable new column", () => {
    expect(scanRequired(`ALTER TABLE "item" ADD COLUMN "notes" TEXT;`)).toEqual(
      []
    );
  });

  it("does not let a LATER column's DEFAULT excuse an earlier one", () => {
    // The bounded span is what makes this work: without it, the DEFAULT on
    // "b" would satisfy the lookahead for "a" and the real violation would
    // pass silently.
    const violations = scanRequired(
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
    expect(scanRequired(sql)).toEqual([]);
  });

  it.each([
    // From 20250115041610_backfill-release-date.sql, made NOT NULL: a backup
    // can never supply a generated column, and the `IS NOT NULL` inside the
    // expression is a predicate, not this column's constraint.
    [
      "a generated column",
      `"secondsToComplete" DECIMAL GENERATED ALWAYS AS ( CASE WHEN "releasedDate" IS NOT NULL THEN 1 ELSE 0 END ) STORED NOT NULL`
    ],
    ["an identity column", `"n" INTEGER GENERATED ALWAYS AS IDENTITY NOT NULL`],
    ["a serial column", `"n" BIGSERIAL NOT NULL`]
  ])(
    "allows a NOT NULL column that supplies its own value: %s",
    (_, column) => {
      expect(scanRequired(`ALTER TABLE "job" ADD COLUMN ${column};`)).toEqual(
        []
      );
    }
  );
});

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

describe("noViewWithoutInvoker", () => {
  it("flags a CREATE OR REPLACE VIEW with no option list", () => {
    const sql =
      'SELECT 1;\nCREATE OR REPLACE VIEW "openJobMaterialLines" AS (\n  SELECT 1\n);';
    const v = noViewWithoutInvoker.scan("p.sql", sql);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(2);
    expect(v[0]?.message).toContain('"openJobMaterialLines"');
  });

  it("flags a view whose option list omits security_invoker", () => {
    const sql = 'CREATE VIEW "x" WITH (check_option = local) AS SELECT 1;';
    expect(noViewWithoutInvoker.scan("p.sql", sql)).toHaveLength(1);
  });

  it("allows security_invoker in any casing and spacing", () => {
    const sql = [
      'CREATE OR REPLACE VIEW "a" WITH (security_invoker = true) AS SELECT 1;',
      'CREATE OR REPLACE VIEW "b" WITH(SECURITY_INVOKER=true) AS SELECT 1;',
      'CREATE VIEW public."c"\nWITH (security_invoker=true)\nAS\nSELECT 1;'
    ].join("\n");
    expect(noViewWithoutInvoker.scan("p.sql", sql)).toHaveLength(0);
  });

  it("allows an explicit owner-rights view", () => {
    const sql =
      'CREATE VIEW "modules" WITH (security_invoker = false) AS SELECT 1;';
    expect(noViewWithoutInvoker.scan("p.sql", sql)).toHaveLength(0);
  });

  it("ignores materialized views", () => {
    const sql = 'CREATE MATERIALIZED VIEW "itemLedgerSnapshot" AS SELECT 1;';
    expect(noViewWithoutInvoker.scan("p.sql", sql)).toHaveLength(0);
  });

  it("ignores a view in a comment", () => {
    const sql = '-- CREATE OR REPLACE VIEW "x" AS\nSELECT 1;';
    expect(noViewWithoutInvoker.scan("p.sql", sql)).toHaveLength(0);
  });

  it("keeps line numbers after a block comment", () => {
    const sql = '/* one\ntwo */\nCREATE VIEW "x" AS SELECT 1;';
    expect(noViewWithoutInvoker.scan("p.sql", sql)[0]?.line).toBe(3);
  });

  it("flags ALTER VIEW … RESET (security_invoker)", () => {
    const sql = 'ALTER VIEW "openJobMaterialLines" RESET (security_invoker);';
    const v = noViewWithoutInvoker.scan("p.sql", sql);
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain("RESET");
  });

  it("allows ALTER VIEW … SET (security_invoker = true)", () => {
    const sql = 'ALTER VIEW "x" SET (security_invoker = true);';
    expect(noViewWithoutInvoker.scan("p.sql", sql)).toHaveLength(0);
  });

  it("ignores a view named in a string or a function body", () => {
    const sql = [
      'COMMENT ON TABLE "job" IS \'CREATE VIEW "x" AS SELECT 1\';',
      "CREATE FUNCTION f() RETURNS void LANGUAGE sql AS $$ SELECT 'CREATE VIEW \"x\" AS' $$;"
    ].join("\n");
    expect(noViewWithoutInvoker.scan("p.sql", sql)).toHaveLength(0);
  });
  it("allows ALTER VIEW … RESET of another option", () => {
    const sql = 'ALTER VIEW "x" RESET (check_option);';
    expect(noViewWithoutInvoker.scan("p.sql", sql)).toHaveLength(0);
  });
});

const fn = (body: string[]) => `
CREATE OR REPLACE FUNCTION public.complete_job(p_job_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
${body.join("\n")}
END;
$$;`;

const ORIGINAL = [
  "  SELECT accountingEnabled INTO v_enabled FROM settings;",
  "  IF NOT v_enabled THEN RETURN; END IF;"
];
const ALWAYS_POST = [
  "  v_posting_status := journal_posting_status(p_company_id);",
  "  INSERT INTO journal (status) VALUES (v_posting_status);"
];
const SERIAL = ["  AND te.status NOT IN ('Rejected', 'Scrapped')"];

const migrations = (third: string[], file = "20261020101010_third.sql") => [
  { file: "20261001101010_first.sql", contents: fn(ORIGINAL) },
  { file: "20261009101010_always-post.sql", contents: fn(ALWAYS_POST) },
  { file, contents: fn(third) }
];

describe("function-redefinition-keeps-changes", () => {
  it("fails a redefinition forked from an older copy", () => {
    const [finding] = findDroppedFunctionChanges(
      migrations([...ORIGINAL, ...SERIAL])
    );
    expect(finding?.snippet).toBe(
      "complete_job drops 20261009101010_always-post.sql"
    );
  });

  it("passes a redefinition that starts from the newest definition", () => {
    expect(
      findDroppedFunctionChanges(migrations([...ALWAYS_POST, ...SERIAL]))
    ).toEqual([]);
  });

  it("tells an overload from the function it shares a name with", () => {
    const overload = (args: string, body: string[]) =>
      fn(body).replace("(p_job_id TEXT)", `(${args})`);
    const SERIAL_OVERLOAD = [
      "  v_serials := array_agg(p_serial ORDER BY p_serial);",
      "  PERFORM receive_serials(p_job_id, v_serials);"
    ];
    expect(
      findDroppedFunctionChanges([
        { file: "20261001101010_first.sql", contents: fn(ORIGINAL) },
        {
          file: "20261009101010_overload.sql",
          contents: overload(
            "p_job_id TEXT, p_serial character varying(20) DEFAULT NULL",
            SERIAL_OVERLOAD
          )
        },
        {
          file: "20261020101010_third.sql",
          contents: overload("text", [...ORIGINAL, ...SERIAL])
        }
      ])
    ).toEqual([]);
    // The overload redefined from an older copy of itself is still caught.
    const [finding] = findDroppedFunctionChanges([
      {
        file: "20261001101010_first.sql",
        contents: overload("t TEXT, n int", ORIGINAL)
      },
      {
        file: "20261009101010_always-post.sql",
        contents: overload("t text, n INTEGER", ALWAYS_POST)
      },
      {
        file: "20261020101010_third.sql",
        contents: overload("IN t TEXT, n int4, OUT ok boolean", [
          ...ORIGINAL,
          ...SERIAL
        ])
      }
    ]);
    expect(finding?.message).toMatch(
      /redefines public\.complete_job\(text, integer\)/
    );
  });

  it("checks a function outside the public schema", () => {
    const util = (body: string[]) =>
      fn(body).replace("public.complete_job", "util.complete_job");
    const [finding] = findDroppedFunctionChanges([
      { file: "20261001101010_first.sql", contents: util(ORIGINAL) },
      { file: "20261009101010_always-post.sql", contents: util(ALWAYS_POST) },
      {
        file: "20261020101010_third.sql",
        contents: util([...ORIGINAL, ...SERIAL])
      }
    ]);
    expect(finding?.snippet).toBe(
      "util.complete_job drops 20261009101010_always-post.sql"
    );
  });

  it("skips a function written without an AS body", () => {
    const findings = findDroppedFunctionChanges([
      ...migrations([...ORIGINAL, ...SERIAL]),
      {
        file: "20261021101010_sql-body.sql",
        contents:
          "CREATE FUNCTION public.one() RETURNS integer LANGUAGE sql RETURN 1;"
      }
    ]);
    expect(findings.map((finding) => finding.snippet)).toEqual([
      "complete_job drops 20261009101010_always-post.sql"
    ]);
  });

  // complete_job_to_inventory as its migrations defined it before 6907343728:
  // 20261014135003 added the production-event lock, and 20261014171619
  // re-created the function from the always-post body, without it.
  const jobCompletion = (file: string, lock: boolean) => ({
    file,
    contents: `
CREATE OR REPLACE FUNCTION public.complete_job_to_inventory(p_job_id TEXT, p_quantity_complete NUMERIC, p_storage_unit_id TEXT, p_user_id TEXT, p_company_id TEXT, p_location_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  FOR v_event IN
    SELECT pe.id, pe.duration, pe.type
    FROM "productionEvent" pe
    INNER JOIN "jobOperation" jo ON jo.id = pe."jobOperationId"
    WHERE jo."jobId" = p_job_id
      AND pe."endTime" IS NOT NULL
      AND pe."postedToGL" = false
      AND pe.duration > 0
${lock ? "    ORDER BY pe.id\n    FOR UPDATE OF pe" : ""}
  LOOP
    v_duration_hours := v_event.duration::NUMERIC / 3600;
  END LOOP;
END;
$$;`
  });

  it("flags 20261014171619, which dropped the production-event lock (fixed by 6907343728)", () => {
    expect(
      findDroppedFunctionChanges([
        jobCompletion("20261009010412_job-costing-always-post.sql", false),
        jobCompletion(
          "20261014135003_lock-production-events-at-job-completion.sql",
          true
        ),
        jobCompletion("20261014171619_receive-consumed-serial-units.sql", false)
      ]).map((v) => v.snippet)
    ).toEqual([
      "complete_job_to_inventory drops 20261014135003_lock-production-events-at-job-completion.sql"
    ]);
  });

  it("passes a redefinition that keeps the production-event lock", () => {
    expect(
      findDroppedFunctionChanges([
        jobCompletion("20261009010412_job-costing-always-post.sql", false),
        jobCompletion(
          "20261014135003_lock-production-events-at-job-completion.sql",
          true
        ),
        jobCompletion("20261014171619_receive-consumed-serial-units.sql", true)
      ])
    ).toEqual([]);
  });

  it("leaves migrations from before it was added alone", () => {
    expect(
      findDroppedFunctionChanges(
        migrations([...ORIGINAL, ...SERIAL], "20261012101010_third.sql")
      )
    ).toEqual([]);
  });
});

// Any migration after the cutoff.
const FILE = "20261201000000_x.sql";
const scanReplay = (sql: string) => migrationReplaySafe.scan(FILE, sql);
const snippets = (sql: string) => scanReplay(sql).map((v) => v.snippet);

// 20261019124417_account-notification-preferences.sql before f47e4a25bf.
const F47_BEFORE = `ALTER TABLE "notificationPreference" ALTER COLUMN "companyId" DROP NOT NULL;

-- NULLS NOT DISTINCT, so a user has at most one account-level row per
-- (channel, topic); the upsert's ON CONFLICT relies on it.
ALTER TABLE "notificationPreference"
  DROP CONSTRAINT "notificationPreference_userId_companyId_channel_topic_key";
ALTER TABLE "notificationPreference"
  ADD CONSTRAINT "notificationPreference_userId_companyId_channel_topic_key"
  UNIQUE NULLS NOT DISTINCT ("userId", "companyId", "channel", "topic");

-- Each user keeps the switch they flipped last, from whichever company.
INSERT INTO "notificationPreference" ("userId", "companyId", "channel", "topic", "enabled", "updatedAt")
SELECT DISTINCT ON ("userId", "channel")
  "userId", NULL, "channel", "topic", "enabled", "updatedAt"
FROM "notificationPreference"
WHERE "topic" = 'changelog' AND "companyId" IS NOT NULL
ORDER BY "userId", "channel", "updatedAt" DESC, "id" DESC;

DELETE FROM "notificationPreference"
WHERE "topic" = 'changelog' AND "companyId" IS NOT NULL;`;

const F47_AFTER = `ALTER TABLE "notificationPreference" ALTER COLUMN "companyId" DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_index i ON i.indexrelid = c.conindid
    WHERE c.conrelid = 'public."notificationPreference"'::regclass
      AND c.conname = 'notificationPreference_userId_companyId_channel_topic_key'
      AND i.indnullsnotdistinct
  ) THEN
    ALTER TABLE "notificationPreference"
      DROP CONSTRAINT IF EXISTS "notificationPreference_userId_companyId_channel_topic_key";
    ALTER TABLE "notificationPreference"
      ADD CONSTRAINT "notificationPreference_userId_companyId_channel_topic_key"
      UNIQUE NULLS NOT DISTINCT ("userId", "companyId", "channel", "topic");
  END IF;
END
$$;

INSERT INTO "notificationPreference" ("userId", "companyId", "channel", "topic", "enabled", "updatedAt")
SELECT DISTINCT ON ("userId", "channel")
  "userId", NULL, "channel", "topic", "enabled", "updatedAt"
FROM "notificationPreference"
WHERE "topic" = 'changelog' AND "companyId" IS NOT NULL
ORDER BY "userId", "channel", "updatedAt" DESC, "id" DESC
ON CONFLICT ON CONSTRAINT "notificationPreference_userId_companyId_channel_topic_key" DO NOTHING;

DELETE FROM "notificationPreference"
WHERE "topic" = 'changelog' AND "companyId" IS NOT NULL;`;

// 20260618171234_material-supersession.sql before cb75027fc2 (table body cut).
const CB75_BEFORE = `CREATE TYPE "supersessionMode" AS ENUM (
  'Consume First',
  'Prefer New',
  'Stock Only',
  'No Stock'
);

CREATE TABLE "itemSupersession" (
  "itemId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "supersessionMode" "supersessionMode" NOT NULL
);

CREATE INDEX "itemSupersession_companyId_idx" ON "itemSupersession" ("companyId");
-- Powers the "Supersedes" back-reference lookup on the successor's record.
CREATE INDEX "itemSupersession_successorItemId_idx"
  ON "itemSupersession" ("successorItemId")
  WHERE "successorItemId" IS NOT NULL;

ALTER TABLE "public"."itemSupersession" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."itemSupersession"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

-- Per-location minimum service-stock floor (used by 'Stock Only' / 'Prefer New').
ALTER TABLE "itemPlanning"
  ADD COLUMN "minimumReserveQuantity" NUMERIC NOT NULL DEFAULT 0;`;

const CB75_AFTER = `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'supersessionMode') THEN
    CREATE TYPE "supersessionMode" AS ENUM (
      'Consume First',
      'Prefer New',
      'Stock Only',
      'No Stock'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "itemSupersession" (
  "itemId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "supersessionMode" "supersessionMode" NOT NULL
);

CREATE INDEX IF NOT EXISTS "itemSupersession_companyId_idx" ON "itemSupersession" ("companyId");
-- Powers the "Supersedes" back-reference lookup on the successor's record.
CREATE INDEX IF NOT EXISTS "itemSupersession_successorItemId_idx"
  ON "itemSupersession" ("successorItemId")
  WHERE "successorItemId" IS NOT NULL;

ALTER TABLE "public"."itemSupersession" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."itemSupersession";
CREATE POLICY "SELECT" ON "public"."itemSupersession"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

-- Per-location minimum service-stock floor (used by 'Stock Only' / 'Prefer New').
ALTER TABLE "itemPlanning"
  ADD COLUMN IF NOT EXISTS "minimumReserveQuantity" NUMERIC NOT NULL DEFAULT 0;`;

// 20261118204200_supplier-card-payments.sql before #2311, which fixed a
// hand-made group, not a re-run: its INSERT was guarded already.
const CARD_GROUP_INSERT = `INSERT INTO "account" (
  number, name, "isGroup", "accountType", "incomeBalance", class,
  "parentId", "isSystem", "companyGroupId", "createdBy"
)
-- One per chart, even one with two groups of that name.
SELECT DISTINCT ON (parent."companyGroupId")
  NULL, 'Credit Cards', TRUE, 'Credit Card'::"accountType",
  'Balance Sheet'::"glIncomeBalance", 'Liability'::"glAccountClass",
  parent.id, FALSE, parent."companyGroupId", 'system'
FROM "account" parent
WHERE parent."isGroup" = TRUE
  AND parent.name = 'Current Liabilities'
  AND parent.class = 'Liability'
  AND NOT EXISTS (
    SELECT 1 FROM "account" existing
    WHERE existing."companyGroupId" = parent."companyGroupId"
      AND existing."accountType" = 'Credit Card'
      AND existing."isGroup" = TRUE
  )
ORDER BY parent."companyGroupId", parent."createdAt", parent.id;`;

describe("migrationReplaySafe", () => {
  it("flags the unguarded DROP CONSTRAINT and INSERT that f47e4a25bf fixed", () => {
    const v = scanReplay(F47_BEFORE);
    expect(v.map((x) => [x.line, x.snippet])).toEqual([
      [
        6,
        'DROP CONSTRAINT "notificationPreference_userId_companyId_channel_topic_key"'
      ],
      [12, 'INSERT INTO "notificationPreference"']
    ]);
  });

  it("passes the statements as f47e4a25bf fixed them", () => {
    expect(scanReplay(F47_AFTER)).toEqual([]);
  });

  it("flags each unguarded CREATE and ADD COLUMN that cb75027fc2 fixed", () => {
    expect(snippets(CB75_BEFORE)).toEqual([
      'CREATE TYPE "supersessionMode"',
      'CREATE TABLE "itemSupersession"',
      'CREATE INDEX "itemSupersession_companyId_idx" ON "itemSupersession"',
      'CREATE INDEX "itemSupersession_successorItemId_idx" ON "itemSupersession"',
      'CREATE POLICY "SELECT" ON "itemSupersession"',
      'ADD COLUMN "minimumReserveQuantity"'
    ]);
  });

  it("passes the statements as cb75027fc2 fixed them", () => {
    expect(scanReplay(CB75_AFTER)).toEqual([]);
  });

  // #2311 fixed a migration that failed on its first run (a guard on the wrong key), not on a
  // re-run: out of scope.
  it("passes the NOT EXISTS-guarded INSERT of the card migration", () => {
    expect(scanReplay(CARD_GROUP_INSERT)).toEqual([]);
  });

  it("only checks migrations after the newest one on main when the rule was written down", () => {
    const sql = 'CREATE TABLE "x" ("id" TEXT);';
    expect(
      migrationReplaySafe.scan("20261119125737_job-wip-balance.sql", sql)
    ).toEqual([]);
    expect(
      migrationReplaySafe.scan("20261119125738_next.sql", sql)
    ).toHaveLength(1);
  });

  it("flags a DROP of every kind without IF EXISTS", () => {
    const sql = [
      'DROP TABLE "a";',
      'DROP VIEW "b";',
      'DROP MATERIALIZED VIEW "c";',
      "DROP FUNCTION d(text);",
      'DROP TRIGGER "e" ON "t";',
      'DROP INDEX "f";',
      'DROP TYPE "g";',
      'DROP POLICY "h" ON "t";',
      'ALTER TABLE "t" DROP CONSTRAINT "i";',
      'ALTER TABLE "t" DROP COLUMN "j";',
      "DROP SEQUENCE k;",
      "DROP SCHEMA l;"
    ].join("\n");
    expect(scanReplay(sql)).toHaveLength(12);
    expect(
      scanReplay(sql.replace(/DROP (\w+(?: VIEW)?) /g, "DROP $1 IF EXISTS "))
    ).toEqual([]);
  });

  it("leaves DROP NOT NULL and DROP DEFAULT alone", () => {
    expect(
      scanReplay(
        'ALTER TABLE "t" ALTER COLUMN "a" DROP NOT NULL, ALTER COLUMN "b" DROP DEFAULT;'
      )
    ).toEqual([]);
  });

  it("flags CREATE SCHEMA, SEQUENCE and UNIQUE INDEX without IF NOT EXISTS", () => {
    expect(
      snippets(
        'CREATE SCHEMA util;\nCREATE SEQUENCE "s";\nCREATE UNIQUE INDEX "u" ON "t" ("a");'
      )
    ).toEqual([
      'CREATE SCHEMA "util"',
      'CREATE SEQUENCE "s"',
      'CREATE INDEX "u" ON "t"'
    ]);
    expect(
      scanReplay(
        'CREATE SCHEMA IF NOT EXISTS util;\nCREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "u" ON "t" ("a");'
      )
    ).toEqual([]);
  });

  it("flags ALTER TYPE … ADD VALUE without IF NOT EXISTS", () => {
    expect(snippets(`ALTER TYPE "status" ADD VALUE 'Hold';`)).toHaveLength(1);
    expect(
      scanReplay(
        `ALTER TYPE "status" ADD VALUE IF NOT EXISTS 'Hold' BEFORE 'Done';`
      )
    ).toEqual([]);
  });

  it("flags CREATE VIEW and CREATE FUNCTION without OR REPLACE, unless dropped first", () => {
    expect(
      snippets('CREATE VIEW "v" WITH (security_invoker = true) AS SELECT 1;')
    ).toEqual(['CREATE VIEW "v"']);
    expect(
      snippets(
        "CREATE FUNCTION public.f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;"
      )
    ).toEqual(['CREATE FUNCTION "f"']);
    expect(
      scanReplay(
        'DROP VIEW IF EXISTS "v";\nCREATE VIEW "v" WITH (security_invoker = true) AS SELECT 1;\n' +
          "DROP FUNCTION IF EXISTS f(int);\nCREATE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;\n" +
          'CREATE OR REPLACE VIEW "w" WITH (security_invoker = true) AS SELECT 1;'
      )
    ).toEqual([]);
  });

  it("accepts CREATE TYPE in a DO block that catches duplicate_object", () => {
    const sql = `DO $$ BEGIN
  CREATE TYPE "s" AS ENUM ('a');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`;
    expect(scanReplay(sql)).toEqual([]);
  });

  it("scans a DO block that neither branches nor catches", () => {
    const sql = "DO $$\nBEGIN\n  CREATE TYPE \"s\" AS ENUM ('a');\nEND\n$$;";
    const v = scanReplay(sql);
    expect(v.map((x) => [x.line, x.snippet])).toEqual([[3, 'CREATE TYPE "s"']]);
  });

  it("matches CREATE POLICY to a DROP POLICY IF EXISTS on the same table only", () => {
    const create =
      'CREATE POLICY "SELECT" ON "public"."b" FOR SELECT USING (true);';
    expect(
      scanReplay(`DROP POLICY IF EXISTS "SELECT" ON public.b;\n${create}`)
    ).toEqual([]);
    expect(
      scanReplay(`DROP POLICY IF EXISTS "SELECT" ON "a";\n${create}`)
    ).toHaveLength(1);
    expect(
      scanReplay(`${create}\nDROP POLICY IF EXISTS "SELECT" ON "b";`)
    ).toHaveLength(1);
  });

  it("accepts CREATE TRIGGER after DROP TRIGGER IF EXISTS on its table, or as CREATE OR REPLACE", () => {
    const create =
      'CREATE TRIGGER "t_audit" AFTER INSERT OR UPDATE ON "t" FOR EACH ROW EXECUTE FUNCTION audit();';
    expect(snippets(create)).toEqual(['CREATE TRIGGER "t_audit" ON "t"']);
    expect(
      scanReplay(`DROP TRIGGER IF EXISTS "t_audit" ON "t";\n${create}`)
    ).toEqual([]);
    expect(
      scanReplay(`DROP TRIGGER IF EXISTS "t_audit" ON "u";\n${create}`)
    ).toHaveLength(1);
    expect(
      scanReplay(create.replace("CREATE TRIGGER", "CREATE OR REPLACE TRIGGER"))
    ).toEqual([]);
  });

  it("accepts ADD CONSTRAINT after a DROP CONSTRAINT of the same name", () => {
    const add = 'ALTER TABLE "t" ADD CONSTRAINT "t_a_check" CHECK ("a" > 0);';
    expect(snippets(add)).toEqual(['ADD CONSTRAINT "t_a_check"']);
    expect(
      scanReplay(
        `ALTER TABLE "t" DROP CONSTRAINT IF EXISTS "t_a_check", ADD CONSTRAINT "t_a_check" CHECK ("a" > 0);`
      )
    ).toEqual([]);
    expect(
      scanReplay(
        `ALTER TABLE "t" DROP CONSTRAINT IF EXISTS "t_b_check";\n${add}`
      )
    ).toHaveLength(1);
  });

  it("accepts what lives on a table the migration dropped and re-creates", () => {
    const sql = `DROP TABLE IF EXISTS "changeOrderType" CASCADE;
CREATE TABLE "changeOrderType" ("id" TEXT, "name" TEXT);
CREATE INDEX "changeOrderType_name_idx" ON "changeOrderType" ("name");
ALTER TABLE "changeOrderType" ADD COLUMN "sortOrder" INTEGER;
ALTER TABLE "changeOrderType" ADD CONSTRAINT "changeOrderType_name_key" UNIQUE ("name");
CREATE POLICY "SELECT" ON "changeOrderType" FOR SELECT USING (true);
INSERT INTO "changeOrderType" ("name") VALUES ('Safety');`;
    expect(scanReplay(sql)).toEqual([]);
  });

  it("accepts statements on a temp table", () => {
    const sql = `CREATE TEMP TABLE "leaseReleasedRun" ("runId" TEXT) ON COMMIT DROP;
INSERT INTO "leaseReleasedRun" ("runId") SELECT "id" FROM "run";
DROP TABLE "leaseReleasedRun";
CREATE FUNCTION pg_temp.doc(t text) RETURNS text AS $$ SELECT t $$ LANGUAGE sql;`;
    expect(scanReplay(sql)).toEqual([]);
  });

  it("flags an INSERT with no guard, and accepts each guard", () => {
    const insert = `INSERT INTO "supplierStage" ("name", "companyId")
SELECT stage, c."id" FROM "company" c CROSS JOIN unnest(ARRAY['Prospect']) AS stage`;
    expect(snippets(`${insert};`)).toEqual(['INSERT INTO "supplierStage"']);
    expect(scanReplay(`${insert}\nON CONFLICT DO NOTHING;`)).toEqual([]);
    expect(
      scanReplay(
        `${insert}\nLEFT JOIN "supplierStage" s ON s."companyId" = c."id" AND s."name" = stage\nWHERE s."id" IS NULL;`
      )
    ).toEqual([]);
    expect(
      scanReplay(
        `DELETE FROM "supplierStage" WHERE "name" = 'Prospect';\n${insert};`
      )
    ).toEqual([]);
  });

  it("does not take a NOT over a plain condition as a guard", () => {
    const sql = `INSERT INTO "supplierStage" ("name", "companyId")
SELECT 'Prospect', c."id" FROM "company" c WHERE NOT c."archived";`;
    expect(snippets(sql)).toEqual(['INSERT INTO "supplierStage"']);
  });

  it("does not take EXISTS or IN (SELECT …) without NOT as a guard", () => {
    const insert = `INSERT INTO "supplierStage" ("name", "companyId")
SELECT 'Prospect', c."id" FROM "company" c`;
    expect(
      snippets(
        `${insert} WHERE EXISTS (SELECT 1 FROM "supplier" s WHERE s."companyId" = c."id");`
      )
    ).toEqual(['INSERT INTO "supplierStage"']);
    expect(
      snippets(
        `${insert} WHERE c."id" IN (SELECT "companyId" FROM "supplier");`
      )
    ).toEqual(['INSERT INTO "supplierStage"']);
  });

  it("ignores statements in comments, strings and function bodies", () => {
    const sql = `-- CREATE TABLE "a" ();
/* DROP TABLE "b"; /* nested */ CREATE TYPE "c" AS ENUM ('x'); */
COMMENT ON TABLE "t" IS 'DROP TABLE "d"; INSERT INTO "e" VALUES (1)';
SELECT E'it\\'s ADD COLUMN "f"';
CREATE OR REPLACE FUNCTION g() RETURNS void AS $function$
BEGIN
  INSERT INTO "h" VALUES (1);
  DROP TABLE "i";
END;
$function$ LANGUAGE plpgsql;`;
    expect(scanReplay(sql)).toEqual([]);
  });

  it("ignores a keyword inside a quoted name", () => {
    const sql = `ALTER POLICY "Anyone with settings_create can insert into the public bucket" ON storage.objects
  WITH CHECK (bucket_id = 'public');`;
    expect(scanReplay(sql)).toEqual([]);
  });

  it("keeps line numbers after comments and dollar-quoted bodies", () => {
    const sql = `/* one
two */
CREATE OR REPLACE FUNCTION f() RETURNS int AS $$
  SELECT 1
$$ LANGUAGE sql;
ALTER TABLE "t" ADD COLUMN "a" TEXT;`;
    expect(scanReplay(sql)[0]?.line).toBe(6);
  });

  it("skips a migration generated from the authz manifest", () => {
    const sql = `${GENERATED_AUTHZ_MIGRATION}\nCREATE POLICY "SELECT" ON "public"."item" FOR SELECT USING (true);`;
    expect(scanReplay(sql)).toEqual([]);
  });
  it("leaves an unnamed constraint alone: a re-run adds it under a new name", () => {
    expect(scanReplay('ALTER TABLE "t" ADD CHECK ("a" > 0);')).toEqual([]);
  });

  it("trusts a DO block whose body the PL/pgSQL parser cannot read", () => {
    // A %ROWTYPE variable needs the catalog, so the block's structure is unknown.
    const sql = `DO $$
DECLARE
  v_row "t"%ROWTYPE;
BEGIN
  SELECT * INTO v_row.a, v_row FROM t;
  CREATE TABLE "x" ("id" TEXT);
END $$;`;
    expect(scanReplay(sql)).toEqual([]);
  });
});

const FK_NEW = "20261201000000_new.sql";

/** The keys of the real migrations: which parents can take a composite FK today. */
const REPO = tenantFkCompositeScan(
  tenantKeysFromMigrations(loadSqlFiles(migrationsDir(repoRoot())))
);

/** A parent keyed ("id", "companyId") and one keyed by id alone. */
const PARENTS = tenantKeysFromMigrations([
  {
    file: "20260101000000_parents.sql",
    contents: [
      'CREATE TABLE "workCenter" (',
      '  "id" TEXT NOT NULL,',
      '  "companyId" TEXT NOT NULL,',
      '  CONSTRAINT "workCenter_pkey" PRIMARY KEY ("id", "companyId")',
      ");",
      'CREATE TABLE "journal" ("id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL);',
      'CREATE TABLE "integration" ("id" TEXT PRIMARY KEY);',
      'CREATE TABLE "customer" ("id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL);',
      'ALTER TABLE "customer" ADD CONSTRAINT "customer_id_companyId_key" UNIQUE ("id", "companyId");',
      'CREATE TABLE "purchaseOrder" ("id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL);',
      'CREATE UNIQUE INDEX "purchaseOrder_id_companyId_key" ON "purchaseOrder" ("id", "companyId");',
      'CREATE TABLE "salesOrder" ("id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL);',
      'CREATE UNIQUE INDEX "salesOrder_open_key" ON "salesOrder" ("id", "companyId") WHERE "status" = \'Open\';',
      'CREATE TABLE "payment" ("id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL);',
      'CREATE TABLE "userNote" ("id" TEXT PRIMARY KEY, "customerId" TEXT);'
    ].join("\n")
  }
]);
const FIXTURE = tenantFkCompositeScan(PARENTS);

const findings = (
  sql: string,
  check = FIXTURE,
  file = FK_NEW
): { line: number; column: string }[] =>
  check.scan(file, sql).map(({ line, message }) => ({
    line,
    column: message.split(" ")[0] ?? ""
  }));

describe("tenantFkComposite", () => {
  // 20261013030022_oee-provider.sql lines 91-116, from `git show 3fc6be2f2d^`.
  const OEE_DEVICE_BEFORE_3FC6BE2F2D = `CREATE TABLE IF NOT EXISTS "workCenterDevice" (
  "id" TEXT NOT NULL DEFAULT id('wcd'),
  "companyId" TEXT NOT NULL,
  "workCenterId" TEXT NOT NULL REFERENCES "workCenter"("id") ON DELETE CASCADE,
  "integration" TEXT NOT NULL REFERENCES "integration"("id"),
  "externalDeviceId" TEXT NOT NULL,
  "externalSiteId" TEXT,
  "siteTimezone" TEXT,
  "deviceName" TEXT NOT NULL,
  "currentState" "machineState",
  "currentStateAt" TIMESTAMP WITH TIME ZONE,
  "appliedThrough" TIMESTAMP WITH TIME ZONE,
  "lastEventAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "lastManualChangeAt" TIMESTAMP WITH TIME ZONE,
  "lastSyncedAt" TIMESTAMP WITH TIME ZONE,
  "lastSyncError" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "workCenterDevice_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "workCenterDevice_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workCenterDevice_workCenter_key" UNIQUE ("workCenterId", "companyId"),
  CONSTRAINT "workCenterDevice_device_key" UNIQUE ("integration", "externalDeviceId", "companyId")
);`;

  it("flags workCenterDevice.workCenterId from before 3fc6be2f2d", () => {
    expect(findings(OEE_DEVICE_BEFORE_3FC6BE2F2D, REPO)).toEqual([
      { line: 4, column: "workCenterDevice.workCenterId" }
    ]);
  });

  it("passes the 3fc6be2f2d fix (20261013191915_oee-tenancy-and-retention.sql lines 7-12)", () => {
    const fix = `ALTER TABLE "workCenterDevice"
  DROP CONSTRAINT IF EXISTS "workCenterDevice_workCenterId_fkey";
ALTER TABLE "workCenterDevice"
  ADD CONSTRAINT "workCenterDevice_workCenterId_fkey"
  FOREIGN KEY ("workCenterId", "companyId")
  REFERENCES "workCenter" ("id", "companyId") ON DELETE CASCADE;`;
    expect(findings(fix, REPO)).toEqual([]);
  });

  it("flags machineStateChange and unattributedMachineTime from before 8a5281c6ff", () => {
    // 20261013030022_oee-provider.sql lines 122-126 and 144-147, from `git show 8a5281c6ff^`.
    const before = `CREATE TABLE IF NOT EXISTS "machineStateChange" (
  "id" TEXT NOT NULL DEFAULT id('msc'),
  "companyId" TEXT NOT NULL,
  "workCenterDeviceId" TEXT NOT NULL,
  "workCenterId" TEXT NOT NULL REFERENCES "workCenter"("id") ON DELETE CASCADE,
  "externalEventId" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "unattributedMachineTime" (
  "id" TEXT NOT NULL DEFAULT id('umt'),
  "companyId" TEXT NOT NULL,
  "workCenterId" TEXT NOT NULL REFERENCES "workCenter"("id") ON DELETE CASCADE,
  "startTime" TIMESTAMP WITH TIME ZONE NOT NULL
);`;
    expect(findings(before, REPO)).toEqual([
      { line: 5, column: "machineStateChange.workCenterId" },
      { line: 11, column: "unattributedMachineTime.workCenterId" }
    ]);
  });

  it("passes the 8a5281c6ff fix (20261013201722_oee-company-scoped-work-center.sql lines 5-16)", () => {
    const fix = `ALTER TABLE "machineStateChange"
  DROP CONSTRAINT IF EXISTS "machineStateChange_workCenterId_fkey";
ALTER TABLE "machineStateChange"
  ADD CONSTRAINT "machineStateChange_workCenterId_fkey"
  FOREIGN KEY ("workCenterId", "companyId")
  REFERENCES "workCenter" ("id", "companyId") ON DELETE CASCADE;

ALTER TABLE "unattributedMachineTime"
  DROP CONSTRAINT IF EXISTS "unattributedMachineTime_workCenterId_fkey";
ALTER TABLE "unattributedMachineTime"
  ADD CONSTRAINT "unattributedMachineTime_workCenterId_fkey"
  FOREIGN KEY ("workCenterId", "companyId")
  REFERENCES "workCenter" ("id", "companyId") ON DELETE CASCADE;`;
    expect(findings(fix, REPO)).toEqual([]);
  });

  it("flags payment.purchaseOrderId in a DO block from before aa781984a4", () => {
    // 20261105213627_supplier-prepayments.sql lines 9-18, from `git show aa781984a4^`.
    const before = `ALTER TABLE "payment" ADD COLUMN IF NOT EXISTS "purchaseOrderId" TEXT;

DO $prepay$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_purchaseOrder_fkey') THEN
    ALTER TABLE "payment" ADD CONSTRAINT "payment_purchaseOrder_fkey"
      FOREIGN KEY ("purchaseOrderId")
      REFERENCES "purchaseOrder"("id") ON DELETE SET NULL;
  END IF;
END $prepay$;`;
    expect(findings(before, REPO)).toEqual([
      { line: 8, column: "payment.purchaseOrderId" }
    ]);
  });

  it("passes the aa781984a4 fix (20261105213627_supplier-prepayments.sql lines 9-18)", () => {
    const fix = `ALTER TABLE "payment" ADD COLUMN IF NOT EXISTS "purchaseOrderId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "purchaseOrder_id_companyId_key"
  ON "purchaseOrder" ("id", "companyId");

ALTER TABLE "payment" DROP CONSTRAINT IF EXISTS "payment_purchaseOrder_fkey";
ALTER TABLE "payment" ADD CONSTRAINT "payment_purchaseOrder_fkey"
  FOREIGN KEY ("purchaseOrderId", "companyId")
  REFERENCES "purchaseOrder"("id", "companyId")
  ON DELETE SET NULL ("purchaseOrderId");`;
    expect(findings(fix, REPO)).toEqual([]);
  });

  it("flags customerAsset.customerId from before ba1db4283e", () => {
    // 20261021002400_field-service.sql lines 7-29, from `git show ba1db4283e^`.
    const before = `CREATE TABLE IF NOT EXISTS "customerAsset" (
  "id" TEXT NOT NULL DEFAULT id('cas'),
  "companyId" TEXT NOT NULL,
  "trackedEntityId" TEXT NOT NULL REFERENCES "trackedEntity"("id"),
  "itemId" TEXT NOT NULL REFERENCES "item"("id"),
  "customerId" TEXT NOT NULL REFERENCES "customer"("id"),
  "customerLocationId" TEXT REFERENCES "customerLocation"("id") ON DELETE SET NULL,
  "status" "customerAssetStatus" NOT NULL DEFAULT 'In Service',
  "shippedDate" DATE,
  "laborWarrantyEndDate" DATE,
  "partsWarrantyEndDate" DATE,
  "shipmentId" TEXT REFERENCES "shipment"("id") ON DELETE SET NULL,  -- the shipment that created or last moved it
  "source" TEXT NOT NULL DEFAULT 'Shipment' CHECK ("source" IN ('Shipment', 'Manual')),
  "notes" JSONB,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "customerAsset_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerAsset_trackedEntity_key" UNIQUE ("trackedEntityId", "companyId"),
  CONSTRAINT "customerAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);`;
    expect(findings(before, REPO)).toEqual([
      { line: 6, column: "customerAsset.customerId" }
    ]);
  });

  it("passes the ba1db4283e fix (20261104215223_composite-customer-fks-service-projects.sql lines 7-10)", () => {
    const fix = `ALTER TABLE "customerAsset"
  DROP CONSTRAINT "customerAsset_customerId_fkey",
  ADD CONSTRAINT "customerAsset_customerId_fkey"
    FOREIGN KEY ("customerId", "companyId") REFERENCES "customer"("id", "companyId");`;
    expect(findings(fix, REPO)).toEqual([]);
  });

  it("names the composite FOREIGN KEY in its message", () => {
    const [v] = FIXTURE.scan(
      FK_NEW,
      'CREATE TABLE "x" ("id" TEXT, "companyId" TEXT NOT NULL, "customerId" TEXT REFERENCES "customer"("id"));'
    );
    expect(v?.message).toContain(
      'FOREIGN KEY ("customerId", "companyId") REFERENCES "customer"("id", "companyId")'
    );
    expect(v?.snippet).toBe(
      'CREATE TABLE "x" ("id" TEXT, "companyId" TEXT NOT NULL, "customerId" TEXT REFERENCES "customer"("id")'
    );
  });

  it("flags a parent keyed by a UNIQUE constraint or a unique index, and a reference with no column list", () => {
    const sql = [
      'CREATE TABLE "x" (',
      '  "companyId" TEXT NOT NULL,',
      '  "customerId" TEXT REFERENCES "customer",',
      '  "purchaseOrderId" TEXT REFERENCES public."purchaseOrder"("id")',
      ");"
    ].join("\n");
    expect(findings(sql)).toEqual([
      { line: 3, column: "x.customerId" },
      { line: 4, column: "x.purchaseOrderId" }
    ]);
  });

  it("flags an ADD COLUMN on a table that gained companyId in an earlier migration", () => {
    expect(
      findings(
        'ALTER TABLE "payment" ADD COLUMN "salesCustomerId" TEXT REFERENCES "customer"("id") ON DELETE SET NULL;'
      )
    ).toEqual([{ line: 1, column: "payment.salesCustomerId" }]);
  });

  it("counts a parent keyed in the same migration", () => {
    const sql = [
      'CREATE TABLE "lease" ("id" TEXT, "companyId" TEXT, PRIMARY KEY ("companyId", "id"));',
      'CREATE TABLE "leaseLine" ("companyId" TEXT, "leaseId" TEXT REFERENCES "lease"("id"));'
    ].join("\n");
    expect(findings(sql)).toEqual([{ line: 2, column: "leaseLine.leaseId" }]);
  });

  it("leaves parents keyed by id alone, global tables and partial unique indexes alone", () => {
    const sql = [
      'CREATE TABLE "x" (',
      '  "companyId" TEXT NOT NULL REFERENCES "company"("id"),',
      '  "journalId" TEXT REFERENCES "journal"("id"),',
      '  "integration" TEXT REFERENCES "integration"("id"),',
      '  "salesOrderId" TEXT REFERENCES "salesOrder"("id")',
      ");"
    ].join("\n");
    expect(findings(sql)).toEqual([]);
  });

  it("leaves a referencing table without companyId alone", () => {
    expect(
      findings(
        'ALTER TABLE "userNote" ADD CONSTRAINT "userNote_customer_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id");'
      )
    ).toEqual([]);
  });

  it("leaves a reference to a column other than id alone", () => {
    expect(
      findings(
        'CREATE TABLE "x" ("companyId" TEXT, "code" TEXT REFERENCES "customer"("customerId"));'
      )
    ).toEqual([]);
  });

  it("ignores REFERENCES in a comment", () => {
    expect(
      findings(
        '-- was "customerId" TEXT REFERENCES "customer"("id")\nCREATE TABLE "x" ("companyId" TEXT);'
      )
    ).toEqual([]);
  });

  it("does not apply to migrations on main before the check", () => {
    expect(
      findings(
        OEE_DEVICE_BEFORE_3FC6BE2F2D,
        REPO,
        "20261013030022_oee-provider.sql"
      )
    ).toEqual([]);
  });

  it("reads the keys from every migration it is given", () => {
    const parent = {
      file: "20261201000000_parent.sql",
      contents:
        'CREATE TABLE "lease" ("id" TEXT, "companyId" TEXT, PRIMARY KEY ("id", "companyId"));'
    };
    const child = {
      file: "20261202000000_child.sql",
      contents:
        'CREATE TABLE "leaseLine" ("companyId" TEXT, "leaseId" TEXT REFERENCES "lease"("id"));'
    };
    expect(
      tenantFkComposite
        .find({ files: [parent, child] })
        .map(({ file, line }) => [file, line])
    ).toEqual([["20261202000000_child.sql", 1]]);
  });
});
