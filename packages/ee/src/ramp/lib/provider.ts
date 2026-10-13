// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * Ramp as a sync provider.
 *
 * Satisfies the role-agnostic `SyncProvider` so Ramp's outbound pushes can run
 * on the same event engine, ledger and drain as the accounting providers,
 * instead of the bespoke cursor-paged sweep they used to have.
 *
 * Deliberately NOT a `BaseProvider` subclass: that base carries accounting-shaped
 * machinery (OAuth token refresh hooks shared with the accounting vault path,
 * journal dimension targets, counterpart search) that a spend platform either
 * does differently or does not have. `SyncProvider` is the structural subset the
 * engine actually needs.
 */

import { SpendProviderID } from "../../accounting/core/models";
import type {
  GlobalSyncConfig,
  SyncEntityType,
  SyncProvider
} from "../../accounting/core/types";
import { buildSpendSyncConfig } from "../../spend/sync-config";
import type { SpendInstallMode } from "../../spend/types";
import type { SpendCapabilities } from "../../sync/capabilities";
import type { RampClient } from "./client";
import type { RampIntegrationMetadata } from "./models";
import { resolveRampMode, resolveRampModeProfile } from "./modes";

export class RampProvider implements SyncProvider {
  static id = SpendProviderID.RAMP;

  /**
   * Per install MODE, not per provider — `ownsRemoteCodingSurface` and
   * `ownsLedgerFamilies` are the whole difference between the two, and
   * `ownsLedgerFamilies: ["ap"]` is what activates ledger delegation.
   */
  readonly capabilities: SpendCapabilities;

  /** The stored install mode; `provider` for anything that predates modes. */
  readonly mode: SpendInstallMode;

  private readonly syncConfig: GlobalSyncConfig;
  private readonly configuredEntityId: string | undefined;
  private entityIdPromise: Promise<string | undefined> | undefined;

  /**
   * Whose identifiers Ramp's coding options are keyed by, when they are not
   * Carbon's.
   *
   * Set from the topology's `identityScope` at construction (the only place that
   * can see BOTH installs). Undefined means Carbon holds Ramp's accounting seat
   * and published the options itself, so a Carbon id addresses them directly.
   *
   * Without this a push-only install coded every bill line with a Carbon id that
   * Ramp has never heard of, so the bill arrived UNCODED and had to be coded by
   * hand before the seat-holder could post it — defeating the point of pushing it.
   */
  public readonly codingIdentityIntegrationId?: string;

  constructor(
    public readonly client: RampClient,
    public readonly companyId: string,
    metadata: RampIntegrationMetadata,
    options: { codingIdentityIntegrationId?: string } = {}
  ) {
    this.codingIdentityIntegrationId = options.codingIdentityIntegrationId;
    this.configuredEntityId = metadata.entityId ?? undefined;

    const profile = resolveRampModeProfile(metadata);
    this.mode = resolveRampMode(metadata);
    this.capabilities = profile.capabilities;

    this.syncConfig = buildSpendSyncConfig({
      ceiling: profile.outboundCeiling,
      toggles: {
        purchaseOrder: metadata.sync.pushPurchaseOrders,
        bill: metadata.sync.pushInvoices
      }
    });
  }

  get id(): SpendProviderID.RAMP {
    return SpendProviderID.RAMP;
  }

  getSyncConfig<T extends SyncEntityType>(
    entity: T
  ): GlobalSyncConfig["entities"][T] {
    return this.syncConfig.entities[entity];
  }

  /**
   * Ramp requires an `entity_id` on a purchase-order create. Prefer the
   * configured one; otherwise take the business's first entity, which is the
   * common single-entity case.
   *
   * Memoized on the provider instance, so a drain that pushes fifty POs resolves
   * it once — the same guarantee the old batch loop got by resolving before its
   * loop. A failed lookup is not cached as a failure because the promise itself
   * resolves to `undefined`; the create simply omits the field, exactly as
   * before.
   */
  async resolveEntityId(): Promise<string | undefined> {
    if (this.configuredEntityId) return this.configuredEntityId;
    this.entityIdPromise ??= this.client
      .getEntities<{ data?: Array<{ id?: string }> }>()
      .then((response) => response.data?.[0]?.id)
      .catch(() => undefined);
    return this.entityIdPromise;
  }

  /**
   * A cheap authenticated read. Ramp's install-time check is the OAuth exchange
   * plus `rampHealthcheck`, which additionally requires a card liability
   * account; this answers only "are these credentials live?", which is what the
   * sync engine asks.
   */
  async validate(): Promise<boolean> {
    try {
      await this.client.getBusiness();
      return true;
    } catch {
      return false;
    }
  }
}
