// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { CarbonEdition, DOMAIN } from "@carbon/auth";
import { redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import { oncePerRead } from "@carbon/logger/middleware.server";
import { companyPlanCacheKey, Edition, isInternalEmail } from "@carbon/utils";
import * as cookie from "cookie";
import { getCarbonServiceRole } from "../lib/supabase/client.server";
import { getCookieDomain } from "../utils/cookie";

const logger = getLogger("auth", "company");

const cookieName = "companyId";
const isTestEdition = CarbonEdition === Edition.Test;
const cookieDomain = isTestEdition ? undefined : getCookieDomain(DOMAIN);
// The same SameSite/Secure rules as the session cookie.
const attributes = {
  domain: cookieDomain,
  sameSite: isTestEdition ? ("none" as const) : ("lax" as const),
  secure: isTestEdition || !!cookieDomain
};

export function getCompanyId(request: Request): string | null {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;
  return cookie.parse(cookieHeader)[cookieName] || null;
}

export function setCompanyId(companyId: string | null) {
  if (!companyId) {
    return cookie.serialize(cookieName, "", {
      path: "/",
      expires: new Date(0),
      ...attributes
    });
  }

  return cookie.serialize(cookieName, companyId, {
    path: "/",
    maxAge: 31536000, // 1 year
    ...attributes
  });
}

// Both plan lookups below run on almost every request, so they are cached in
// Redis and memoized per read request. The Stripe sync clears the plan key when
// it writes a row; the TTL covers every other writer.
const PLAN_CACHE_TTL_SECONDS = 5 * 60;
const carbonOwnedCacheKey = (companyId: string) => `carbonOwned:${companyId}`;

/**
 * The company's `companyPlan.planId`, or null when it has no plan row.
 *
 * Read via service role: `companyPlan`'s SELECT policy needs an authenticated
 * `auth.uid()`, which the anon `carbon-key` API-key client does not have, so a
 * read through the caller's client returns no row for a paying company.
 *
 * A failed read returns null without being cached. Callers treat null as the
 * lowest plan, so a transient failure must not stick for the whole TTL.
 */
export function getCompanyPlanId(companyId: string): Promise<string | null> {
  return oncePerRead(`companyPlan:${companyId}`, () =>
    loadCompanyPlanId(companyId)
  );
}

/**
 * Decodes the cached value: `undefined` is a miss, `null` a cached "no plan row"
 * (stored as ""). Redis being down resolves null, so it reads as a miss.
 */
export function planIdFromCache(
  cached: string | null
): string | null | undefined {
  if (typeof cached !== "string") return undefined;
  return cached || null;
}

async function loadCompanyPlanId(companyId: string): Promise<string | null> {
  const cacheKey = companyPlanCacheKey(companyId);
  const cached = planIdFromCache(await redis.get(cacheKey));
  if (cached !== undefined) return cached;

  const { data, error } = await getCarbonServiceRole()
    .from("companyPlan")
    .select("planId")
    .eq("id", companyId)
    .maybeSingle();

  if (error) {
    logger.error("Failed to read company plan", { companyId, error });
    return null;
  }

  const planId = data?.planId ?? null;
  await redis.set(cacheKey, planId ?? "", "EX", PLAN_CACHE_TTL_SECONDS);
  return planId;
}

/**
 * True when the company's group owner has a Carbon-internal email. These
 * companies get top-tier plan access without billing — the runtime analogue of
 * the `STRIPE_BYPASS_COMPANY_IDS` list, keyed on owner identity instead of a
 * hardcoded id. Use only as a fallback after the normal plan check.
 */
export function isCarbonOwnedCompany(companyId: string): Promise<boolean> {
  return oncePerRead(`carbonOwned:${companyId}`, () =>
    loadIsCarbonOwnedCompany(companyId)
  );
}

async function loadIsCarbonOwnedCompany(companyId: string): Promise<boolean> {
  const cacheKey = carbonOwnedCacheKey(companyId);
  const cached = await redis.get(cacheKey);
  if (cached === "1" || cached === "0") return cached === "1";

  const client = getCarbonServiceRole();

  const company = await client
    .from("company")
    .select("companyGroup(ownerId)")
    .eq("id", companyId)
    .maybeSingle();
  if (company.error) {
    logger.error("Failed to read company owner", {
      companyId,
      error: company.error
    });
    return false;
  }

  let owned = false;
  const ownerId = company.data?.companyGroup?.ownerId;
  if (ownerId) {
    const owner = await client
      .from("user")
      .select("email")
      .eq("id", ownerId)
      .maybeSingle();
    if (owner.error) {
      logger.error("Failed to read company owner email", {
        companyId,
        error: owner.error
      });
      return false;
    }
    owned = isInternalEmail(owner.data?.email);
  }

  await redis.set(cacheKey, owned ? "1" : "0", "EX", PLAN_CACHE_TTL_SECONDS);
  return owned;
}
