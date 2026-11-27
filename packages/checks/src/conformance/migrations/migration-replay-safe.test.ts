// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { GENERATED_AUTHZ_MIGRATION } from "../../sources/migrations";
import { migrationReplaySafe } from "./migration-replay-safe";

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
