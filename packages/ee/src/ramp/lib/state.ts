// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database, Json } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type IntegrationStatePatch,
  patchIntegrationState
} from "../../integrations/secrets";
import type { RampCredentials, RampCursors } from "./models";

const RAMP = "ramp";

const RAMP_SETTINGS_PATHS = [
  "entityId",
  "cardLiabilityAccountId",
  "statementBankAccountId",
  "cashbackIncomeAccountId",
  "reimbursementBankAccountId",
  "pullTransactions",
  "pullBills",
  "pullReimbursements",
  "pushPurchaseOrders",
  "pushInvoices"
] as const;

type RampSettingsPath = (typeof RAMP_SETTINGS_PATHS)[number];

function settingsPatch(metadata: Record<string, unknown>) {
  const patch: Record<string, Json | undefined> = {};
  const remove: string[] = [];

  for (const path of RAMP_SETTINGS_PATHS) {
    if (!Object.hasOwn(metadata, path)) continue;
    const value = metadata[path as RampSettingsPath];
    if (value === undefined || value === null || value === "") {
      remove.push(path);
    } else {
      patch[path] = value as Json;
    }
  }

  return { patch, remove };
}

async function patchRampState(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  patch: IntegrationStatePatch
) {
  return patchIntegrationState(serviceRole, companyId, RAMP, patch);
}

/** Settings owns only the flat account/entity/toggle fields declared above. */
export async function patchRampSettings(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  args: {
    metadata: Record<string, unknown>;
    active?: boolean;
    updatedBy?: string;
  }
) {
  const { patch, remove } = settingsPatch(args.metadata);
  return patchRampState(serviceRole, companyId, {
    metadata: patch,
    removeMetadata: remove,
    active: args.active,
    updatedBy: args.updatedBy
  });
}

/** OAuth owns its token set; reconnect also removes obsolete client credentials. */
export async function patchRampOAuthCredentials(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  args: {
    credentials: Extract<RampCredentials, { type: "oauth2" }>;
    updatedBy: string;
    /**
     * The install mode, read off the SIGNED OAuth state. Owned by this patch
     * because it is settled at connect time and never again — it decides which
     * scopes were requested, so a later settings save must not be able to move it.
     */
    syncMode?: string;
    /** What the token response actually granted (RFC 6749 §3.3). */
    grantedScopes?: string[];
    /**
     * Which system holds Ramp's accounting connection. UNDEFINED means unknown,
     * not absent — Carbon may be unable to read it at all (see the open question
     * in `.ai/plans/implemented/2026-09-23-spend-push-only-mode.md`).
     */
    accountingConnectionProvider?: string;
  }
) {
  const { credentials } = args;
  const secrets: Record<string, Json | undefined> = {
    "credentials.accessToken": credentials.accessToken
  };
  const metadata: Record<string, Json | undefined> = {
    "credentials.type": credentials.type,
    "credentials.environment": credentials.environment
  };
  if (args.syncMode) metadata.syncMode = args.syncMode;
  if (args.grantedScopes) metadata.grantedScopes = args.grantedScopes;
  if (args.accountingConnectionProvider) {
    metadata.accountingConnectionProvider = args.accountingConnectionProvider;
  }

  const removeMetadata = ["credentials.clientId"];
  const removeSecrets = ["credentials.clientSecret"];
  if (credentials.expiresAt) {
    metadata["credentials.expiresAt"] = credentials.expiresAt;
  } else {
    removeMetadata.push("credentials.expiresAt");
  }
  if (credentials.refreshToken) {
    secrets["credentials.refreshToken"] = credentials.refreshToken;
  } else {
    removeSecrets.push("credentials.refreshToken");
  }

  return patchRampState(serviceRole, companyId, {
    metadata,
    secrets,
    removeMetadata,
    removeSecrets,
    active: true,
    updatedBy: args.updatedBy
  });
}

/** Refresh does not own or replace the refresh token. */
export async function patchRampRefreshedTokens(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  tokens: { accessToken: string; expiresAt: string }
) {
  return patchRampState(serviceRole, companyId, {
    metadata: { "credentials.expiresAt": tokens.expiresAt },
    secrets: { "credentials.accessToken": tokens.accessToken }
  });
}

export async function patchRampConnection(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  connectionId: string
) {
  return patchRampState(serviceRole, companyId, {
    metadata: { connectionId }
  });
}

export async function patchRampWebhook(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  webhook: { webhookId: string; webhookSecret: string }
) {
  return patchRampState(serviceRole, companyId, {
    metadata: { webhookId: webhook.webhookId },
    secrets: { webhookSecret: webhook.webhookSecret }
  });
}

/**
 * Refresh which system Ramp reports as holding its accounting connection.
 *
 * Unlike the OAuth patch, this one CLEARS the field when nobody is connected.
 * The value was written once at connect and never revisited, so a peer that
 * later disconnected left the details drawer naming it forever — a stored
 * snapshot presented as current fact. Passing `undefined` removes it, which is
 * the honest rendering of "nobody holds the seat".
 *
 * Only call this when the answer is KNOWN. A failed read must leave the previous
 * value alone rather than erase it (see `convergeRamp`).
 */
export async function patchRampAccountingConnectionProvider(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  providerName: string | undefined
) {
  return providerName
    ? patchRampState(serviceRole, companyId, {
        metadata: { accountingConnectionProvider: providerName }
      })
    : patchRampState(serviceRole, companyId, {
        removeMetadata: ["accountingConnectionProvider"]
      });
}

export async function patchRampCursor(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  key: keyof NonNullable<RampCursors>,
  value: string
) {
  return patchRampState(serviceRole, companyId, {
    metadata: { [`cursors.${key}`]: value }
  });
}

export async function clearRampConnectionState(
  serviceRole: SupabaseClient<Database>,
  companyId: string
) {
  return patchRampState(serviceRole, companyId, {
    removeMetadata: ["connectionId", "webhookId"],
    removeSecrets: ["webhookSecret"]
  });
}
