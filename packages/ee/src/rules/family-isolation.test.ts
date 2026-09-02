// Cross-family isolation for the merged "enforcementRule" table.
//
// Storage and sales rules used to live in separate tables with separate pin
// tables, so leakage between the families was structurally impossible. After
// the merge they share `enforcementRule` AND `enforcementRuleItemAssignment`,
// so isolation is now a property of the queries: every read filters on
// `family`, and pin rows are resolved against a family-filtered rule set rather
// than an embed (an embed would happily return the other family's rule).
//
// These tests drive the real service functions against a fake PostgREST client
// that records the filters applied, so a future edit that drops an `.eq("family",
// …)` — or reintroduces an embed on the shared pin table — fails here.

import { describe, expect, it } from "vitest";
import { getActiveSalesRulesForItems } from "./sales/service";
import { getActiveRulesForTargets } from "./storage/service";

type Filter = { col: string; val: unknown };

/**
 * Minimal PostgREST double. Each `.from()` returns a thenable builder that
 * records its filters and resolves to whatever rows the fixture supplies for
 * that table.
 */
function makeClient(rows: Record<string, unknown[]>) {
  const calls: { table: string; filters: Filter[]; select: string }[] = [];

  const client = {
    from(table: string) {
      const filters: Filter[] = [];
      let select = "";
      const builder: Record<string, unknown> = {
        select(cols: string) {
          select = cols;
          calls.push({ table, filters, select });
          return builder;
        },
        eq(col: string, val: unknown) {
          filters.push({ col, val });
          return builder;
        },
        in(col: string, val: unknown) {
          filters.push({ col, val });
          return builder;
        },
        order() {
          return builder;
        },
        then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
          return Promise.resolve({
            data: rows[table] ?? [],
            error: null
          }).then(resolve);
        }
      };
      return builder;
    }
  };

  return { client, calls };
}

const SALES_RULE = {
  id: "rule_sales",
  name: "No export to X",
  severity: "error",
  message: "blocked",
  conditionAst: { kind: "all", conditions: [] },
  surfaces: ["quoteLine"],
  updatedAt: null,
  active: true,
  filteredItemTypes: [],
  filteredItemGroupIds: [],
  filteredItemMatchAll: false
};

describe("enforcementRule family isolation", () => {
  it("scopes the sales rule fetch to the sales family", async () => {
    const { client, calls } = makeClient({ enforcementRule: [SALES_RULE] });

    await getActiveSalesRulesForItems(
      // biome-ignore lint/suspicious/noExplicitAny: test double
      client as any,
      "company_1",
      ["item_1"]
    );

    const ruleCall = calls.find((c) => c.table === "enforcementRule");
    expect(ruleCall).toBeDefined();
    expect(ruleCall?.filters).toContainEqual({ col: "family", val: "sales" });
    expect(ruleCall?.filters).toContainEqual({
      col: "companyId",
      val: "company_1"
    });
  });

  it("ignores a pin that points at another family's rule", async () => {
    // The shared pin table returns a row for a STORAGE rule id. The sales rule
    // fetch never returns that id, so it must not become a sales assignment.
    const { client } = makeClient({
      enforcementRule: [SALES_RULE],
      enforcementRuleItemAssignment: [
        { itemId: "item_1", ruleId: "rule_sales" },
        { itemId: "item_1", ruleId: "rule_storage_pinned_to_same_item" }
      ]
    });

    const { rules, assignmentsByItemId, error } =
      await getActiveSalesRulesForItems(
        // biome-ignore lint/suspicious/noExplicitAny: test double
        client as any,
        "company_1",
        ["item_1"]
      );

    expect(error).toBeNull();
    expect(rules.map((r) => r.id)).toEqual(["rule_sales"]);

    const pinned = assignmentsByItemId.get("item_1");
    expect(pinned).toBeDefined();
    expect([...(pinned ?? [])]).toEqual(["rule_sales"]);
    expect(pinned?.has("rule_storage_pinned_to_same_item")).toBe(false);
  });

  it("reads pins from the shared assignment table", async () => {
    const { client, calls } = makeClient({ enforcementRule: [SALES_RULE] });

    await getActiveSalesRulesForItems(
      // biome-ignore lint/suspicious/noExplicitAny: test double
      client as any,
      "company_1",
      ["item_1"]
    );

    const pinCall = calls.find(
      (c) => c.table === "enforcementRuleItemAssignment"
    );
    expect(pinCall).toBeDefined();
    // No embed on the shared table — it would cross the family boundary.
    expect(pinCall?.select).not.toContain("(");
  });

  // The reverse direction: the storage fetches must be pinned to the storage
  // family the same way. Without these, dropping an `.eq("family", "storage")`
  // in storage/service.ts would only ever be caught in production.

  const STORAGE_RULE = {
    id: "rule_storage",
    targetType: "item",
    severity: "error",
    message: "blocked",
    conditionAst: { kind: "all", conditions: [] },
    surfaces: ["receipt"],
    updatedAt: null,
    active: true,
    filteredItemTypes: [],
    filteredItemGroupIds: [],
    filteredItemMatchAll: false
  };

  it("scopes every storage rule fetch to the storage family", async () => {
    const { client, calls } = makeClient({
      enforcementRule: [STORAGE_RULE],
      enforcementRuleItemAssignment: [
        { itemId: "item_1", ruleId: "rule_storage" }
      ]
    });

    await getActiveRulesForTargets(
      // biome-ignore lint/suspicious/noExplicitAny: test double
      client as any,
      { targetType: "item", targetIds: ["item_1"], companyId: "company_1" }
    );

    const ruleCalls = calls.filter((c) => c.table === "enforcementRule");
    // Broadcast fetch + explicit-pin resolution — both must carry the family.
    expect(ruleCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of ruleCalls) {
      expect(call.filters).toContainEqual({ col: "family", val: "storage" });
      expect(call.filters).toContainEqual({
        col: "companyId",
        val: "company_1"
      });
    }
  });

  it("ignores a pin that points at a sales rule", async () => {
    // The shared pin table returns a row for a SALES rule id. The
    // family-filtered rule fetch never returns that id, so it must not become
    // a storage assignment.
    const { client } = makeClient({
      enforcementRule: [STORAGE_RULE],
      enforcementRuleItemAssignment: [
        { itemId: "item_1", ruleId: "rule_storage" },
        { itemId: "item_1", ruleId: "rule_sales_pinned_to_same_item" }
      ]
    });

    const { data, error } = await getActiveRulesForTargets(
      // biome-ignore lint/suspicious/noExplicitAny: test double
      client as any,
      { targetType: "item", targetIds: ["item_1"], companyId: "company_1" }
    );

    expect(error).toBeNull();
    const assigned = data.get("item_1") ?? [];
    expect(assigned.map((r) => r.id)).toEqual(["rule_storage"]);
  });
});
