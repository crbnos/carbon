import {
  getFieldDef,
  isFieldAvailableOnSurfaces,
  SURFACES_BY_TARGET_TYPE,
  TARGET_TYPES,
  TRANSACTION_SURFACES
} from "@carbon/utils";
import { z } from "zod";
import { zfd } from "zod-form-data";

export const storageRuleSeverities = ["error", "warn"] as const;

export const storageRuleOperators = [
  "eq",
  "neq",
  "in",
  "notIn",
  "isSet",
  "isNotSet",
  "gt",
  "lt"
] as const;

const storageRuleConditionValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
  z.null()
]);

const storageRuleConditionSchema = z.object({
  field: z.string().min(1, { message: "Field is required" }),
  op: z.enum(storageRuleOperators),
  value: storageRuleConditionValueSchema.optional()
});

export const storageRuleMatchKinds = ["all", "any", "none"] as const;

export const storageRuleConditionAstSchema = z.object({
  kind: z.enum(storageRuleMatchKinds),
  conditions: z
    .array(storageRuleConditionSchema)
    .min(1, { message: "At least one condition is required" })
});

const storageRuleConditionAstFormField = z.preprocess((raw) => {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}, storageRuleConditionAstSchema);

export const storageRuleValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    name: z.string().min(1, { message: "Name is required" }).max(120),
    description: zfd.text(z.string().optional()),
    message: z.string().min(1, { message: "Message is required" }).max(500),
    severity: z.enum(storageRuleSeverities),
    targetType: z.enum(TARGET_TYPES),
    // Broadcast gate for workCenter rules. Item rules ignore this and use the
    // filteredItem* fields instead (empty = all items).
    appliesToAll: zfd.checkbox(),
    filteredItemTypes: zfd.repeatableOfType(z.string()).optional(),
    filteredItemGroupIds: zfd.repeatableOfType(z.string()).optional(),
    filteredItemMatchAll: zfd.checkbox(),
    active: zfd.checkbox(),
    surfaces: zfd
      .repeatableOfType(z.enum(TRANSACTION_SURFACES))
      .refine((arr) => arr.length >= 1, {
        message: "Pick at least one surface"
      }),
    conditionAst: storageRuleConditionAstFormField
  })
  .superRefine((val, ctx) => {
    // Reject any surface that isn't valid for the chosen targetType. Schema
    // enforcement only — DB has no CHECK; UI also filters the picker.
    const allowed = new Set<string>(SURFACES_BY_TARGET_TYPE[val.targetType]);
    for (let i = 0; i < val.surfaces.length; i++) {
      const s = val.surfaces[i]!;
      if (!allowed.has(s)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["surfaces", i],
          message: `Surface "${s}" not valid for ${val.targetType} rules`
        });
      }
    }

    // Reject conditions on a registry field whose context the evaluator won't
    // populate for every selected surface (else it resolves undefined → false
    // "X is required"). Unknown paths are left to runtime presence handling.
    val.conditionAst.conditions.forEach((c, i) => {
      const def = getFieldDef(c.field);
      if (def && !isFieldAvailableOnSurfaces(def, val.surfaces)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["conditionAst", "conditions", i, "field"],
          message: `"${def.label}" isn't available on the selected surface(s)`
        });
      }
    });
  });

/**
 * Polymorphic assignment validator factory. The form's hidden field tells the
 * action which targetType is in play, then this validator picks the right
 * target-id key.
 */
export const storageRuleAssignmentValidator = (
  targetType: "item" | "workCenter"
) => {
  const idKey = targetType === "item" ? "itemId" : "workCenterId";
  return z.object({
    [idKey]: z.string().min(1, { message: "Target ID is required" }),
    ruleId: z.string().min(1, { message: "Rule ID is required" })
  });
};

export const storageRuleAcknowledgeValidator = zfd.checkbox();
