// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noDiscardedQueryError } from "./no-discarded-query-error";

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
