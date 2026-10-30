// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { FEDERATION_LIMITS, federationProviders } from "./constants";
import { ruleRequirementErrors } from "./match";

function parseJson(value: string | undefined, empty: unknown): unknown {
  if (!value) return empty;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

const claimValue = z
  .string()
  .trim()
  .min(1)
  .max(FEDERATION_LIMITS.maxValueLength);

/** The form posts its condition rows as a list, so a repeated claim is caught rather than collapsed. */
const claimRowsSchema = z.array(
  z.object({ claim: claimValue, value: claimValue })
);

function parseClaimRows(value: string | undefined) {
  return claimRowsSchema.safeParse(parseJson(value, []));
}

/** The federation rule form: claim condition rows and scopes post as JSON strings. */
export const federationRuleValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    name: z.string().trim().min(1, { message: "Name is required" }),
    provider: z.enum(federationProviders, {
      message: "Provider is required"
    }),
    issuer: z
      .string()
      .trim()
      .min(1, { message: "Issuer is required" })
      .max(FEDERATION_LIMITS.maxValueLength),
    audience: z
      .string()
      .trim()
      .min(1, { message: "Audience is required" })
      .max(FEDERATION_LIMITS.maxValueLength),
    subject: zfd.text(
      z.string().trim().max(FEDERATION_LIMITS.maxValueLength).optional()
    ),
    claimConditions: zfd.text(z.string().optional()),
    scopes: zfd.text(z.string().optional()),
    tokenLifetimeMinutes: zfd.numeric(
      z
        .number()
        .int()
        .min(FEDERATION_LIMITS.minTokenLifetimeMinutes)
        .max(FEDERATION_LIMITS.maxTokenLifetimeMinutes)
    )
  })
  .superRefine((form, ctx) => {
    const rows = parseClaimRows(form.claimConditions);
    if (!rows.success) {
      ctx.addIssue({
        code: "custom",
        path: ["claimConditions"],
        message: "Each claim condition needs a claim name and a value"
      });
      return;
    }
    const names = rows.data.map((row) => row.claim);
    if (new Set(names).size !== names.length) {
      ctx.addIssue({
        code: "custom",
        path: ["claimConditions"],
        message: "Each claim may appear in one condition only"
      });
      return;
    }
    const errors = ruleRequirementErrors({
      issuer: form.issuer,
      subject: form.subject ?? null,
      claimConditions: Object.fromEntries(
        rows.data.map((row) => [row.claim, row.value])
      )
    });
    for (const [field, message] of Object.entries(errors)) {
      ctx.addIssue({ code: "custom", path: [field], message });
    }
  });

export type FederationRuleForm = z.output<typeof federationRuleValidator>;

/** A federation rule form's fields as saved. */
export function federationRuleFields({
  claimConditions,
  scopes,
  subject,
  ...form
}: FederationRuleForm) {
  return {
    ...form,
    subject: subject || null,
    claimConditions: Object.fromEntries(
      (parseClaimRows(claimConditions).data ?? []).map((row) => [
        row.claim,
        row.value
      ])
    ),
    scopes: (parseJson(scopes, {}) ?? {}) as Record<string, string[]>
  };
}

export type FederationRuleInput = ReturnType<typeof federationRuleFields>;

export type FederationRule =
  Database["public"]["Tables"]["federationRule"]["Row"];
