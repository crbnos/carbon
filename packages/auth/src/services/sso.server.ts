import type { Database } from "@carbon/database";
import {
  getAppUrl,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL
} from "@carbon/env";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { decodeJwt } from "jose";

const log = getLogger("auth");

type SsoProviderArgs = {
  metadataUrl?: string;
  metadataXml?: string;
  domains: string[];
};

type SsoResult<T> = { data: T; error: null } | { data: null; error: string };

// Provider registration goes through the GoTrue admin SSO API — providers are
// registered per GoTrue instance, at runtime, with the service-role key. The
// body is `{ type: "saml", metadata_url?, metadata_xml?, domains }`. The
// app-side company binding lives in the "ssoConnection" table — these wrappers
// only manage the provider side.
const adminSsoUrl = (path = "") =>
  `${SUPABASE_URL}/auth/v1/admin/sso/providers${path}`;

async function ssoProviderRequest<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: Record<string, unknown>
): Promise<SsoResult<T>> {
  const url = adminSsoUrl(path);
  const headers: Record<string, string> = {
    apikey: SUPABASE_SERVICE_ROLE_KEY ?? "",
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json"
  };

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      let message = response.statusText;
      try {
        const payload = await response.json();
        message = payload?.msg ?? payload?.message ?? payload?.error ?? message;
      } catch {
        // non-JSON error body — keep statusText
      }
      log.error("SSO provider request failed", {
        method,
        path,
        status: response.status,
        message
      });
      return { data: null, error: message };
    }

    return { data: (await response.json()) as T, error: null };
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "SSO provider request failed";
    log.error("SSO provider request threw", {
      method,
      path,
      message
    });
    return { data: null, error: message };
  }
}

function toProviderBody(args: SsoProviderArgs) {
  return {
    type: "saml",
    ...(args.metadataUrl ? { metadata_url: args.metadataUrl } : {}),
    ...(args.metadataXml ? { metadata_xml: args.metadataXml } : {}),
    domains: args.domains
  };
}

export async function createGoTrueSsoProvider(
  args: SsoProviderArgs
): Promise<SsoResult<{ id: string }>> {
  const result = await ssoProviderRequest<{ id: string }>(
    "POST",
    "",
    toProviderBody(args)
  );
  if (result.error === null && !result.data?.id) {
    return { data: null, error: "SSO backend did not return a provider id" };
  }
  return result;
}

export async function updateGoTrueSsoProvider(
  providerId: string,
  args: SsoProviderArgs
): Promise<SsoResult<{ id: string }>> {
  return ssoProviderRequest<{ id: string }>(
    "PUT",
    `/${providerId}`,
    toProviderBody(args)
  );
}

export async function deleteGoTrueSsoProvider(
  providerId: string
): Promise<SsoResult<{ id: string }>> {
  return ssoProviderRequest<{ id: string }>("DELETE", `/${providerId}`);
}

export async function getGoTrueSsoProvider(
  providerId: string
): Promise<SsoResult<{ id: string; domains?: { domain: string }[] }>> {
  return ssoProviderRequest<{ id: string; domains?: { domain: string }[] }>(
    "GET",
    `/${providerId}`
  );
}

/**
 * The SAML Service Provider URLs an IdP admin registers for this deployment.
 *
 * The URLs are un-prefixed on purpose: GoTrue self-declares its SP entityID
 * and ACS from API_EXTERNAL_URL (no /auth/v1 prefix) and validates each
 * assertion's Destination against that exact URL — Kong routes /sso/ for this
 * (kong.yml auth-v1-sso).
 */
export function getSamlSpUrls(): { acsUrl: string; metadataUrl: string } {
  const base = `${SUPABASE_URL}/sso/saml`;
  return { acsUrl: `${base}/acs`, metadataUrl: `${base}/metadata` };
}

// --- "ssoConnection" lookups ----------------------------------------------
// The one copy shared by ERP, MES, and jobs — domain and provider routing must
// answer identically at every enforcement point, so none of them keeps its own.

export async function getSsoConnectionByDomain(
  client: SupabaseClient<Database>,
  domain: string
) {
  return client
    .from("ssoConnection")
    .select("*")
    .contains("domains", [domain.toLowerCase()])
    .eq("active", true)
    .maybeSingle();
}

export async function getSsoConnectionByProviderId(
  client: SupabaseClient<Database>,
  providerId: string
) {
  return client
    .from("ssoConnection")
    .select("*")
    .eq("providerId", providerId)
    .eq("active", true)
    .maybeSingle();
}

/**
 * Pre-auth enforcement helper: TRUE only when the email's domain is covered by
 * an ACTIVE connection whose "Require SSO" toggle is on. Callers refuse magic
 * link, OAuth, and passkey logins server-side when this returns true.
 */
export async function isSsoRequiredForEmail(
  client: SupabaseClient<Database>,
  email: string
) {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;

  const connection = await getSsoConnectionByDomain(client, domain);
  return connection.data?.requireSso === true;
}

/**
 * SSO-aware invite link. When the invitee's email domain belongs to an active
 * SSO connection, the invite email points at the login page (prefilled email;
 * the SSO callback consumes the pending invite — the code is not needed in the
 * URL). Otherwise it points at the ordinary code-based invite route.
 */
export async function getSsoAwareInviteLink(
  client: SupabaseClient<Database>,
  email: string,
  code: string
): Promise<string> {
  const domain = email.split("@")[1];
  if (domain) {
    const ssoConnection = await getSsoConnectionByDomain(client, domain);
    if (ssoConnection.data) {
      return `${getAppUrl()}/login?email=${encodeURIComponent(email)}`;
    }
  }
  return `${getAppUrl()}/invite/${code}`;
}

/**
 * The SSO provider id from a user's IDENTITY LIST, or null when no SSO identity
 * exists. GoTrue records SAML identities with provider "sso:<providerId>"; the
 * same value appears on app_metadata.provider for SSO-only users.
 *
 * WARNING: this answers "does this user HAVE an SSO identity", NOT "did this
 * session authenticate via SSO". Once an account is linked, its permanent
 * "sso:" identity makes every login — including Google OAuth and magic link —
 * look like SSO through this lens. Session classification (Require SSO
 * enforcement, MFA skip) must use getSsoProviderIdFromSession, which reads the
 * session's own `amr` claim.
 */
export function getSsoProviderIdFromUser(user: User): string | null {
  for (const identity of user.identities ?? []) {
    if (identity.provider?.startsWith("sso:")) {
      return identity.provider.slice("sso:".length);
    }
  }
  const provider = user.app_metadata?.provider;
  if (typeof provider === "string" && provider.startsWith("sso:")) {
    return provider.slice("sso:".length);
  }
  return null;
}

/**
 * The SSO provider id for THIS SESSION, or null when the session did not
 * authenticate via SAML — regardless of what identities the user has linked.
 *
 * Classification comes from the session JWT's `amr` claim (GoTrue: an array of
 * `{ method, timestamp }`; a SAML login carries `method: "sso/saml"`). Only
 * when the session is genuinely SAML-authenticated is the provider id resolved
 * from the user's identity list. A linked account's Google/magic-link login has
 * the "sso:" identity but no "sso/saml" amr entry, and correctly returns null.
 *
 * The token is decoded WITHOUT verification: it was just minted for us by
 * GoTrue via the service role, so its integrity is not in question here — only
 * its claims are read. Defensive failures (undecodable token, missing amr)
 * return null, failing CLOSED toward the non-SSO path where Require SSO
 * enforcement lives.
 */
export function getSsoProviderIdFromSession(
  accessToken: string,
  user: User
): string | null {
  let payload: Record<string, unknown>;
  try {
    payload = decodeJwt(accessToken);
  } catch {
    log.info(
      "SSO session check: access token could not be decoded; treating session as non-SSO"
    );
    return null;
  }

  const amr = payload.amr;
  if (!Array.isArray(amr)) {
    // Unexpected on GoTrue v2.189 — a genuine SAML login always carries amr.
    log.info(
      "SSO session check: amr claim missing from access token; treating session as non-SSO"
    );
    return null;
  }

  const isSamlSession = amr.some(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { method?: unknown }).method === "sso/saml"
  );
  if (!isSamlSession) return null;

  return getSsoProviderIdFromUser(user);
}
