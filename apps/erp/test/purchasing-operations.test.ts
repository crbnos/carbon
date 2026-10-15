// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// The module's imports reach the glossary, whose `msg` macro only runs compiled.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));

import { reopenPurchaseOrder } from "../app/modules/purchasing/purchasing.server";
import { createServiceContext } from "../app/modules/service-fn.server";

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

function contextFor(client: any, permissions: Claims) {
  return createServiceContext({
    actor: { type: "user", userId: "user-1", permissions },
    company: { id: "company-1", groupId: "group-1" },
    caller: client,
    system: unreachable,
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
