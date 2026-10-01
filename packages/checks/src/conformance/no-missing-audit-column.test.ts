// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noMissingAuditColumn } from "./no-missing-audit-column";

const FILE = "apps/erp/app/routes/api+/sales-rfq.$rfqId.map-lines.ts";

// customerPartToItem really has these six columns and no audit ones; item has
// both; company has updatedBy but not createdBy. A table absent from the map is
// unknown to the check.
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
const snippets = (ts: string) => check.scan(FILE, ts).map((v) => v.snippet);

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
    expect(
      snippets(
        'client.from("customerPartToItem").insert({ createdBy, updatedBy });'
      )
    ).toEqual(["createdBy", "updatedBy"]);
    // company has updatedBy but not createdBy
    expect(
      snippets('client.from("company").update({ createdBy, updatedBy });')
    ).toEqual(["createdBy"]);
  });

  it("allows audit fields on a table that has them", () => {
    expect(
      snippets(
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
    expect(snippets(ts)).toEqual([]);
  });

  it("ignores a table it has no columns for", () => {
    expect(
      snippets('client.from("someFutureTable").insert({ createdBy });')
    ).toEqual([]);
  });

  it("covers the Kysely spellings", () => {
    const insert = [
      'await trx.insertInto("customerPartToItem")',
      "  .values({ customerId, itemId, companyId, createdBy: userId })",
      "  .execute();"
    ].join("\n");
    expect(snippets(insert)).toEqual(["createdBy"]);

    const update = [
      'await trx.updateTable("customerPartToItem")',
      "  .set({ customerPartId, updatedBy: userId })",
      "  .execute();"
    ].join("\n");
    expect(snippets(update)).toEqual(["updatedBy"]);
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
      expect(snippets(ts)).toEqual([]);
    });

    it("does not blame a table for a write on the preceding line", () => {
      const ts = [
        'client.from("item").insert({ createdBy });',
        'client.from("customerPartToItem").select("id");'
      ].join("\n");
      expect(snippets(ts)).toEqual([]);
    });

    it("still follows a chain broken across lines", () => {
      const ts = [
        "await client",
        '  .from("customerPartToItem")',
        "  // staged by the RFQ mapping",
        "  .upsert({ customerId, createdBy: userId })",
        '  .select("id");'
      ].join("\n");
      expect(snippets(ts)).toEqual(["createdBy"]);
    });
  });

  // A name only counts in KEY position in a row object.
  describe("inspects row keys, not identifier occurrences", () => {
    it("ignores an audit identifier used as a value", () => {
      expect(
        snippets(
          'client.from("company").update({ name: createdBy, updatedBy });'
        )
      ).toEqual([]);
    });

    it("flags a quoted key", () => {
      expect(
        snippets(
          'client.from("customerPartToItem").insert({ "createdBy": userId });'
        )
      ).toEqual(["createdBy"]);
    });

    it("ignores the keys of a nested value object", () => {
      expect(
        snippets(
          'client.from("customerPartToItem").update({ meta: { createdBy } });'
        )
      ).toEqual([]);
    });

    it("ignores a write option in the second argument", () => {
      expect(
        snippets(
          'client.from("customerPartToItem").upsert({ customerId }, { onConflict: "createdBy" });'
        )
      ).toEqual([]);
    });

    it("ignores an audit name inside a call in a value position", () => {
      expect(
        snippets(
          'client.from("customerPartToItem").update({ customerPartId: pick(row, createdBy) });'
        )
      ).toEqual([]);
    });

    it("flags every row of an inserted array", () => {
      expect(
        snippets(
          'client.from("customerPartToItem").insert([{ createdBy }, { updatedBy }]);'
        )
      ).toEqual(["createdBy", "updatedBy"]);
    });

    it("finds nothing in a spread payload — that is the generator's job", () => {
      expect(
        snippets('client.from("customerPartToItem").insert([customerPart]);')
      ).toEqual([]);
    });
  });
});
