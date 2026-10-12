// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

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

// Token refresh, OAuth callback, settings save, the webhook's company id and
// the panel's Fields save share the metadata column, so each patch names only
// its own keys and goes through `patchIntegrationState` (a row lock).

const SETTINGS_PATHS: Record<OnshapeOAuthIntegrationId, readonly string[]> = {
  [ONSHAPE_INTEGRATION_ID]: ["assetSyncEnabled"],
  [ONSHAPE_GOVERNMENT_INTEGRATION_ID]: [
    "baseUrl",
    "clientId",
    "assetSyncEnabled"
  ],
  // The panel's Fields save owns its keys.
  [ONSHAPE_V2_INTEGRATION_ID]: []
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
  // A response without a refresh token keeps the stored one.
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
 * Drops the cached Onshape company so it is re-resolved from the new token. A
 * grant without write scope turns asset sync off: a refresh cannot widen it.
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
