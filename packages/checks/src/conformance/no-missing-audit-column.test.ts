import { describe, expect, it } from "vitest";
import { noMissingAuditColumn } from "./no-missing-audit-column";

const FILE = "apps/erp/app/routes/api+/sales-rfq.$rfqId.map-lines.ts";

// customerPartToItem really has these six columns and no audit ones; item has
// both. A table absent from the map is unknown to the check.
const COLUMNS = new Map([
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

const check = noMissingAuditColumn(COLUMNS);

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
    const v = check.scan(FILE, ts);
    expect(v).toHaveLength(1);
    expect(v[0]?.snippet).toBe("createdBy");
    expect(v[0]?.line).toBe(7);
    expect(v[0]?.message).toContain("customerPartToItem");
  });

  it("flags both fields, and only the ones the table lacks", () => {
    const both =
      'client.from("customerPartToItem").insert({ createdBy, updatedBy });';
    expect(check.scan(FILE, both).map((v) => v.snippet)).toEqual([
      "createdBy",
      "updatedBy"
    ]);
    // company has updatedBy but not createdBy
    const one =
      'client.from("company").update({ name, createdBy, updatedBy });';
    expect(check.scan(FILE, one).map((v) => v.snippet)).toEqual(["createdBy"]);
  });

  it("allows audit fields on a table that has them", () => {
    const ts =
      'client.from("item").insert({ readableId, companyId, createdBy });';
    expect(check.scan(FILE, ts)).toEqual([]);
  });

  it("ignores a read and a delete on the same table", () => {
    const ts = [
      'const { data } = await client.from("customerPartToItem").select("*")',
      '  .eq("createdBy", userId);',
      'await client.from("customerPartToItem").delete().eq("id", id);'
    ].join("\n");
    expect(check.scan(FILE, ts)).toEqual([]);
  });

  it("ignores a table it has no columns for", () => {
    const ts = 'client.from("someFutureTable").insert({ createdBy });';
    expect(check.scan(FILE, ts)).toEqual([]);
  });

  it("does not reach into a later, unrelated write", () => {
    // `createdBy` here belongs to the item insert, not to the link-table read.
    const ts = [
      'const existing = await client.from("customerPartToItem").select("id");',
      "",
      "// a comment long enough that the next write is well past the window,",
      "// which is what keeps the two statements from being conflated at all",
      "",
      'await client.from("item").insert({ companyId, createdBy: userId });'
    ].join("\n");
    expect(check.scan(FILE, ts)).toEqual([]);
  });

  it("covers the Kysely spellings", () => {
    const insert = [
      'await trx.insertInto("customerPartToItem")',
      "  .values({ customerId, itemId, companyId, createdBy: userId })",
      "  .execute();"
    ].join("\n");
    expect(check.scan(FILE, insert).map((v) => v.snippet)).toEqual([
      "createdBy"
    ]);

    const update = [
      'await trx.updateTable("customerPartToItem")',
      "  .set({ customerPartId, updatedBy: userId })",
      "  .execute();"
    ].join("\n");
    expect(check.scan(FILE, update).map((v) => v.snippet)).toEqual([
      "updatedBy"
    ]);
  });
});
