import { CarbonEdition, DOMAIN } from "@carbon/auth";
import { Edition, isInternalEmail } from "@carbon/utils";
import * as cookie from "cookie";
import { getCarbonServiceRole } from "../lib/supabase/client.server";
import { getCookieDomain } from "../utils/cookie";

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

/**
 * True when the company's group owner has a Carbon-internal email. These
 * companies get top-tier plan access without billing — the runtime analogue of
 * the `STRIPE_BYPASS_COMPANY_IDS` list, keyed on owner identity instead of a
 * hardcoded id. Use only as a fallback after the normal plan check, since it
 * hits the database.
 */
export async function isCarbonOwnedCompany(
  companyId: string
): Promise<boolean> {
  const client = getCarbonServiceRole();

  const { data: company } = await client
    .from("company")
    .select("companyGroup(ownerId)")
    .eq("id", companyId)
    .single();

  const ownerId = company?.companyGroup?.ownerId;
  if (!ownerId) return false;

  const { data: owner } = await client
    .from("user")
    .select("email")
    .eq("id", ownerId)
    .single();

  return isInternalEmail(owner?.email);
}
