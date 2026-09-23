import type { RuleOperator } from "./types.ts";
import type { RuleShape } from "./validate.ts";

export type RuleValueKind =
  | "enum"
  | "number"
  | "boolean"
  | "country"
  | "storageType"
  | "customerTypes"
  | "location";

// The slice of the rule builder's field registry (@carbon/utils
// field-registry.ts, which this package cannot import) the seed can author:
// which fields each rule shape may test, with which operators, and the value
// the tier knows how to resolve. Exported as `@carbon/database/dataset-rule-fields`
// so `field-registry.test.ts` in @carbon/utils can pin it to the registry.
export const RULE_FIELDS: Record<
  string,
  {
    ops: readonly RuleOperator[];
    shapes: RuleShape[];
    value: RuleValueKind;
  }
> = {
  "item.type": {
    ops: ["eq", "neq", "in", "notIn"],
    shapes: ["sales", "storage:item"],
    value: "enum"
  },
  "item.replenishmentSystem": {
    ops: ["eq", "neq", "in", "notIn"],
    shapes: ["sales", "storage:item"],
    value: "enum"
  },
  "item.itemTrackingType": {
    ops: ["eq", "neq", "in", "notIn"],
    shapes: ["sales", "storage:item"],
    value: "enum"
  },
  "storageUnit.storageTypeId": {
    ops: ["eq", "neq", "isSet", "isNotSet"],
    shapes: ["storage:item"],
    value: "storageType"
  },
  "storageUnit.locationId": {
    ops: ["eq", "neq", "isSet", "isNotSet"],
    shapes: ["storage:item"],
    value: "location"
  },
  "workCenter.locationId": {
    ops: ["eq", "neq", "isSet", "isNotSet"],
    shapes: ["storage:workCenter"],
    value: "location"
  },
  "workCenter.active": {
    ops: ["eq", "neq"],
    shapes: ["storage:workCenter"],
    value: "boolean"
  },
  "transaction.quantity": {
    ops: ["eq", "neq", "gt", "lt"],
    shapes: ["sales", "storage:item", "storage:workCenter"],
    value: "number"
  },
  "customer.customerTypeId": {
    ops: ["in", "notIn", "isSet", "isNotSet"],
    shapes: ["sales"],
    value: "customerTypes"
  },
  "customer.location.countryCode": {
    ops: ["eq", "neq", "in", "notIn", "isSet", "isNotSet"],
    shapes: ["sales"],
    value: "country"
  }
};
