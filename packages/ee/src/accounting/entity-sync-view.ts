import { ENTITY_DEFINITIONS, ProviderID } from "./core/models";
import { resolveSyncConfig } from "./core/service";
import type {
  AccountingEntityType,
  GlobalSyncConfig,
  SystemOfRecord
} from "./core/types";
import { buildQboSyncConfig } from "./providers/quickbooks-online";
import { buildRilletSyncConfig } from "./providers/rillet";
import { buildXeroSyncConfig } from "./providers/xero";

/**
 * The document entities the Source of Truth settings tab exposes. Every
 * other AccountingEntityType (purchaseOrder, salesOrder, payment,
 * inventoryAdjustment, journalEntry, employee) either has no per-record
 * ownership conflict to arbitrate or is unconditionally forced by every
 * provider — these five are the ones a stored `owner` can genuinely decide,
 * capability-permitting.
 */
export const SOURCE_OF_TRUTH_ENTITY_TYPES = [
  "customer",
  "vendor",
  "item",
  "invoice",
  "bill"
] as const satisfies readonly AccountingEntityType[];

export type SourceOfTruthEntityType =
  (typeof SOURCE_OF_TRUTH_ENTITY_TYPES)[number];

export type EntitySyncEntry = {
  entityType: SourceOfTruthEntityType;
  label: string;
  owner: SystemOfRecord;
  /** False when the provider's capability forcing overrides any stored owner. */
  configurable: boolean;
  /** Human explanation of the forced owner. Present only when !configurable. */
  note?: string;
};

type SyncConfigForceFn = (resolved: GlobalSyncConfig) => GlobalSyncConfig;

/**
 * Every provider's capability-forcing function, keyed by ProviderID. An
 * unrecognized providerId (no entry here) has no forcing at all — every
 * entity resolves as configurable, the safe default.
 */
const FORCE_FN_BY_PROVIDER: Partial<Record<string, SyncConfigForceFn>> = {
  [ProviderID.XERO]: buildXeroSyncConfig,
  [ProviderID.QUICKBOOKS]: buildQboSyncConfig,
  [ProviderID.RILLET]: buildRilletSyncConfig
};

const PROVIDER_DISPLAY_NAMES: Partial<Record<string, string>> = {
  [ProviderID.XERO]: "Xero",
  [ProviderID.QUICKBOOKS]: "QuickBooks Online",
  [ProviderID.RILLET]: "Rillet"
};

/**
 * Whether the provider's force function lets a stored `owner` override take
 * effect for `entityType`. Probed structurally rather than hardcoding each
 * provider's forced-entity lists here (which would drift the moment a force
 * function changes): run the force function once with the entity's owner
 * set to "carbon" and once with "accounting" (everything else held from
 * `resolved`) — if the two runs disagree, the force function is passing the
 * owner through (configurable); if they agree, it's forcing a constant
 * regardless of input (not configurable). A single before/after flip isn't
 * enough — when the forced value happens to equal the flipped-to value,
 * that comparison would falsely read as configurable.
 */
function isConfigurable(
  forceFn: SyncConfigForceFn | undefined,
  resolved: GlobalSyncConfig,
  entityType: AccountingEntityType
): boolean {
  if (!forceFn) return true;

  const ownerAfterForcing = (owner: SystemOfRecord): SystemOfRecord => {
    const probe: GlobalSyncConfig = {
      entities: {
        ...resolved.entities,
        [entityType]: { ...resolved.entities[entityType], owner }
      }
    };
    return forceFn(probe).entities[entityType].owner;
  };

  return ownerAfterForcing("carbon") !== ownerAfterForcing("accounting");
}

function forcedOwnerNote(providerId: string, owner: SystemOfRecord): string {
  const providerName = PROVIDER_DISPLAY_NAMES[providerId] ?? providerId;
  return owner === "carbon"
    ? `Synced to ${providerName} — Carbon is the source of truth`
    : `${providerName} is the source of truth — synced back to Carbon`;
}

/**
 * Per-entity Source of Truth view shared by every accounting provider's
 * settings UI: resolve the company's stored sync config
 * (`resolveSyncConfig`), then run the provider's capability-forcing
 * function to get the config actually in effect (`buildXeroSyncConfig` /
 * `buildQboSyncConfig` / `buildRilletSyncConfig`). Replaces Xero's old
 * bespoke customerOwner/vendorOwner/itemOwner/invoiceOwner/billOwner
 * settings fields with a single generic, provider-agnostic computation.
 */
export function getEntitySyncView(
  providerId: string,
  metadata: unknown
): EntitySyncEntry[] {
  const resolved = resolveSyncConfig(metadata);
  const forceFn = FORCE_FN_BY_PROVIDER[providerId];
  const applied = forceFn ? forceFn(resolved) : resolved;

  return SOURCE_OF_TRUTH_ENTITY_TYPES.map((entityType) => {
    const owner = applied.entities[entityType].owner;
    const configurable = isConfigurable(forceFn, resolved, entityType);

    return {
      entityType,
      label: ENTITY_DEFINITIONS[entityType].label,
      owner,
      configurable,
      ...(configurable ? {} : { note: forcedOwnerNote(providerId, owner) })
    };
  });
}
