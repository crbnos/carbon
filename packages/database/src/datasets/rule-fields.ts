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

// A copy of the rule builder's field registry slice the seed can author: this package
// cannot import @carbon/utils, whose field-registry.test.ts pins it to the registry.
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
