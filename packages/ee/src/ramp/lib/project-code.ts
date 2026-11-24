// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { z } from "zod";
import { RAMP_COST_CENTER_FIELD_ID, RAMP_GL_ACCOUNT_FIELD_ID } from "./coding";

const fieldId = z.string().trim().min(1, "Choose a custom field.");
const enabledSettings = z.object({
  projectCodeValueType: z.enum(["option", "text"]),
  projectCodePoField: fieldId,
  projectCodeInvoiceField: fieldId,
  projectCodeFieldExternalId: z
    .string()
    .trim()
    .min(1, "Enter the Ramp field external ID.")
    .refine(
      (id) =>
        id !== RAMP_GL_ACCOUNT_FIELD_ID && id !== RAMP_COST_CENTER_FIELD_ID,
      "Choose a project field. This ID is reserved for account or cost center coding."
    )
});

// The drawer can save other settings before a company has configured project coding.
export const projectCodeSettingFields = {
  projectCodeValueType: z.enum(["off", "option", "text"]).optional(),
  projectCodePoField: z.string().trim().optional(),
  projectCodeInvoiceField: z.string().trim().optional(),
  projectCodeFieldExternalId: z.string().trim().optional()
};

export function validateProjectCodeSettings(
  settings: { projectCodeValueType?: "off" | "option" | "text" },
  ctx: z.RefinementCtx
) {
  if (!settings.projectCodeValueType || settings.projectCodeValueType === "off")
    return;
  const result = enabledSettings.safeParse(settings);
  if (!result.success) {
    for (const issue of result.error.issues) {
      ctx.addIssue({
        code: "custom",
        path: issue.path,
        message: issue.message
      });
    }
  }
}

export type RampProjectCodeMapping = {
  purchaseOrderField: string;
  purchaseInvoiceField: string;
  fieldExternalId: string;
  valueType: "option" | "text";
};

export function resolveProjectCodeMapping(
  metadata: unknown
): RampProjectCodeMapping | undefined {
  const result = enabledSettings.safeParse(metadata);
  if (!result.success) return undefined;
  return {
    purchaseOrderField: result.data.projectCodePoField,
    purchaseInvoiceField: result.data.projectCodeInvoiceField,
    fieldExternalId: result.data.projectCodeFieldExternalId,
    valueType: result.data.projectCodeValueType
  };
}

export function readProjectCode(
  customFields: unknown,
  fieldId: string
): string | undefined {
  if (
    !customFields ||
    typeof customFields !== "object" ||
    !Object.hasOwn(customFields, fieldId)
  )
    return undefined;
  const value = (customFields as Record<string, unknown>)[fieldId];
  return typeof value === "string" ? value.trim() || undefined : undefined;
}
