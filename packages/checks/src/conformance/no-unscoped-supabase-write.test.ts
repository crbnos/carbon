// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noUnscopedSupabaseWrite } from "./no-unscoped-supabase-write";

const columns = (...names: string[]) =>
  new Map(names.map((n) => [n, "string"] as [string, string]));

const COLUMN_TYPES = new Map<string, Map<string, string>>([
  ["receipt", columns("id", "companyId", "status")],
  ["salesInvoice", columns("id", "companyId", "dateIssued")],
  ["salesInvoiceShipment", columns("id", "companyId")],
  ["maintenanceDispatchItem", columns("id", "companyId")],
  ["maintenanceDispatchEvent", columns("id", "companyId", "endTime")],
  ["quoteLine", columns("id", "companyId", "quoteId")],
  ["company", columns("id", "name")],
  ["account", columns("id", "companyGroupId")]
]);

const check = noUnscopedSupabaseWrite(COLUMN_TYPES);
const SERVICE = "apps/erp/app/modules/sales/sales.service.ts";
const scan = (ts: string, file = SERVICE) => check.scan(file, ts);

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
    const v = scan(ts, "apps/erp/app/routes/x+/receipt+/$receiptId.post.tsx");
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
      scan(ts, "apps/erp/app/routes/x+/receipt+/$receiptId.post.tsx")
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
    const v = scan(ts, "apps/erp/app/routes/x+/sales-invoice+/update.tsx");
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
      scan(ts, "apps/erp/app/routes/x+/sales-invoice+/update.tsx")
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
    const v = scan(ts, "apps/mes/app/services/maintenance.service.ts");
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
      scan(ts, "apps/mes/app/services/maintenance.service.ts")
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
    const v = scan(ts, "apps/erp/app/modules/invoicing/invoicing.service.ts");
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
      scan(ts, "apps/erp/app/modules/invoicing/invoicing.service.ts")
    ).toHaveLength(0);
  });

  it("flags a delete keyed by a parent id alone", () => {
    expect(
      scan('await client.from("quoteLine").delete().eq("quoteId", quoteId);')
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
      expect(scan(ts)).toHaveLength(0);
    }
  });

  it("does not count companyId in the row, or in a match on another key", () => {
    expect(
      scan(
        'await client.from("quoteLine").update({ companyId, x }).eq("id", id);'
      )
    ).toHaveLength(1);
    expect(
      scan(
        'await client.from("quoteLine").update({ x }).match({ id: companyIdOf(x) });'
      )
    ).toHaveLength(1);
  });

  it("does not let a NEIGHBOURING write's companyId scope this one", () => {
    const ts = [
      'await client.from("quoteLine").update({ x }).eq("id", id);',
      'await client.from("quoteLine").update({ y }).eq("id", id).eq("companyId", companyId);'
    ].join("\n");
    const v = scan(ts);
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
    expect(scan(scoped)).toHaveLength(0);
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
    expect(scan(unscoped)).toHaveLength(1);
  });

  it("does not follow an awaited result held in a local", () => {
    const ts = [
      "export async function f() {",
      '  const result = await client.from("quoteLine").delete().eq("id", id);',
      '  result.eq("companyId", companyId);',
      "}"
    ].join("\n");
    expect(scan(ts)).toHaveLength(1);
  });

  it("ignores tables with no companyId column, unknown tables and variables", () => {
    for (const ts of [
      'await client.from("company").update({ name }).eq("id", companyId);',
      'await client.from("account").update({ name }).eq("id", id);',
      'await client.from("notATable").delete().eq("id", id);',
      'await client.from(table).delete().eq("id", id);'
    ]) {
      expect(scan(ts)).toHaveLength(0);
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
      expect(scan(ts)).toHaveLength(0);
    }
  });

  it("ignores a companyId filter that is only in a comment", () => {
    const ts = [
      'await client.from("quoteLine").delete()',
      '  // .eq("companyId", companyId)',
      '  .eq("id", id);'
    ].join("\n");
    expect(scan(ts)).toHaveLength(1);
  });

  it("covers routes, MES and jobs, and ignores edge functions and packages/ee", () => {
    const ts = 'await client.from("quoteLine").delete().eq("id", id);';
    for (const file of [
      "apps/erp/app/routes/x+/quote+/delete.tsx",
      "apps/mes/app/services/operations.service.ts",
      "packages/jobs/src/inngest/functions/x.ts"
    ]) {
      expect(scan(ts, file)).toHaveLength(1);
    }
    for (const file of [
      "packages/database/supabase/functions/post-receipt/index.ts",
      "packages/ee/src/xero/sync.ts"
    ]) {
      expect(scan(ts, file)).toHaveLength(0);
    }
  });
});
