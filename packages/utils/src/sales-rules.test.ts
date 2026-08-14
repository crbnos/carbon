// Sales-rule extensions of the shared rule engine. Storage-rule behavior is
// covered by rules.test.ts — these cases lock the additive sales-rule
// surface: customer ctx resolution, compileSalesRuleWithCache + evaluateRules
// on sales-document surfaces, and the sales-rule field registry slice.
import { beforeEach, describe, expect, it } from "vitest";
import { getFieldDef } from "./field-registry";
import {
  __resetStorageRulesCache,
  buildResolver,
  compileSalesRuleWithCache,
  evaluateRules,
  getFieldsForSalesRuleSurfaces,
  type RuleContext,
  type SalesRuleRow
} from "./rules";

const salesRuleOf = (overrides: Partial<SalesRuleRow> = {}): SalesRuleRow => ({
  id: overrides.id ?? "item_rule_1",
  severity: overrides.severity ?? "error",
  message: overrides.message ?? "violated",
  conditionAst: overrides.conditionAst ?? {
    kind: "all",
    conditions: [
      { field: "item.type", op: "eq", value: "Part" },
      {
        field: "customer.location.countryCode",
        op: "in",
        value: ["IR", "KP"]
      }
    ]
  },
  surfaces: overrides.surfaces,
  updatedAt: overrides.updatedAt ?? "2026-08-11T00:00:00Z",
  active: true
});

describe("sales rules", () => {
  beforeEach(() => __resetStorageRulesCache());

  it("buildResolver resolves customer.location.countryCode from ctx", () => {
    const resolve = buildResolver("customer.location.countryCode");
    expect(resolve({ customer: { location: { countryCode: "IR" } } })).toBe(
      "IR"
    );
    expect(resolve({ customer: {} })).toBeUndefined();
    expect(resolve({})).toBeUndefined();
  });

  it("compileSalesRuleWithCache + evaluateRules fire a violation on quoteLine when conditions are unsatisfied", () => {
    const compiled = compileSalesRuleWithCache(
      salesRuleOf({ message: "{item.name} fails the embargo rule" })
    );
    // Default surfaces = every sales-rule surface.
    expect(compiled.surfaces).toEqual(["quoteLine", "salesOrderLine"]);
    expect(compiled.targetType).toBe("item");

    const failingCtx: RuleContext = {
      item: { name: "Widget", type: "Part" },
      customer: { id: "cust_1", location: { countryCode: "US" } },
      transaction: { kind: "quoteLine", quantity: 1 }
    };
    const violations = evaluateRules([compiled], failingCtx, "quoteLine");
    expect(violations).toEqual([
      {
        ruleId: "item_rule_1",
        severity: "error",
        message: "Widget fails the embargo rule"
      }
    ]);

    // Conditions satisfied → no violation.
    const passingCtx: RuleContext = {
      item: { name: "Widget", type: "Part" },
      customer: { id: "cust_1", location: { countryCode: "IR" } },
      transaction: { kind: "quoteLine", quantity: 1 }
    };
    expect(evaluateRules([compiled], passingCtx, "quoteLine")).toEqual([]);
  });

  it("produces a required-field violation when customer.location is absent", () => {
    const compiled = compileSalesRuleWithCache(salesRuleOf());
    const ctx: RuleContext = {
      item: { name: "Widget", type: "Part" },
      customer: { id: "cust_1" }, // no location → countryCode unresolvable
      transaction: { kind: "quoteLine", quantity: 1 }
    };
    const violations = evaluateRules([compiled], ctx, "quoteLine");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toBe("Customer country is required");
  });

  it("skips rules not subscribed to the evaluated surface", () => {
    const compiled = compileSalesRuleWithCache(
      salesRuleOf({ id: "item_rule_so", surfaces: ["salesOrderLine"] })
    );
    const ctx: RuleContext = {
      item: { name: "Widget", type: "Part" },
      customer: { id: "cust_1", location: { countryCode: "US" } },
      transaction: { kind: "quoteLine", quantity: 1 }
    };
    expect(evaluateRules([compiled], ctx, "quoteLine")).toEqual([]);
    expect(evaluateRules([compiled], ctx, "salesOrderLine")).toHaveLength(1);
  });

  it("getFieldsForSalesRuleSurfaces includes customer fields and excludes storage/workCenter fields", () => {
    const paths = getFieldsForSalesRuleSurfaces(["quoteLine"]).map(
      (f) => f.path
    );
    expect(paths).toContain("customer.customerTypeId");
    expect(paths).toContain("customer.customerStatusId");
    expect(paths).toContain("customer.location.countryCode");
    expect(paths).toContain("item.type");
    expect(paths).toContain("transaction.quantity");
    expect(paths.some((p) => p.startsWith("storageUnit."))).toBe(false);
    expect(paths.some((p) => p.startsWith("workCenter."))).toBe(false);
    expect(paths.some((p) => p.startsWith("operation."))).toBe(false);

    // Same set on both surfaces (identical context availability).
    expect(
      getFieldsForSalesRuleSurfaces(["quoteLine", "salesOrderLine"]).map(
        (f) => f.path
      )
    ).toEqual(paths);
  });

  it("getFieldDef resolves sales-rule registry fields and synthesizes customer custom fields", () => {
    expect(getFieldDef("customer.location.countryCode")?.label).toBe(
      "Customer country"
    );
    expect(getFieldDef("customer.customerTypeId")?.context).toBe("customer");

    const def = getFieldDef("customer.customFields.foo");
    expect(def?.label).toBe("foo");
    expect(def?.context).toBe("customer");
    expect(def?.description).toBe("Custom field on the customer record.");
  });
});
