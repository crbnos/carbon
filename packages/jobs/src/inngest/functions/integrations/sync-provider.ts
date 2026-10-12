// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Resolve any sync provider — accounting or spend — for a company.
 *
 * `event-handler-sync` and the drain used to assume every provider id was an
 * accounting provider (`getAccountingIntegration` + `getProviderIntegration`).
 * Ramp's outbound pushes run on the same engine now, so the resolution branches
 * once, here, on the provider's ROLE rather than on its id — adding a second
 * spend platform means adding a case to `buildSpendProvider`, not touching the
 * event handler.
 */

import type { Database } from "@carbon/database";
import {
  getAccountingIntegration,
  getProviderIntegration,
  ProviderID,
  SpendProviderID,
  type SyncProvider,
  type SyncProviderID
} from "@carbon/ee/accounting";
import { getRampIntegration, RampProvider } from "@carbon/ee/ramp.server";
import { loadIntegrationTopology } from "./topology";
// Side-effect import: registers Ramp's syncers with `SyncFactory` at module
// scope, exactly as importing an accounting provider's barrel does. Without it
// the drain resolves a RampProvider and then finds no registry for it.
import "@carbon/ee/ramp/entities";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ResolvedSyncProvider = {
  provider: SyncProvider;
  /** The `companyIntegration.metadata` the drain needs for consolidation policy. */
  metadata: unknown;
  /** Who the ledger attributes operations to (`companyIntegration.updatedBy`). */
  updatedBy: string | null;
};

function isSpendProvider(providerId: string): providerId is SpendProviderID {
  return (Object.values(SpendProviderID) as string[]).includes(providerId);
}

export function isAccountingProvider(
  providerId: string
): providerId is ProviderID {
  return (Object.values(ProviderID) as string[]).includes(providerId);
}

/**
 * Returns null when the provider id is unknown or the integration is not
 * connected — the caller records that as a skip rather than failing the run.
 */
export async function resolveSyncProvider(
  client: SupabaseClient<Database>,
  companyId: string,
  providerId: SyncProviderID | string
): Promise<ResolvedSyncProvider | null> {
  if (isSpendProvider(providerId)) {
    const integration = await getRampIntegration(client, companyId);
    if (!integration) return null;

    // `getRampIntegration` returns the client and parsed metadata but not the
    // row's audit columns, and the ledger attributes every operation to whoever
    // configured the integration.
    const row = await client
      .from("companyIntegration")
      .select("updatedBy")
      .eq("companyId", companyId)
      .eq("id", providerId)
      .single();

    // Whose identifiers this platform's coding options are keyed by. Resolved
    // HERE because only the topology can see both installs, and only this module
    // may import the `@carbon/ee` barrel the topology needs.
    const topology = await loadIntegrationTopology(client, companyId);
    const scope = topology.identityScope(providerId);

    return {
      provider: new RampProvider(
        integration.client,
        companyId,
        integration.metadata,
        {
          codingIdentityIntegrationId:
            scope.kind === "delegated" ? scope.toIntegrationId : undefined
        }
      ),
      metadata: integration.metadata,
      updatedBy: row.data?.updatedBy ?? null
    };
  }

  if (!isAccountingProvider(providerId)) return null;

  const integration = await getAccountingIntegration(
    client,
    companyId,
    providerId
  );

  return {
    provider: getProviderIntegration(
      client,
      companyId,
      integration.id,
      integration.metadata
    ),
    metadata: integration.metadata,
    updatedBy: integration.updatedBy ?? null
  };
}
