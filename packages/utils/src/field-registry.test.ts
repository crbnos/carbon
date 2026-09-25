import { RULE_FIELDS } from "@carbon/database/dataset-rule-fields";
import { describe, expect, it } from "vitest";
import {
  availableOperators,
  type FieldDef,
  getFieldsForSalesRules,
  getFieldsForTargetType
} from "./field-registry";

// @carbon/database keeps its own copy of the seedable rule fields (it cannot import
// this package); anything it allows must be offered here, or the seed writes rules the app refuses.
const FIELDS_BY_SHAPE: Record<string, FieldDef[]> = {
  sales: getFieldsForSalesRules(),
  "storage:item": getFieldsForTargetType("item"),
  "storage:workCenter": getFieldsForTargetType("workCenter")
};

describe("dataset RULE_FIELDS ⊆ the rule builder's registry", () => {
  it.each(
    Object.entries(RULE_FIELDS).flatMap(([path, field]) =>
      field.shapes.map((shape) => [path, shape, field.ops] as const)
    )
  )("%s on a %s rule", (path, shape, ops) => {
    const def = FIELDS_BY_SHAPE[shape]?.find((f) => f.path === path);
    expect(def, `${path} is not offered to a ${shape} rule`).toBeDefined();
    expect(ops.filter((op) => !availableOperators(def!).includes(op))).toEqual(
      []
    );
  });
});
