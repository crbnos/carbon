// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// The service's imports reach the glossary, whose `msg` macro only runs compiled.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));

import { getJobReleaseReadiness } from "../app/modules/production/production.service";

// PostgREST returns at most this many rows per request (`max_rows`).
const ROW_CAP = 1000;

// A supabase-client stand-in that applies `in` filters and enforces the row
// cap: an unpaged read is cut off at ROW_CAP, a `.range()` read returns its
// page. `inFilterSizes` records how many ids each `in` filter carried.
function cappedClient(tables: Record<string, Record<string, unknown>[]>) {
  const inFilterSizes: number[] = [];
  const client = {
    from: (table: string) => {
      let rows = tables[table] ?? [];
      const chain: Record<string, any> = {};
      for (const method of ["select", "eq", "is", "order"]) {
        chain[method] = () => chain;
      }
      chain.in = (column: string, values: string[]) => {
        inFilterSizes.push(values.length);
        rows = rows.filter((row) => values.includes(row[column] as string));
        return chain;
      };
      chain.range = async (from: number, to: number) => ({
        data: rows.slice(from, Math.min(to + 1, from + ROW_CAP)),
        error: null
      });
      chain.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: rows.slice(0, ROW_CAP), error: null }).then(
          resolve
        );
      return chain;
    }
  } as any;
  return { client, inFilterSizes };
}

describe("getJobReleaseReadiness", () => {
  it("reads materials and operations past the row cap", async () => {
    const { client } = cappedClient({
      job: [{ id: "job-1", jobId: "J000001", status: "Planned", item: null }],
      jobMakeMethod: [{ id: "root", jobId: "job-1" }],
      jobMaterialWithMakeMethodId: [
        ...Array.from({ length: ROW_CAP }, () => ({
          jobId: "job-1",
          jobMaterialMakeMethodId: null,
          methodType: "Pull from Inventory",
          kit: false,
          description: "Fastener",
          itemReadableId: "F-100"
        })),
        // Past the cap: a sub-assembly nothing on the floor builds.
        {
          jobId: "job-1",
          jobMaterialMakeMethodId: "sub-late",
          methodType: "Make to Order",
          kit: false,
          description: "Late Bracket",
          itemReadableId: "B-200"
        }
      ],
      jobOperation: [
        ...Array.from({ length: ROW_CAP }, (_, index) => ({
          id: `op-${index}`,
          jobId: "job-1",
          jobMakeMethodId: "root",
          operationType: "Process",
          operationSupplierProcessId: null,
          processId: "machining",
          description: "Machine"
        })),
        // Past the cap: an outside operation release must put on a PO.
        {
          id: "op-plating",
          jobId: "job-1",
          jobMakeMethodId: "root",
          operationType: "Outside Processing",
          operationSupplierProcessId: null,
          processId: "plating",
          description: "Plating"
        }
      ],
      supplierProcess: [
        { id: "sp-1", supplierId: "supplier-a", processId: "plating" }
      ],
      purchaseOrder: [
        { id: "po-1", purchaseOrderId: "PO000001", supplierId: "supplier-a" }
      ]
    });

    const { data, error } = await getJobReleaseReadiness(
      client,
      ["job-1"],
      "company-1"
    );

    expect(error).toBeNull();
    expect(data?.jobs).toEqual([
      {
        id: "job-1",
        jobId: "J000001",
        status: "Planned",
        manufacturingBlocked: false,
        missingAssemblies: [
          { makeMethodId: "sub-late", description: "Late Bracket" }
        ],
        outsideOperationsWithoutSupplier: [],
        supplierIds: ["supplier-a"]
      }
    ]);
    expect(data?.suppliers).toEqual([
      {
        supplierId: "supplier-a",
        draftPurchaseOrders: [{ id: "po-1", purchaseOrderId: "PO000001" }]
      }
    ]);
  });

  it("reads a whole page of jobs without one long id list", async () => {
    const jobIds = Array.from({ length: 250 }, (_, index) => `job-${index}`);
    const { client, inFilterSizes } = cappedClient({
      job: jobIds.map((id) => ({
        id,
        jobId: id.toUpperCase(),
        status: "Planned",
        item: null
      })),
      jobMakeMethod: jobIds.map((id) => ({ id: `root-${id}`, jobId: id })),
      jobOperation: jobIds.map((id) => ({
        id: `op-${id}`,
        jobId: id,
        jobMakeMethodId: `root-${id}`,
        operationType: "Outside Processing",
        operationSupplierProcessId: null,
        processId: "plating",
        description: "Plating"
      })),
      supplierProcess: [
        { id: "sp-1", supplierId: "supplier-a", processId: "plating" }
      ]
    });

    const { data, error } = await getJobReleaseReadiness(
      client,
      jobIds,
      "company-1"
    );

    expect(error).toBeNull();
    // Every job came back once, with the operation that sits in its own group.
    expect(data?.jobs.map((job) => job.id).sort()).toEqual([...jobIds].sort());
    expect(
      data?.jobs.every(
        (job) =>
          job.missingAssemblies.length === 0 &&
          job.supplierIds.join() === "supplier-a"
      )
    ).toBe(true);
    // 250 job ids and 250 outside-operation ids, never more than 100 in a URL.
    expect(Math.max(...inFilterSizes)).toBe(100);
  });
});
