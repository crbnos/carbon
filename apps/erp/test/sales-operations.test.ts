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

const { evaluate, invoke, recorded } = vi.hoisted(() => ({
  // The sales-rule evaluator: what the rules find on the document.
  evaluate: vi.fn(),
  // The server functions (`convert`, `post-customer-contract`).
  invoke: vi.fn(),
  // The acknowledgment rows a gate writes.
  recorded: [] as { outcome: string; violations: unknown[] }[]
}));

vi.mock("@carbon/ee/rules.server", async () => {
  const violations = await import("../../../packages/ee/src/rules/violations");
  return {
    ...violations,
    evaluateSalesRulesForSalesDocument: evaluate,
    evaluateSalesRuleLines: vi.fn(),
    resolveSalesOrderShipTo: vi.fn()
  };
});
// Workflow moments go to the event bus.
vi.mock("@carbon/lib/workflows", () => ({ raiseMoment: vi.fn() }));
vi.mock("@carbon/server-functions", () => ({
  serverFns: { as: () => ({ invoke }), system: () => ({ invoke }) }
}));
vi.mock("../app/modules/shared/shared.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  refuseUnlessOwned: vi.fn(async () => null),
  sendSalesOrderEmail: vi.fn()
}));
vi.mock("../app/modules/shared/shared.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getCompanyTimeZone: vi.fn(async () => "UTC"),
  getLocationTimeZone: vi.fn(async () => "UTC")
}));

import { createServiceContext } from "@carbon/api/service-fn.server";

const { cancelContract, convertQuote, convertSalesRfq, setQuoteStatus } = await import(
  "../app/modules/sales/sales.server"
);

type Permissions = Record<
  string,
  { view: string[]; create: string[]; update: string[]; delete: string[] }
>;
const grant = (...modules: string[]): Permissions =>
  Object.fromEntries(
    modules.map((module) => [
      module,
      {
        view: ["company-1"],
        create: ["company-1"],
        update: ["company-1"],
        delete: ["company-1"]
      }
    ])
  );

// Every write the service role makes resolves; the acknowledgment rows are kept.
function serviceRole() {
  const from = (table: string) => {
    const chain: Record<string, any> = {};
    for (const method of ["select", "eq", "in", "limit", "order", "not", "update"]) {
      chain[method] = () => chain;
    }
    chain.insert = (rows: { outcome: string }[]) => {
      if (table === "enforcementRuleAcknowledgment") {
        recorded.push({ outcome: rows[0]!.outcome, violations: rows });
      }
      return chain;
    };
    chain.single = chain.maybeSingle = () => chain;
    chain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve);
    return chain;
  };
  return { from } as any;
}

const contextFor = (permissions: Permissions) =>
  createServiceContext({
    actor: { type: "user", userId: "user-1", permissions },
    company: { id: "company-1", groupId: "group-1" },
    caller: serviceRole(),
    system: serviceRole,
    pg: () => ({}) as any,
    kv: () => ({}) as any
  });

const error = (lineId?: string) => ({
  ruleId: "rule-error",
  severity: "error" as const,
  message: "Not to this country",
  lineId
});
const warning = { ruleId: "rule-warn", severity: "warn" as const, message: "Check" };

beforeEach(() => {
  vi.clearAllMocks();
  recorded.length = 0;
  invoke.mockResolvedValue({ data: { convertedId: "converted-1" }, error: null });
});

describe("the document sales-rule gate", () => {
  const convert = (acknowledged: boolean) =>
    convertSalesRfq(contextFor(grant("sales")), { id: "rfq-1", acknowledged });

  it("refuses an error even when acknowledged, and converts nothing", async () => {
    evaluate.mockResolvedValue({ violations: [error()], ruleNames: {} });
    const result = await convert(true);
    expect(result.data).toMatchObject({ violations: [error()] });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("holds a warning until it is acknowledged", async () => {
    evaluate.mockResolvedValue({ violations: [warning], ruleNames: {} });
    expect((await convert(false)).data).toMatchObject({ violations: [warning] });
    expect((await convert(true)).data).toEqual({ quoteId: "converted-1" });
  });

  it("fails closed when the rules cannot be evaluated", async () => {
    evaluate.mockRejectedValue(new Error("rules unreachable"));
    const result = await convert(true);
    expect(result.data).toMatchObject({
      violations: [{ ruleId: "__evaluation-error__", message: "rules unreachable" }]
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("setting a document status", () => {
  const set = (status: "Sent" | "Lost") =>
    setQuoteStatus(contextFor(grant("sales")), { quoteId: "quote-1", status });
});

describe("cancelling a contract", () => {
  const cancel = (permissions: Permissions, creditUnusedTime: boolean) =>
    cancelContract(contextFor(permissions), {
      customerContractId: "contract-1",
      endDate: "2026-12-31",
      reason: "Customer left",
      creditUnusedTime
    });

  it("needs the invoicing permission only to credit the unused time", async () => {
    invoke.mockResolvedValue({ data: { memoReadableId: "CM-1" }, error: null });

    expect((await cancel(grant("sales"), true)).error?.category).toBe(
      "forbidden"
    );
    expect(invoke).not.toHaveBeenCalled();

    expect((await cancel(grant("sales"), false)).error).toBeNull();
    expect((await cancel(grant("sales", "invoicing"), true)).data).toEqual({
      id: "contract-1",
      memoReadableId: "CM-1"
    });
  });
});
