// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

// The service's imports reach the glossary, whose `msg` macro only runs compiled.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() })
}));

const { evaluate, invoke } = vi.hoisted(() => ({
  // The sales-rule evaluator: what the rules find on the invoice.
  evaluate: vi.fn(),
  // The posting server functions.
  invoke: vi.fn()
}));

vi.mock("@carbon/ee/rules.server", async () => {
  const violations = await import("../../../packages/ee/src/rules/violations");
  return {
    ...violations,
    evaluateSalesRulesForSalesDocument: evaluate,
    evaluateSalesRuleLines: vi.fn(),
    resolveSalesInvoiceShipTo: vi.fn(),
    resolveSalesOrderShipTo: vi.fn()
  };
});
vi.mock("@carbon/server-functions", () => ({
  serverFns: { system: () => ({ invoke }) }
}));
vi.mock("@carbon/lib/workflows", () => ({ raiseMoment: vi.fn() }));
vi.mock("../app/modules/shared/shared.service", async (actual) => ({
  ...(await actual<object>()),
  // The records the tests name are the company's.
  refuseUnlessOwned: vi.fn(async () => null),
  sendSalesOrderEmail: vi.fn()
}));
vi.mock("@carbon/lib/party-contact.server", () => ({
  checkPartyContactRequirement: vi.fn(async () => null)
}));

import { createServiceContext } from "@carbon/api/service-fn.server";

const { postSalesInvoice, voidCharge } = await import(
  "../app/modules/invoicing/invoicing.server"
);
const { tieOutAdjustmentLines } = await import(
  "../app/modules/invoicing/invoicing.service"
);

/** Every read finds the invoice's customer; every write succeeds. */
function client() {
  const from = () => {
    const chain: Record<string, any> = {};
    for (const method of ["select", "eq", "in", "update", "insert"]) {
      chain[method] = () => chain;
    }
    chain.single = chain.maybeSingle = () => chain;
    chain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({
        data: { id: "invoice-1", customerId: "customer-1" },
        error: null
      }).then(resolve);
    return chain;
  };
  return { from } as any;
}

const invoicing = {
  invoicing: {
    view: ["company-1"],
    create: ["company-1"],
    update: ["company-1"],
    delete: ["company-1"]
  }
};

const context = () =>
  createServiceContext({
    actor: { type: "user", userId: "user-1", permissions: invoicing },
    company: { id: "company-1", groupId: "group-1" },
    caller: client(),
    system: client,
    pg: () => ({}) as any,
    kv: () => ({}) as any
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("voiding a charge", () => {
  const voidIt = () => voidCharge(context(), { chargeId: "chg_1" });

  it("returns the server function's own refusal", async () => {
    // The refusal is the only useful thing to say: a generic string left the
    // user looking at a Posted charge with no idea why it stayed posted.
    invoke.mockResolvedValue({
      data: null,
      error: { status: 422, message: "Charge is already voided" }
    });
    const result = await voidIt();
    expect(result.error).toMatchObject({
      category: "rule",
      message: "Charge is already voided"
    });
  });

  it("falls back to a generic message when the failure has none", async () => {
    // A data-layer failure arrives with an empty message by design.
    invoke.mockResolvedValue({ data: null, error: { status: 500, message: "" } });
    expect((await voidIt()).error?.message).toBe("Failed to void charge");
  });

  it("answers the charge when the void lands", async () => {
    invoke.mockResolvedValue({ data: { success: true }, error: null });
    expect(await voidIt()).toEqual({ data: { chargeId: "chg_1" }, error: null });
  });
});

describe("posting a sales invoice", () => {
  const post = (acknowledged: boolean) =>
    postSalesInvoice(context(), {
      invoiceId: "invoice-1",
      notification: "None",
      acknowledged
    });
  const warning = {
    ruleId: "rule-warn",
    severity: "warn" as const,
    message: "Check the destination"
  };

  it("runs the sales-rule gate before the invoice is claimed or posted", async () => {
    evaluate.mockResolvedValue({ violations: [warning], ruleNames: {} });
    const result = await post(false);
    expect(result.data).toMatchObject({ violations: [warning] });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns the post's own refusal", async () => {
    evaluate.mockResolvedValue({ violations: [], ruleNames: {} });
    invoke.mockResolvedValue({
      data: null,
      error: { status: 400, message: "The invoice has no lines" }
    });
    const result = await post(false);
    expect(result.error).toMatchObject({
      category: "validation",
      message: "The invoice has no lines"
    });
  });

  it("refuses when the rules cannot be evaluated, before anything is written", async () => {
    evaluate.mockRejectedValue(new Error("rules unreachable"));
    const result = await post(true);
    expect(result.error?.message).toBe("Invoice not posted — rules unreachable");
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("a tie-out adjustment", () => {
  const lines = (side: "receivables" | "payables", variance: number) =>
    tieOutAdjustmentLines({
      side,
      variance,
      controlAccount: "control",
      offsetAccount: "rounding",
      description: "adjustment"
    }).map(({ accountId, debit, credit }) => ({ accountId, debit, credit }));

  it("raises an understated receivables balance with a debit", () => {
    expect(lines("receivables", 12.5)).toEqual([
      { accountId: "control", debit: 12.5, credit: 0 },
      { accountId: "rounding", debit: 0, credit: 12.5 }
    ]);
    expect(lines("receivables", -3)).toEqual([
      { accountId: "control", debit: 0, credit: 3 },
      { accountId: "rounding", debit: 3, credit: 0 }
    ]);
  });

  it("raises an understated payables balance with a credit", () => {
    expect(lines("payables", 12.5)).toEqual([
      { accountId: "control", debit: 0, credit: 12.5 },
      { accountId: "rounding", debit: 12.5, credit: 0 }
    ]);
    expect(lines("payables", -3)).toEqual([
      { accountId: "control", debit: 3, credit: 0 },
      { accountId: "rounding", debit: 0, credit: 3 }
    ]);
  });
});
