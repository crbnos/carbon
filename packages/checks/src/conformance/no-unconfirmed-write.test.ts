import { describe, expect, it } from "vitest";
import { noUnconfirmedWrite } from "./no-unconfirmed-write";

const SERVICE = "apps/erp/app/modules/sales/sales.service.ts";
const scan = (ts: string, file = SERVICE) => noUnconfirmedWrite.scan(file, ts);

describe("noUnconfirmedWrite", () => {
  it("flags a bare delete keyed on id", () => {
    const ts = [
      "export async function deleteWidget(client, widgetId) {",
      '  return client.from("widget").delete().eq("id", widgetId);',
      "}"
    ].join("\n");
    const v = scan(ts);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(2);
    expect(v[0]?.snippet).toBe('deleteWidget: from("widget").delete()');
  });

  it("flags a multi-line update keyed on id", () => {
    const ts = [
      "export async function updateWidgetStatus(client, update) {",
      "  return client",
      '    .from("widget")',
      "    .update(update)",
      '    .eq("id", update.id);',
      "}"
    ].join("\n");
    expect(scan(ts)).toHaveLength(1);
  });

  it("flags a status-guarded write: the guard is just another filter", () => {
    const ts =
      'export async function deleteEntry(client, id) { return client.from("journal").delete().eq("id", id).eq("status", "Draft"); }';
    expect(scan(ts)).toHaveLength(1);
  });

  it("does not accept .select() without .single(): a miss is data: []", () => {
    const ts =
      'export async function updateWidget(client, id, x) { return client.from("widget").update(x).eq("id", id).select("id"); }';
    expect(scan(ts)).toHaveLength(1);
  });

  it("does not accept a bare .maybeSingle(): a miss is data: null", () => {
    const ts =
      'export async function updateWidget(client, id, x) { return client.from("widget").update(x).eq("id", id).select("id").maybeSingle(); }';
    expect(scan(ts)).toHaveLength(1);
  });

  it("passes .select().single()", () => {
    const ts = [
      "export async function deleteWidget(client, widgetId) {",
      "  return client",
      '    .from("widget")',
      "    .delete()",
      '    .eq("id", widgetId)',
      '    .select("id")',
      "    .single();",
      "}"
    ].join("\n");
    expect(scan(ts)).toHaveLength(0);
  });

  it("passes .maybeSingle() when the caller then checks for the missing row", () => {
    const ts = [
      "export async function moveWidget(client, id, from, to) {",
      "  const result = await client",
      '    .from("widget")',
      "    .update({ status: to })",
      '    .eq("id", id)',
      '    .eq("status", from)',
      '    .select("id")',
      "    .maybeSingle();",
      "  if (result.error) return result;",
      '  if (!result.data) return { data: null, error: ruleError("moved") };',
      "  return result;",
      "}"
    ].join("\n");
    expect(scan(ts)).toHaveLength(0);
  });

  it("passes a chain continued through a variable into .single()", () => {
    const ts = [
      "export async function upsertWidget(client, widget) {",
      "  let query = client",
      '    .from("widget")',
      "    .update(widget)",
      '    .eq("id", widget.id);',
      '  if (widget.companyId) query = query.eq("companyId", widget.companyId);',
      '  return query.select("id").single();',
      "}"
    ].join("\n");
    expect(scan(ts)).toHaveLength(0);
  });

  it("ignores writes keyed on a non-unique column: .single() would roll them back", () => {
    const ts = [
      "export async function deleteWidgetLines(client, widgetId) {",
      '  return client.from("widgetLine").delete().eq("widgetId", widgetId);',
      "}",
      "export async function deleteWidgets(client, ids) {",
      '  return client.from("widget").delete().in("id", ids);',
      "}"
    ].join("\n");
    expect(scan(ts)).toHaveLength(0);
  });

  it("uses the table's own unique key when it is not id", () => {
    const flagged =
      'export async function updateCustomerTax(client, t) { return client.from("customerTax").update(t).eq("customerId", t.customerId); }';
    expect(scan(flagged)).toHaveLength(1);
    const readableIdOnly =
      'export async function updatePart(client, p) { return client.from("part").update(p).eq("id", p.id); }';
    expect(scan(readableIdOnly)).toHaveLength(0);
    const scoped =
      'export async function updatePart(client, p) { return client.from("part").update(p).eq("id", p.id).eq("companyId", p.companyId); }';
    expect(scan(scoped)).toHaveLength(1);
  });

  it("reads each branch of a ternary as its own statement", () => {
    const ts = [
      "export async function deleteThing(client, id, hard) {",
      "  return hard",
      '    ? client.from("thing").delete().eq("id", id).select("id").single()',
      '    : client.from("thing").update({ active: false }).eq("id", id);',
      "}"
    ].join("\n");
    const v = scan(ts);
    expect(v).toHaveLength(1);
    expect(v[0]?.snippet).toBe('deleteThing: from("thing").update()');
  });

  it("ignores reads, inserts and upserts", () => {
    const ts = [
      'client.from("widget").select("*").eq("id", id);',
      'client.from("widget").insert(w);',
      'client.from("widget").upsert(w).eq("id", id);'
    ].join("\n");
    expect(scan(ts)).toHaveLength(0);
  });

  it("ignores commented-out code", () => {
    const ts = '// return client.from("widget").delete().eq("id", id);';
    expect(scan(ts)).toHaveLength(0);
  });

  it("only scans ERP service files", () => {
    const ts = 'return client.from("widget").delete().eq("id", id);';
    expect(scan(ts, "apps/erp/app/routes/x+/widget.tsx")).toHaveLength(0);
    expect(scan(ts, "apps/mes/app/services/widget.service.ts")).toHaveLength(0);
  });
});
