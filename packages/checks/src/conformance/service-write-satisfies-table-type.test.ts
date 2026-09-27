import { describe, expect, it } from "vitest";
import { serviceWriteSatisfiesTableType } from "./service-write-satisfies-table-type";

const SERVICE = "apps/erp/app/modules/sales/sales.service.ts";
const scan = (ts: string, file = SERVICE) =>
  serviceWriteSatisfiesTableType.scan(file, ts);

describe("serviceWriteSatisfiesTableType", () => {
  it("flags an untyped literal update, naming the function and table", () => {
    const ts = [
      "export async function closeOrder(client, id) {",
      '  return client.from("salesOrder").update({ closed: true }).eq("id", id);',
      "}"
    ].join("\n");
    const v = scan(ts);
    expect(v).toHaveLength(1);
    expect(v[0]?.snippet).toBe('closeOrder: .from("salesOrder").update(');
    expect(v[0]?.line).toBe(2);
  });

  it("flags literals inside an array or sanitize()", () => {
    const ts = [
      "export async function a(client, x) {",
      '  await client.from("memo").insert([{ memoId: x }]);',
      '  return client.from("memo").update(sanitize({ note: x }));',
      "}"
    ].join("\n");
    expect(scan(ts)).toHaveLength(2);
  });

  it("passes a literal typed with satisfies", () => {
    const ts = [
      "export async function a(client, x) {",
      '  await client.from("memo").insert([{ memoId: x } satisfies TablesInsert<"memo">]);',
      "  return client",
      '    .from("item")',
      "    .update({",
      "      name: x, // a comment with a } brace",
      '      description: `text ${"}"}`',
      '    } satisfies TablesUpdate<"item">);',
      "}"
    ].join("\n");
    expect(scan(ts)).toHaveLength(0);
  });

  it("ignores a write of a named value (typed where it is built)", () => {
    const ts =
      'export async function a(client, row) { return client.from("memo").insert(row); }';
    expect(scan(ts)).toHaveLength(0);
  });

  it("only scans service files", () => {
    const ts =
      'export async function a(client) { return client.from("memo").update({ x: 1 }); }';
    expect(scan(ts, "apps/erp/app/routes/x+/memo.tsx")).toHaveLength(0);
  });
});
