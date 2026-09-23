import { RULE_FIELDS } from "@carbon/database/dataset-rule-fields";
import { describe, expect, it } from "vitest";
import {
  availableOperators,
  type FieldDef,
  getFieldsForSalesRules,
  getFieldsForTargetType
} from "./field-registry";

// The demo datasets' validator keeps its own copy of the fields a seeded rule may
// test (@carbon/database cannot import this package). Every field, shape and
// operator it allows must be one the rule builder offers, or the seed writes
// rules the app would refuse.
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
