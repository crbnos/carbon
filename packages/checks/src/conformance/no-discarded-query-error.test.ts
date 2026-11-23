// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noDiscardedQueryError } from "./no-discarded-query-error";

const scan = (contents: string) =>
  noDiscardedQueryError
    .scan("apps/erp/app/modules/x/x.service.ts", contents)
    .map(({ line, snippet }) => ({ line, snippet }));

describe("noDiscardedQueryError", () => {
  // cfdc4f9299^ accounting.service.ts — a failed group read scoped the ledger to every company.
  it("flags a data-only destructure of a read (cfdc4f9299 parent)", () => {
    expect(
      scan(`
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
      scan(`
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

  // b399972472^ sales.service.ts — a failed read ended the price-list export early.
  it("flags a bare { data } destructure (b399972472 parent)", () => {
    expect(
      scan(`
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
      scan(`
  const { data, error } = await client
    .from("itemCost")
    .select("itemId")
    .eq("companyId", companyId)
    .in("itemPostingGroupId", groupIds);
  const itemIds = (data ?? []).map((r) => r.itemId);
  return { itemIds, filters: remaining, error };`)
    ).toEqual([]);
  });

  // 22c9b98508^ sales-rfq.$rfqId.map-lines.ts — both writes' results were dropped.
  it("flags awaited writes used as bare statements (22c9b98508 parent)", () => {
    expect(
      scan(`
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
      scan(`
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

  // c0b85077ee^ approvals/service.ts — a failed read meant "nothing pending".
  it("flags a bound result read for data with its error never read (c0b85077ee parent)", () => {
    expect(
      scan(`
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
      scan(`
async function f() {
  const result = await client.from("approvalRequest").select("id");
  ${rest}
}`)
    ).toEqual([]);
  });

  it("flags .data read straight off an awaited call", () => {
    expect(
      scan(
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
    'const { data } = await client.storage.from("private").download(path);',
    'const { data } = await client.functions.invoke("create", { body });',
    'const { count } = await carbon?.from("job").select("id", { count: "exact", head: true });',
    "const { data } = await (serviceRole as any).from(table).select();"
  ])("flags every supabase-js request shape: %s", (line) => {
    expect(scan(line)).toHaveLength(1);
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
      "the pattern inside a comment or string",
      '// const { data } = await client.from("t").select();\nconst s = "await client.from(\\"t\\").insert({})";'
    ]
  ])("passes %s", (_, contents) => {
    expect(scan(contents)).toEqual([]);
  });
});
