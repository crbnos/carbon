// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { z } from "zod";

/**
 * The wire contract between the Carbon MES mobile app and the MES API
 * (`apps/mes/app/routes/api+/v1+/`). Both sides import these schemas, so a
 * server response the app's zod would reject fails the server's own tests first.
 *
 * `/api/v1` is ADDITIVE-ONLY (BACKWARD_COMPATIBILITY.md). A breaking change
 * needs `/api/v2`, and v1 stays until the oldest supported app release stops
 * using it.
 */
/**
 * An http(s) URL. `z.string().url()` delegates to `new URL`, which happily
 * accepts "localhost:54321" (scheme "localhost:") and "carbon-mes://link" — so
 * it would pass a Supabase URL the app can never fetch from. Check the protocol.
 */
export const httpUrl = z.string().refine(
  (value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  },
  { message: "Must be an http or https URL" }
);

export const API_VERSION = 1 as const;
export const API_PREFIX = "/api/v1" as const;

/** Header names, lowercase — `Headers` lookups are case-insensitive either way. */
export const HEADERS = {
  /** The company every query is scoped to; checked against the caller's claims. */
  company: "x-carbon-company",
  /** The location whose work centers / printers the call acts on. */
  location: "x-carbon-location",
  /** Shared tablets: the signed operator token the command is attributed to. */
  operator: "x-carbon-operator",
  /** Shared tablets: the signed terminal token, sent only when pinning in. */
  terminal: "x-carbon-terminal",
  /** The app's own version, so the server can answer 426 to an old build. */
  appVersion: "x-carbon-app-version",
  /** Required on every authenticated POST; de-duplicates a retried command. */
  idempotencyKey: "idempotency-key",
  /** Set on a replayed response so the client can tell it apart from a fresh run. */
  idempotentReplayed: "idempotent-replayed",
  /** The API versions this server speaks, comma-separated. On EVERY response. */
  apiVersions: "carbon-api"
} as const;

export type ApiErrorCode =
  | "validation_failed"
  | "invalid_token"
  | "token_expired"
  | "mfa_required"
  | "operator_expired"
  | "company_required"
  | "location_required"
  | "forbidden"
  | "sso_required"
  | "not_found"
  | "conflict"
  | "blocked"
  | "needs_acknowledgement"
  | "request_in_progress"
  | "idempotency_key_required"
  | "idempotency_key_reused"
  | "update_required"
  | "rate_limited"
  | "locked"
  | "retry_later"
  | "invalid_code"
  | "internal";

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Field-level validation messages, keyed by the body field name. */
    fields?: Record<string, string[]>;
    /** Extra payload a code defines — e.g. `unresolvedLines` for `blocked`. */
    details?: unknown;
  };
};

export const apiErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fields: z.record(z.string(), z.array(z.string())).optional(),
    details: z.unknown().optional()
  })
});

/**
 * Compare two dotted numeric versions. Missing parts count as 0, so "1.0" and
 * "1.0.0" are equal, and non-numeric parts count as 0 rather than NaN-ing the
 * comparison (an app version is only ever used to decide "too old to talk to").
 */
export function compareAppVersion(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".");
  const pb = b.split(".");
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = Number.parseInt(pa[i] ?? "0", 10);
    const nb = Number.parseInt(pb[i] ?? "0", 10);
    const va = Number.isNaN(na) ? 0 : na;
    const vb = Number.isNaN(nb) ? 0 : nb;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

/** Does this server speak a version the app understands? */
export function serverSpeaksApiVersion(header: string | null): boolean {
  if (!header) return false;
  return header
    .split(",")
    .map((v) => v.trim())
    .includes(String(API_VERSION));
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const authCodeRequest = z.object({
  email: z.string().email()
});
export type AuthCodeRequest = z.infer<typeof authCodeRequest>;

/**
 * Always `{ ok: true }`, for an existing account and a non-existent one alike —
 * the endpoint must not reveal which emails exist. `method: "password"` appears
 * only for an allow-listed store-review account (`APP_REVIEW_EMAILS`).
 */
export const authCodeResponse = z.object({
  ok: z.literal(true),
  method: z.literal("password").optional()
});
export type AuthCodeResponse = z.infer<typeof authCodeResponse>;

const sixDigitCode = z
  .string()
  .regex(/^\d{6}$/, { message: "Enter the 6-digit code from your email" });

export const authVerifyRequest = z.object({
  email: z.string().email(),
  code: sixDigitCode
});
export type AuthVerifyRequest = z.infer<typeof authVerifyRequest>;

export const authSessionResponse = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number(),
  /** The user has a verified TOTP factor; the app must run `/auth/mfa` next. */
  mfaRequired: z.boolean()
});
export type AuthSessionResponse = z.infer<typeof authSessionResponse>;

/**
 * BOTH tokens, not just the access token: `verifyTotpChallenge`
 * (`@carbon/auth/mfa.server`) seeds an anon client with `auth.setSession`
 * before it challenges, so it needs the refresh token too.
 */
export const authMfaRequest = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  code: sixDigitCode
});
export type AuthMfaRequest = z.infer<typeof authMfaRequest>;

export const authPasswordRequest = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});
export type AuthPasswordRequest = z.infer<typeof authPasswordRequest>;

// ---------------------------------------------------------------------------
// GET /me — everything the app learns about an instance once signed in
// ---------------------------------------------------------------------------

export const deploymentMode = z.enum(["connected", "airgapped"]);
export type DeploymentMode = z.infer<typeof deploymentMode>;

export const meInstance = z.object({
  name: z.string(),
  /** The PUBLIC Supabase URL — never SUPABASE_INTERNAL_URL. */
  supabaseUrl: httpUrl,
  supabaseAnonKey: z.string().min(1),
  mode: deploymentMode,
  controlledEnvironment: z.boolean(),
  idleLockMs: z.number(),
  minAppVersion: z.string(),
  /** Null on self-hosted, air-gapped and controlled installs: no phoning home. */
  analytics: z
    .object({ posthogKey: z.string().min(1), posthogHost: z.string().min(1) })
    .nullable()
});
export type MeInstance = z.infer<typeof meInstance>;

export const mePermissions = z.object({
  production: z.object({
    view: z.boolean(),
    create: z.boolean(),
    update: z.boolean()
  }),
  inventory: z.object({ view: z.boolean(), update: z.boolean() }),
  quality: z.object({ create: z.boolean() }),
  settings: z.object({ update: z.boolean() })
});
export type MePermissions = z.infer<typeof mePermissions>;

export const meResponse = z.object({
  instance: meInstance,
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    avatarUrl: z.string().nullable()
  }),
  companies: z.array(z.object({ id: z.string(), name: z.string() })),
  locations: z.array(
    z.object({ id: z.string(), name: z.string(), companyId: z.string() })
  ),
  defaultLocationId: z.string().nullable(),
  workCenters: z.array(
    z.object({ id: z.string(), name: z.string(), locationId: z.string() })
  ),
  /** Console mode is on for the company AND the PERMISSIONS feature is entitled. */
  consoleAvailable: z.boolean(),
  permissions: mePermissions
});
export type MeResponse = z.infer<typeof meResponse>;

// ---------------------------------------------------------------------------
// Screen reads
// ---------------------------------------------------------------------------

/**
 * The operations list query. `filter` carries the web's own `key:op:value`
 * strings unchanged, so the app and the web cookie encode a filter the same way.
 */
export const operationsQuery = z.object({
  workCenterIds: z.array(z.string()).default([]),
  filter: z.array(z.string()).default([])
});
export type OperationsQuery = z.infer<typeof operationsQuery>;
