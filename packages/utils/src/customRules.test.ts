import { beforeEach, describe, expect, it } from "vitest";
import {
  __customRulesCacheSize,
  __resetCustomRulesCache,
  type CustomRuleRow,
  compileRule,
  compileWithCache,
  evaluateRules,
  getFieldsForTargetTypeAndSurfaces,
  interpolateMessage,
  isFieldAvailableOnSurfaces,
  itemRuleAppliesToItem,
  type RuleContext,
  SURFACE_CONTEXT_AVAILABILITY,
  TRANSACTION_SURFACES
} from "./customRules";
import {
  FIELD_REGISTRY,
  getFieldDef,
  getFieldsForTargetType
} from "./field-registry";

const ruleOf = (
  conditions: Array<{ field: string; op: string; value?: unknown }>,
  overrides: Partial<CustomRuleRow> = {}
): CustomRuleRow => ({
  id: overrides.id ?? "rule_1",
  targetType: overrides.targetType ?? "item",
  severity: overrides.severity ?? "error",
  message: overrides.message ?? "violated",
  conditionAst: { kind: "all", conditions: conditions as never },
  surfaces: overrides.surfaces,
  updatedAt: overrides.updatedAt ?? "2026-05-04T00:00:00Z",
  active: true
});

describe("operators", () => {
  it.each([
    ["eq", "Part", true],
    ["eq", "Material", false],
    ["neq", "Part", false],
    ["neq", "Material", true]
  ])("%s comparing 'Part' vs %s", (op, value, expectedSatisfied) => {
    const compiled = compileRule(ruleOf([{ field: "item.type", op, value }]));
    expect(compiled.predicate({ item: { type: "Part" } })).toBe(
      expectedSatisfied
    );
  });

  it("in/notIn match arrays", () => {
    const inRule = compileRule(
      ruleOf([
        { field: "transaction.locationId", op: "in", value: ["loc_a", "loc_b"] }
      ])
    );
    expect(inRule.predicate({ transaction: { locationId: "loc_a" } })).toBe(
      true
    );
    expect(inRule.predicate({ transaction: { locationId: "loc_x" } })).toBe(
      false
    );

    const notIn = compileRule(
      ruleOf([
        {
          field: "transaction.locationId",
          op: "notIn",
          value: ["loc_a", "loc_b"]
        }
      ])
    );
    expect(notIn.predicate({ transaction: { locationId: "loc_x" } })).toBe(
      true
    );
    expect(notIn.predicate({ transaction: { locationId: "loc_a" } })).toBe(
      false
    );
  });

  it("isSet/isNotSet handles null, undefined, and empty string", () => {
    const isSet = compileRule(
      ruleOf([{ field: "item.itemPostingGroupId", op: "isSet" }])
    );
    expect(isSet.predicate({ item: { itemPostingGroupId: "grp_a" } })).toBe(
      true
    );
    expect(isSet.predicate({ item: { itemPostingGroupId: null } })).toBe(false);
    expect(isSet.predicate({ item: { itemPostingGroupId: undefined } })).toBe(
      false
    );
    expect(isSet.predicate({ item: { itemPostingGroupId: "" } })).toBe(false);

    const isNot = compileRule(
      ruleOf([{ field: "item.itemPostingGroupId", op: "isNotSet" }])
    );
    expect(isNot.predicate({ item: { itemPostingGroupId: "" } })).toBe(true);
    expect(isNot.predicate({ item: { itemPostingGroupId: "grp_a" } })).toBe(
      false
    );
  });

  it("array-left semantics: eq matches if any element equals", () => {
    const eqRule = compileRule(
      ruleOf([{ field: "storageUnit.storageTypeId", op: "eq", value: "cold" }])
    );
    expect(
      eqRule.predicate({ storageUnit: { storageTypeId: ["hot", "cold"] } })
    ).toBe(true);
    expect(
      eqRule.predicate({ storageUnit: { storageTypeId: ["hot", "ambient"] } })
    ).toBe(false);
  });

  it("array-left semantics: in matches if any element overlaps", () => {
    const inRule = compileRule(
      ruleOf([
        {
          field: "storageUnit.storageTypeId",
          op: "in",
          value: ["cold", "frozen"]
        }
      ])
    );
    expect(
      inRule.predicate({ storageUnit: { storageTypeId: ["hot", "cold"] } })
    ).toBe(true);
    expect(
      inRule.predicate({ storageUnit: { storageTypeId: ["hot", "ambient"] } })
    ).toBe(false);
  });

  it("array-left semantics: neq is true only when no element equals", () => {
    const neqRule = compileRule(
      ruleOf([{ field: "storageUnit.storageTypeId", op: "neq", value: "cold" }])
    );
    expect(
      neqRule.predicate({ storageUnit: { storageTypeId: ["hot", "ambient"] } })
    ).toBe(true);
    expect(
      neqRule.predicate({ storageUnit: { storageTypeId: ["hot", "cold"] } })
    ).toBe(false);
  });

  it("array-left semantics: notIn requires no overlap", () => {
    const notInRule = compileRule(
      ruleOf([
        {
          field: "storageUnit.storageTypeId",
          op: "notIn",
          value: ["cold", "frozen"]
        }
      ])
    );
    expect(
      notInRule.predicate({
        storageUnit: { storageTypeId: ["hot", "ambient"] }
      })
    ).toBe(true);
    expect(
      notInRule.predicate({ storageUnit: { storageTypeId: ["hot", "cold"] } })
    ).toBe(false);
  });

  it("array-left semantics: isSet/isNotSet on empty vs populated array", () => {
    const isSet = compileRule(
      ruleOf([{ field: "storageUnit.storageTypeId", op: "isSet" }])
    );
    expect(isSet.predicate({ storageUnit: { storageTypeId: ["cold"] } })).toBe(
      true
    );
    expect(isSet.predicate({ storageUnit: { storageTypeId: [] } })).toBe(false);

    const isNot = compileRule(
      ruleOf([{ field: "storageUnit.storageTypeId", op: "isNotSet" }])
    );
    expect(isNot.predicate({ storageUnit: { storageTypeId: [] } })).toBe(true);
    expect(isNot.predicate({ storageUnit: { storageTypeId: ["cold"] } })).toBe(
      false
    );
  });

  it("gt/lt only compare numbers", () => {
    const gt = compileRule(
      ruleOf([{ field: "transaction.quantity", op: "gt", value: 100 }])
    );
    expect(gt.predicate({ transaction: { quantity: 200 } })).toBe(true);
    expect(gt.predicate({ transaction: { quantity: 50 } })).toBe(false);
    expect(gt.predicate({ transaction: { quantity: "300" } })).toBe(false);

    const lt = compileRule(
      ruleOf([{ field: "transaction.quantity", op: "lt", value: 100 }])
    );
    expect(lt.predicate({ transaction: { quantity: 50 } })).toBe(true);
    expect(lt.predicate({ transaction: { quantity: 200 } })).toBe(false);
  });
});

describe("compilePredicate", () => {
  it("AND short-circuits on first false", () => {
    let secondCondCalls = 0;
    const compiled = compileRule(
      ruleOf([
        { field: "item.type", op: "eq", value: "Part" },
        { field: "transaction.kind", op: "eq", value: "receipt" }
      ])
    );
    expect(
      compiled.predicate({
        item: { type: "Material" },
        transaction: { kind: "receipt" }
      })
    ).toBe(false);
    secondCondCalls++;
    expect(secondCondCalls).toBe(1);
  });

  it("empty conditions array → predicate true (no constraints)", () => {
    const compiled = compileRule(ruleOf([]));
    expect(compiled.predicate({})).toBe(true);
  });

  it("malformed AST → predicate false (defensive)", () => {
    const compiled = compileRule({
      id: "x",
      targetType: "item",
      severity: "error",
      message: "m",
      // @ts-expect-error intentionally malformed
      conditionAst: { kind: "or", conditions: [] }
    });
    expect(compiled.predicate({})).toBe(false);
  });

  it("unknown root segment → resolver returns undefined → predicate false", () => {
    const compiled = compileRule(
      ruleOf([{ field: "garbage.path", op: "eq", value: "x" }])
    );
    expect(compiled.predicate({})).toBe(false);
  });

  it("custom field path resolves through item.customFields", () => {
    const compiled = compileRule(
      ruleOf([
        {
          field: "item.customFields.frozen",
          op: "eq",
          value: true
        }
      ])
    );
    expect(
      compiled.predicate({ item: { customFields: { frozen: true } } })
    ).toBe(true);
    expect(
      compiled.predicate({ item: { customFields: { frozen: false } } })
    ).toBe(false);
  });

  it("workCenter + operation root segments resolve", () => {
    const compiled = compileRule(
      ruleOf(
        [
          { field: "workCenter.locationId", op: "eq", value: "loc_a" },
          { field: "operation.itemId", op: "isSet" }
        ],
        { targetType: "workCenter" }
      )
    );
    expect(
      compiled.predicate({
        workCenter: { locationId: "loc_a" },
        operation: { itemId: "item_1" }
      })
    ).toBe(true);
    expect(
      compiled.predicate({
        workCenter: { locationId: "loc_a" },
        operation: { itemId: null }
      })
    ).toBe(false);
  });
});

describe("interpolateMessage", () => {
  it("substitutes registered tokens", () => {
    const ctx: RuleContext = {
      item: { name: "Vanilla Ice Cream" },
      shelf: { name: "A1" }
    };
    expect(
      interpolateMessage("{item.name} cannot live on {shelf.name}", ctx)
    ).toBe("Vanilla Ice Cream cannot live on A1");
  });

  it("renders missing ctx tokens as em-dash", () => {
    expect(interpolateMessage("{item.name} is bad", {})).toBe("— is bad");
  });

  it("does not match malformed tokens", () => {
    expect(interpolateMessage("{nope", {})).toBe("{nope");
  });
});

describe("evaluateRules", () => {
  it("returns one violation per failed rule with interpolated message", () => {
    const r1 = compileRule(
      ruleOf(
        [
          {
            field: "storageUnit.storageTypeId",
            op: "eq",
            value: "cold"
          }
        ],
        {
          id: "rule_cold",
          severity: "error",
          message: "{item.name} requires cold storage"
        }
      )
    );
    const r2 = compileRule(
      ruleOf([{ field: "transaction.quantity", op: "lt", value: 1000 }], {
        id: "rule_qty",
        severity: "warn",
        message: "Large receipt"
      })
    );

    const violations = evaluateRules(
      [r1, r2],
      {
        item: { name: "Vanilla" },
        storageUnit: { storageTypeId: "ambient" },
        transaction: { quantity: 2000 }
      },
      "receipt"
    );

    expect(violations).toHaveLength(2);
    expect(violations[0]).toEqual({
      ruleId: "rule_cold",
      severity: "error",
      message: "Vanilla requires cold storage"
    });
    expect(violations[1]?.severity).toBe("warn");
  });

  it("returns no violations when all rules satisfied", () => {
    const r = compileRule(
      ruleOf([
        {
          field: "storageUnit.storageTypeId",
          op: "eq",
          value: "cold"
        }
      ])
    );
    const violations = evaluateRules(
      [r],
      { storageUnit: { storageTypeId: "cold" } },
      "receipt"
    );
    expect(violations).toEqual([]);
  });

  it("rule subscribed to surfaces it doesn't include is skipped", () => {
    const r = compileRule(
      ruleOf([{ field: "operation.itemId", op: "isSet" }], {
        targetType: "workCenter",
        surfaces: ["operationStart"]
      })
    );
    const violations = evaluateRules(
      [r],
      { operation: { itemId: null } },
      "operationFinish"
    );
    expect(violations).toEqual([]);
  });
});

describe("compileWithCache", () => {
  beforeEach(() => __resetCustomRulesCache());

  it("returns same compiled instance on cache hit", () => {
    const row = ruleOf([{ field: "item.type", op: "eq", value: "Part" }]);
    const a = compileWithCache(row);
    const b = compileWithCache(row);
    expect(a).toBe(b);
  });

  it("invalidates when updatedAt changes", () => {
    const row1 = ruleOf([{ field: "item.type", op: "eq", value: "Part" }], {
      updatedAt: "2026-05-04T00:00:00Z"
    });
    const row2 = ruleOf([{ field: "item.type", op: "eq", value: "Part" }], {
      updatedAt: "2026-05-04T01:00:00Z"
    });
    const a = compileWithCache(row1);
    const b = compileWithCache(row2);
    expect(a).not.toBe(b);
    expect(__customRulesCacheSize()).toBe(2);
  });

  it("does not collide across targetTypes with identical content", () => {
    // Same id, same AST, same message — different targetType must produce
    // distinct compiled rules. Catches a stale cache key that omits
    // targetType.
    const itemRow = ruleOf([{ field: "item.type", op: "eq", value: "Part" }], {
      id: "shared_id",
      targetType: "item"
    });
    const wcRow = ruleOf([{ field: "item.type", op: "eq", value: "Part" }], {
      id: "shared_id",
      targetType: "workCenter"
    });
    const a = compileWithCache(itemRow);
    const b = compileWithCache(wcRow);
    expect(a).not.toBe(b);
    expect(a.targetType).toBe("item");
    expect(b.targetType).toBe("workCenter");
  });

  it("evicts oldest when over cap", () => {
    for (let i = 0; i < 300; i++) {
      compileWithCache(
        ruleOf([{ field: "item.type", op: "eq", value: `v${i}` }], {
          id: `rule_${i}`,
          updatedAt: `t${i}`
        })
      );
    }
    expect(__customRulesCacheSize()).toBeLessThanOrEqual(256);
  });
});

describe("FIELD_REGISTRY", () => {
  it("getFieldDef returns registered field", () => {
    expect(getFieldDef("item.type")?.label).toBe("Item type");
    expect(getFieldDef("storageUnit.storageTypeId")?.context).toBe("storage");
  });

  it("getFieldDef synthesizes definition for custom field paths", () => {
    const def = getFieldDef("item.customFields.frozen");
    expect(def?.label).toBe("frozen");
    expect(def?.context).toBe("item");
  });

  it("returns undefined for unknown paths", () => {
    expect(getFieldDef("garbage.path")).toBeUndefined();
  });
});

describe("getFieldsForTargetType", () => {
  it("item target sees item + storage + shared fields, not workCenter fields", () => {
    const fields = getFieldsForTargetType("item");
    const paths = fields.map((f) => f.path);
    expect(paths).toContain("item.type");
    expect(paths).toContain("transaction.quantity");
    // storageUnit ctx is loaded for item-target surfaces when the line carries
    // a storageUnitId — these fields are now visible (with nullable: true so
    // authors can guard with isSet/isNotSet).
    expect(paths).toContain("storageUnit.id");
    expect(paths).toContain("storageUnit.locationId");
    expect(paths).toContain("storageUnit.storageTypeId");
    expect(paths.some((p) => p.startsWith("workCenter."))).toBe(false);
    expect(paths.some((p) => p.startsWith("operation."))).toBe(false);
  });

  it("workCenter target sees workCenter + shared, not item.* or storageUnit.*", () => {
    const fields = getFieldsForTargetType("workCenter");
    const paths = fields.map((f) => f.path);
    expect(paths).toContain("workCenter.locationId");
    expect(paths).toContain("workCenter.active");
    expect(paths).toContain("transaction.quantity");
    expect(paths).not.toContain("item.type");
    expect(paths.some((p) => p.startsWith("storageUnit."))).toBe(false);
  });

  it("storageUnit target sees storage + item fields (item ctx loads on every storageUnit-target surface)", () => {
    const fields = getFieldsForTargetType("storageUnit");
    const paths = fields.map((f) => f.path);
    expect(paths).toContain("storageUnit.id");
    expect(paths).toContain("storageUnit.storageTypeId");
    expect(paths).toContain("storageUnit.locationId");
    expect(paths).toContain("transaction.quantity");
    expect(paths).toContain("item.type");
    expect(paths).toContain("item.replenishmentSystem");
    expect(paths).toContain("item.itemTrackingType");
  });
});

describe("required-field pre-check", () => {
  const coldRule = ruleOf(
    [{ field: "storageUnit.storageTypeId", op: "eq", value: "cold-id" }],
    { id: "rule_cold", severity: "error", message: "must be cold storage" }
  );

  it("null field → hard violation, predicate skipped", () => {
    const compiled = compileRule(coldRule);
    const ctx: RuleContext = {};
    const violations = evaluateRules([compiled], ctx, "inventoryAdjustment");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleId).toBe("rule_cold");
    expect(violations[0]?.severity).toBe("error");
    expect(violations[0]?.message).toBe("Storage type is required");
  });

  it("empty string counts as missing", () => {
    const compiled = compileRule(coldRule);
    const ctx: RuleContext = { storageUnit: { storageTypeId: "" } };
    const violations = evaluateRules([compiled], ctx, "inventoryAdjustment");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toBe("Storage type is required");
  });

  it("isSet op is exempt — predicate runs, not required-field check", () => {
    const rule = compileRule(
      ruleOf([{ field: "storageUnit.storageTypeId", op: "isSet" }], {
        id: "rule_isset",
        severity: "warn",
        message: "storage type must be set"
      })
    );
    const ctx: RuleContext = {};
    const violations = evaluateRules([rule], ctx, "inventoryAdjustment");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toBe("storage type must be set");
    expect(violations[0]?.message).not.toContain("required");
  });

  it("isNotSet op is exempt — predicate runs, not required-field check", () => {
    const rule = compileRule(
      ruleOf([{ field: "storageUnit.storageTypeId", op: "isNotSet" }], {
        id: "rule_isnotset",
        severity: "warn",
        message: "storage type must not be set"
      })
    );
    const ctx: RuleContext = { storageUnit: { storageTypeId: "some-id" } };
    const violations = evaluateRules([rule], ctx, "inventoryAdjustment");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toBe("storage type must not be set");
    expect(violations[0]?.message).not.toContain("required");
  });

  it("field present but wrong value → predicate violation, not required", () => {
    const compiled = compileRule(coldRule);
    const ctx: RuleContext = { storageUnit: { storageTypeId: "ambient-id" } };
    const violations = evaluateRules([compiled], ctx, "inventoryAdjustment");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toBe("must be cold storage");
    expect(violations[0]?.message).not.toContain("required");
  });

  it("all required fields present and predicate passes → no violations", () => {
    const compiled = compileRule(coldRule);
    const ctx: RuleContext = { storageUnit: { storageTypeId: "cold-id" } };
    const violations = evaluateRules([compiled], ctx, "inventoryAdjustment");
    expect(violations).toEqual([]);
  });
});

describe("per-surface field availability", () => {
  it("every surface has an availability entry", () => {
    for (const s of TRANSACTION_SURFACES) {
      expect(SURFACE_CONTEXT_AVAILABILITY[s]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("isFieldAvailableOnSurfaces defers to targetType when no surfaces given", () => {
    const itemTypeDef = getFieldDef("item.type")!;
    expect(isFieldAvailableOnSurfaces(itemTypeDef, [])).toBe(true);
  });

  it("storage fields are not offered on operation (workCenter) surfaces", () => {
    const wcFields = getFieldsForTargetTypeAndSurfaces("workCenter", [
      "operationStart"
    ]);
    expect(wcFields.some((f) => f.context === "storage")).toBe(false);
    // transaction.quantity (shared) stays available everywhere.
    expect(wcFields.some((f) => f.path === "transaction.quantity")).toBe(true);
  });

  it("item-surface fields stay offered for item rules", () => {
    const itemFields = getFieldsForTargetTypeAndSurfaces("item", ["receipt"]);
    expect(itemFields.some((f) => f.path === "item.type")).toBe(true);
    expect(itemFields.some((f) => f.context === "storage")).toBe(true);
  });

  it("narrowed set is a subset of the targetType set", () => {
    const all = getFieldsForTargetType("item");
    const narrowed = getFieldsForTargetTypeAndSurfaces("item", ["receipt"]);
    expect(narrowed.length).toBeLessThanOrEqual(all.length);
    for (const f of narrowed) {
      expect(all).toContain(f);
    }
  });

  it("every registry field is offered on at least one surface of its targetType", () => {
    for (const f of FIELD_REGISTRY) {
      const someSurface = TRANSACTION_SURFACES.some((s) =>
        SURFACE_CONTEXT_AVAILABILITY[s].includes(f.context)
      );
      expect(someSurface, `field "${f.path}" offered on no surface`).toBe(true);
    }
  });
});

describe("itemRuleAppliesToItem", () => {
  const part = { type: "Part", itemPostingGroupId: "grp_a" };

  it("empty filters → applies to all items", () => {
    expect(itemRuleAppliesToItem(part, {})).toBe(true);
    expect(
      itemRuleAppliesToItem(part, {
        filteredItemTypes: [],
        filteredItemGroupIds: []
      })
    ).toBe(true);
  });

  it("single dimension (type) — OR and AND behave the same", () => {
    expect(
      itemRuleAppliesToItem(part, { filteredItemTypes: ["Part", "Material"] })
    ).toBe(true);
    expect(
      itemRuleAppliesToItem(part, { filteredItemTypes: ["Material"] })
    ).toBe(false);
    expect(
      itemRuleAppliesToItem(part, {
        filteredItemTypes: ["Material"],
        filteredItemMatchAll: true
      })
    ).toBe(false);
  });

  it("single dimension (group)", () => {
    expect(
      itemRuleAppliesToItem(part, { filteredItemGroupIds: ["grp_a"] })
    ).toBe(true);
    expect(
      itemRuleAppliesToItem(part, { filteredItemGroupIds: ["grp_b"] })
    ).toBe(false);
  });

  it("OR (default) — either dimension matches", () => {
    expect(
      itemRuleAppliesToItem(part, {
        filteredItemTypes: ["Material"],
        filteredItemGroupIds: ["grp_a"]
      })
    ).toBe(true);
    expect(
      itemRuleAppliesToItem(part, {
        filteredItemTypes: ["Material"],
        filteredItemGroupIds: ["grp_b"]
      })
    ).toBe(false);
  });

  it("AND — both dimensions must match", () => {
    expect(
      itemRuleAppliesToItem(part, {
        filteredItemTypes: ["Part"],
        filteredItemGroupIds: ["grp_a"],
        filteredItemMatchAll: true
      })
    ).toBe(true);
    expect(
      itemRuleAppliesToItem(part, {
        filteredItemTypes: ["Part"],
        filteredItemGroupIds: ["grp_b"],
        filteredItemMatchAll: true
      })
    ).toBe(false);
  });

  it("null/absent posting group never matches a group filter", () => {
    expect(
      itemRuleAppliesToItem(
        { type: "Part", itemPostingGroupId: null },
        { filteredItemGroupIds: ["grp_a"] }
      )
    ).toBe(false);
  });
});
