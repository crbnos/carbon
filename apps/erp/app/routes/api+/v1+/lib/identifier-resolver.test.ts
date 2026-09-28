// The identifier resolver runs through a real supabase-js client; only the
// PostgREST HTTP boundary is stubbed, answering each GET from fixture rows by
// the `eq.` filters in its query string.

import type { Database } from "@carbon/database";
import { ORPCError } from "@orpc/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  resolveIdentifier,
  resolveIdentifierArgs
} from "./identifier-resolver.server";

type Row = Record<string, string>;

function postgrest(tables: Record<string, Row[]>, requests: string[] = []) {
  const fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    requests.push(`${url.pathname}?${url.searchParams.toString()}`);
    const table = url.pathname.split("/").pop() ?? "";
    if (!(table in tables)) {
      return new Response(
        JSON.stringify({
          code: "42P01",
          message: `relation "${table}" does not exist`
        }),
        { status: 404, headers: { "content-type": "application/json" } }
      );
    }
    const filters = [...url.searchParams.entries()].filter(([, v]) =>
      v.startsWith("eq.")
    );
    const limit = Number(url.searchParams.get("limit") ?? Infinity);
    const rows = tables[table]
      .filter((row) =>
        filters.every(([column, value]) => row[column] === value.slice(3))
      )
      .slice(0, limit)
      .map((row) => ({ id: row.id }));
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  return createClient<Database>("http://postgrest.test", "anon", {
    global: { fetch },
    auth: { persistSession: false, autoRefreshToken: false }
  }) as SupabaseClient<Database>;
}

const jobs: Row[] = [
  { id: "job_1", companyId: "c1", jobId: "J000001" },
  { id: "job_2", companyId: "c1", jobId: "J000002" },
  // Same readable number in another company: never visible to c1.
  { id: "job_9", companyId: "c2", jobId: "J000002" }
];

const items: Row[] = [
  {
    id: "item_a0",
    companyId: "c1",
    readableId: "P-100",
    readableIdWithRevision: "P-100"
  },
  {
    id: "item_aB",
    companyId: "c1",
    readableId: "P-100",
    readableIdWithRevision: "P-100.B"
  },
  {
    id: "item_c1",
    companyId: "c1",
    readableId: "P-200",
    readableIdWithRevision: "P-200.A"
  },
  {
    id: "item_c2",
    companyId: "c1",
    readableId: "P-200",
    readableIdWithRevision: "P-200.B"
  },
  {
    id: "item_d0",
    companyId: "c1",
    readableId: "P-300",
    readableIdWithRevision: "P-300"
  }
];

describe("resolveIdentifier", () => {
  it("returns a record id as is, in one lookup", async () => {
    const requests: string[] = [];
    const client = postgrest({ job: jobs }, requests);
    expect(await resolveIdentifier(client, "c1", "job", "job_1")).toEqual({
      id: "job_1"
    });
    expect(requests).toHaveLength(1);
  });

  it("resolves a readable number within the caller's company", async () => {
    const client = postgrest({ job: jobs });
    expect(await resolveIdentifier(client, "c1", "job", "J000002")).toEqual({
      id: "job_2"
    });
    expect(await resolveIdentifier(client, "c2", "job", "J000002")).toEqual({
      id: "job_9"
    });
  });

  it("never resolves another company's record id", async () => {
    const client = postgrest({ job: jobs });
    const result = await resolveIdentifier(client, "c1", "job", "job_9");
    expect(result.error?.kind).toBe("notFound");
  });

  it("resolves an item by readable id with revision", async () => {
    const client = postgrest({ item: items });
    expect(await resolveIdentifier(client, "c1", "item", "P-100.B")).toEqual({
      id: "item_aB"
    });
    expect(await resolveIdentifier(client, "c1", "item", "P-200.A")).toEqual({
      id: "item_c1"
    });
  });

  it("resolves the bare readable id of an item with one revision", async () => {
    const client = postgrest({ item: items });
    expect(await resolveIdentifier(client, "c1", "item", "P-300")).toEqual({
      id: "item_d0"
    });
  });

  it("refuses a bare readable id that is also the first revision's", async () => {
    // "P-100" is item_a0's readableIdWithRevision and item_aB's readableId.
    const client = postgrest({ item: items });
    const result = await resolveIdentifier(client, "c1", "item", "P-100");
    expect(result.error).toEqual({
      kind: "ambiguous",
      message:
        "P-100 matches more than one item record by readableIdWithRevision or readableId; pass the record id (the `id` field) of the one you mean."
    });
  });

  it("refuses a readable id shared by several revisions", async () => {
    const client = postgrest({ item: items });
    const result = await resolveIdentifier(client, "c1", "item", "P-200");
    expect(result.error?.kind).toBe("ambiguous");
  });

  it("reports an unknown value as not found, naming what it tried", async () => {
    const client = postgrest({ job: jobs });
    const result = await resolveIdentifier(client, "c1", "job", "J404");
    expect(result.error).toEqual({
      kind: "notFound",
      message: "No job matches J404 (looked up by id or jobId)."
    });
  });

  it("an id-only key never tries a readable column", async () => {
    const requests: string[] = [];
    const client = postgrest(
      {
        supplierPart: [
          { id: "sp_1", companyId: "c1", supplierPartId: "VENDOR-1" }
        ]
      },
      requests
    );
    const result = await resolveIdentifier(
      client,
      "c1",
      "supplierPart",
      "VENDOR-1"
    );
    expect(result.error?.kind).toBe("notFound");
    expect(requests).toHaveLength(1);
  });

  it("passes a database failure through", async () => {
    const client = postgrest({});
    const result = await resolveIdentifier(client, "c1", "job", "J000001");
    expect(result.error?.kind).toBe("database");
  });
});

describe("resolveIdentifierArgs", () => {
  const context = (tables: Record<string, Row[]>) => ({
    client: postgrest(tables),
    companyId: "c1"
  });

  it("replaces only the keyed params", async () => {
    const out = await resolveIdentifierArgs(
      { name: "production_getJobOperations", keys: { jobId: "job" } },
      context({ job: jobs }),
      { jobId: "J000001", locationId: "J000002" }
    );
    expect(out).toEqual({ jobId: "job_1", locationId: "J000002" });
  });

  it("leaves absent, null and empty keys to the service", async () => {
    const args = { jobId: "", other: 1 };
    const out = await resolveIdentifierArgs(
      { name: "production_getJobOperations", keys: { jobId: "job" } },
      context({ job: jobs }),
      args
    );
    expect(out).toBe(args);
  });

  it("throws NOT_FOUND naming the tool when a key matches nothing", async () => {
    const call = resolveIdentifierArgs(
      { name: "production_deleteJob", keys: { jobId: "job" } },
      context({ job: jobs }),
      { jobId: "J404" }
    );
    await expect(call).rejects.toBeInstanceOf(ORPCError);
    await expect(call).rejects.toMatchObject({
      code: "NOT_FOUND",
      message:
        "production_deleteJob: No job matches J404 (looked up by id or jobId)."
    });
  });

  it("throws BAD_REQUEST for an ambiguous readable id", async () => {
    await expect(
      resolveIdentifierArgs(
        { name: "items_getSupplierParts", keys: { itemId: "item" } },
        context({ item: items }),
        { itemId: "P-200" }
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("carries a database failure as data.supabase", async () => {
    await expect(
      resolveIdentifierArgs(
        { name: "production_deleteJob", keys: { jobId: "job" } },
        context({}),
        { jobId: "J000001" }
      )
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { supabase: { code: "42P01" } }
    });
  });
});
