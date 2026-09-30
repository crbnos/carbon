import type { Database, Json } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { patchIntegrationState } from "../../integrations/secrets";
import {
  ONSHAPE_GOVERNMENT_INTEGRATION_ID,
  ONSHAPE_INTEGRATION_ID
} from "./connection";
import {
  ONSHAPE_V2_INTEGRATION_ID,
  type OnshapeOAuthIntegrationId
} from "./integration-id";

/**
 * Writes to an Onshape integration row, one owner per key.
 *
 * Three writers share the metadata column: the token refresh, the OAuth
 * callback and the settings save, plus the panel's property map. Each used to
 * write the whole column back from a copy read earlier, so whichever landed
 * last reverted the others. Every write here names only the keys it owns and
 * goes through `patchIntegrationState`, which applies it under a row lock.
 */

/** The keys each integration's settings form owns. Secrets are listed apart. */
const SETTINGS_PATHS: Record<OnshapeOAuthIntegrationId, readonly string[]> = {
  [ONSHAPE_INTEGRATION_ID]: ["assetSyncEnabled"],
  [ONSHAPE_GOVERNMENT_INTEGRATION_ID]: [
    "baseUrl",
    "clientId",
    "assetSyncEnabled"
  ],
  [ONSHAPE_V2_INTEGRATION_ID]: [
    "defaultReplenishmentSystem",
    "defaultMethodTypeForMake",
    "defaultMethodTypeForBuy",
    "defaultItemTrackingType",
    "defaultUnitOfMeasureCode"
  ]
};

const SETTINGS_SECRET_PATHS: Partial<
  Record<OnshapeOAuthIntegrationId, readonly string[]>
> = {
  [ONSHAPE_GOVERNMENT_INTEGRATION_ID]: ["clientSecret"]
};

export function isOnshapeOAuthIntegrationId(
  value: unknown
): value is OnshapeOAuthIntegrationId {
  return typeof value === "string" && Object.hasOwn(SETTINGS_PATHS, value);
}

export function onshapeSettingsPatch(
  integrationId: OnshapeOAuthIntegrationId,
  metadata: Record<string, unknown>
) {
  const patch: Record<string, Json> = {};
  const removeMetadata: string[] = [];
  for (const path of SETTINGS_PATHS[integrationId]) {
    if (!Object.hasOwn(metadata, path)) continue;
    const value = metadata[path];
    if (value === undefined || value === null || value === "") {
      removeMetadata.push(path);
    } else {
      patch[path] = value as Json;
    }
  }

  // An empty secret field means "keep the vaulted value".
  const secrets: Record<string, Json> = {};
  for (const path of SETTINGS_SECRET_PATHS[integrationId] ?? []) {
    const value = metadata[path];
    if (typeof value === "string" && value.trim().length > 0) {
      secrets[path] = value;
    }
  }

  return { metadata: patch, removeMetadata, secrets };
}

/** The settings save: only the fields the integration's form declares. */
export async function patchOnshapeSettings(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  integrationId: OnshapeOAuthIntegrationId,
  args: {
    metadata: Record<string, unknown>;
    active?: boolean;
    updatedBy?: string;
  }
) {
  return patchIntegrationState(serviceRole, companyId, integrationId, {
    ...onshapeSettingsPatch(integrationId, args.metadata),
    active: args.active,
    updatedBy: args.updatedBy
  });
}

export type OnshapeTokenSet = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: string;
};

export function onshapeTokenPatch(tokens: OnshapeTokenSet) {
  const secrets: Record<string, Json> = {
    "credentials.accessToken": tokens.accessToken
  };
  // Onshape rotates refresh tokens; a response without one leaves the stored
  // token in place rather than erasing it.
  if (tokens.refreshToken) {
    secrets["credentials.refreshToken"] = tokens.refreshToken;
  }
  return {
    metadata: {
      "credentials.type": "oauth2",
      "credentials.expiresAt": tokens.expiresAt
    } as Record<string, Json>,
    secrets
  };
}

/** A token refresh owns the token pair and its expiry, nothing else. */
export async function patchOnshapeRefreshedTokens(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  integrationId: OnshapeOAuthIntegrationId,
  tokens: OnshapeTokenSet
) {
  return patchIntegrationState(
    serviceRole,
    companyId,
    integrationId,
    onshapeTokenPatch(tokens)
  );
}

export type OnshapeGrant = OnshapeTokenSet & {
  scope: string;
  baseUrl: string;
  canWrite: boolean;
  updatedBy: string;
};

/**
 * A completed authorization owns the grant: tokens, scope and host. The Onshape
 * company is re-resolved from the new token, so the cached one is dropped. A
 * grant without write scope turns asset sync off, because a refresh can never
 * widen it.
 */
export function onshapeGrantPatch(grant: OnshapeGrant) {
  const tokens = onshapeTokenPatch(grant);
  return {
    metadata: {
      ...tokens.metadata,
      scope: grant.scope,
      baseUrl: grant.baseUrl,
      ...(grant.canWrite ? {} : { assetSyncEnabled: false })
    } as Record<string, Json>,
    secrets: tokens.secrets,
    removeMetadata: ["onshapeCompanyId"],
    // A new grant never inherits the previous grant's refresh token.
    removeSecrets: grant.refreshToken ? [] : ["credentials.refreshToken"],
    active: true,
    updatedBy: grant.updatedBy
  };
}

export async function patchOnshapeOAuthGrant(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  integrationId: OnshapeOAuthIntegrationId,
  grant: OnshapeGrant
) {
  return patchIntegrationState(
    serviceRole,
    companyId,
    integrationId,
    onshapeGrantPatch(grant)
  );
}

/** The Onshape company a sync connection's webhook and jobs target. */
export async function patchOnshapeCompanyId(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  integrationId: OnshapeOAuthIntegrationId,
  onshapeCompanyId: string
) {
  return patchIntegrationState(serviceRole, companyId, integrationId, {
    metadata: { onshapeCompanyId }
  });
}
