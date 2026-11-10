// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// The module's imports reach the glossary, whose `msg` macro only runs compiled.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));

import {
  orderPlannedPurchases,
  reopenPurchaseOrder,
  submitDigitalSupplierQuote
} from "../app/modules/purchasing/purchasing.server";
import { createServiceContext } from "@carbon/api/service-fn.server";

type Claims = Record<
  string,
  { view: string[]; create: string[]; update: string[]; delete: string[] }
>;

/** The caller's client answering one read of the order; nothing else is
 *  reachable, so a test that gets past the read and writes fails loudly. */
function callerReading(order: { status: string; orderDate: string | null }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: order, error: null })
  };
  return { from: () => chain } as any;
}

const unreachable = () => {
  throw new Error("must not be reached");
};

// A client with no methods: any read through it fails the test.
const noClient = () => ({}) as any;

function contextFor(client: any, permissions: Claims) {
  return createServiceContext({
    actor: { type: "user", userId: "user-1", permissions },
    company: { id: "company-1", groupId: "group-1" },
    caller: client,
    system: noClient,
    pg: unreachable,
    kv: unreachable
  });
}

const purchasing = (actions: Partial<Claims[string]>) => ({
  purchasing: {
    view: [],
    create: [],
    update: [],
    delete: [],
    ...actions
  }
});

describe("reopenPurchaseOrder", () => {
  it("refuses to reopen a released order without delete permission, before any write", async () => {
    const result = await reopenPurchaseOrder(
      contextFor(
        callerReading({ status: "To Receive", orderDate: "2026-06-01" }),
        purchasing({ update: ["company-1"] })
      ),
      { purchaseOrderId: "po-1", status: "Draft" }
    );
    expect(result.error).toMatchObject({ category: "forbidden" });
  });

  it("refuses a revision of an order that was never released", async () => {
    const result = await reopenPurchaseOrder(
      contextFor(
        callerReading({ status: "Needs Approval", orderDate: null }),
        purchasing({ update: ["company-1"], delete: ["company-1"] })
      ),
      { purchaseOrderId: "po-1", status: "Draft", createRevision: true }
    );
    expect(result.error).toMatchObject({
      category: "rule",
      message: "Only a released purchase order can be revised"
    });
  });
});

describe("orderPlannedPurchases", () => {
  // An existing line is changed through updateLine or Apply, which carry the
  // status and promised-date guards: ordering it again would duplicate it.
  it("refuses an order that names an existing line, before reading anything", async () => {
    const result = await orderPlannedPurchases(
      contextFor(noClient(), purchasing({ create: ["company-1"] })),
      {
        locationId: "loc-1",
        items: [
          {
            id: "item-1",
            orders: [
              {
                startDate: null,
                dueDate: "2026-11-02",
                periodId: "period-1",
                quantity: 5,
                supplierId: "supplier-1",
                existingLineId: "pol-1"
              }
            ]
          }
        ]
      }
    );
    expect(result.error).toMatchObject({
      category: "validation",
      message: "Existing orders are changed from the Open Orders list"
    });
  });
});

describe("submitDigitalSupplierQuote", () => {
  it("refuses a line that is not on the quote, before any price is written", async () => {
    // The service role: the quote reads back, its lines are only "line-1".
    const system = {
      from: (table: string) => {
        if (table === "supplierQuoteLinePrice") return unreachable();
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: async () => ({ data: [{ id: "line-1" }], error: null }),
          maybeSingle: async () => ({
            data: { id: "sq-1", createdBy: "user-1", externalNotes: null },
            error: null
          })
        };
        return chain;
      }
    } as any;
    const ctx = createServiceContext({
      actor: { type: "system", onBehalfOf: "user-1" },
      company: { id: "company-1", groupId: "group-1" },
      caller: system,
      system: () => system,
      pg: unreachable,
      kv: unreachable
    });
    const price = {
      quantity: 1,
      leadTime: 5,
      shippingCost: 0,
      supplierShippingCost: 0,
      supplierUnitPrice: 10,
      supplierTaxAmount: 0,
      unitPrice: 10
    };

    const result = await submitDigitalSupplierQuote(ctx, {
      supplierQuoteId: "sq-1",
      submittedBy: "Pat",
      submittedByEmail: "pat@example.com",
      selectedLines: {
        "line-1": { "1": price },
        "another-quote-line": { "1": price }
      }
    });

    expect(result.error).toMatchObject({ category: "validation" });
  });
});
