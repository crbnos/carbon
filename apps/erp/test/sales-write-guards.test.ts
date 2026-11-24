// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { EntitlementError } from "@carbon/ee/entitlements.server";
import { CarbonEdition } from "@carbon/env";
import { Edition } from "@carbon/utils";
import { describe, expect, it } from "vitest";
import {
  assignSalesRule,
  createContractLine,
  createSalesRule,
  deleteSalesRule,
  unassignSalesRule,
  updateContractLine,
  updateSalesOrderField,
  updateSalesReturnOrderField,
  updateSalesRule
} from "../app/modules/sales/sales.server";
import { salesRulesEntitlementRefusal } from "../app/modules/sales/sales.service";
import { filteringSupabase } from "./filtering-supabase-fake";

const unreachable = () => {
  throw new Error("must not be reached");
};

const sales = {
  sales: {
    view: ["company-1"],
    create: ["company-1"],
    update: ["company-1"],
    delete: ["company-1"]
  }
};

// The ownership checks read with the service role, the writes as the caller.
function contextFor(client: unknown) {
  return createServiceContext({
    actor: { type: "user", userId: "user-1", permissions: sales },
    company: { id: "company-1", groupId: "group-1" },
    caller: client as never,
    system: (() => client) as never,
    pg: unreachable,
    kv: unreachable
  });
}

describe("clearing a document's customer", () => {
  it("is refused on sales orders and return orders, whose customer is required", async () => {
    const { client, writes } = filteringSupabase({
      salesOrder: [{ id: "so-1", companyId: "company-1", status: "Draft" }],
      salesReturnOrder: [{ id: "ro-1", companyId: "company-1", status: "Draft" }]
    });
    const ctx = contextFor(client);

    const order = await updateSalesOrderField(ctx, {
      ids: ["so-1"],
      field: "customerId",
      value: null
    });
    const returnOrder = await updateSalesReturnOrderField(ctx, {
      ids: ["ro-1"],
      field: "customerId",
      value: ""
    });

    expect(order.error).toMatchObject({ category: "validation" });
    expect(returnOrder.error).toMatchObject({ category: "validation" });
    expect(writes).toEqual([]);
  });
});

describe("a sales rule write", () => {
  // Each id exists in company-2 too, so a check that drops the companyId
  // filter passes another company's rule or item.
  const tables = () => ({
    enforcementRule: [
      { id: "rule-1", companyId: "company-2", family: "sales" },
      { id: "rule-2", companyId: "company-1", family: "sales" },
      { id: "rule-3", companyId: "company-1", family: "storage" }
    ],
    item: [
      { id: "item-1", companyId: "company-2" },
      { id: "item-2", companyId: "company-1" }
    ],
    enforcementRuleItemAssignment: [
      { ruleId: "rule-2", itemId: "item-1", companyId: "company-2" }
    ]
  });
  const rule: Parameters<typeof createSalesRule>[1] = {
    name: "US ship-to only",
    message: "Ships to the US only",
    severity: "error",
    surfaces: ["quoteLine"],
    conditionAst: {
      kind: "all",
      conditions: [
        { field: "customer.location.countryCode", op: "in", value: ["US"] }
      ]
    }
  };

  it.each([
    ["another company's", "rule-1"],
    ["a storage", "rule-3"]
  ])("refuses %s rule, and writes nothing", async (_, ruleId) => {
    const { client, writes } = filteringSupabase(tables());
    const ctx = contextFor(client);
    const results = [
      await updateSalesRule(ctx, { ...rule, id: ruleId }),
      await deleteSalesRule(ctx, { id: ruleId }),
      await assignSalesRule(ctx, { ruleId, itemId: "item-2" }),
      await unassignSalesRule(ctx, { ruleId, itemId: "item-2" })
    ];
    for (const result of results) {
      expect(result.error).toMatchObject({ category: "notFound" });
    }
    expect(writes).toEqual([]);
  });

  it("refuses to pin a rule to another company's item", async () => {
    const { client, writes } = filteringSupabase(tables());
    const result = await assignSalesRule(contextFor(client), {
      ruleId: "rule-2",
      itemId: "item-1"
    });
    expect(result.error).toMatchObject({ category: "notFound" });
    expect(writes).toEqual([]);
  });

  it("refuses to unpin an item the rule is not pinned to in this company", async () => {
    const { client, writes } = filteringSupabase(tables());
    const result = await unassignSalesRule(contextFor(client), {
      ruleId: "rule-2",
      itemId: "item-1"
    });
    expect(result.error).toMatchObject({ category: "notFound" });
    expect(writes).toEqual([]);
  });

  // The community edition has no sales rules, so every write reaches the
  // ee lock and is refused there.
  it.runIf(CarbonEdition === Edition.Community)(
    "is refused with entitlement where the plan has no sales rules, and writes nothing",
    async () => {
      const { client, writes } = filteringSupabase({
        ...tables(),
        enforcementRuleItemAssignment: [
          { ruleId: "rule-2", itemId: "item-2", companyId: "company-1" }
        ]
      });
      const ctx = contextFor(client);
      const results = [
        await createSalesRule(ctx, rule),
        await updateSalesRule(ctx, { ...rule, id: "rule-2" }),
        await deleteSalesRule(ctx, { id: "rule-2" }),
        await assignSalesRule(ctx, { ruleId: "rule-2", itemId: "item-2" }),
        await unassignSalesRule(ctx, { ruleId: "rule-2", itemId: "item-2" })
      ];
      for (const result of results) {
        expect(result.error).toMatchObject({ category: "entitlement" });
      }
      expect(writes).toEqual([]);
    }
  );

  it("turns only the entitlement throw into a refusal", () => {
    const ctx = contextFor({});
    expect(
      salesRulesEntitlementRefusal(ctx, new EntitlementError("SALES_RULES"))
    ).toMatchObject({ category: "entitlement" });
    const failure = new Error("connection reset");
    expect(() => salesRulesEntitlementRefusal(ctx, failure)).toThrow(failure);
  });
});

describe("a contract line's billing method", () => {
  const line = {
    customerContractId: "contract-1",
    revenueType: "One-time",
    itemId: "item-1",
    quantity: 1,
    rate: 100,
    discountPercent: 0,
    taxPercent: 0,
    startDate: "2026-11-01",
    revenueMethod: "Daily"
  } as const;

  it("is Fixed on a new line that names none, as the line form defaults it", () => {
    const parsed = createContractLine.input.parse(line);
    expect(parsed.billingMethod).toBe("Fixed");
  });

  it("is left out of an update that names none, so the stored one is kept", () => {
    const parsed = updateContractLine.input.parse({
      id: "line-1",
      customerContractId: "contract-1",
      description: "Support"
    });
    expect(parsed).toEqual({
      id: "line-1",
      customerContractId: "contract-1",
      description: "Support"
    });
  });
});
