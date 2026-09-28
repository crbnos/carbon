import { describe, expect, it } from "vitest";
import { noDirectTableWriteInRoute } from "./no-direct-table-write-in-route";

const ROUTE = "apps/erp/app/routes/x+/part+/$itemId.purchasing.new.tsx";
const scan = (ts: string, file = ROUTE) =>
  noDirectTableWriteInRoute.scan(file, ts);

describe("noDirectTableWriteInRoute", () => {
  it("flags a supabase insert/update/upsert/delete, across line breaks", () => {
    const ts = [
      'await client.from("supplierPartPrice").insert(rows);',
      "await client",
      '  .from("item")',
      "  .update({ active: true })",
      '  .eq("id", id);',
      'await client.from("quote").upsert(row);',
      'await client.from("quoteOperation").delete().eq("id", id);'
    ].join("\n");
    const v = scan(ts);
    expect(v.map((x) => x.snippet)).toEqual([
      'from("supplierPartPrice").insert',
      'from("item").update',
      'from("quote").upsert',
      'from("quoteOperation").delete'
    ]);
    expect(v.map((x) => x.line)).toEqual([1, 3, 6, 7]);
  });

  it("flags Kysely writes", () => {
    const ts = [
      'await trx.deleteFrom("supplierPartPrice").where("companyId", "=", c);',
      'await trx.insertInto("supplierPartPrice").values(rows);',
      'await db.updateTable("item").set({ active }).execute();'
    ].join("\n");
    expect(scan(ts).map((x) => x.snippet)).toEqual([
      'deleteFrom("supplierPartPrice")',
      'insertInto("supplierPartPrice")',
      'updateTable("item")'
    ]);
  });

  it("allows reads, service calls and storage buckets", () => {
    const ts = [
      'const q = await client.from("quote").select("*").eq("id", id);',
      "await upsertSupplierPartPrices(getDatabaseClient(), args);",
      'await client.storage.from("private").remove([path]);',
      'await trx.selectFrom("item").select("id").execute();'
    ].join("\n");
    expect(scan(ts)).toEqual([]);
  });

  it("ignores comments", () => {
    const ts = [
      '// client.from("item").update({ active })',
      '/* trx.deleteFrom("item") */',
      'const url = "https://example.com"; // .from("x").insert('
    ].join("\n");
    expect(scan(ts)).toEqual([]);
  });

  it("only scans ERP x+ routes", () => {
    const ts = 'await client.from("item").update({ active: true });';
    expect(scan(ts, "apps/erp/app/modules/items/items.service.ts")).toEqual([]);
    expect(scan(ts, "apps/erp/app/routes/api+/item.$type.ts")).toEqual([]);
    expect(scan(ts, "apps/mes/app/routes/x+/start.tsx")).toEqual([]);
  });
});
