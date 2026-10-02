// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database, Json } from "@carbon/database";
import { Ratelimit, redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeJwt } from "jose";
import { getCarbon } from "../lib/supabase/client";
import { getCarbonServiceRole } from "../lib/supabase/client.server";
import type { Permission } from "../types";
import { getAuthAccountByAccessToken } from "./auth.server";
import { logAuthEvent } from "./auth-events.server";
import { userHasVerifiedTotpFactor } from "./mfa.server";
import { getClaims, makePermissionsFromClaims } from "./users";

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
};

export type ApiPermissions = {
  view?: string | string[];
  create?: string | string[];
  update?: string | string[];
  delete?: string | string[];
  role?: string;
};

/** A verified operator token's payload, as `console-pin.server` stores it. */
export type ApiOperator = {
  userId: string;
  companyId: string;
  sessionUserId: string;
  pinnedAt: number;
};

export type ApiUserDeps = {
  getUser?: typeof getAuthAccountByAccessToken;
  getClaims?: (userId: string, companyId: string) => Promise<ApiClaims>;
  hasTotp?: typeof userHasVerifiedTotpFactor;
  /**
   * Shared-tablet support, injected by the MES app. `@carbon/auth` cannot
   * import `@carbon/ee` (ee already depends on auth, so it would be a cycle),
   * and the entitlement + PIN checks live there — so the caller supplies them.
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

  const companyId = request.headers.get("x-carbon-company")?.trim();
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
  if (tokenAssuranceLevel(bearer) !== "aal2" && (await hasTotp(user.id))) {
    throw new ApiError(401, "mfa_required", "Enter your two-factor code");
  }

  let effectiveUserId = user.id;
  let consoleMode = false;
  const operatorToken = request.headers.get("x-carbon-operator")?.trim();
  if (operatorToken) {
    if (!deps.operator) {
      throw new ApiError(
        400,
        "validation_failed",
        "Operator tokens are not accepted on this endpoint"
      );
    }
    const operator = await deps.operator.verify(operatorToken);
    if (
      !operator ||
      operator.companyId !== companyId ||
      operator.sessionUserId !== user.id ||
      !(await deps.operator.revalidate(operator))
    ) {
      throw new ApiError(
        401,
        "operator_expired",
        "Pin in again to keep working"
      );
    }
    effectiveUserId = operator.userId;
    consoleMode = true;
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
    client: getCarbon(bearer)
  };
}
