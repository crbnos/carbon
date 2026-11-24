// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../sources/migrations";
import {
  GENERATED_AUTHZ_MIGRATION,
  noAuthzDdlInMigrations
} from "./no-authz-ddl-in-migrations";

const check = noAuthzDdlInMigrations([
  {
    schema: "public",
    name: "get_companies_with_employee_role",
    file: "packages/database/src/authz/helpers/get_companies_with_employee_role.sql",
    since: "20260927000000"
  },
  {
    schema: "public",
    name: "dispatch_event_batch",
    file: "packages/database/src/event-system/functions/dispatch_event_batch.sql",
    since: "20261002114954"
  },
  {
    schema: "util",
    name: "wake_event_queue",
    file: "packages/database/src/event-system/functions/util.wake_event_queue.sql",
    since: "20261002114954"
  }
]);
const NEW = "20260928120000_widget.sql";
const AFTER_EVENT_TAKEOVER = "20261003120000_widget.sql";

describe("noAuthzDdlInMigrations", () => {
  it("flags CREATE POLICY and ALTER POLICY in a new migration", () => {
    const sql = `CREATE POLICY "SELECT" ON "public"."widget" FOR SELECT USING (true);
ALTER POLICY "SELECT" ON "public"."widget" USING (false);`;
    expect(check.scan(NEW, sql).map((v) => v.line)).toEqual([1, 2]);
  });

  it("flags a policy whose target is on the next line, at the CREATE line", () => {
    const sql = `SELECT 1;\nCREATE POLICY "SELECT"\n  ON widget FOR SELECT USING (true);`;
    expect(check.scan(NEW, sql).map((v) => v.line)).toEqual([2]);
  });

  it("allows policies outside public (storage buckets are not in the manifest)", () => {
    const sql = `CREATE POLICY "Bucket read" ON storage.objects FOR SELECT USING (true);
CREATE POLICY "x" ON "storage"."objects" FOR INSERT WITH CHECK (true);`;
    expect(check.scan(NEW, sql)).toEqual([]);
  });

  it("flags a policy on realtime.messages (broadcast authorization is in the manifest)", () => {
    const sql = `CREATE POLICY "company topic" ON realtime.messages FOR SELECT USING (true);`;
    expect(check.scan(NEW, sql)).toHaveLength(1);
  });

  it("flags a call that attaches event triggers (they are declared in attachments.ts)", () => {
    const sql = `SELECT attach_event_trigger('widget', ARRAY['sync_widget']::TEXT[]);
SELECT attach_statement_handler('widget', ARRAY['broadcast_table_changes']);
SELECT set_event_triggers('widget');`;
    expect(check.scan("20261101120000_widget.sql", sql)).toHaveLength(3);
    expect(check.scan("20261004194526_before.sql", sql)).toEqual([]);
  });

  // The two forks the check exists for. Each shipped before its function was
  // taken over, so it replays here as a migration written after the takeover.
  const forked = noAuthzDdlInMigrations([
    {
      schema: "public",
      name: "get_companies_with_employee_permission",
      file: "packages/database/src/authz/helpers/get_companies_with_employee_permission.sql",
      since: "20260927000000"
    },
    {
      schema: "public",
      name: "create_audit_log_table",
      file: "packages/database/src/event-system/functions/create_audit_log_table.sql",
      since: "20261002114954"
    }
  ]);

  it("flags the helper redefinition that dropped STABLE, fixed by 4df5f8c9bd", () => {
    // 20260925121735_rpc-function-guards.sql before 4df5f8c9bd: CREATE OR
    // REPLACE without STABLE made the RLS helper VOLATILE again.
    const sql = `CREATE OR REPLACE FUNCTION public.get_companies_with_employee_permission(permission text)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  permission_companies text[];
BEGIN
  RETURN permission_companies;
END;
$function$;`;
    expect(forked.scan(NEW, sql).map((v) => v.snippet)).toEqual([
      "CREATE OR REPLACE FUNCTION public.get_companies_with_employee_permission"
    ]);
  });

  it("flags the create_audit_log_table fork that ran DDL on every audit write, fixed by 1f5183a1f2", () => {
    // 20260924171942_audit-log-company-scope.sql before 1f5183a1f2: the
    // existing-table path re-attached the append-only trigger every call.
    const sql = `-- Fork create_audit_log_table (live def, 20260818014100): guard first, then
-- secure_audit_log_table on both the existing-table and the new-table path.
CREATE OR REPLACE FUNCTION public.create_audit_log_table(p_company_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  tbl_name TEXT;
BEGIN
  PERFORM assert_audit_log_access(p_company_id, 'settings_update');
  tbl_name := 'auditLog_' || p_company_id;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND information_schema.tables.table_name = tbl_name
  ) THEN
    PERFORM attach_audit_log_append_only(tbl_name);
    PERFORM secure_audit_log_table(p_company_id);
    RETURN;
  END IF;
END;
$function$;`;
    expect(forked.scan(AFTER_EVENT_TAKEOVER, sql).map((v) => v.line)).toEqual([
      3
    ]);
  });

  it("allows DROP POLICY (needed before dropping a column a policy uses)", () => {
    expect(
      check.scan(NEW, `DROP POLICY "SELECT" ON "public"."widget";`)
    ).toEqual([]);
  });

  it("flags defining, altering or dropping a managed helper, however it is spelled", () => {
    const sql = `CREATE OR REPLACE FUNCTION public.get_companies_with_employee_role() RETURNS text[] AS $$ $$;
ALTER FUNCTION "public"."get_companies_with_employee_role"() VOLATILE;
DROP FUNCTION IF EXISTS get_companies_with_employee_role();`;
    expect(check.scan(NEW, sql)).toHaveLength(3);
  });

  it("flags an event-system function, in public or util, after its takeover", () => {
    const sql = `CREATE OR REPLACE FUNCTION public.dispatch_event_batch() RETURNS trigger AS $$ $$;
CREATE OR REPLACE FUNCTION util.wake_event_queue() RETURNS void AS $$ $$;`;
    const found = check.scan(AFTER_EVENT_TAKEOVER, sql);
    expect(found.map((v) => v.line)).toEqual([1, 2]);
    expect(found[1]?.message).toContain("util.wake_event_queue.sql");
  });

  it("leaves event-system migrations from before the takeover as history", () => {
    const sql =
      "CREATE OR REPLACE FUNCTION public.dispatch_event_batch() RETURNS trigger AS $$ $$;";
    expect(
      check.scan(
        "20261001195204_event-dispatch-skip-unchanged-updates.sql",
        sql
      )
    ).toEqual([]);
  });

  it("tells a managed function from its namesake in another schema", () => {
    expect(
      check.scan(
        AFTER_EVENT_TAKEOVER,
        "CREATE OR REPLACE FUNCTION public.wake_event_queue() RETURNS void AS $$ $$;"
      )
    ).toEqual([]);
  });

  it("allows any other function", () => {
    expect(
      check.scan(
        NEW,
        "CREATE OR REPLACE FUNCTION public.get_part_details() RETURNS void AS $$ $$;"
      )
    ).toEqual([]);
  });

  it("exempts only the exact header `authz migration` writes", () => {
    const source = readFileSync(
      join(repoRoot(), "packages/database/src/authz/migration.ts"),
      "utf8"
    );
    expect(source).toContain(JSON.stringify(GENERATED_AUTHZ_MIGRATION));
    const edited = GENERATED_AUTHZ_MIGRATION.replace("Do not edit.", "Edited.");
    expect(
      check.scan(
        NEW,
        `${edited}\nCREATE POLICY "SELECT" ON public.widget FOR SELECT USING (true);`
      )
    ).toHaveLength(1);
  });

  it("allows a migration rendered by `authz migration`", () => {
    const sql = `-- Generated by \`pnpm --filter @carbon/database authz migration\` from packages/database/src/authz. Do not edit.
CREATE POLICY "SELECT" ON public.widget FOR SELECT USING (true);`;
    expect(check.scan(NEW, sql)).toEqual([]);
  });

  it("ignores migrations from before the manifest took over, and comments", () => {
    const sql = `CREATE POLICY "SELECT" ON t FOR SELECT USING (true);`;
    expect(check.scan("20260926141957_employee-pin.sql", sql)).toEqual([]);
    expect(check.scan(NEW, `-- CREATE POLICY "x" ON t`)).toEqual([]);
  });
});
