import { describe, expect, it } from "vitest";
import { declaredArgUnused } from "./declared-arg-unused";

const SERVICE = "apps/erp/app/modules/sales/sales.service.ts";
const scan = (ts: string, file = SERVICE) => declaredArgUnused.scan(file, ts);

describe("declaredArgUnused", () => {
  it("flags a declared filter the body never reads", () => {
    const ts = [
      "export async function getWidgets(",
      "  client: SupabaseClient<Database>,",
      "  companyId: string,",
      "  args: GenericQueryFilters & {",
      "    search: string | null;",
      "    status: string | null;",
      "    customerId: string | null;",
      "  }",
      ") {",
      '  let query = client.from("widgets").select("*").eq("companyId", companyId);',
      '  query = setSearchFilter(query, args.search, ["name"]);',
      "  if (args.customerId) {",
      '    query = query.eq("customerId", args.customerId);',
      "  }",
      "  query = setGenericQueryFilters(query, args, []);",
      "  return query;",
      "}"
    ].join("\n");
    const v = scan(ts);
    expect(v.map((x) => x.snippet)).toEqual(["getWidgets: args.status"]);
    expect(v[0]?.line).toBe(1);
  });

  it("accepts optional chaining, bracket access and destructuring", () => {
    const ts = [
      "export async function getWidgets(client, args?: { a?: string; b?: string; c?: string }) {",
      '  if (args?.a) query = query.eq("a", args.a);',
      '  if (args?.["b"]) query = query.eq("b", 1);',
      "  const { c } = args;",
      "  return query;",
      "}"
    ].join("\n");
    expect(scan(ts)).toHaveLength(0);
  });

  it("ignores the generic keys and a truthiness test on args", () => {
    const ts = [
      "export async function getWidgets(client, args?: GenericQueryFilters & { limit: number; sorts?: Sort[] }) {",
      "  if (args) {",
      "    query = setGenericQueryFilters(query, args, []);",
      "  }",
      "  return query;",
      "}"
    ].join("\n");
    expect(scan(ts)).toHaveLength(0);
  });

  it("assumes every key is read when args is handed on whole", () => {
    const ts = [
      "export async function getWidgets(client, args: { status?: string }) {",
      "  return getWidgetsInner(client, args);",
      "}",
      "export async function getGadgets(client, args: { status?: string }) {",
      '  return client.rpc("gadgets", { ...args });',
      "}"
    ].join("\n");
    expect(scan(ts)).toHaveLength(0);
  });

  it("reads past a return type annotation to the body", () => {
    const ts = [
      "export async function getWidgets(",
      "  client,",
      "  args: { status?: string; kind?: string }",
      "): Promise<{",
      "  data: Widget[] | null;",
      "}> {",
      '  if (args.status) query = query.eq("status", args.status);',
      "  return query;",
      "}"
    ].join("\n");
    expect(scan(ts).map((x) => x.snippet)).toEqual(["getWidgets: args.kind"]);
  });

  it("only checks READ functions", () => {
    const ts = [
      "export async function upsertWidget(client, args: { status?: string }) {",
      "  return null;",
      "}"
    ].join("\n");
    expect(scan(ts)).toHaveLength(0);
  });

  it("only checks params named args/filters/params", () => {
    const ts = [
      "export async function getWidget(client, widget: { id: string; name: string }) {",
      '  return client.from("widget").select("*").eq("id", widget.id);',
      "}"
    ].join("\n");
    expect(scan(ts)).toHaveLength(0);
  });

  it("only scans ERP service files", () => {
    const ts =
      "export async function getWidgets(client, args: { status?: string }) { return 1; }";
    expect(scan(ts, "apps/erp/app/routes/x+/widgets.tsx")).toHaveLength(0);
  });
});
