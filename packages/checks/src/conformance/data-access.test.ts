// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { loadDbTableColumnTypes } from "../sources/db-columns";
import { repoRoot } from "../sources/migrations";
import { loadTypescriptFiles } from "../sources/typescript";
import {
  COUNTER_COLUMNS,
  counterWriteRelative,
  findStampColumnMismatches,
  mesUnitWriteResolvesUnit,
  noChainedClientWrites,
  noDbClientInService,
  noDiscardedQueryError,
  noInlineUniqueViolation,
  noMissingAuditColumn,
  noPostgresChanges,
  noRawOrSearch,
  noUnscopedKyselyWrite,
  noUnscopedSupabaseWrite,
  statusColumns,
  statusWriteGuarded,
  UNIT_PICK_ALLOW_LIST,
  UNIT_WRITE_ALLOW_LIST,
  unitPickers,
  unitWriters
} from "./data-access";

describe("noInlineUniqueViolation", () => {
  const scan = (file: string, src: string) =>
    noInlineUniqueViolation.scan(file, src);

  it("flags an inline SQLSTATE comparison in a route", () => {
    const v = scan(
      "apps/erp/app/routes/x.tsx",
      `if (result.error?.code === "23505") {\n  return fail();\n}`
    );
    expect(v).toHaveLength(1);
    expect(v[0]!.line).toBe(1);
  });

  it("accepts the shared helper call", () => {
    expect(
      scan(
        "apps/erp/app/routes/x.tsx",
        `if (isUniqueViolation(result.error)) return fail();`
      )
    ).toHaveLength(0);
  });

  it("exempts the helper's own file", () => {
    expect(
      scan("packages/utils/src/errors.ts", `const UNIQUE_VIOLATION = "23505";`)
    ).toHaveLength(0);
  });
});

const orSearchScan = (contents: string) =>
  noRawOrSearch.scan("a.service.ts", contents);

describe("no-raw-or-search", () => {
  it("flags search text interpolated into an .or() ilike", () => {
    expect(
      orSearchScan(
        "query.or(\n  `name.ilike.%${args.search}%,id.ilike.%${args.search}%`\n);"
      )
    ).toHaveLength(1);
    expect(orSearchScan("query.or(`id.ilike.${pattern}`);")).toHaveLength(1);
  });

  it("passes searchFilter and .or() filters on ids the code built", () => {
    expect(
      orSearchScan('query.or(searchFilter(["name"], args.search));')
    ).toHaveLength(0);
    expect(
      orSearchScan("query.or(`companyId.eq.${companyId},companyId.is.null`);")
    ).toHaveLength(0);
  });
});

const postgresChangesScan = (contents: string) =>
  noPostgresChanges.scan("apps/erp/app/hooks/useThing.tsx", contents);

describe("noPostgresChanges", () => {
  it("flags a postgres_changes subscription, at its line", () => {
    const violations = postgresChangesScan(
      `channel.on(\n  "postgres_changes",\n  { event: "*", schema: "public", table: "job" },\n  refresh\n);`
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.line).toBe(2);
  });

  it("accepts a broadcast subscription", () => {
    expect(
      postgresChangesScan(
        `channel.on("broadcast", { event: "*" }, ({ payload }) => {});`
      )
    ).toEqual([]);
  });

  it("ignores the words in a comment or prose", () => {
    expect(
      postgresChangesScan(`// this used to be a postgres_changes subscription`)
    ).toEqual([]);
  });
});

const DB_CLIENT_SERVICE =
  "apps/erp/app/modules/production/production.service.ts";

describe("noDbClientInService", () => {
  it("flags getProcessPool() in a service file", () => {
    const ts = "const pool = getProcessPool();";
    const v = noDbClientInService.scan(DB_CLIENT_SERVICE, ts);
    expect(v).toHaveLength(1);
    expect(v[0]?.snippet).toBe("getProcessPool(");
  });

  it("flags getPostgresClient() in a service file", () => {
    const ts = "return getPostgresClient(pool, PostgresDriver);";
    // getPostgresClient( and PostgresDriver both match
    const v = noDbClientInService.scan(DB_CLIENT_SERVICE, ts);
    expect(v).toHaveLength(2);
  });

  it("flags a raw new Pool()", () => {
    const ts = "const pool = new Pool({ connectionString });";
    expect(noDbClientInService.scan(DB_CLIENT_SERVICE, ts)).toHaveLength(1);
  });

  it("flags getDatabaseClient() and getJobDatabaseClient() in a service file", () => {
    const ts = [
      'import { getDatabaseClient } from "~/services/database.server";',
      "const db = getDatabaseClient();",
      "await seed(getJobDatabaseClient(5), args);"
    ].join("\n");
    const v = noDbClientInService.scan(DB_CLIENT_SERVICE, ts);
    // The import names the getter without calling it; only the calls count.
    expect(v.map((x) => [x.line, x.snippet])).toEqual([
      [2, "getDatabaseClient("],
      [3, "getJobDatabaseClient("]
    ]);
  });

  it("ignores the getter named in a comment", () => {
    const ts = [
      "// The route passes getDatabaseClient() in as `db`.",
      "/**",
      " * Called with getDatabaseClient() from the route.",
      " */"
    ].join("\n");
    expect(noDbClientInService.scan(DB_CLIENT_SERVICE, ts)).toHaveLength(0);
  });

  it("allows a type-only import of the Kysely types", () => {
    const ts =
      'import type { Kysely, KyselyDatabase } from "@carbon/database/client";';
    expect(noDbClientInService.scan(DB_CLIENT_SERVICE, ts)).toHaveLength(0);
  });

  it("allows importing the sql template from kysely", () => {
    const ts = 'import { sql } from "kysely";';
    expect(noDbClientInService.scan(DB_CLIENT_SERVICE, ts)).toHaveLength(0);
  });

  it("allows a service that RECEIVES db and opens a transaction", () => {
    const ts = [
      "export async function updateOrder(db: Kysely<KyselyDatabase>, updates) {",
      "  return db.transaction().execute(async (trx) => {});",
      "}"
    ].join("\n");
    expect(noDbClientInService.scan(DB_CLIENT_SERVICE, ts)).toHaveLength(0);
  });

  it("does NOT scan .server.ts (the sanctioned home for a DB client)", () => {
    const ts =
      "const pool = getProcessPool(); getPostgresClient(pool, PostgresDriver);";
    expect(
      noDbClientInService.scan("apps/erp/app/services/database.server.ts", ts)
    ).toHaveLength(0);
  });

  it("does not confuse *.service.test.ts for a service file", () => {
    const ts = "const pool = getProcessPool();";
    expect(
      noDbClientInService.scan(
        "apps/erp/app/modules/production/production.service.test.ts",
        ts
      )
    ).toHaveLength(0);
  });
});

const UNSCOPED_SERVICE = "apps/erp/app/modules/sales/sales.service.ts";
const unscopedScan = (ts: string, file = UNSCOPED_SERVICE) =>
  noUnscopedKyselyWrite.scan(file, ts);

describe("noUnscopedKyselyWrite", () => {
  it("flags the reported shape: an update keyed by id alone", () => {
    const ts = [
      "for (const { id, sortOrder, updatedBy } of updates) {",
      "  await trx",
      '    .updateTable("quoteLine")',
      "    .set({ sortOrder, updatedBy })",
      '    .where("id", "=", id)',
      "    .execute();",
      "}"
    ].join("\n");
    const v = unscopedScan(ts);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(3);
    expect(v[0]?.snippet).toBe('.updateTable("quoteLine")');
  });

  it("flags a delete keyed by a parent id alone", () => {
    const ts =
      'await trx.deleteFrom("jobMaterialStep").where("jobOperationStepId", "in", ids).execute();';
    expect(unscopedScan(ts)).toHaveLength(1);
  });

  it("allows a write scoped by companyId", () => {
    const ts = [
      "await trx",
      '  .updateTable("quoteLine")',
      "  .set({ sortOrder })",
      '  .where("id", "=", id)',
      '  .where("companyId", "=", companyId)',
      "  .execute();"
    ].join("\n");
    expect(unscopedScan(ts)).toHaveLength(0);
  });

  it("accepts companyGroupId on a group-scoped table with no companyId", () => {
    const ts = [
      "await trx",
      '  .updateTable("currency")',
      "  .set({ decimalPlaces })",
      '  .where("id", "=", id)',
      '  .where("companyGroupId", "=", companyGroupId)',
      "  .execute();"
    ].join("\n");
    expect(unscopedScan(ts)).toHaveLength(0);
  });

  it("does not accept companyGroupId on a company-scoped table", () => {
    const ts = [
      "await trx",
      '  .updateTable("quoteLine")',
      "  .set({ sortOrder })",
      '  .where("id", "=", id)',
      '  .where("companyGroupId", "=", companyGroupId)',
      "  .execute();"
    ].join("\n");
    expect(unscopedScan(ts)).toHaveLength(1);
  });

  it("still flags a group-scoped table written by id alone", () => {
    const ts =
      'await trx.updateTable("currency").set({ decimalPlaces }).where("id", "=", id).execute();';
    expect(unscopedScan(ts)).toHaveLength(1);
  });

  it("accepts an aliased table's qualified companyId", () => {
    const ts =
      'await trx.updateTable("job as j").set({ status }).where("j.id", "=", id).where("j.companyId", "=", companyId).executeTakeFirst();';
    expect(unscopedScan(ts)).toHaveLength(0);
  });

  it("requires the predicate on a table named by a variable too", () => {
    const ts = [
      'const slideTable = "jobOperationStepSlide" as const;',
      'await trx.deleteFrom(slideTable).where("stepId", "in", ids).execute();'
    ].join("\n");
    expect(unscopedScan(ts)).toHaveLength(1);
  });

  it("does not count companyId in the SET as scoping", () => {
    const ts =
      'await trx.updateTable("item").set({ companyId, name }).where("id", "=", id).execute();';
    expect(unscopedScan(ts)).toHaveLength(1);
  });

  it("does not let a NEIGHBOURING statement's companyId scope this one", () => {
    const ts = [
      'await trx.updateTable("quoteLine").set({ sortOrder }).where("id", "=", id).execute();',
      'await trx.updateTable("quote").set({ status }).where("id", "=", quoteId).where("companyId", "=", companyId).execute();'
    ].join("\n");
    const v = unscopedScan(ts);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(1);
  });

  it("does not let a sibling array element's companyId scope this one", () => {
    const ts = [
      "await Promise.all([",
      '  trx.deleteFrom("a").where("id", "=", id),',
      '  trx.deleteFrom("b").where("id", "=", id).where("companyId", "=", companyId)',
      "]);"
    ].join("\n");
    const v = unscopedScan(ts);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(2);
  });

  it("ignores a companyId predicate that is only in a comment", () => {
    const ts = [
      "await trx",
      '  .updateTable("quoteLine")',
      '  // .where("companyId", "=", companyId)',
      '  .where("id", "=", id)',
      "  .execute();"
    ].join("\n");
    expect(unscopedScan(ts)).toHaveLength(1);
  });

  it("ignores a write that is only in a comment", () => {
    const ts = '// trx.updateTable("quoteLine").where("id", "=", id)';
    expect(unscopedScan(ts)).toHaveLength(0);
  });

  it("stops at a semicolon inside a SET callback only at depth 0", () => {
    const ts = [
      "await trx",
      '  .updateTable("methodMaterial")',
      "  .set((eb) => { const x = 1; return { x }; })",
      '  .where("companyId", "=", companyId)',
      "  .execute();"
    ].join("\n");
    expect(unscopedScan(ts)).toHaveLength(0);
  });

  it("accepts a link table scoped through its parent in a subquery", () => {
    const ts = [
      "await trx",
      '  .deleteFrom("jobMaterialStep")',
      '  .where("jobOperationStepId", "in", (eb) =>',
      "    eb",
      '      .selectFrom("jobOperationStep")',
      '      .select("id")',
      '      .where("id", "in", ids)',
      '      .where("companyId", "=", companyId)',
      "  )",
      "  .execute();"
    ].join("\n");
    expect(unscopedScan(ts)).toHaveLength(0);
  });

  it("accepts an id predicate on company and companySettings, whose id is the tenant", () => {
    for (const table of ["company", "companySettings"]) {
      const ts = `await trx.updateTable("${table}").set(fields).where("id", "=", companyId).execute();`;
      expect(unscopedScan(ts)).toHaveLength(0);
    }
    expect(
      unscopedScan(
        'await updateRows(db, "companySettings", { digitalReceipts }, { id: companyId });'
      )
    ).toHaveLength(0);
  });

  it("flags a company or companySettings write with no where", () => {
    for (const table of ["company", "companySettings"]) {
      expect(
        unscopedScan(`await trx.updateTable("${table}").set(fields).execute();`)
      ).toHaveLength(1);
      expect(
        unscopedScan(`await trx.deleteFrom("${table}").execute();`)
      ).toHaveLength(1);
    }
    expect(
      unscopedScan(
        'await updateRows(db, "companySettings", { digitalReceipts }, {});'
      )
    ).toHaveLength(1);
  });

  it("covers routes, MES and jobs", () => {
    const ts = 'await db.deleteFrom("kanban").where("id", "=", id).execute();';
    for (const file of [
      "apps/erp/app/routes/x+/kanban+/delete.$id.tsx",
      "apps/mes/app/services/operations.service.ts",
      "packages/jobs/src/inngest/functions/tasks/foo.ts"
    ]) {
      expect(unscopedScan(ts, file)).toHaveLength(1);
    }
  });

  it("ignores edge functions and packages/ee", () => {
    const ts = 'await db.deleteFrom("user").where("id", "=", id).execute();';
    for (const file of [
      "packages/database/supabase/functions/embedding/index.ts",
      "packages/ee/src/sso/provisioning.server.ts"
    ]) {
      expect(unscopedScan(ts, file)).toHaveLength(0);
    }
  });
  it("holds updateRows and deleteRows to the same rule", () => {
    const fn = "apps/erp/app/modules/inventory/inventory.service.ts";
    expect(
      unscopedScan(
        'await updateRows(db, "fixedAsset", { status }, { id: assetId });',
        fn
      )
    ).toHaveLength(1);
    expect(
      unscopedScan(
        'await deleteRows(trx, "fixedAssetDisposal", { fixedAssetId });',
        fn
      )
    ).toHaveLength(1);
    expect(
      unscopedScan(
        'await updateRows(db, "fixedAsset", { status }, { id: assetId, companyId });',
        fn
      )
    ).toHaveLength(0);
    expect(
      unscopedScan('await updateRows(db, "item", { companyId }, { id });', fn)
    ).toHaveLength(1);
  });
  it("exempts userPermission, which has no company column", () => {
    expect(
      unscopedScan(
        'await trx.updateTable("userPermission").set(fields).where("id", "=", id).execute();'
      )
    ).toHaveLength(0);
  });

  it("exempts userPermission in deleteRows too", () => {
    expect(
      unscopedScan('await deleteRows(trx, "userPermission", { id });')
    ).toHaveLength(0);
  });

  it("ignores a call named updateRows that takes no table and filter", () => {
    expect(
      unscopedScan("updateRows(next);\nupdateRows(db, next);")
    ).toHaveLength(0);
  });
});

const supabaseColumns = (...names: string[]) =>
  new Map(names.map((n) => [n, "string"] as [string, string]));

const SUPABASE_WRITE_TYPES = new Map<string, Map<string, string>>([
  ["receipt", supabaseColumns("id", "companyId", "status")],
  ["salesInvoice", supabaseColumns("id", "companyId", "dateIssued")],
  ["salesInvoiceShipment", supabaseColumns("id", "companyId")],
  ["maintenanceDispatchItem", supabaseColumns("id", "companyId")],
  ["maintenanceDispatchEvent", supabaseColumns("id", "companyId", "endTime")],
  ["quoteLine", supabaseColumns("id", "companyId", "quoteId")],
  ["company", supabaseColumns("id", "name")],
  ["account", supabaseColumns("id", "companyGroupId")]
]);

const supabaseWriteCheck = noUnscopedSupabaseWrite(SUPABASE_WRITE_TYPES);
const SUPABASE_WRITE_SERVICE = "apps/erp/app/modules/sales/sales.service.ts";
const supabaseWriteScan = (ts: string, file = SUPABASE_WRITE_SERVICE) =>
  supabaseWriteCheck.scan(file, ts);

describe("noUnscopedSupabaseWrite", () => {
  // git show 573bcf0079^:'apps/erp/app/routes/x+/receipt+/$receiptId.post.tsx', lines 166-171
  it("flags the receipt post's Pending update from before 573bcf0079", () => {
    const ts = [
      "export async function action({ request, params }: ActionFunctionArgs) {",
      "  const setPendingState = await client",
      '    .from("receipt")',
      "    .update({",
      '      status: "Pending"',
      "    })",
      '    .eq("id", receiptId);',
      "}"
    ].join("\n");
    const v = supabaseWriteScan(
      ts,
      "apps/erp/app/routes/x+/receipt+/$receiptId.post.tsx"
    );
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(3);
    expect(v[0]?.snippet).toBe("action: receipt.update");
  });

  // git show 573bcf0079:'apps/erp/app/routes/x+/receipt+/$receiptId.post.tsx', lines 167-173
  it("passes the 573bcf0079 fix", () => {
    const ts = [
      "export async function action({ request, params }: ActionFunctionArgs) {",
      "  const setPendingState = await client",
      '    .from("receipt")',
      "    .update({",
      '      status: "Pending"',
      "    })",
      '    .eq("id", receiptId)',
      '    .eq("companyId", companyId);',
      "}"
    ].join("\n");
    expect(
      supabaseWriteScan(
        ts,
        "apps/erp/app/routes/x+/receipt+/$receiptId.post.tsx"
      )
    ).toHaveLength(0);
  });

  // git show 0909321afd^:'apps/erp/app/routes/x+/sales-invoice+/update.tsx', lines 94-114
  it("flags both dateIssued updates from before 0909321afd", () => {
    const ts = [
      "export async function action({ request }: ActionFunctionArgs) {",
      "        if (value && paymentTerm?.data) {",
      "          return await client",
      '            .from("salesInvoice")',
      "            .update({",
      "              dateIssued: value,",
      "              dateDue: parseDate(value)",
      "                .add({ days: paymentTerm.data.daysDue })",
      "                .toString(),",
      "              updatedBy: userId,",
      "              updatedAt: new Date().toISOString()",
      "            })",
      '            .eq("id", ids[0] as string);',
      "        }",
      "        return await client",
      '          .from("salesInvoice")',
      "          .update({",
      "            dateIssued: value ? value : null,",
      "            updatedBy: userId,",
      "            updatedAt: new Date().toISOString()",
      "          })",
      '          .eq("id", ids[0] as string);',
      "}"
    ].join("\n");
    const v = supabaseWriteScan(
      ts,
      "apps/erp/app/routes/x+/sales-invoice+/update.tsx"
    );
    expect(v.map((x) => x.line)).toEqual([4, 16]);
  });

  // git show 0909321afd:'apps/erp/app/routes/x+/sales-invoice+/update.tsx', the dateIssued branch
  it("passes the 0909321afd fix", () => {
    const ts = [
      "export async function action({ request }: ActionFunctionArgs) {",
      "        return await client",
      '          .from("salesInvoice")',
      "          .update({",
      "            dateIssued: value ? value : null,",
      "            ...(dateDue ? { dateDue } : {}),",
      "            updatedBy: userId,",
      "            updatedAt: new Date().toISOString()",
      "          })",
      '          .eq("id", ids[0] as string)',
      '          .eq("companyId", companyId);',
      "}"
    ].join("\n");
    expect(
      supabaseWriteScan(ts, "apps/erp/app/routes/x+/sales-invoice+/update.tsx")
    ).toHaveLength(0);
  });

  // git show 9ddb3bc295^:apps/mes/app/services/maintenance.service.ts, lines 135-152 and 267-272
  it("flags the MES maintenance update and delete from before 9ddb3bc295", () => {
    const ts = [
      "export async function endMaintenanceEvent(",
      "  client: SupabaseClient<Database>,",
      "  args: {",
      "    eventId: string;",
      "    endTime: string;",
      "    updatedBy: string;",
      "  }",
      ") {",
      "  return client",
      '    .from("maintenanceDispatchEvent")',
      "    .update({",
      "      endTime: args.endTime,",
      "      updatedBy: args.updatedBy",
      "    })",
      '    .eq("id", args.eventId)',
      '    .select("id")',
      "    .single();",
      "}",
      "",
      "export async function deleteMaintenanceDispatchItem(",
      "  client: SupabaseClient<Database>,",
      "  itemId: string",
      ") {",
      '  return client.from("maintenanceDispatchItem").delete().eq("id", itemId);',
      "}"
    ].join("\n");
    const v = supabaseWriteScan(
      ts,
      "apps/mes/app/services/maintenance.service.ts"
    );
    expect(v.map((x) => x.snippet)).toEqual([
      "endMaintenanceEvent: maintenanceDispatchEvent.update",
      "deleteMaintenanceDispatchItem: maintenanceDispatchItem.delete"
    ]);
  });

  // git show 9ddb3bc295:apps/mes/app/services/maintenance.service.ts, lines 273-283
  it("passes the 9ddb3bc295 fix", () => {
    const ts = [
      "export async function deleteMaintenanceDispatchItem(",
      "  client: SupabaseClient<Database>,",
      "  itemId: string,",
      "  companyId: string",
      ") {",
      "  return client",
      '    .from("maintenanceDispatchItem")',
      "    .delete()",
      '    .eq("id", itemId)',
      '    .eq("companyId", companyId);',
      "}"
    ].join("\n");
    expect(
      supabaseWriteScan(ts, "apps/mes/app/services/maintenance.service.ts")
    ).toHaveLength(0);
  });

  // git show 89bdf0e27e^:apps/erp/app/modules/invoicing/invoicing.service.ts, lines 1340-1367
  it("flags the invoice shipment update from before 89bdf0e27e", () => {
    const ts = [
      "export async function upsertSalesInvoiceShipment(",
      "  client: SupabaseClient<Database>,",
      "  salesInvoiceShipment:",
      "    | (z.infer<typeof salesInvoiceShipmentValidator> & {",
      "        companyId: string;",
      "        createdBy: string;",
      "        customFields?: Json;",
      "      })",
      "    | (z.infer<typeof salesInvoiceShipmentValidator> & {",
      "        id: string;",
      "        updatedBy: string;",
      "        customFields?: Json;",
      "      })",
      ") {",
      '  if ("id" in salesInvoiceShipment) {',
      "    return client",
      '      .from("salesInvoiceShipment")',
      "      .update(sanitize(salesInvoiceShipment))",
      '      .eq("id", salesInvoiceShipment.id)',
      '      .select("id")',
      "      .single();",
      "  }",
      "  return client",
      '    .from("salesInvoiceShipment")',
      "    .insert([salesInvoiceShipment])",
      '    .select("id")',
      "    .single();",
      "}"
    ].join("\n");
    const v = supabaseWriteScan(
      ts,
      "apps/erp/app/modules/invoicing/invoicing.service.ts"
    );
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(17);
  });

  // git show 89bdf0e27e:apps/erp/app/modules/invoicing/invoicing.service.ts, lines 1338-1355
  it("passes the 89bdf0e27e fix", () => {
    const ts = [
      "export async function upsertSalesInvoiceShipment(",
      "  client: SupabaseClient<Database>,",
      "  salesInvoiceShipment: z.infer<typeof salesInvoiceShipmentValidator> & {",
      "    companyId: string;",
      "    updatedBy: string;",
      "    customFields?: Json;",
      "  }",
      ") {",
      "  const { companyId, ...shipment } = salesInvoiceShipment;",
      "  return client",
      '    .from("salesInvoiceShipment")',
      "    .update(sanitize(shipment))",
      '    .eq("id", shipment.id)',
      '    .eq("companyId", companyId)',
      '    .select("id")',
      "    .single();",
      "}"
    ].join("\n");
    expect(
      supabaseWriteScan(
        ts,
        "apps/erp/app/modules/invoicing/invoicing.service.ts"
      )
    ).toHaveLength(0);
  });

  it("flags a delete keyed by a parent id alone", () => {
    expect(
      supabaseWriteScan(
        'await client.from("quoteLine").delete().eq("quoteId", quoteId);'
      )
    ).toHaveLength(1);
  });

  it("accepts .in, .match and .filter on companyId", () => {
    for (const filter of [
      '.in("companyId", companyIds)',
      ".match({ id, companyId })",
      ".match({ id: lineId, companyId: args.companyId })",
      '.filter("companyId", "eq", companyId)'
    ]) {
      const ts = `await client.from("quoteLine").update({ x }).eq("id", id)${filter};`;
      expect(supabaseWriteScan(ts)).toHaveLength(0);
    }
  });

  it("does not count companyId in the row, or in a match on another key", () => {
    expect(
      supabaseWriteScan(
        'await client.from("quoteLine").update({ companyId, x }).eq("id", id);'
      )
    ).toHaveLength(1);
    expect(
      supabaseWriteScan(
        'await client.from("quoteLine").update({ x }).match({ id: companyIdOf(x) });'
      )
    ).toHaveLength(1);
  });

  it("does not let a NEIGHBOURING write's companyId scope this one", () => {
    const ts = [
      'await client.from("quoteLine").update({ x }).eq("id", id);',
      'await client.from("quoteLine").update({ y }).eq("id", id).eq("companyId", companyId);'
    ].join("\n");
    const v = supabaseWriteScan(ts);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(1);
  });

  it("follows a builder held in a local within the same function", () => {
    const scoped = [
      "export async function f() {",
      '  let query = client.from("quoteLine").delete().eq("quoteId", quoteId);',
      '  if (companyId) query = query.eq("companyId", companyId);',
      "  return query;",
      "}"
    ].join("\n");
    expect(supabaseWriteScan(scoped)).toHaveLength(0);
    const unscoped = [
      "export async function f() {",
      '  let query = client.from("quoteLine").delete().eq("quoteId", quoteId);',
      '  if (ids) query = query.in("id", ids);',
      "  return query;",
      "}",
      "export async function g() {",
      '  return query.eq("companyId", companyId);',
      "}"
    ].join("\n");
    expect(supabaseWriteScan(unscoped)).toHaveLength(1);
  });

  it("does not follow an awaited result held in a local", () => {
    const ts = [
      "export async function f() {",
      '  const result = await client.from("quoteLine").delete().eq("id", id);',
      '  result.eq("companyId", companyId);',
      "}"
    ].join("\n");
    expect(supabaseWriteScan(ts)).toHaveLength(1);
  });

  it("ignores tables with no companyId column, unknown tables and variables", () => {
    for (const ts of [
      'await client.from("company").update({ name }).eq("id", companyId);',
      'await client.from("account").update({ name }).eq("id", id);',
      'await client.from("notATable").delete().eq("id", id);',
      'await client.from(table).delete().eq("id", id);'
    ]) {
      expect(supabaseWriteScan(ts)).toHaveLength(0);
    }
  });

  it("ignores reads, inserts, upserts, storage and comments", () => {
    for (const ts of [
      'await client.from("quoteLine").select("*").eq("id", id);',
      'await client.from("quoteLine").insert([{ companyId, x }]);',
      'await client.from("quoteLine").upsert({ id, companyId, x });',
      'await client.storage.from("quoteLine").remove([path]); x.update(y);',
      '// await client.from("quoteLine").delete().eq("id", id);'
    ]) {
      expect(supabaseWriteScan(ts)).toHaveLength(0);
    }
  });

  it("ignores a companyId filter that is only in a comment", () => {
    const ts = [
      'await client.from("quoteLine").delete()',
      '  // .eq("companyId", companyId)',
      '  .eq("id", id);'
    ].join("\n");
    expect(supabaseWriteScan(ts)).toHaveLength(1);
  });

  it("covers routes, MES and jobs, and ignores edge functions and packages/ee", () => {
    const ts = 'await client.from("quoteLine").delete().eq("id", id);';
    for (const file of [
      "apps/erp/app/routes/x+/quote+/delete.tsx",
      "apps/mes/app/services/operations.service.ts",
      "packages/jobs/src/inngest/functions/x.ts"
    ]) {
      expect(supabaseWriteScan(ts, file)).toHaveLength(1);
    }
    for (const file of [
      "packages/database/supabase/functions/post-receipt/index.ts",
      "packages/ee/src/xero/sync.ts"
    ]) {
      expect(supabaseWriteScan(ts, file)).toHaveLength(0);
    }
  });
});

const FILE = "apps/erp/app/routes/api+/sales-rfq.$rfqId.map-lines.ts";

// customerPartToItem really has these six columns and no audit ones; item has
// both; company has updatedBy but not createdBy. A table absent from the map is
// unknown to the check.
const AUDIT_COLUMNS = new Map([
  [
    "customerPartToItem",
    new Set([
      "id",
      "customerId",
      "customerPartId",
      "customerPartRevision",
      "itemId",
      "companyId"
    ])
  ],
  ["item", new Set(["id", "companyId", "createdBy", "updatedBy"])],
  ["company", new Set(["id", "name", "updatedBy"])]
]);

const auditCheck = noMissingAuditColumn(AUDIT_COLUMNS);
const auditSnippets = (ts: string) =>
  auditCheck.scan(FILE, ts).map((v) => v.snippet);

describe("noMissingAuditColumn", () => {
  it("flags the real customerPartToItem upsert that failed with PGRST204", () => {
    const ts = [
      'await serviceRole.from("customerPartToItem").upsert(',
      "  {",
      "    customerId,",
      "    customerPartId: map.customerPartId,",
      "    itemId: finalItemId,",
      "    companyId,",
      "    createdBy: userId",
      "  },",
      '  { onConflict: "customerId,itemId" }',
      ");"
    ].join("\n");
    const v = auditCheck.scan(FILE, ts);
    expect(v).toHaveLength(1);
    expect(v[0]?.snippet).toBe("createdBy");
    expect(v[0]?.line).toBe(7);
    expect(v[0]?.message).toContain("customerPartToItem");
  });

  it("flags both fields, and only the ones the table lacks", () => {
    expect(
      auditSnippets(
        'client.from("customerPartToItem").insert({ createdBy, updatedBy });'
      )
    ).toEqual(["createdBy", "updatedBy"]);
    // company has updatedBy but not createdBy
    expect(
      auditSnippets('client.from("company").update({ createdBy, updatedBy });')
    ).toEqual(["createdBy"]);
  });

  it("allows audit fields on a table that has them", () => {
    expect(
      auditSnippets(
        'client.from("item").insert({ readableId, companyId, createdBy });'
      )
    ).toEqual([]);
  });

  it("ignores a read and a delete on the same table", () => {
    const ts = [
      'const { data } = await client.from("customerPartToItem").select("*")',
      '  .eq("createdBy", userId);',
      'await client.from("customerPartToItem").delete().eq("id", id);'
    ].join("\n");
    expect(auditSnippets(ts)).toEqual([]);
  });

  it("ignores a table it has no columns for", () => {
    expect(
      auditSnippets('client.from("someFutureTable").insert({ createdBy });')
    ).toEqual([]);
  });

  it("covers the Kysely spellings", () => {
    const insert = [
      'await trx.insertInto("customerPartToItem")',
      "  .values({ customerId, itemId, companyId, createdBy: userId })",
      "  .execute();"
    ].join("\n");
    expect(auditSnippets(insert)).toEqual(["createdBy"]);

    const update = [
      'await trx.updateTable("customerPartToItem")',
      "  .set({ customerPartId, updatedBy: userId })",
      "  .execute();"
    ].join("\n");
    expect(auditSnippets(update)).toEqual(["updatedBy"]);
  });

  // The write must come from the target's own chain. A character window reached
  // into the following statement and blamed the wrong table; an earlier version
  // of this test only passed because it padded the gap with comments.
  describe("binds the write to the matched chain", () => {
    it("does not blame a link table for the next statement's write", () => {
      const ts = [
        'client.from("customerPartToItem").select("id");',
        'client.from("item").insert({ createdBy });'
      ].join("\n");
      expect(auditSnippets(ts)).toEqual([]);
    });

    it("does not blame a table for a write on the preceding line", () => {
      const ts = [
        'client.from("item").insert({ createdBy });',
        'client.from("customerPartToItem").select("id");'
      ].join("\n");
      expect(auditSnippets(ts)).toEqual([]);
    });

    it("still follows a chain broken across lines", () => {
      const ts = [
        "await client",
        '  .from("customerPartToItem")',
        "  // staged by the RFQ mapping",
        "  .upsert({ customerId, createdBy: userId })",
        '  .select("id");'
      ].join("\n");
      expect(auditSnippets(ts)).toEqual(["createdBy"]);
    });
  });

  // A name only counts in KEY position in a row object.
  describe("inspects row keys, not identifier occurrences", () => {
    it("ignores an audit identifier used as a value", () => {
      expect(
        auditSnippets(
          'client.from("company").update({ name: createdBy, updatedBy });'
        )
      ).toEqual([]);
    });

    it("flags a quoted key", () => {
      expect(
        auditSnippets(
          'client.from("customerPartToItem").insert({ "createdBy": userId });'
        )
      ).toEqual(["createdBy"]);
    });

    it("ignores the keys of a nested value object", () => {
      expect(
        auditSnippets(
          'client.from("customerPartToItem").update({ meta: { createdBy } });'
        )
      ).toEqual([]);
    });

    it("ignores a write option in the second argument", () => {
      expect(
        auditSnippets(
          'client.from("customerPartToItem").upsert({ customerId }, { createdBy });'
        )
      ).toEqual([]);
    });

    it("ignores an audit name inside a call in a value position", () => {
      expect(
        auditSnippets(
          'client.from("customerPartToItem").update({ customerPartId: pick(row, createdBy) });'
        )
      ).toEqual([]);
    });

    it.each([
      ["a line comment", "  // itemId, createdBy,"],
      ["a block comment", "  /* itemId, createdBy, */"]
    ])("ignores a key commented out with %s", (_, comment) => {
      const ts = [
        'client.from("customerPartToItem").insert({',
        "  customerId,",
        comment,
        "  companyId",
        "});"
      ].join("\n");
      expect(auditSnippets(ts)).toEqual([]);
    });

    it("reads past a closing bracket inside a comment", () => {
      const ts = [
        'client.from("customerPartToItem").insert({',
        "  customerId, // the customer :)",
        "  createdBy",
        "});"
      ].join("\n");
      expect(auditSnippets(ts)).toEqual(["createdBy"]);
    });

    it("ends the row at the write's own closing bracket, not one inside a string", () => {
      const ts = [
        'client.from("customerPartToItem").insert({ customerPartId: "A)", createdBy });',
        'client.from("item").insert({ updatedBy });'
      ].join("\n");
      expect(auditSnippets(ts)).toEqual(["createdBy"]);
    });

    it("flags every row of an inserted array", () => {
      expect(
        auditSnippets(
          'client.from("customerPartToItem").insert([{ createdBy }, { updatedBy }]);'
        )
      ).toEqual(["createdBy", "updatedBy"]);
    });
  });
});

const STAMP_COLUMNS = new Map([
  [
    "account",
    new Set(["id", "name", "companyGroupId", "createdBy", "updatedBy"])
  ],
  ["itemCost", new Set(["itemId", "companyId", "createdBy", "updatedBy"])],
  ["contact", new Set(["id", "companyId", "firstName"])]
]);

const STAMP_SERVICE = `
export async function upsertAccount(client, account: { name: string }) {
  if ("createdBy" in account) {
    return client.from("account").insert([account]).select("*").single();
  }
  return client.from("account").update(sanitize(account)).eq("id", account.id);
}
export async function upsertItemCost(client, itemCost: { itemId: string }) {
  return client.from("itemCost").update(sanitize(itemCost)).eq("itemId", itemCost.itemId);
}
export async function insertContact(client, payload: { contact: object }) {
  return client.from("contact").insert([{ ...payload.contact, isCustomer: true }]);
}
export async function upsertRecord(client, record: { name: string }) {
  if ("createdBy" in record) {
    const data = sanitize(record);
    return client.from("itemCost").insert([data]);
  }
  return client.from("itemCost").update(sanitize({ ...record })).eq("itemId", "x");
}
export async function insertRows(client, rows: { name: string }[]) {
  return client.from("account").insert(rows);
}
export async function insertUntyped(client, row: { name: string }) {
  return (client.from("account") as any).insert([row]);
}
`;

function findings(server: string) {
  return findStampColumnMismatches(
    [
      {
        server: { file: "m/m.server.ts", contents: server },
        service: { file: "m/m.service.ts", contents: STAMP_SERVICE }
      }
    ],
    STAMP_COLUMNS
  ).map((v) => v.snippet);
}

const leaf = (name: string, call: string) => `
export const ${name} = defineServiceFn({
  async run(ctx, input) {
    return unwrap(ctx, await ${call});
  }
});
`;

describe("stamp-matches-columns", () => {
  it("fails a stamped field the written table has no column for", () => {
    expect(
      findings(
        leaf(
          "createAccount",
          `service.upsertAccount(ctx.asCaller.supabase, payload(ctx, input).withGroup().forCreate())`
        )
      )
    ).toEqual(["createAccount account companyId"]);
  });

  it("fails createdBy stamped onto a payload that only reaches an update", () => {
    expect(
      findings(
        leaf(
          "upsertItemCost",
          `service.upsertItemCost(ctx.asCaller.supabase, payload(ctx, input).withoutCompany().forUpsert())`
        )
      )
    ).toEqual(["upsertItemCost createdBy-on-update"]);
  });

  it("passes updatedBy on an update, and createdBy dropped by the update operation", () => {
    expect(
      findings(
        leaf(
          "upsertItemCost",
          `service.upsertItemCost(ctx.asCaller.supabase, payload(ctx, input).withoutCompany().forUpdate())`
        ) +
          leaf(
            "updateAccount",
            `service.upsertAccount(ctx.asCaller.supabase, payload(ctx, input).withoutCompany().forUpdate())`
          )
      )
    ).toEqual([]);
  });

  it("follows a local initialized from the payload", () => {
    expect(
      findings(
        leaf(
          "createRecord",
          `service.upsertRecord(ctx.asCaller.supabase, payload(ctx, input).withoutCompany().withGroup().forCreate())`
        )
      )
    ).toEqual(["createRecord itemCost companyGroupId"]);
  });

  it("reads the table through a cast on the builder", () => {
    expect(
      findings(
        leaf(
          "createUntyped",
          `service.insertUntyped(ctx.asCaller.supabase, payload(ctx, input).forCreate())`
        )
      )
    ).toEqual(["createUntyped account companyId"]);
  });

  it("ignores a payload that is not handed to a service function", () => {
    expect(
      findings(
        leaf("draftAccount", `save(ctx, payload(ctx, input).forCreate())`)
      )
    ).toEqual([]);
  });

  it("skips a service function the service file does not declare", () => {
    expect(
      findings(
        leaf(
          "archiveAccount",
          `service.archiveAccount(ctx.asCaller.supabase, payload(ctx, input).forCreate())`
        )
      )
    ).toEqual([]);
  });

  it("does not follow a payload built inside a callback argument", () => {
    expect(
      findings(
        leaf(
          "createAccount",
          `service.upsertAccount(ctx.asCaller.supabase, withDefaults(() => payload(ctx, input).withGroup().forCreate()))`
        )
      )
    ).toEqual([]);
  });

  it("does not follow a nested object stamp never adds fields to", () => {
    expect(
      findings(
        leaf(
          "insertContact",
          `service.insertContact(ctx.asCaller.supabase, payload(ctx, input).forUpsert())`
        )
      )
    ).toEqual([]);
  });

  it("checks only createdBy on a list, the one field stamp adds to each row", () => {
    expect(
      findings(
        leaf(
          "insertRows",
          `service.insertRows(ctx.asCaller.supabase, payload(ctx, input.rows).forCreate())`
        )
      )
    ).toEqual([]);
  });
});

const discardedScan = (contents: string) =>
  noDiscardedQueryError
    .scan("apps/erp/app/modules/x/x.service.ts", contents)
    .map(({ line, snippet }) => ({ line, snippet }));

describe("noDiscardedQueryError", () => {
  it("flags a data-only destructure of a read (cfdc4f9299 parent)", () => {
    expect(
      discardedScan(`
  if (args.consolidated) {
    readClient = getCarbonServiceRole();
    const { data: groupCompanies } = await readClient
      .from("company")
      .select("id")
      .eq("companyGroupId", args.companyGroupId)
      .eq("active", true);
    companyIds = (groupCompanies ?? []).map((c) => c.id);
  }`)
    ).toEqual([
      {
        line: 4,
        snippet:
          'const { data: groupCompanies } = await readClient.from("company")'
      }
    ]);
  });

  it("passes the destructure once it binds error (cfdc4f9299)", () => {
    expect(
      discardedScan(`
    const { data: groupCompanies, error: groupError } = await readClient
      .from("company")
      .select("id")
      .eq("companyGroupId", args.companyGroupId)
      .eq("active", true);
    companyIds = (groupCompanies ?? []).map((c) => c.id);
    if (groupError || companyIds.length === 0) {
      return listErrorPage("lines");
    }`)
    ).toEqual([]);
  });

  it("flags a bare { data } destructure (b399972472 parent)", () => {
    expect(
      discardedScan(`
  const { data } = await client
    .from("itemCost")
    .select("itemId")
    .eq("companyId", companyId)
    .in("itemPostingGroupId", groupIds);
  const itemIds = (data ?? []).map((r) => r.itemId);
  return { itemIds, filters: remaining };`)
    ).toEqual([
      { line: 2, snippet: 'const { data } = await client.from("itemCost")' }
    ]);
  });

  it("passes { data, error } returned to the caller (b399972472)", () => {
    expect(
      discardedScan(`
  const { data, error } = await client
    .from("itemCost")
    .select("itemId")
    .eq("companyId", companyId)
    .in("itemPostingGroupId", groupIds);
  const itemIds = (data ?? []).map((r) => r.itemId);
  return { itemIds, filters: remaining, error };`)
    ).toEqual([]);
  });

  it("flags awaited writes used as bare statements (22c9b98508 parent)", () => {
    expect(
      discardedScan(`
    if (finalItemId) {
      // Update salesRfqLine
      await client
        .from("salesRfqLine")
        .update({
          itemId: finalItemId,
          updatedBy: userId
        })
        .eq("id", map.lineId);

      // Upsert customerPartToItem
      if (customerId && map.customerPartId) {
        await serviceRole.from("customerPartToItem").upsert(
          {
            customerId,
            customerPartId: map.customerPartId,
            itemId: finalItemId,
            companyId,
            createdBy: userId
          },
          { onConflict: "customerId, itemId" }
        );
      }
    }`)
    ).toEqual([
      { line: 4, snippet: 'await client.from("salesRfqLine").update(' },
      {
        line: 14,
        snippet: 'await serviceRole.from("customerPartToItem").upsert('
      }
    ]);
  });

  it("passes writes whose result is bound and checked (22c9b98508)", () => {
    expect(
      discardedScan(`
      const { error: lineError } = await client
        .from("salesRfqLine")
        .update({ itemId: finalItemId, updatedBy: userId })
        .eq("id", map.lineId);
      if (lineError) {
        failed++;
        continue;
      }
      if (customerId && map.customerPartId) {
        const { error: customerPartError } = await serviceRole
          .from("customerPartToItem")
          .upsert(
            { customerId, customerPartId: map.customerPartId, itemId: finalItemId, companyId },
            { onConflict: "customerId,itemId" }
          );
        if (customerPartError) failed++;
      }`)
    ).toEqual([]);
  });

  it("flags a bound result read for data with its error never read (c0b85077ee parent)", () => {
    expect(
      discardedScan(`
): Promise<boolean> {
  const result = await client
    .from("approvalRequest")
    .select("id")
    .eq("documentType", documentType)
    .eq("documentId", documentId)
    .eq("status", "Pending")
    .limit(1);

  return (result.data?.length ?? 0) > 0;
}`)
    ).toEqual([
      {
        line: 3,
        snippet: 'const result = await client.from("approvalRequest")'
      }
    ]);
  });

  it.each([
    [
      "its error is read",
      "if (result.error) throw new Error('x'); return result.data.length > 0;"
    ],
    ["it is returned whole", "return result;"],
    ["it is passed on", "return unwrap(result).length > 0;"],
    ["it is spread", "return { ...result, rows: result.data };"]
  ])("passes a bound result when %s (c0b85077ee)", (_, rest) => {
    expect(
      discardedScan(`
async function f() {
  const result = await client.from("approvalRequest").select("id");
  ${rest}
}`)
    ).toEqual([]);
  });

  const RESULT_BINDINGS = [
    [
      "var",
      'var result = await client.from("t").select("id");',
      'var result = await client.from("t")'
    ],
    [
      "a declaration with a type annotation",
      'const result: PostgrestResponse<{ id: string }> = await client.from("t").select("id");',
      'const result: PostgrestResponse<{ id: string }> = await client.from("t")'
    ],
    [
      "assignment to an existing variable",
      'let result; result = await client.from("t").select("id");',
      'result = await client.from("t")'
    ],
    [
      "assignment at the start of a block",
      'result = await client.from("t").select("id");',
      'result = await client.from("t")'
    ]
  ];

  const boundResult = (binding: string, rest: string) => `
async function f(id: string) {
  ${binding}
  ${rest}
}`;

  it.each(RESULT_BINDINGS)(
    "flags a result bound by %s and read for data with its error never read",
    (_, binding, snippet) => {
      expect(
        discardedScan(boundResult(binding, "return result.data;"))
      ).toEqual([{ line: 3, snippet }]);
    }
  );

  it.each(RESULT_BINDINGS)(
    "passes a result bound by %s once its error is read",
    (_, binding) => {
      expect(
        discardedScan(
          boundResult(
            binding,
            "if (result.error) throw result.error; return result.data;"
          )
        )
      ).toEqual([]);
    }
  );

  it("judges a bound result only inside its own block", () => {
    expect(
      discardedScan(`
async function unchecked() {
  const result = await client.from("job").select("id");
  return result.data;
}
async function checked() {
  const result = await client.from("job").select("id");
  if (result.error) throw result.error;
  return result.data;
}`)
    ).toEqual([
      { line: 3, snippet: 'const result = await client.from("job")' }
    ]);
  });

  it("does not take another object's property of the same name for the result", () => {
    expect(
      discardedScan(`
async function f() {
  const result = await client.from("job").select("id");
  if (response.result.error) throw response.result.error;
  return result.data;
}`)
    ).toEqual([
      { line: 3, snippet: 'const result = await client.from("job")' }
    ]);
  });

  it.each([
    [
      "at the very start of the file",
      'await client.from("job").delete().eq("id", id);\nconst done = true;',
      1
    ],
    [
      "at the very end of the file with no semicolon",
      'const id = "j1";\nawait client.from("job").delete().eq("id", id)',
      2
    ],
    [
      "after else",
      'if (keep) log(id);\nelse await client.from("job").delete().eq("id", id);',
      2
    ],
    [
      "as the body of an if without braces",
      'if (stale) await client.from("job").delete().eq("id", id);',
      1
    ]
  ])("flags an unbound write %s", (_, contents, line) => {
    expect(discardedScan(contents)).toEqual([
      { line, snippet: 'await client.from("job").delete(' }
    ]);
  });

  it("flags .data read straight off an awaited call", () => {
    expect(
      discardedScan(
        'const rates = (await client.rpc("get_exchange_rates", { p_company_id: id })).data ?? [];'
      )
    ).toEqual([
      {
        line: 1,
        snippet:
          '(await client.rpc("get_exchange_rates", { p_company_id: id })…).data'
      }
    ]);
  });

  it.each([
    [
      'const { data } = await client.storage.from("private").download(path);',
      'const { data } = await client.storage.from("private")'
    ],
    [
      'const { data } = await client.functions.invoke("create", { body });',
      'const { data } = await client.functions.invoke("create", { body })'
    ],
    [
      'const { count } = await carbon?.from("job").select("id", { count: "exact", head: true });',
      'const { count } = await carbon?.from("job")'
    ],
    [
      "const { data } = await (serviceRole as any).from(table).select();",
      "const { data } = await (serviceRole as any).from(table)"
    ],
    [
      'const { data } = await client!.from("job").select("id");',
      'const { data } = await client!.from("job")'
    ],
    [
      'const { data } = await client.functions.invoke<Created>("create");',
      'const { data } = await client.functions.invoke<Created>("create")'
    ],
    [
      'const { data } = await client.rpc<Row[]>("list_rows");',
      'const { data } = await client.rpc<Row[]>("list_rows")'
    ]
  ])("flags every supabase-js request shape: %s", (contents, snippet) => {
    expect(discardedScan(contents)).toEqual([{ line: 1, snippet }]);
  });

  it("ends the snippet of a request with a type argument at that request", () => {
    expect(
      discardedScan(`const { data } = await client.rpc<Row[]>("list_rows");
const { data: jobs } = await client.from("job").select("id");`)
    ).toEqual([
      {
        line: 1,
        snippet: 'const { data } = await client.rpc<Row[]>("list_rows")'
      },
      { line: 2, snippet: 'const { data: jobs } = await client.from("job")' }
    ]);
  });

  it.each([
    [
      "a rest element",
      'const { data, ...rest } = await client.from("t").select();'
    ],
    ["a non-supabase call", "const { data } = await fetchThing(client, id);"],
    ["a PascalCase global", "const { data } = await Array.from(rows);"],
    [
      "a Kysely UPDATE … FROM",
      'await db.updateTable("a").from("b").set({ x: 1 }).execute();'
    ],
    ["a returned write", 'return await client.from("t").update({ x: 1 });'],
    [
      "a write in a concise arrow body",
      'onSave(async () => await carbon.from("t").update({ x: 1 }));'
    ],
    [
      "a property assigned a result beside a local of the same name",
      'let row: Row;\ncache.row = await client.from("t").select("id");\nreturn row.data;'
    ],
    [
      "an awaited array literal",
      'const results = await [client.from("t").select("id")];'
    ],
    [
      "the pattern inside a comment or string",
      '// const { data } = await client.from("t").select();\nconst s = "await client.from(\\"t\\").insert({})";'
    ]
  ])("passes %s", (_, contents) => {
    expect(discardedScan(contents)).toEqual([]);
  });
});

const ROUTE = "apps/mes/app/routes/x+/complete.tsx";
const unitScan = (contents: string, file = ROUTE) =>
  mesUnitWriteResolvesUnit
    .scan(file, contents)
    .map((v) => `${v.line}:${v.snippet}`);

/** A top-level function with the given body lines, as oxfmt formats it. */
const fn = (name: string, ...body: string[]) =>
  [`export async function ${name}(args) {`, ...body.map((l) => `  ${l}`), "}"]
    .join("\n")
    .concat("\n");

const RESOLVE = 'const work = await resolveWorkUnit({ mode: "require" });';
const SCRAP =
  'await erpPosting("issue", caller, { type: "jobOperationScrap" });';

describe("mes-unit-write-resolves-unit", () => {
  it("passes a write in the function that resolves the unit, nested callbacks included", () => {
    expect(
      unitScan(
        fn(
          "action",
          RESOLVE,
          "await Promise.all(ids.map(async (id) => {",
          '  await erpPosting("issue", c, { type: "jobOperationSerialComplete" });',
          "}));"
        )
      )
    ).toEqual([]);
  });

  it("flags a write when resolveWorkUnit appears only in a comment or a string", () => {
    expect(
      unitScan(
        fn(
          "action",
          "// resolveWorkUnit({ mode: 'require' }) runs upstream",
          'const note = "resolveWorkUnit(";',
          SCRAP
        )
      )
    ).toEqual(['4:type:"jobOperationScrap"']);
  });

  it("flags a write whose resolver is in a different function", () => {
    expect(unitScan(fn("loader", RESOLVE) + fn("action", SCRAP))).toEqual([
      '5:type:"jobOperationScrap"'
    ]);
  });

  it.each([
    [
      'await client.from("jobOperationStepRecord").upsert(row);',
      '2:.from("jobOperationStepRecord").upsert'
    ],
    [
      'await client\n    .from("productionEvent")\n    .insert(event);',
      '3:.from("productionEvent").insert'
    ],
    [
      'await trx.insertInto("trackedActivity").values(row).execute();',
      '2:insertInto("trackedActivity"'
    ]
  ])(
    "flags a direct unit-table write without the resolver: %s",
    (write, finding) => {
      expect(unitScan(fn("action", write))).toEqual([finding]);
    }
  );

  it("flags an issue posting whose type is not a literal", () => {
    expect(
      unitScan(
        fn("action", 'await deps.post("issue", caller, { type, quantity });')
      )
    ).toEqual(['2:post("issue"']);
    expect(
      unitScan(
        fn(
          "action",
          'await erpPosting("issue", caller, { type: "jobOperation" });'
        )
      )
    ).toEqual([]);
  });

  it.each([
    ['throw new Error("insertScrapQuantity(job) failed");'],
    ["const hint = 'erpPosting(\"issue\", caller, { type, quantity })';"]
  ])("does not take text inside a string for a write: %s", (line) => {
    expect(unitScan(fn("action", line))).toEqual([]);
  });

  it("checks the callers of a writer, not its definition", () => {
    expect(
      unitScan(
        fn(
          "insertAttributeRecord",
          'await client.from("jobOperationStepRecord").upsert(d);'
        ) + fn("action", "await insertAttributeRecord(client, data);"),
        "apps/mes/app/services/operations.service.ts"
      )
    ).toEqual(["5:insertAttributeRecord("]);
  });

  it("allows only the listed function of an allow-listed file", () => {
    const file = "apps/mes/app/services/quality.server.ts";
    expect(unitScan(fn("postSerialCompletions", SCRAP), file)).toEqual([]);
    expect(
      unitScan(fn("postSerialCompletions", "") + fn("postAnother", SCRAP), file)
    ).toEqual(['5:type:"jobOperationScrap"']);
  });

  it("flags a server pick of a unit outside the resolver, whatever the call shape", () => {
    expect(
      unitScan(
        [
          'import { isSerialEntityIncompleteForOperation } from "./operations.service";',
          fn(
            "action",
            RESOLVE,
            "const next = units.find(isSerialEntityIncompleteForOperation);",
            "const other = getNextIncompleteSerialEntity(units, id);"
          )
        ].join("\n")
      )
    ).toEqual([
      "4:isSerialEntityIncompleteForOperation",
      "5:getNextIncompleteSerialEntity"
    ]);
  });

  it("allows a pick only in the listed function of an allow-listed file", () => {
    const file = "apps/mes/app/routes/x+/operation.$operationId.tsx";
    const pick = "const next = getNextIncompleteSerialEntity(units, id);";
    expect(unitScan(fn("loader", pick), file)).toEqual([]);
    expect(unitScan(fn("action", pick), file)).toEqual([
      "2:getNextIncompleteSerialEntity"
    ]);
  });

  it("lets the resolver pick, and leaves the predicate's definition alone", () => {
    expect(
      unitScan(
        "getNextIncompleteSerialEntity(units, id)",
        "apps/mes/app/services/work-unit.server.ts"
      )
    ).toEqual([]);
    expect(
      unitScan(
        "export function isSerialEntityIncompleteForOperation(entity, id) {}",
        "apps/mes/app/services/operations.service.ts"
      )
    ).toEqual([]);
  });

  it("only scans MES routes and services", () => {
    expect(
      unitScan(
        fn("action", SCRAP),
        "apps/erp/app/modules/production/production.service.ts"
      )
    ).toEqual([]);
  });
});

describe("the MES unit writers", () => {
  const files = loadTypescriptFiles(repoRoot());

  it("are still what every allow-list entry names", () => {
    // A stale entry would pre-approve the next writer added under its name.
    expect(unitWriters(files)).toEqual(
      expect.arrayContaining(Object.keys(UNIT_WRITE_ALLOW_LIST))
    );
    expect(unitPickers(files)).toEqual(
      Object.keys(UNIT_PICK_ALLOW_LIST).sort()
    );
  });
});

const CHAINED_SERVICE = "apps/erp/app/modules/sales/sales.service.ts";
const chainedScan = (contents: string, file = CHAINED_SERVICE) =>
  noChainedClientWrites
    .scan(file, contents)
    .map(({ line, snippet }) => ({ line, snippet }));

describe("no-chained-client-writes", () => {
  // git show efd366dba0^:apps/erp/app/modules/sales/sales.service.ts, lines 3871–3962
  it("flags the quote line price delete and re-insert from before efd366dba0", () => {
    expect(
      chainedScan(`export async function upsertQuoteLinePrices(
  client: SupabaseClient<Database>,
  quoteId: string,
  lineId: string,
  quoteLinePrices: {
    quoteLineId: string;
    unitPrice: number;
    leadTime: number;
    discountPercent: number;
    quantity: number;
    createdBy: string;
    categoryMarkups?: Record<string, number>;
    priceSource?: "system" | "manual";
  }[]
) {
  const existingPrices = await client
    .from("quoteLinePrice")
    .select("*")
    .eq("quoteLineId", lineId);
  if (existingPrices.error) {
    return existingPrices;
  }

  const deletePrices = await client
    .from("quoteLinePrice")
    .delete()
    .eq("quoteLineId", lineId);
  if (deletePrices.error) {
    return deletePrices;
  }

  const quoteExchangeRate = await client
    .from("quote")
    .select("id, exchangeRate")
    .eq("id", quoteId)
    .single();

  const quoteLineUnitPricePrecision = await client
    .from("quoteLine")
    .select("unitPricePrecision")
    .eq("id", lineId)
    .single();

  const pricesByQuantity = existingPrices.data.reduce<
    Record<
      number,
      {
        discountPercent: number;
        leadTime: number;
        shippingCost: number;
        categoryMarkups: unknown;
        priceSource: string;
      }
    >
  >((acc, price) => {
    acc[price.quantity] = price;
    return acc;
  }, {});

  const pricesWithExistingDiscountsAndLeadTimes = quoteLinePrices.map((p) => {
    const existing = pricesByQuantity[p.quantity];
    const roundedUnitPrice = Number(
      p.unitPrice.toFixed(
        quoteLineUnitPricePrecision.data?.unitPricePrecision ?? 2
      )
    );

    return {
      ...p,
      unitPrice: roundedUnitPrice,
      discountPercent: existing?.discountPercent ?? p.discountPercent,
      leadTime: existing?.leadTime ?? p.leadTime,
      // Shipping is entered per quantity break and is independent of the price
      // being rewritten — without this the delete+reinsert resets it to the
      // column default of 0.
      shippingCost: existing?.shippingCost ?? 0,
      categoryMarkups: p.categoryMarkups ?? existing?.categoryMarkups ?? {},
      // Explicit caller intent wins; otherwise keep the row's provenance so a
      // delete+reinsert can never turn a manual price back into a system one.
      priceSource: p.priceSource ?? existing?.priceSource ?? "system",
      quoteId: quoteId,
      exchangeRate: quoteExchangeRate.data?.exchangeRate ?? 1
    };
  });

  return (
    client
      .from("quoteLinePrice")
      // @ts-expect-error - categoryMarkups is a Json object
      .insert(pricesWithExistingDiscountsAndLeadTimes)
  );
}`)
    ).toEqual([
      {
        line: 87,
        snippet:
          "upsertQuoteLinePrices: quoteLinePrice.delete, quoteLinePrice.insert"
      }
    ]);
  });

  // git show efd366dba0:apps/erp/app/modules/sales/sales.service.ts, lines 3871–3956
  it("passes the price rewrite in one Kysely transaction (efd366dba0)", () => {
    expect(
      chainedScan(`export async function upsertQuoteLinePrices(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  quoteId: string,
  lineId: string,
  quoteLinePrices: {
    quoteLineId: string;
    unitPrice: number;
    leadTime: number;
    discountPercent: number;
    quantity: number;
    createdBy: string;
    categoryMarkups?: Record<string, number>;
    priceSource?: "system" | "manual";
  }[]
) {
  // Rewriting a line's prices is a delete + reinsert, so it has to be atomic:
  // if the insert failed after the delete had already committed, the line would
  // be left with no pricing at all and the previous values unrecoverable.
  // Kysely bypasses RLS, so every statement is scoped by companyId explicitly.
  return db.transaction().execute(async (trx) => {
    const existingPrices = await trx
      .selectFrom("quoteLinePrice")
      .selectAll()
      .where("quoteLineId", "=", lineId)
      .where("companyId", "=", companyId)
      .execute();

    await trx
      .deleteFrom("quoteLinePrice")
      .where("quoteLineId", "=", lineId)
      .where("companyId", "=", companyId)
      .execute();

    if (quoteLinePrices.length === 0) return;

    const quote = await trx
      .selectFrom("quote")
      .select("exchangeRate")
      .where("id", "=", quoteId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();

    const quoteLine = await trx
      .selectFrom("quoteLine")
      .select("unitPricePrecision")
      .where("id", "=", lineId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();

    const existingByQuantity = new Map(
      existingPrices.map((price) => [price.quantity, price])
    );

    await trx
      .insertInto("quoteLinePrice")
      .values(
        quoteLinePrices.map((p) => {
          const existing = existingByQuantity.get(p.quantity);

          return {
            ...p,
            companyId,
            quoteId,
            unitPrice: Number(
              p.unitPrice.toFixed(quoteLine?.unitPricePrecision ?? 2)
            ),
            discountPercent: existing?.discountPercent ?? p.discountPercent,
            leadTime: existing?.leadTime ?? p.leadTime,
            // Shipping is entered per quantity break and is independent of the
            // price being rewritten — without this the delete+reinsert resets
            // it to the column default of 0.
            shippingCost: existing?.shippingCost ?? 0,
            categoryMarkups:
              p.categoryMarkups ?? existing?.categoryMarkups ?? {},
            // Explicit caller intent wins; otherwise keep the row's provenance
            // so a delete+reinsert can never turn a manual price back into a
            // system one.
            priceSource: p.priceSource ?? existing?.priceSource ?? "system",
            exchangeRate: quote?.exchangeRate ?? 1
          };
        })
      )
      .execute();
  });
}`)
    ).toEqual([]);
  });

  // git show 37f71945a4^:apps/erp/app/modules/items/items.service.ts, lines 4302–4342
  it("flags the Draft insert and source activation from before 37f71945a4", () => {
    expect(
      chainedScan(
        `export async function upsertMakeMethodVersion(
  client: SupabaseClient<Database>,
  makeMethodVersion: z.infer<typeof makeMethodVersionValidator> & {
    companyId: string;
    createdBy: string;
  }
) {
  const currentMakeMethod = await client
    .from("makeMethod")
    .select("*")
    .eq("id", makeMethodVersion.copyFromId)
    .eq("companyId", makeMethodVersion.companyId)
    .single();

  if (currentMakeMethod.error) return currentMakeMethod;

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, version, ...data } = currentMakeMethod.data;

  const insert = await client
    .from("makeMethod")
    .insert({
      ...data,
      status: "Draft",
      version: makeMethodVersion.version,
      createdBy: makeMethodVersion.createdBy
    })
    .select("id, ...item(itemId:id, type)")
    .single();

  if (insert.error) return insert;

  if (makeMethodVersion.activeVersionId) {
    await client
      .from("makeMethod")
      .update({ status: "Active" })
      .eq("id", makeMethodVersion.activeVersionId);
  }

  return insert;
}`,
        "apps/erp/app/modules/items/items.service.ts"
      )
    ).toEqual([
      {
        line: 34,
        snippet: "upsertMakeMethodVersion: makeMethod.insert, makeMethod.update"
      }
    ]);
  });

  // git show 37f71945a4:apps/erp/app/modules/items/items.service.ts, lines 4312–4428
  it("passes the version insert, activation and copy in withTransaction (37f71945a4)", () => {
    expect(
      chainedScan(
        `export async function createMakeMethodVersion(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    copyFromId: string;
    version: number;
    /** Set a Draft source Active. An Active or Archived source is left alone. */
    activate?: boolean;
    /** The change notice the new Draft belongs to; else the source's. */
    changeOrderId?: string;
    companyId: string;
    createdBy: string;
  }
): Promise<
  | {
      data: {
        id: string;
        itemId: string;
        type: Database["public"]["Tables"]["item"]["Row"]["type"];
      };
      error: null;
    }
  | { data: null; error: ServiceError | ServerFnError }
> {
  const { copyFromId, version, companyId, createdBy } = args;

  const source = await client
    .from("makeMethod")
    .select("itemId, status, customFields, tags, changeOrderId, ...item(type)")
    .eq("id", copyFromId)
    .eq("companyId", companyId)
    .single();
  if (source.error) return { data: null, error: source.error };

  // The makeMethod policies ask for parts_create to insert and parts_update to
  // set a version Active.
  const activate = args.activate === true && source.data.status === "Draft";
  const permitted = await requireCompanyPermission(
    client,
    companyId,
    "parts_create"
  );
  if (permitted.error) return { data: null, error: permitted.error };
  if (activate) {
    const canActivate = await requireCompanyPermission(
      client,
      companyId,
      "parts_update"
    );
    if (canActivate.error) return { data: null, error: canActivate.error };
  }

  try {
    const draftId = await withTransaction(db, async (trx) => {
      const draft = await trx
        .insertInto("makeMethod")
        .values({
          itemId: source.data.itemId,
          customFields: toJson(source.data.customFields),
          tags: source.data.tags,
          changeOrderId: args.changeOrderId ?? source.data.changeOrderId,
          status: "Draft",
          version,
          companyId,
          createdBy
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      if (activate) {
        // A source set Active meanwhile, or archived behind a newer Active, is
        // not outranked by the new Draft either: nothing to refuse.
        await trx
          .updateTable("makeMethod")
          .set({ status: "Active" })
          .where("id", "=", copyFromId)
          .where("companyId", "=", companyId)
          .where("status", "=", "Draft")
          .execute();
      }

      const copy = await copyMakeMethod(getCarbonServiceRole(), trx, {
        sourceId: copyFromId,
        targetId: draft.id,
        billOfMaterial: true,
        billOfProcess: true,
        parameters: true,
        tools: true,
        steps: true,
        workInstructions: true,
        companyId,
        userId: createdBy
      });
      if (copy.error) throw copy.error;

      return draft.id;
    });

    return {
      data: { id: draftId, itemId: source.data.itemId, type: source.data.type },
      error: null
    };
  } catch (error) {
    // The copy's refusal, with the status its category is read from.
    if (error instanceof ServerFnError) return { data: null, error };
    // A taken version number is the caller's to retry.
    if (!isUniqueViolation(error)) {
      logger.error("Failed to create make method version", {
        companyId,
        copyFromId,
        version,
        error
      });
    }
    return { data: null, error: writeError(error) };
  }
}`,
        "apps/erp/app/modules/items/items.service.ts"
      )
    ).toEqual([]);
  });

  // git show f922057bbc^:apps/erp/app/modules/sales/sales.service.ts, lines 2133–2176
  it("flags the contact insert and its customer link from before f922057bbc", () => {
    expect(
      chainedScan(`export async function insertCustomerContact(
  client: SupabaseClient<Database>,
  customerContact: {
    customerId: string;
    companyId: string;
    contact: PickPartial<z.infer<typeof customerContactValidator>, "email">;
    customerLocationId?: string;
    customFields?: Json;
  }
) {
  const insertContact = await client
    .from("contact")
    .insert([
      {
        ...customerContact.contact,
        isCustomer: true,
        companyId: customerContact.companyId
      }
    ])
    .select("id")
    .single();
  if (insertContact.error) {
    return insertContact;
  }

  const contactId = insertContact.data?.id;
  if (!contactId) {
    return { data: null, error: new Error("Contact ID not found") };
  }

  return client
    .from("customerContact")
    .insert([
      {
        customerId: customerContact.customerId,
        contactId,
        customerLocationId: customerContact.customerLocationId,
        companyId: customerContact.companyId,
        customFields: customerContact.customFields
      }
    ])
    .select("id")
    .single();
}`)
    ).toEqual([
      {
        line: 31,
        snippet: "insertCustomerContact: contact.insert, customerContact.insert"
      }
    ]);
  });

  // git show f922057bbc:apps/erp/app/modules/sales/sales.service.ts, lines 2138–2211
  it("passes the contact and its link in one withTransaction (f922057bbc)", () => {
    expect(
      chainedScan(`export async function insertCustomerContact(
  db: Kysely<KyselyDatabase>,
  customerContact: {
    customerId: string;
    companyId: string;
    contact: PickPartial<z.infer<typeof customerContactValidator>, "email">;
    customerLocationId?: string;
    customFields?: Json;
  }
) {
  const { customerId, companyId, customerLocationId, contact } =
    customerContact;
  try {
    // One transaction: a contact with no customer link is invisible in the app.
    const id = await withTransaction(db, async (trx) => {
      const owner = await trx
        .selectFrom("customer")
        .select("id")
        .where("id", "=", customerId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!owner) return "Customer not found";
      if (customerLocationId) {
        const location = await trx
          .selectFrom("customerLocation")
          .select("id")
          .where("id", "=", customerLocationId)
          .where("customerId", "=", customerId)
          .executeTakeFirst();
        if (!location) return "Location not found";
      }

      const inserted = await trx
        .insertInto("contact")
        .values({
          companyId,
          isCustomer: true,
          firstName: contact.firstName,
          lastName: contact.lastName,
          title: contact.title,
          email: contact.email,
          mobilePhone: contact.mobilePhone,
          homePhone: contact.homePhone,
          workPhone: contact.workPhone,
          notes: contact.notes
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      const link = await trx
        .insertInto("customerContact")
        .values({
          customerId,
          contactId: inserted.id,
          customerLocationId,
          companyId,
          customFields: toJson(customerContact.customFields)
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return { id: link.id };
    });
    return typeof id === "string"
      ? { data: null, error: ruleError(id) }
      : { data: id, error: null };
  } catch (error) {
    logger.error("Failed to create customer contact", {
      companyId,
      customerId,
      error
    });
    return { data: null, error: error as Error };
  }
}`)
    ).toEqual([]);
  });

  it("flags writes fanned out with Promise.all, in a service function's run", () => {
    expect(
      chainedScan(
        `export const cancelOrder = defineServiceFn({
  input,
  permission,
  async run(ctx, input) {
    const client = ctx.asSystem.supabase;
    const [lines, header] = await Promise.all([
      client.from("salesOrderLine").update({ status: "Cancelled" }).eq("salesOrderId", input.id),
      client.from("salesOrder").update({ status: "Cancelled" }).eq("id", input.id)
    ]);
    return unwrap(ctx, lines, header);
  }
});`,
        "apps/erp/app/modules/sales/sales.server.ts"
      )
    ).toEqual([
      {
        line: 8,
        snippet: "cancelOrder: salesOrderLine.update, salesOrder.update"
      }
    ]);
  });

  it("counts a write in a callback toward the function that calls it", () => {
    expect(
      chainedScan(`export async function replaceTags(client, id, tags) {
  await client.from("tag").delete().eq("documentId", id);
  await Promise.all(
    tags.map((tag) => client.from("tag").insert({ documentId: id, tag }))
  );
}`)
    ).toEqual([{ line: 4, snippet: "replaceTags: tag.delete, tag.insert" }]);
  });

  it("passes the two branches of an upsert", () => {
    expect(
      chainedScan(`export async function upsertThing(client, thing) {
  if ("id" in thing) {
    return client.from("thing").update(thing).eq("id", thing.id);
  }
  return client.from("thing").insert([thing]).select("id").single();
}

export async function upsertOther(client, other) {
  if (other.id) {
    const updated = await client.from("other").update(other).eq("id", other.id);
    if (updated.error) return updated;
    return updated;
  } else {
    return client.from("other").insert(other);
  }
}

export async function saveMode(client, mode, row) {
  return mode === "edit"
    ? client.from("x").update(row).eq("id", row.id)
    : client.from("x").insert(row);
}

export async function byIntent(client, intent, row) {
  switch (intent) {
    case "archive":
      return client.from("x").update({ archived: true }).eq("id", row.id);
    case "delete":
      return client.from("x").delete().eq("id", row.id);
  }
}`)
    ).toEqual([]);
  });

  it("passes writes inside a Kysely transaction callback, and a single write", () => {
    expect(
      chainedScan(`export async function one(client, row) {
  return client.from("x").insert(row);
}

export async function inTransaction(db, client, row) {
  return withTransaction(db, async (trx) => {
    await client.from("x").delete().eq("id", row.id);
    await client.from("x").insert(row);
  });
}`)
    ).toEqual([]);
  });

  it("does not let a return inside a callback end the outer function", () => {
    expect(
      chainedScan(`export async function reset(client, ids) {
  await Promise.all(
    ids.map(async (id) => {
      await client.from("x").delete().eq("id", id);
      return id;
    })
  );
  await client.from("y").insert({ ids });
}`)
    ).toEqual([{ line: 8, snippet: "reset: x.delete, y.insert" }]);
  });

  it("leaves reads, storage and Array.from alone", () => {
    expect(
      chainedScan(`export async function files(client, rows) {
  await client.storage.from("private").update(path, file);
  await client.storage.from("private").remove([path]);
  const copy = Array.from(rows).delete;
  await client.from("x").select("id");
  return client.from("x").update({ a: 1 }).eq("id", 1);
}`)
    ).toEqual([]);
  });

  it("passes an update-else-insert upsert of one row, and insert-if-absent then update", () => {
    expect(
      chainedScan(`export async function upsertOverride(client, row) {
  const update = await client
    .from("exchangeRateOverride")
    .update({ rate: row.rate })
    .eq("currencyCode", row.currencyCode)
    .select("id");
  if (update.error) return update;
  if (update.data.length > 0) return update;
  return client.from("exchangeRateOverride").insert(row);
}

export async function markInstalled(client, row) {
  const inserted = await client
    .from("companyIntegration")
    .upsert(row, { ignoreDuplicates: true });
  if (inserted.error) return inserted;
  return client
    .from("companyIntegration")
    .update({ active: true })
    .eq("id", row.id)
    .eq("active", false);
}`)
    ).toEqual([]);
  });

  it("still flags two updates of one table (archive the old, publish the new)", () => {
    expect(
      chainedScan(`export async function activateVersion(client, id, others) {
  await client.from("instruction").update({ status: "Archived" }).in("id", others);
  return client.from("instruction").update({ status: "Published" }).eq("id", id);
}`)
    ).toEqual([{ line: 3, snippet: "activateVersion: instruction.update" }]);
  });

  it("names a callback option after the function that passes it", () => {
    expect(
      chainedScan(
        `export const attachFile = defineServiceFn({
  input,
  permission,
  async run(ctx, input) {
    return service.placeFile(ctx, {
      setModel: async (id) => {
        await ctx.client.from("quoteLine").update({ id }).eq("id", input.lineId);
        await ctx.client.from("item").update({ id }).eq("id", input.itemId);
      }
    });
  }
});`,
        "apps/erp/app/modules/sales/sales.server.ts"
      )
    ).toEqual([
      { line: 8, snippet: "attachFile.setModel: quoteLine.update, item.update" }
    ]);
  });

  it("scans only ERP module server files and MES services", () => {
    const code = `export async function two(client) {
  await client.from("a").insert({});
  await client.from("b").insert({});
}`;
    expect(chainedScan(code, "apps/erp/app/routes/x+/a.tsx")).toEqual([]);
    expect(chainedScan(code, "apps/erp/app/modules/a/a.models.ts")).toEqual([]);
    expect(
      chainedScan(code, "apps/mes/app/services/operations.service.ts")
    ).toEqual([{ line: 3, snippet: "two: a.insert, b.insert" }]);
  });
});

const STATUS_SERVICE = "apps/erp/app/modules/accounting/accounting.service.ts";

const enumOf = (name: string) => `Database["public"]["Enums"]["${name}"]`;

// The shape the generated types give the check: a column → its type text.
const STATUS_TYPES = new Map<string, Map<string, string>>([
  [
    "accountingPeriod",
    new Map([
      ["id", "string"],
      ["closeStatus", enumOf("periodCloseStatus")],
      ["lockedAt", "string | null"]
    ])
  ],
  ["quote", new Map([["status", enumOf("quoteStatus")]])],
  ["salesInvoice", new Map([["status", enumOf("salesInvoiceStatus")]])],
  ["receipt", new Map([["status", enumOf("receiptStatus")]])],
  [
    "leasePayment",
    new Map([
      ["status", enumOf("leasePaymentStatus")],
      ["purchaseInvoiceLineId", "string | null"]
    ])
  ],
  ["trackedEntity", new Map([["status", enumOf("trackedEntityStatus")]])],
  ["employeeJob", new Map([["flsaStatus", enumOf("flsaStatus")]])],
  [
    "salesOrderStatusHistory",
    new Map([["status", enumOf("salesOrderStatus")]])
  ],
  ["note", new Map([["status", "string"]])]
]);

const statusCheck = statusWriteGuarded(STATUS_TYPES);
const statusScan = (ts: string, file = STATUS_SERVICE) =>
  statusCheck.scan(file, ts);
const statusSnippets = (ts: string, file = STATUS_SERVICE) =>
  statusScan(ts, file).map((v) => v.snippet);

// `git show de82a88cc6^:apps/erp/app/modules/accounting/accounting.service.ts`,
// lines 3478–3550: both functions read closeStatus, check it in code, then
// update by id alone. An unlock queued behind a close set the Closed period
// back to Open.
const DE82A88CC6_PARENT = `/** Not published: \`accounting_lockPeriod\` runs it. */
export async function lockAccountingPeriod(
  client: SupabaseClient<Database>,
  args: { periodId: string; companyId: string; userId: string }
) {
  const cutover = await requireAccountingCutover(client, args.companyId);
  if (cutover.error) return { data: null, error: cutover.error };
  const period = await getAccountingPeriodById(
    client,
    args.periodId,
    args.companyId
  );
  if (period.error || !period.data) {
    return {
      data: null,
      error: period.error ?? { message: "Period not found" }
    };
  }
  if (period.data.closeStatus !== "Open") {
    return {
      data: null,
      error: { message: "Only open periods can be locked" }
    };
  }
  return (client.from("accountingPeriod") as any)
    .update({
      closeStatus: "Locked",
      lockedAt: new Date().toISOString(),
      lockedBy: args.userId,
      updatedBy: args.userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", args.periodId)
    .eq("companyId", args.companyId)
    .select("id")
    .single();
}

/** Not published: \`accounting_unlockPeriod\` runs it. */
export async function unlockAccountingPeriod(
  client: SupabaseClient<Database>,
  args: { periodId: string; companyId: string; userId: string }
) {
  const period = await getAccountingPeriodById(
    client,
    args.periodId,
    args.companyId
  );
  if (period.error || !period.data) {
    return {
      data: null,
      error: period.error ?? { message: "Period not found" }
    };
  }
  if (period.data.closeStatus !== "Locked") {
    return {
      data: null,
      error: { message: "Only locked periods can be unlocked" }
    };
  }
  return (client.from("accountingPeriod") as any)
    .update({
      closeStatus: "Open",
      lockedAt: null,
      lockedBy: null,
      updatedBy: args.userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", args.periodId)
    .eq("companyId", args.companyId)
    .select("id")
    .single();
}
`;

// `git show de82a88cc6:…/accounting.service.ts`, the fixed setPeriodCloseStatus
// (lines 3545–3568): the UPDATE names the status it moves from.
const DE82A88CC6_FIX = `async function setPeriodCloseStatus(
  client: SupabaseClient<Database>,
  args: { periodId: string; companyId: string; userId: string },
  move: { from: "Open" | "Locked"; to: "Open" | "Locked" },
  columns: { lockedAt: string | null; lockedBy: string | null },
  refusal: string
) {
  const result = await client
    .from("accountingPeriod")
    .update({
      closeStatus: move.to,
      ...columns,
      updatedBy: args.userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", args.periodId)
    .eq("companyId", args.companyId)
    .eq("closeStatus", move.from)
    .select("id")
    .maybeSingle();
  if (result.error) return { data: null, error: result.error };
  if (!result.data) return { data: null, error: { message: refusal } };
  return { data: result.data, error: null };
}
`;

// `git show 2c9ef0dd8f^:packages/database/supabase/functions/convert/index.ts`,
// lines 672–683: a replayed accept moved an Ordered quote again and made a
// second sales order.
const CONVERT = "packages/database/supabase/functions/convert/index.ts";
const C2C9EF0DD8F_PARENT = `          const newQuoteStatus: "Ordered" | "Partial" = hasZeroQuantityLines
            ? "Partial"
            : "Ordered";
          await trx
            .updateTable("quote")
            .set({
              status: newQuoteStatus,
              digitalQuoteAcceptedBy: digitalQuoteAcceptedBy ?? null,
              digitalQuoteAcceptedByEmail: digitalQuoteAcceptedByEmail ?? null,
            })
            .where("id", "=", quote.data.id)
            .execute();
`;

// `git show 2c9ef0dd8f:…/convert/index.ts`, lines 672–695.
const C2C9EF0DD8F_FIX = `          const newQuoteStatus: "Ordered" | "Partial" = hasZeroQuantityLines
            ? "Partial"
            : "Ordered";
          // Atomic guard: only convert a quote that is still "Sent". Both the
          // internal "convert to order" flow and the unauthenticated digital
          // quote accept run from "Sent" only. If a concurrent or replayed
          // request already converted it, 0 rows update here and the throw rolls
          // the whole transaction back — no duplicate sales order is committed.
          const quoteStatusUpdate = await trx
            .updateTable("quote")
            .set({
              status: newQuoteStatus,
              digitalQuoteAcceptedBy: digitalQuoteAcceptedBy ?? null,
              digitalQuoteAcceptedByEmail: digitalQuoteAcceptedByEmail ?? null,
            })
            .where("id", "=", quote.data.id)
            .where("status", "=", "Sent")
            .executeTakeFirst();

          if (Number(quoteStatusUpdate.numUpdatedRows ?? 0) === 0) {
            throw new Error(
              \`Quote \${quote.data.id} is no longer in a convertible state\`
            );
          }
`;

// `git show 578c411ffe^:apps/erp/app/modules/invoicing/invoicing.service.ts`:
// the void branch of postSalesInvoice (from line 9516), its lock (lines
// 11066–11077) and its status write (11629–11640). The lock reads only `id`,
// so a second void waited for the first and then reversed the invoice again.
// The fix reached main squashed into b6ca51d4e1 (#2337), the sha that stays
// reachable once the branch is gone.
const INVOICING = "apps/erp/app/modules/invoicing/invoicing.service.ts";
const VOID_HEAD = `export async function postSalesInvoice(
  ctx: ServiceContext,
  raw: z.input<typeof postSalesInvoiceInput>
) {
  const { type, invoiceId } = postSalesInvoiceInput.parse(raw);
`;
const VOID_WRITE = `          // Update invoice status to voided
          await trx
            .updateTable("salesInvoice")
            .set({
              status: "Voided",
              updatedAt: today,
              updatedBy: userId
            })
            .where("id", "=", invoiceId)
            .where("companyId", "=", companyId)
            .execute();
        });
}
`;
const C578C411FFE_PARENT = `${VOID_HEAD}        await db.transaction().execute(async (trx) => {
          await assertPostingStatusUnchanged(trx, companyId, postingStatus);
          // Locked before the journal is read, as a line account change locks
          // it before it adds lines: those are reversed with the rest, never
          // left on a voided invoice.
          await trx
            .selectFrom("salesInvoice")
            .select("id")
            .where("id", "=", invoiceId)
            .where("companyId", "=", companyId)
            .forUpdate()
            .execute();
${VOID_WRITE}`;

// `git show 578c411ffe:…/invoicing.service.ts`, lines 11066–11081: the same
// lock reads the status and refuses a Voided invoice.
const C578C411FFE_FIX = `${VOID_HEAD}        await db.transaction().execute(async (trx) => {
          await assertPostingStatusUnchanged(trx, companyId, postingStatus);
          // Locked before the journal is read, as a line account change locks
          // it before it adds lines: those are reversed with the rest, never
          // left on a voided invoice.
          const locked = await trx
            .selectFrom("salesInvoice")
            .select("status")
            .where("id", "=", invoiceId)
            .where("companyId", "=", companyId)
            .forUpdate()
            .executeTakeFirst();
          if (locked?.status === "Voided") {
            throw new InvalidInputError("Sales invoice is already voided");
          }
${VOID_WRITE}`;

describe("statusWriteGuarded: the shipped bugs", () => {
  it("flags lock and unlock from before de82a88cc6", () => {
    const v = statusScan(DE82A88CC6_PARENT);
    expect(v.map((x) => x.snippet)).toEqual([
      "lockAccountingPeriod: accountingPeriod.closeStatus",
      "unlockAccountingPeriod: accountingPeriod.closeStatus"
    ]);
    expect(v.map((x) => x.line)).toEqual([27, 63]);
    expect(v[0]?.message).toContain('.eq("closeStatus", <expected>)');
    expect(v[0]?.message).toContain("FOR UPDATE");
  });

  it("passes the de82a88cc6 fix", () => {
    expect(statusScan(DE82A88CC6_FIX)).toEqual([]);
  });

  it("flags the quote conversion from before 2c9ef0dd8f", () => {
    expect(statusSnippets(C2C9EF0DD8F_PARENT, CONVERT)).toEqual([
      "<top level>: quote.status"
    ]);
  });

  it("passes the 2c9ef0dd8f fix", () => {
    expect(statusScan(C2C9EF0DD8F_FIX, CONVERT)).toEqual([]);
  });

  it("flags the void from before 578c411ffe (b6ca51d4e1 on main), which locked the invoice and never read its status", () => {
    const v = statusScan(C578C411FFE_PARENT, INVOICING);
    expect(v.map((x) => [x.line, x.snippet])).toEqual([
      [22, "postSalesInvoice: salesInvoice.status"]
    ]);
    expect(v[0]?.message).toContain("nothing reads status under that lock");
  });

  it("passes the 578c411ffe fix", () => {
    expect(statusScan(C578C411FFE_FIX, INVOICING)).toEqual([]);
  });
});

describe("statusWriteGuarded", () => {
  it("accepts each spelling of a status predicate", () => {
    const writes = [
      '.eq("status", "Draft")',
      '.neq("status", "Voided")',
      '.in("status", ["Draft", "Pending"])',
      '.is("status", null)'
    ];
    for (const filter of writes) {
      const ts = `export async function post(client) {
  await client.from("receipt").update({ status: "Pending" }).eq("id", id)${filter};
}`;
      expect(statusScan(ts), filter).toEqual([]);
    }
    const kysely = `export async function post(trx) {
  await trx.updateTable("receipt as r").set({ status: "Posted" }).where("r.id", "=", id).where("r.status", "=", "Pending").execute();
}`;
    expect(statusScan(kysely)).toEqual([]);
  });

  it("follows a predicate added to a builder held in a variable", () => {
    const ts = `export async function updateReceiptStatus(client, { id, status, expected }) {
  let query = client
    .from("receipt")
    .update({ status })
    .eq("id", id);
  if (expected) query = query.eq("status", expected);
  return query.select("id").single();
}`;
    expect(statusScan(ts)).toEqual([]);
  });

  it("passes a write after the function locked a row of the same table", () => {
    const ts = `export async function voidReceipt(trx, id) {
  const locked = await trx.selectFrom("receipt").select("status").where("id", "=", id).forUpdate().executeTakeFirst();
  if (locked?.status !== "Posted") throw new Error("not posted");
  await trx.updateTable("receipt").set({ status: "Voided" }).where("id", "=", id).execute();
}`;
    expect(statusScan(ts)).toEqual([]);
  });

  it("counts a lock whose select reads the status, or a read of it after the lock", () => {
    const guarded = [
      `const locked = await trx.selectFrom("receipt").select(["id", "status"]).where("id", "=", id).forUpdate().executeTakeFirst();`,
      `const locked = await trx.selectFrom("receipt as r").select("r.status as current").where("r.id", "=", id).forUpdate().executeTakeFirst();`,
      `const locked = await trx.selectFrom("receipt").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();`,
      `const locked = await trx.selectFrom("receipt").select("id").where("id", "=", id).where("status", "=", "Posted").forUpdate().executeTakeFirst();`,
      `await sql\`SELECT "id" FROM "receipt" WHERE "id" = \${id} AND "status" = 'Posted' FOR UPDATE\`.execute(trx);`,
      `await trx.selectFrom("receipt").select("id").where("id", "=", id).forUpdate().execute();
  const current = await trx.selectFrom("receipt").select("status").where("id", "=", id).executeTakeFirst();`,
      `const { rows } = await sql\`SELECT * FROM "receipt" WHERE "id" = \${id} FOR UPDATE\`.execute(trx);`
    ];
    for (const lock of guarded) {
      const ts = `export async function voidReceipt(trx, id) {
  ${lock}
  await trx.updateTable("receipt").set({ status: "Voided" }).where("id", "=", id).execute();
}`;
      expect(statusScan(ts), lock).toEqual([]);
    }
  });

  it("flags a lock that reads no status, as SQL or through a helper", () => {
    const blind = [
      `await sql\`SELECT "id" FROM "receipt" WHERE "id" = \${id} FOR UPDATE\`.execute(trx);`,
      "await lockReceipt(trx, id);",
      `const locked = await trx.selectFrom("receipt").select("id").where("id", "=", id).forUpdate().executeTakeFirst();
  if (!locked) throw new Error("not found");`
    ];
    for (const lock of blind) {
      const ts = `async function lockReceipt(trx, id) {
  return trx.selectFrom("receipt").select("id").where("id", "=", id).forUpdate().executeTakeFirst();
}

export async function voidReceipt(trx, id) {
  ${lock}
  await trx.updateTable("receipt").set({ status: "Voided" }).where("id", "=", id).execute();
}`;
      expect(statusSnippets(ts), lock).toEqual(["voidReceipt: receipt.status"]);
    }
  });

  it("passes a helper's lock when the caller reads the status of the row it returns", () => {
    const ts = `async function lockReceipt(trx, id) {
  return trx.selectFrom("receipt").selectAll("receipt").where("id", "=", id).forUpdate().executeTakeFirst();
}

export async function voidReceipt(trx, id) {
  const receipt = await lockReceipt(trx, id);
  if (receipt?.status !== "Posted") throw new Error("not posted");
  await trx.updateTable("receipt").set({ status: "Voided" }).where("id", "=", id).execute();
}`;
    expect(statusScan(ts)).toEqual([]);
  });

  it("does not take a lock on another table, or a lock taken after the write", () => {
    const otherTable = `export async function voidReceipt(trx, id) {
  await trx.selectFrom("purchaseOrder").select("id").where("id", "=", poId).forUpdate().execute();
  await trx.updateTable("receipt").set({ status: "Voided" }).where("id", "=", id).execute();
}`;
    expect(statusSnippets(otherTable)).toEqual(["voidReceipt: receipt.status"]);
    const lockedAfter = `export async function voidReceipt(trx, id) {
  await trx.updateTable("receipt").set({ status: "Voided" }).where("id", "=", id).execute();
  await trx.selectFrom("receipt").select("id").where("id", "=", id).forUpdate().execute();
}`;
    expect(statusSnippets(lockedAfter)).toEqual([
      "voidReceipt: receipt.status"
    ]);
  });

  it("does not let a lock in one function stand for a write in another", () => {
    const ts = `export async function lockIt(trx, id) {
  await trx.selectFrom("receipt").select("id").where("id", "=", id).forUpdate().execute();
}

export async function voidReceipt(trx, id) {
  await trx.updateTable("receipt").set({ status: "Voided" }).where("id", "=", id).execute();
}`;
    expect(statusSnippets(ts)).toEqual(["voidReceipt: receipt.status"]);
  });

  it("passes a write after a same-file helper that locks the table", () => {
    const ts = `async function lockReceipt(trx, id) {
  return trx.selectFrom("receipt").select("status").where("id", "=", id).forUpdate().executeTakeFirst();
}

export async function voidReceipt(trx, id) {
  const receipt = await lockReceipt(trx, id);
  if (receipt?.status !== "Posted") throw new Error("not posted");
  await trx.updateTable("receipt").set({ status: "Voided" }).where("id", "=", id).execute();
}`;
    expect(statusScan(ts)).toEqual([]);
  });

  it("finds a lock on a query held in a variable and locked on a later line", () => {
    const ts = `export async function voidReceipt(trx, id) {
  let query = trx.selectFrom("receipt").select("status").where("id", "=", id);
  if (!dryRun) query = query.forUpdate();
  await query.executeTakeFirst();
  await trx.updateTable("receipt").set({ status: "Voided" }).where("id", "=", id).execute();
}`;
    expect(statusScan(ts)).toEqual([]);
  });

  it("passes an UPDATE that filters on another column it changes", () => {
    const ts = `async function releaseLeasePayments(trx, ids) {
  await trx
    .updateTable("leasePayment")
    .set({ status: "Pending", purchaseInvoiceLineId: null, updatedBy: userId })
    .where("companyId", "=", companyId)
    .where("purchaseInvoiceLineId", "in", ids)
    .execute();
}`;
    expect(statusScan(ts)).toEqual([]);
  });

  it("does not count an audit column as that claim", () => {
    const ts = `async function consume(trx, ids) {
  await trx.updateTable("trackedEntity").set({ status: "Consumed", updatedBy: userId }).where("id", "in", ids).where("updatedBy", "=", userId).execute();
}`;
    expect(statusSnippets(ts)).toEqual(["consume: trackedEntity.status"]);
  });

  it("reads status rows built for updateRowsById, which has no predicate of its own", () => {
    const ts = `export async function consumeAll(trx, entities) {
  const updates = [];
  for (const entity of entities) {
    updates.push({ id: entity.id, data: { status: "Consumed" } });
  }
  await updateRowsById(trx, "trackedEntity", companyId, updates);
}`;
    expect(statusSnippets(ts)).toEqual(["consumeAll: trackedEntity.status"]);
  });

  it("reads a row object built in a local and its later member writes", () => {
    const ts = `export async function setAsset(client, id) {
  const update: Database["public"]["Tables"]["receipt"]["Update"] = {
    updatedBy: userId
  };
  if (done) update.status = "Posted";
  await client.from("receipt").update(update).eq("id", id);
}`;
    expect(statusSnippets(ts)).toEqual(["setAsset: receipt.status"]);
  });

  it("reads the updateRows filter", () => {
    const guarded =
      'await updateRows(trx, "receipt", { status: "Posted" }, { id, companyId, status: "Pending" });';
    expect(statusScan(guarded)).toEqual([]);
    const unguarded =
      'await updateRows(trx, "receipt", { status: "Posted" }, { id, companyId });';
    expect(
      statusSnippets(`export async function post(trx) {\n  ${unguarded}\n}`)
    ).toEqual(["post: receipt.status"]);
  });

  it("names a class method in the snippet, and keeps a lock to its method", () => {
    const ts = `export class InvoiceSyncer {
  async lock(tx, id) {
    await tx.selectFrom("receipt").select("id").where("id", "=", id).forUpdate().execute();
  }

  async upsertLocal(tx, id, data) {
    await tx.updateTable("receipt").set({ status: data.status }).where("id", "=", id).execute();
  }
}`;
    expect(statusSnippets(ts)).toEqual([
      "InvoiceSyncer.upsertLocal: receipt.status"
    ]);
  });

  it("ignores status-named columns that are not a lifecycle", () => {
    const ts = `export async function edit(trx) {
  await trx.updateTable("employeeJob").set({ flsaStatus: "Exempt" }).where("id", "=", id).execute();
  await trx.updateTable("salesOrderStatusHistory").set({ status: "Confirmed" }).where("id", "=", id).execute();
  await trx.updateTable("note").set({ status: "x" }).where("id", "=", id).execute();
}`;
    expect(statusScan(ts)).toEqual([]);
  });

  it("ignores inserts, reads and comments", () => {
    const ts = `export async function create(trx) {
  // await trx.updateTable("receipt").set({ status: "Posted" }).where("id", "=", id).execute();
  await trx.insertInto("receipt").values({ status: "Draft" }).execute();
  await client.from("receipt").select("status").eq("id", id);
  await client.from("receipt").upsert({ status: "Draft" });
}`;
    expect(statusScan(ts)).toEqual([]);
  });
});

describe("statusColumns over the generated types", () => {
  const real = statusColumns(loadDbTableColumnTypes(repoRoot()));

  it("finds the lifecycle columns the shipped bugs wrote", () => {
    expect(real.get("accountingPeriod")?.has("closeStatus")).toBe(true);
    expect(real.get("quote")?.has("status")).toBe(true);
    expect(real.get("receipt")?.has("status")).toBe(true);
    expect(real.get("salesInvoice")?.has("status")).toBe(true);
  });

  it("leaves out classifications, results and history logs", () => {
    expect(real.has("employeeJob")).toBe(false);
    expect(real.has("salesOrderStatusHistory")).toBe(false);
    expect(real.get("gauge")).toBeUndefined();
  });
});

const COUNTER_SERVICE = "apps/erp/app/modules/inventory/inventory.service.ts";

const COUNTER_TYPES = new Map<string, Map<string, string>>([
  [
    "jobMaterial",
    new Map([
      ["id", "string"],
      ["quantityIssued", "number"],
      ["estimatedQuantity", "number"]
    ])
  ],
  ["jobOperation", new Map([["quantityComplete", "number"]])],
  [
    "purchaseOrderLine",
    new Map([
      ["quantityReceived", "number | null"],
      ["receivedComplete", "boolean"]
    ])
  ]
]);

const counterCheck = counterWriteRelative(COUNTER_TYPES);
const counterScan = (ts: string) => counterCheck.scan(COUNTER_SERVICE, ts);
const counterSnippets = (ts: string) => counterScan(ts).map((v) => v.snippet);

// The function head both parents share, from `git show
// ca513209d8^:apps/erp/app/modules/inventory/inventory.service.ts` (lines
// 21713–21741).
const HEAD = `async function issueJobOperationMaterials(
  trx: Transaction<KyselyDatabase>,
  {
    jobOperationId,
    quantity,
    companyId,
    userId,
    postingStatus,
    accountDefaults,
    dimensionMap,
    db,
    dryRun = false,
    plannedElsewhere = []
  }: {
    jobOperationId: string;
    quantity: number;
    companyId: string;
    userId: string;
    // Provisional before the company's accounting cutover, Posted after it.
    postingStatus: AutomaticJournalStatus;
    accountDefaults: ConsumeAccountDefaults;
    dimensionMap: Map<string, string>;
    db: Kysely<KyselyDatabase>;
    // Throw DryRunRollback after the strict check, before any ledger row.
    dryRun?: boolean;
    // Rows earlier operations of the same dry run plan to draw, so operations
    // sharing a bin are checked against their combined demand.
    plannedElsewhere?: ItemLedgerInsert[];
  }
) {
`;

// The job material read, unchanged in every revision (21742–21752).
const READ = `  const materialsToIssue = await trx
    .selectFrom("jobMaterial")
    .where("jobOperationId", "=", jobOperationId)
    .where("companyId", "=", companyId)
    .where("itemType", "in", ["Material", "Part", "Consumable"])
    .where("methodType", "!=", "Make to Order")
    .where("estimatedQuantity", ">", 0)
    .where("requiresBatchTracking", "=", false)
    .where("requiresSerialTracking", "=", false)
    .selectAll()
    .execute();
`;

// ca513209d8^, lines 21850–21864 and 22019–22030: the loop computes the issue
// from the read above and writes quantityIssued as that read plus the issue.
// Two completions of one operation both read the same quantityIssued.
const CA513209D8_PARENT = `${HEAD}${READ}
  for await (const material of materialsToIssue) {
    const demandQuantity = Number(material.quantity) * quantity;
    const remainingQuantity = Math.max(
      Number(material.estimatedQuantity ?? 0) -
        Number(material.quantityIssued ?? 0),
      0
    );
    const quantityToIssue = Math.min(demandQuantity, remainingQuantity);

    if (quantityToIssue <= 0) continue;

    await trx
      .updateTable("jobMaterial")
      .set({
        quantityIssued: round(
          round(Number(material.quantityIssued) ?? 0) + round(quantityToIssue)
        )
      })
      .where("id", "=", material.id)
      .where("companyId", "=", companyId)
      .execute();
  }
}
`;

// ca513209d8 added this lock of the OPERATION before the read (21743–21754).
const CA513209D8_LOCK = `  if (!dryRun) {
    await trx
      .selectFrom("jobOperation")
      .select("id")
      .where("id", "=", jobOperationId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .execute();
  }

`;

// f92d1b24fa^ (lines 28418–28421 and 28566–28575): the same write, now
// collected for updateRowsById. The operation lock is still there, and the
// draw locks are taken later, after the read.
const F92D1B24FA_PARENT = `${HEAD}${CA513209D8_LOCK}${READ}
  const materialIssuedUpdates: {
    id: string;
    data: { quantityIssued: number };
  }[] = [];
  for await (const material of materialsToIssue) {
    materialIssuedUpdates.push({
      id: material.id,
      data: {
        quantityIssued: round(
          round(Number(material.quantityIssued) ?? 0) + round(quantityToIssue)
        )
      }
    });
  }
  await updateRowsById(trx, "jobMaterial", companyId, materialIssuedUpdates);
}
`;

// f92d1b24fa (lines 28307–28332): take the draw locks the backflush takes,
// then read quantityIssued again under them.
const F92D1B24FA_RELOCK = `  if (!dryRun) {
    await lockUntrackedDraws(trx, {
      companyId,
      locationId: job.locationId,
      itemIds: pluckUnique(materialsToIssue, (m) => m.itemId)
    });
    const issued = await trx
      .selectFrom("jobMaterial")
      .select(["id", "quantityIssued"])
      .where(
        "id",
        "in",
        materialsToIssue.map((m) => m.id)
      )
      .where("companyId", "=", companyId)
      .execute();
    const issuedById = new Map(
      issued.map((row) => [row.id, row.quantityIssued])
    );
    for (const material of materialsToIssue) {
      material.quantityIssued =
        issuedById.get(material.id) ?? material.quantityIssued;
    }
  }
`;

const F92D1B24FA_FIX = F92D1B24FA_PARENT.replace(
  "\n  const materialIssuedUpdates",
  `\n${F92D1B24FA_RELOCK}\n  const materialIssuedUpdates`
);

describe("counterWriteRelative: the shipped bugs", () => {
  it("flags the write from before ca513209d8", () => {
    const v = counterScan(CA513209D8_PARENT);
    expect(v.map((x) => x.snippet)).toEqual([
      "issueJobOperationMaterials: jobMaterial.quantityIssued"
    ]);
    expect(v[0]?.message).toContain(`sql\`"quantityIssued" + \${delta}\``);
    expect(v[0]?.message).toContain("forUpdate()");
  });

  it("still flags ca513209d8's fix: its operation lock did not cover the backflush (f92d1b24fa)", () => {
    const fixed = CA513209D8_PARENT.replace(READ, `${CA513209D8_LOCK}${READ}`);
    expect(counterSnippets(fixed)).toEqual([
      "issueJobOperationMaterials: jobMaterial.quantityIssued"
    ]);
  });

  it("flags the updateRowsById write from before f92d1b24fa", () => {
    expect(counterSnippets(F92D1B24FA_PARENT)).toEqual([
      "issueJobOperationMaterials: jobMaterial.quantityIssued"
    ]);
  });

  it("passes the f92d1b24fa fix", () => {
    expect(counterScan(F92D1B24FA_FIX)).toEqual([]);
  });
});

describe("counterWriteRelative", () => {
  it("passes a relative write in SQL", () => {
    const ts = `export async function issue(trx, id, delta) {
  const line = await trx.selectFrom("jobMaterial").selectAll().where("id", "=", id).executeTakeFirst();
  await trx.updateTable("jobMaterial").set({ quantityIssued: sql\`"quantityIssued" + \${delta}\` }).where("id", "=", id).execute();
  await trx.updateTable("jobMaterial").set({ quantityIssued: (eb) => eb("quantityIssued", "+", delta) }).where("id", "=", id).execute();
}`;
    expect(counterScan(ts)).toEqual([]);
  });

  it("passes a total read under a lock of the same table", () => {
    const ts = `export async function issue(trx, id, delta) {
  const line = await trx.selectFrom("jobMaterial").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  await trx.updateTable("jobMaterial").set({ quantityIssued: line.quantityIssued + delta }).where("id", "=", id).execute();
}`;
    expect(counterScan(ts)).toEqual([]);
  });

  it("does not take a named lock without a read after it", () => {
    const ts = `export async function issue(trx, id, delta) {
  const line = await trx.selectFrom("jobMaterial").selectAll().where("id", "=", id).executeTakeFirst();
  await lockUntrackedDraws(trx, { companyId, locationId, itemIds });
  await trx.updateTable("jobMaterial").set({ quantityIssued: line.quantityIssued + delta }).where("id", "=", id).execute();
}`;
    expect(counterSnippets(ts)).toEqual(["issue: jobMaterial.quantityIssued"]);
  });

  it("follows the total through locals", () => {
    const ts = `export async function receive(client, line, received) {
  const current = line.quantityReceived ?? 0;
  const next = current + received;
  await client.from("purchaseOrderLine").update({ quantityReceived: next }).eq("id", line.id);
}`;
    expect(counterSnippets(ts)).toEqual([
      "receive: purchaseOrderLine.quantityReceived"
    ]);
  });

  it("stops following the total after three locals", () => {
    const ts = `export async function receive(client, line, received) {
  const a = line.quantityReceived ?? 0;
  const b = a + received;
  const c = round(b);
  const d = Math.max(c, 0);
  await client.from("purchaseOrderLine").update({ quantityReceived: d }).eq("id", line.id);
}`;
    expect(counterScan(ts)).toEqual([]);
  });

  it("does not take a read of another table after the named lock", () => {
    const ts = `export async function issue(trx, id, delta) {
  const line = await trx.selectFrom("jobMaterial").selectAll().where("id", "=", id).executeTakeFirst();
  await lockUntrackedDraws(trx, { companyId, locationId, itemIds });
  const operation = await trx.selectFrom("jobOperation").select(["id", "quantityIssued"]).executeTakeFirst();
  await trx.updateTable("jobMaterial").set({ quantityIssued: line.quantityIssued + delta }).where("id", "=", id).execute();
}`;
    expect(counterSnippets(ts)).toEqual(["issue: jobMaterial.quantityIssued"]);
  });

  it("passes a total read with selectAll after a named lock", () => {
    const ts = `export async function issue(trx, id, delta) {
  await lockUntrackedDraws(trx, { companyId, locationId, itemIds });
  const line = await trx.selectFrom("jobMaterial").selectAll().where("id", "=", id).executeTakeFirst();
  await trx.updateTable("jobMaterial").set({ quantityIssued: line.quantityIssued + delta }).where("id", "=", id).execute();
}`;
    expect(counterScan(ts)).toEqual([]);
  });

  it("skips a table the generated types do not have", () => {
    const ts = `export async function issue(trx, id, delta) {
  await trx.updateTable("legacyMaterial").set({ quantityIssued: line.quantityIssued + delta }).where("id", "=", id).execute();
}`;
    expect(counterScan(ts)).toEqual([]);
  });

  it("skips a counter name that is not a numeric column of the written table", () => {
    const ts = `export async function complete(trx, operation, delta) {
  await trx.updateTable("jobOperation").set({ quantityIssued: operation.quantityIssued + delta }).where("id", "=", operation.id).execute();
}`;
    expect(counterScan(ts)).toEqual([]);
  });

  it("passes a relative SQL write whose delta is the difference of two reads", () => {
    const ts = `export async function issue(trx, id, before, after) {
  await trx.updateTable("jobMaterial").set({ quantityIssued: (eb) => eb("quantityIssued", "+", after.quantityIssued - before.quantityIssued) }).where("id", "=", id).execute();
}`;
    expect(counterScan(ts)).toEqual([]);
  });

  it("reads rows collected in a map for updateRowsById", () => {
    const ts = `export async function postReceipt(trx, lines) {
  const updates = lines.reduce((acc, line) => {
    const newQuantityReceived = (line.quantityReceived ?? 0) + line.received;
    return {
      ...acc,
      [line.id]: { quantityReceived: newQuantityReceived, receivedComplete: true }
    };
  }, {});
  await updateRowsById(trx, "purchaseOrderLine", companyId, Object.entries(updates).map(([id, data]) => ({ id, data })));
}`;
    expect(counterSnippets(ts)).toEqual([
      "postReceipt: purchaseOrderLine.quantityReceived"
    ]);
  });

  it("passes a total that does not read the counter back", () => {
    const ts = `export async function setIssued(trx, id, issued) {
  const quantityIssued = issued * 2;
  await trx.updateTable("jobMaterial").set({ quantityIssued }).where("id", "=", id).execute();
  await trx.updateTable("jobMaterial").set({ quantityIssued: 0 }).where("id", "=", id).execute();
  await trx.updateTable("jobMaterial").set({ estimatedQuantity: line.estimatedQuantity + 1 }).where("id", "=", id).execute();
}`;
    expect(counterScan(ts)).toEqual([]);
  });

  it("does not read a for-of loop body as the loop variable's value", () => {
    // postPurchaseInvoice's void: the rows destructure \`purchaseOrderId\`,
    // which an earlier loop also declares; its body is a projection, not a
    // write.
    const ts = `export async function voidInvoice(trx, lines, received) {
  const updates = { [id]: { quantityReceived: received, purchaseOrderId } };
  for (const purchaseOrderId of orderIds) {
    const projected = lines.map((line) => ({ ...line, quantityReceived: line.quantityReceived }));
  }
  await updateRowsById(trx, "purchaseOrderLine", companyId, Object.entries(updates).map(([id, { purchaseOrderId: _p, ...data }]) => ({ id, data })));
}`;
    expect(counterScan(ts)).toEqual([]);
  });
});

describe("COUNTER_COLUMNS over the generated types", () => {
  it("are numeric columns the schema really has", () => {
    const types = loadDbTableColumnTypes(repoRoot());
    const numeric = new Set<string>();
    for (const columns of types.values()) {
      for (const [name, type] of columns) {
        if (/^number\b/.test(type)) numeric.add(name);
      }
    }
    const missing = [...COUNTER_COLUMNS].filter((c) => !numeric.has(c));
    expect(missing).toEqual([]);
  });
});
