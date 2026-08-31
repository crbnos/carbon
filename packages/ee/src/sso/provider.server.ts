import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from "@carbon/env";
import { getLogger } from "@carbon/logger";
import { isSsoEnabled } from "./gate";

const log = getLogger("ee");

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
  if (!isSsoEnabled()) {
    return {
      data: null,
      error: "Single sign-on requires Carbon Enterprise edition"
    };
  }

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
      e instanceof Error ? e.message : "SAML SSO provider request failed";
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
    return {
      data: null,
      error: "SAML SSO backend did not return a provider id"
    };
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
