// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database, Json } from "@carbon/database";
import { Ratelimit, redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeJwt } from "jose";
import { IS_LOCAL_DEV } from "../config/env";
import { getCarbon } from "../lib/supabase/client";
import { getCarbonServiceRole } from "../lib/supabase/client.server";
import type { Permission } from "../types";
import { getAuthAccountByAccessToken } from "./auth.server";
import { logAuthEvent } from "./auth-events.server";
import {
  revalidateConsolePinIn,
  type StoredConsolePinIn
} from "./console-pin.server";
import {
  refreshOperatorToken,
  verifyOperatorToken
} from "./console-token.server";
import { userHasVerifiedTotpFactor } from "./mfa.server";
import { getClaims, getCompanies, makePermissionsFromClaims } from "./users";

const log = getLogger("auth");

/**
 * Bearer-token authentication for the MES mobile API
 * (`apps/mes/app/routes/api+/v1+/`).
 *
 * This is NOT a wrapper around `requirePermissions`: that function throws
 * `redirect`s (through `requireAuthSession`), which a native client cannot
 * follow. Everything here throws an `ApiError` instead, and the route turns it
 * into a JSON body. The permission check below is otherwise a deliberate mirror
 * of the session path in `requirePermissions` — including the use of an EXACT
 * companyId match with no `"0"` wildcard, which is what that loop does (note
 * `hasPermission` in users.ts differs; it is not what gates routes).
 */

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

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly fields?: Record<string, string[]>,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Every API response carries the versions this server speaks. */
export const API_VERSIONS_HEADER = "carbon-api";
export const API_VERSIONS = "1";

export function apiErrorResponse(err: ApiError): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: err.code,
        message: err.message,
        ...(err.fields && { fields: err.fields }),
        ...(err.details !== undefined && { details: err.details })
      }
    }),
    {
      status: err.status,
      headers: {
        "Content-Type": "application/json",
        [API_VERSIONS_HEADER]: API_VERSIONS
      }
    }
  );
}

export type ApiClaims = {
  permissions: Record<string, Permission>;
  role: string | null;
};

export type ApiUser = {
  /** The company every query must be scoped to. */
  companyId: string;
  /**
   * Who the work is attributed to. The pinned operator on a shared tablet,
   * otherwise the signed-in user — the same split `requirePermissions` makes
   * between `userId` and `sessionUserId`.
   */
  userId: string;
  /** The signed-in user, whose claims were checked. */
  sessionUserId: string;
  consoleMode: boolean;
  accessToken: string;
  email: string;
  claims: ApiClaims;
  /** RLS-scoped as the signed-in user, like the web's non-bypass client. */
  client: SupabaseClient<Database>;
  /**
   * In console mode only: the operator's claim re-signed with a fresh
   * `pinnedAt`. The route wrapper returns it in the `x-carbon-operator`
   * response header and the app replaces what it holds in memory, which is how
   * a pin-in survives a long shift — the web gets the same sliding window for
   * free, because the MES shell loader rewrites the pin-in cookie on every
   * navigation.
   */
  operatorToken?: string;
};

export type ApiPermissions = {
  view?: string | string[];
  create?: string | string[];
  update?: string | string[];
  delete?: string | string[];
  role?: string;
};

/**
 * A verified operator token's payload — the SAME claim the signed
 * `console-pin-<companyId>` cookie carries on the web, so one
 * `revalidateConsolePinIn` answers "may this operator still act?" for both
 * carriers and a tablet and a browser cannot disagree.
 */
export type ApiOperator = StoredConsolePinIn;

export type ApiUserDeps = {
  /**
   * Resolve the company from the signed-in user when the `x-carbon-company`
   * header is absent, instead of refusing the request.
   *
   * For `/me` ONLY, and it is not a convenience: `/me` is how the app LEARNS
   * which companies it may send. A fresh install has signed in and has no
   * company yet, so requiring the header there made first sign-in impossible —
   * the app asked which companies it had and was told to name one first.
   *
   * Every other endpoint still requires the header. The caller has been to
   * `/me` by then, and a request that forgot to say which tenant it means must
   * be refused rather than guessed at.
   */
  companyOptional?: boolean;
  getUser?: typeof getAuthAccountByAccessToken;
  getClaims?: (userId: string, companyId: string) => Promise<ApiClaims>;
  hasTotp?: typeof userHasVerifiedTotpFactor;
  /**
   * Shared-tablet support. Defaults to `DEFAULT_OPERATOR_HOOK` below; the MES
   * app overrides it to add the commercial console ENTITLEMENT check, because
   * `@carbon/auth` cannot import `@carbon/ee` (ee already depends on auth, so
   * it would be a cycle).
   */
  operator?: {
    verify: (token: string) => Promise<ApiOperator | null>;
    revalidate: (operator: ApiOperator) => Promise<boolean>;
  };
  rateLimit?: (userId: string) => Promise<boolean>;
};

// Claims are cached per (user, COMPANY) here rather than through
// `getUserClaims`, whose key is `permissions:${userId}` with no company in it.
// That is safe on web because the session's company only changes through
// `updateCompanySession`, which deletes the key — but this API takes the company
// from a per-request header, so a cached `role` from one company could be read
// for another. A short private key keeps that correct without touching the six
// web invalidation sites (and their vi.mock fixtures) that own the shared key.
// 60s is strictly tighter than the shared cache's 1 hour.
const API_CLAIMS_TTL_SECONDS = 60;

function apiClaimsCacheKey(userId: string, companyId: string) {
  return `mes-api:claims:${userId}:${companyId}`;
}

export async function getApiClaims(
  userId: string,
  companyId: string
): Promise<ApiClaims> {
  try {
    const cached = await redis.get(apiClaimsCacheKey(userId, companyId));
    if (cached) return JSON.parse(cached) as ApiClaims;
  } catch (e) {
    log.error("Failed to read API claims from redis", { error: e });
  }

  const raw = await getClaims(getCarbonServiceRole(), userId, companyId);
  if (raw.error || raw.data === null) {
    log.error("Failed to get claims for API caller", { raw });
    throw new ApiError(500, "internal", "Could not resolve permissions");
  }

  const claims = makePermissionsFromClaims(raw.data as Json[]);
  if (!claims) {
    throw new ApiError(500, "internal", "Could not resolve permissions");
  }

  try {
    await redis.set(
      apiClaimsCacheKey(userId, companyId),
      JSON.stringify(claims),
      "EX",
      API_CLAIMS_TTL_SECONDS
    );
  } catch (e) {
    // Best effort: @carbon/kv fails soft, and we already have the claims.
    log.error("Failed to cache API claims", { error: e });
  }

  return claims;
}

/** Drop the API's cached claims — call after changing a user's permissions. */
export async function bustApiClaims(userId: string, companyId: string) {
  try {
    await redis.del(apiClaimsCacheKey(userId, companyId));
  } catch (e) {
    log.error("Failed to bust API claims", { error: e });
  }
}

/**
 * The shared-tablet hook: an operator claim this server SIGNED, verified
 * server-side, then re-validated against the database.
 *
 * `revalidate` asks `revalidateConsolePinIn` — the operator must still be an
 * ACTIVE employee of the token's company and `companySettings.consoleEnabled`
 * must still be on. It deliberately does NOT ask for the commercial
 * `PERMISSIONS` entitlement, which lives in `@carbon/ee` and would be an
 * import cycle from here: the MES app injects a `deps.operator` that adds
 * `isConsoleModeEnabledForCompany`, and `POST /api/v1/console/pin-in` asks it
 * before minting, so a company with no entitlement never gets a token at all.
 */
export const DEFAULT_OPERATOR_HOOK: NonNullable<ApiUserDeps["operator"]> = {
  verify: verifyOperatorToken,
  revalidate: revalidateConsolePinIn
};

const userRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(300, "1 m"),
  prefix: "@carbon/mes-api:user"
});

/**
 * The permission loop from `requirePermissions`' session path, verbatim in
 * behaviour: an exact `companyId` match, every requested action required, and
 * `role` compared directly.
 */
function hasRequiredPermissions(
  claims: ApiClaims,
  required: ApiPermissions,
  companyId: string
): boolean {
  return Object.entries(required).every(([action, permission]) => {
    if (typeof permission === "string") {
      if (action === "role") return claims.role === permission;
      if (!(permission in claims.permissions)) return false;
      const scoped =
        claims.permissions[permission]?.[
          action as "view" | "create" | "update" | "delete"
        ];
      return scoped?.includes(companyId) || false;
    }
    if (Array.isArray(permission)) {
      return permission.every((p) => {
        const scoped =
          claims.permissions[p]?.[
            action as "view" | "create" | "update" | "delete"
          ];
        return scoped?.includes(companyId) ?? false;
      });
    }
    return false;
  });
}

/** `aal2` means the session has cleared a TOTP challenge. */
function tokenAssuranceLevel(token: string): string | null {
  try {
    const payload = decodeJwt(token) as { aal?: unknown };
    return typeof payload.aal === "string" ? payload.aal : null;
  } catch {
    return null;
  }
}

export async function requireApiUser(
  request: Request,
  permissions: ApiPermissions = {},
  deps: ApiUserDeps = {}
): Promise<ApiUser> {
  const getUser = deps.getUser ?? getAuthAccountByAccessToken;
  const loadClaims = deps.getClaims ?? getApiClaims;
  const hasTotp = deps.hasTotp ?? userHasVerifiedTotpFactor;

  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!bearer) {
    throw new ApiError(401, "invalid_token", "Sign in to continue");
  }

  // `crbn_` keys belong to the ERP's public API, which acts as the key's
  // creator and so cannot attribute work to an individual operator.
  if (bearer.startsWith("crbn_")) {
    throw new ApiError(
      401,
      "invalid_token",
      "API keys belong to the Carbon API, not the MES app"
    );
  }

  const user = await getUser(bearer);
  if (!user) {
    throw new ApiError(401, "token_expired", "Your session expired");
  }

  let companyId = request.headers.get("x-carbon-company")?.trim();
  if (!companyId && deps.companyOptional) {
    // The user's own companies, ordered by name, so the fallback is stable
    // rather than whichever row the database happened to return first.
    const companies = await getCompanies(getCarbonServiceRole(), user.id);
    companyId = companies.data?.[0]?.companyId ?? undefined;
  }
  if (!companyId) {
    throw new ApiError(400, "company_required", "No company was selected");
  }

  const claims = await loadClaims(user.id, companyId);

  if (claims.role !== "employee") {
    logAuthEvent("permission_denied", {
      userId: user.id,
      actor: user.email ?? undefined,
      companyId,
      reason: `MES API: role ${claims.role ?? "none"}`
    });
    throw new ApiError(
      403,
      "forbidden",
      "Ask your supervisor for access to this company"
    );
  }

  if (!hasRequiredPermissions(claims, permissions, companyId)) {
    logAuthEvent("permission_denied", {
      userId: user.id,
      actor: user.email ?? undefined,
      companyId,
      reason: `MES API: ${JSON.stringify(permissions)}`
    });
    throw new ApiError(
      403,
      "forbidden",
      "Ask your supervisor for access to this action"
    );
  }

  // Mirrors the web's mfaVerified bounce in `requireAuthSession`: a user who
  // enrolled a TOTP factor must clear it before any call succeeds.
  //
  // The DEV_BYPASS_EMAIL account is exempt, as it is from the SSO-required gate
  // (`.claude/rules/authentication-system.md`). The web bypass mints a session
  // with `mfaVerified: true` and carries that in a cookie; the API has no
  // cookie and can only read the token's `aal`, which the bypass leaves at
  // `aal1` — so without this a developer whose local test user happens to have
  // a TOTP factor could never call the API at all. Gated on IS_LOCAL_DEV, the
  // same flag `signInWithBypassEmail` itself refuses to run without, so it
  // cannot exist in a deployed environment.
  const isLocalBypassUser =
    IS_LOCAL_DEV &&
    !!process.env.DEV_BYPASS_EMAIL &&
    user.email?.toLowerCase() ===
      process.env.DEV_BYPASS_EMAIL.trim().toLowerCase();

  if (
    !isLocalBypassUser &&
    tokenAssuranceLevel(bearer) !== "aal2" &&
    (await hasTotp(user.id))
  ) {
    throw new ApiError(401, "mfa_required", "Enter your two-factor code");
  }

  // Everything above has already passed: the Bearer token resolved to a real
  // account, the company header matched its claims, the permissions held and
  // the MFA gate cleared. ONLY NOW is the operator claim read, and all it can
  // do is move the attribution from the terminal account to a person that
  // account is already allowed to act as.
  let effectiveUserId = user.id;
  let consoleMode = false;
  let freshOperatorToken: string | undefined;
  const operatorToken = request.headers.get("x-carbon-operator")?.trim();
  if (operatorToken) {
    const hook = deps.operator ?? DEFAULT_OPERATOR_HOOK;
    const operator = await hook.verify(operatorToken);
    if (
      !operator ||
      // Bound to ONE company, so a token cannot be replayed against another
      // tenant the terminal account happens to belong to...
      operator.companyId !== companyId ||
      // ...and to the terminal SESSION that minted it, so a token lifted off
      // one tablet is worthless on the next one.
      operator.sessionUserId !== user.id ||
      !(await hook.revalidate(operator))
    ) {
      throw new ApiError(
        401,
        "operator_expired",
        "Pin in again to keep working"
      );
    }
    effectiveUserId = operator.userId;
    consoleMode = true;
    freshOperatorToken = await refreshOperatorToken(operator);
  }

  const withinLimit = deps.rateLimit
    ? await deps.rateLimit(user.id)
    : (await userRatelimit.limit(user.id)).success;
  if (!withinLimit) {
    throw new ApiError(429, "rate_limited", "Too many requests, slow down");
  }

  return {
    companyId,
    userId: effectiveUserId,
    sessionUserId: user.id,
    consoleMode,
    accessToken: bearer,
    email: user.email ?? "",
    claims,
    client: getCarbon(bearer),
    ...(freshOperatorToken && { operatorToken: freshOperatorToken })
  };
}
