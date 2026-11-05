// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  planIndexWrites,
  planLookups,
  SEARCH_ENTITY_CONFIGS,
  type SearchEvent,
  toIndexRow
} from "./search-config";

const event = (
  table: string,
  operation: SearchEvent["operation"],
  recordId: string,
  record: Record<string, any> | null = { id: recordId }
): SearchEvent => ({ table, operation, recordId, new: record });

describe("planIndexWrites", () => {
  it("keeps only the last event per record", () => {
    const plan = planIndexWrites([
      event("job", "INSERT", "job_1"),
      event("job", "UPDATE", "job_1", { id: "job_1", jobId: "J-2" }),
      event("job", "INSERT", "job_2"),
      event("job", "DELETE", "job_2", null)
    ]);

    expect(plan.upserts.map((u) => u.record)).toEqual([
      { id: "job_1", jobId: "J-2" }
    ]);
    expect(plan.deletes).toEqual([{ entity_type: "job", entity_id: "job_2" }]);
    expect(plan.skipped).toBe(2);
  });

  it("removes a deactivated employee and skips tables it does not index", () => {
    const plan = planIndexWrites([
      event("employee", "UPDATE", "u_1", { id: "u_1", active: false }),
      event("jobOperation", "UPDATE", "op_1")
    ]);

    expect(plan.deletes).toEqual([
      { entity_type: "employee", entity_id: "u_1" }
    ]);
    expect(plan.upserts).toEqual([]);
    expect(plan.skipped).toBe(1);
  });
});

describe("lookups", () => {
  const { upserts } = planIndexWrites([
    event("job", "INSERT", "job_1", {
      id: "job_1",
      jobId: "J-1",
      itemId: "item_1",
      customerId: "cust_1",
      status: "Ready"
    }),
    event("job", "INSERT", "job_2", {
      id: "job_2",
      jobId: "J-2",
      itemId: "item_1",
      customerId: null
    }),
    event("customer", "INSERT", "cust_1", { id: "cust_1", name: "Acme" })
  ]);

  it("reads each related table once for the whole batch", () => {
    expect(planLookups(upserts)).toEqual([
      {
        key: "item.id.name",
        table: "item",
        column: "name",
        matchOn: "id",
        companyScoped: true,
        ids: ["item_1"]
      },
      {
        key: "customer.id.name",
        table: "customer",
        column: "name",
        matchOn: "id",
        companyScoped: true,
        ids: ["cust_1"]
      },
      {
        key: "customerTax.customerId.taxId",
        table: "customerTax",
        column: "taxId",
        matchOn: "customerId",
        companyScoped: true,
        ids: ["cust_1"]
      }
    ]);
  });

  it("limits every lookup to the company except the global user table", () => {
    const employee = planIndexWrites([
      event("employee", "INSERT", "u_1", { id: "u_1", employeeTypeId: "et_1" })
    ]).upserts;
    expect(
      planLookups(employee).map((plan) => [plan.table, plan.companyScoped])
    ).toEqual([
      ["user", false],
      ["employeeType", true]
    ]);
  });

  it("builds the index row from the record and its looked-up names", () => {
    const resolved = new Map([
      ["item.id.name", new Map<string, unknown>([["item_1", "Bracket"]])],
      ["customer.id.name", new Map<string, unknown>([["cust_1", "Acme"]])]
    ]);

    expect(toIndexRow(upserts[0]!, resolved)).toEqual({
      entity_type: "job",
      entity_id: "job_1",
      title: "J-1",
      description: "Bracket Acme",
      link: "/x/job/job_1",
      tags: ["Ready"],
      metadata: { quantity: undefined, dueDate: undefined }
    });
    expect(toIndexRow(upserts[1]!, resolved).description).toBe("Bracket ");
  });
});

describe("revised documents", () => {
  // A revision shares its original's number, so without the suffix both read
  // as the same document and searching the revised id finds nothing.
  it.each([
    ["quote", "quoteId"],
    ["salesRfq", "rfqId"],
    ["supplierQuote", "supplierQuoteId"],
    ["purchaseOrder", "purchaseOrderId"]
  ])("%s titles carry the revision", (table, column) => {
    const titles = planIndexWrites([
      event(table, "INSERT", "r0", {
        id: "r0",
        [column]: "D-1",
        revisionId: 0
      }),
      event(table, "INSERT", "r1", { id: "r1", [column]: "D-1", revisionId: 1 })
    ]).upserts.map((upsert) => toIndexRow(upsert, new Map()).title);

    expect(titles).toEqual(["D-1", "D-1-1"]);
  });
});

describe("search links", () => {
  // The search box navigates straight to the stored link, so one that names
  // no route is a 404 (sales RFQs were indexed at /x/rfq/<id>).
  const routes = new URL(
    "../../../../../../apps/erp/app/routes/x+/",
    import.meta.url
  );
  const itemTypes = ["Part", "Material", "Tool", "Consumable", "Service"];

  it.each(Object.entries(SEARCH_ENTITY_CONFIGS))(
    "%s links to an ERP route",
    (_table, config) => {
      // An item links by its type.
      const records =
        config.entityType === "item"
          ? itemTypes.map((type) => ({ id: "r1", type }))
          : [{ id: "r1" }];
      for (const record of records) {
        const [, x, segment] = config.getLink(record).split("/");
        expect(x).toBe("x");
        expect(existsSync(new URL(`${segment}+`, routes)), segment).toBe(true);
      }
    }
  );
});
