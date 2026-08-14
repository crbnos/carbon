// Zod mirrors of the rule-engine AST types in `./rules` (`Operator`,
// `MatchKind`, `Condition`, `ConditionAst`).
//
// Lives here rather than in an ERP module because BOTH rule families validate
// the same AST: storage rules (`~/modules/inventory`) and sales rules
// (`~/modules/items`). Keeping it in the engine package means neither module
// has to import the other — `inventory` already depends on `items`, so the
// reverse edge would be a cycle.

import { z } from "zod";
import type { MatchKind, Operator, Severity } from "./rules";

export const RULE_OPERATORS = [
  "eq",
  "neq",
  "in",
  "notIn",
  "isSet",
  "isNotSet",
  "gt",
  "lt"
] as const satisfies readonly Operator[];

export const RULE_MATCH_KINDS = [
  "all",
  "any",
  "none"
] as const satisfies readonly MatchKind[];

export const RULE_SEVERITIES = [
  "error",
  "warn"
] as const satisfies readonly Severity[];

const ruleConditionValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
  z.null()
]);

const ruleConditionSchema = z.object({
  field: z.string().min(1, { message: "Field is required" }),
  op: z.enum(RULE_OPERATORS),
  value: ruleConditionValueSchema.optional()
});

export const conditionAstSchema = z.object({
  kind: z.enum(RULE_MATCH_KINDS),
  conditions: z
    .array(ruleConditionSchema)
    .min(1, { message: "At least one condition is required" })
});

/**
 * Form-field wrapper: the builder posts the AST as a JSON string, so parse it
 * before the object schema runs. A malformed string falls through unchanged so
 * zod reports a shape error rather than a parse crash.
 */
export const conditionAstFormField = z.preprocess((raw) => {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}, conditionAstSchema);
