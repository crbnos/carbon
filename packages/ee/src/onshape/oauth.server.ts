import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { issueOAuthState } from "@carbon/auth/oauth-state.server";
import { resolveIntegrationSecrets } from "../integrations/secrets";
import {
  getConflictingOnshapeIntegration,
  type OnshapeIntegrationId
} from "./lib/connection";
import {
  getOnshapeAuthorizeUrl,
  getOnshapeOAuthConfig,
  type OnshapeOAuthConfig
} from "./lib/oauth";

/**
 * The OAuth client for one of a company's Onshape connections. The public app
 * reads this instance's environment; a Government private app reads the
 * client id, secret and hosts its admin saved in the integration settings (the
 * secret from Vault, so this needs the service role).
 */
export async function loadOnshapeOAuthConfig(
  companyId: string,
  integrationId: OnshapeIntegrationId
): Promise<OnshapeOAuthConfig | null> {
  const serviceRole = getCarbonServiceRole();
  const integration = await serviceRole
    .from("companyIntegration")
    .select("metadata, secretRef")
    .eq("id", integrationId)
    .eq("companyId", companyId)
    .maybeSingle();

  let metadata: Record<string, unknown> = {};
  if (integration.data) {
    try {
      metadata = (await resolveIntegrationSecrets(
        serviceRole,
        companyId,
        integrationId,
        integration.data.metadata,
        integration.data.secretRef
      )) as Record<string, unknown>;
    } catch {
      // No vaulted secret yet: a Government connection is simply not
      // configured, and the public app never needed one to start.
      metadata = (integration.data.metadata ?? {}) as Record<string, unknown>;
    }
  }

  return getOnshapeOAuthConfig(integrationId, metadata);
}

export type OnshapeAuthorizationStart =
  | { ok: true; url: string; cookie: string }
  | { ok: false; reason: "not-configured" | "connection-conflict" };

/**
 * Start the OAuth round trip for an Onshape connection: resolve its client,
 * refuse while the OTHER Onshape connection is active, and issue the state the
 * callback will consume. The state is bound to this browser, user, company and
 * integration — otherwise anyone could hand a victim a callback URL carrying
 * their own Onshape code and link the victim's company to the attacker's
 * account.
 */
export async function beginOnshapeAuthorization(
  request: Request,
  params: {
    integrationId: OnshapeIntegrationId;
    userId: string;
    companyId: string;
  }
): Promise<OnshapeAuthorizationStart> {
  const conflict = await getConflictingOnshapeIntegration(
    getCarbonServiceRole(),
    params.companyId,
    params.integrationId
  );
  if (conflict) return { ok: false, reason: "connection-conflict" };

  const config = await loadOnshapeOAuthConfig(
    params.companyId,
    params.integrationId
  );
  if (!config) return { ok: false, reason: "not-configured" };

  const { state, cookie } = await issueOAuthState(params, request);
  return { ok: true, url: getOnshapeAuthorizeUrl(config, state), cookie };
}
