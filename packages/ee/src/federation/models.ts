// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  FEDERATION_LIMITS,
  federationJwksSources,
  federationProviders
} from "./constants";
import { issuerConfigErrors, nameError, ruleRequirementErrors } from "./match";

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

const urlField = zfd.text(
  z.string().trim().max(FEDERATION_LIMITS.maxValueLength).optional()
);

/** The issuer form. The pasted key set posts as JSON text. */
export const federationIssuerValidator = z
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
    jwksSource: z.enum(federationJwksSources),
    discoveryUrl: urlField,
    jwksUrl: urlField,
    jwks: zfd.text(z.string().max(64_000).optional()),
    caCertificate: zfd.text(z.string().max(16_000).optional()),
    requireUniqueJti: zfd.checkbox(),
    maxTokenLifetimeHours: zfd.numeric(z.number().int())
  })
  .superRefine((form, ctx) => {
    // Check what is saved: a field the chosen key source ignores is dropped.
    const fields = federationIssuerFields(form);
    const errors = issuerConfigErrors({
      ...fields,
      // An unparseable pasted key set reads as missing, not as an empty one.
      jwks: fields.jwks
    });
    for (const [field, message] of Object.entries(errors)) {
      ctx.addIssue({ code: "custom", path: [field], message });
    }
  });

export type FederationIssuerForm = z.output<typeof federationIssuerValidator>;

/** An issuer form's fields as saved: only the fields of the chosen key source are kept. */
export function federationIssuerFields({
  discoveryUrl,
  jwksUrl,
  jwks,
  caCertificate,
  ...form
}: FederationIssuerForm) {
  const inline = form.jwksSource === "Inline JWKS";
  return {
    ...form,
    discoveryUrl:
      form.jwksSource === "OIDC Discovery" ? discoveryUrl || null : null,
    jwksUrl: form.jwksSource === "JWKS URL" ? jwksUrl || null : null,
    jwks: inline
      ? ((parseJson(jwks, null) ?? null) as Record<string, unknown> | null)
      : null,
    caCertificate: inline ? null : caCertificate?.trim() || null
  };
}

export type FederationIssuerInput = ReturnType<typeof federationIssuerFields>;

/**
 * The rule form: condition rows and scopes post as JSON strings. `issuerUrl`
 * is the chosen issuer's URL, sent only so the form can run the shared-issuer
 * checks before it posts; the server reads the issuer itself.
 */
export const federationRuleValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    name: z.string().trim().min(1, { message: "Name is required" }),
    description: zfd.text(
      z.string().trim().max(FEDERATION_LIMITS.maxDescriptionLength).optional()
    ),
    issuerId: z.string().min(1, { message: "Issuer is required" }),
    issuerUrl: zfd.text(z.string().optional()),
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
    const name = nameError(form.name);
    if (name) ctx.addIssue({ code: "custom", path: ["name"], message: name });

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
      // Without the issuer's URL the shared-issuer checks wait for the server.
      issuer: form.issuerUrl || "https://issuer.invalid",
      subject: form.subject ?? null,
      claimConditions: Object.fromEntries(
        rows.data.map((row) => [row.claim, row.value])
      )
    });
    for (const [field, message] of Object.entries(errors)) {
      if (field === "issuer") continue;
      ctx.addIssue({ code: "custom", path: [field], message });
    }
  });

export type FederationRuleForm = z.output<typeof federationRuleValidator>;

/** A federation rule form's fields as saved. */
export function federationRuleFields({
  claimConditions,
  scopes,
  subject,
  description,
  issuerUrl: _issuerUrl,
  ...form
}: FederationRuleForm) {
  return {
    ...form,
    description: description || null,
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
