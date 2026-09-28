/**
 * One capability surface for every sync provider, discriminated by role.
 *
 * Deliberately NOT a second vocabulary beside the accounting providers'
 * existing declaration: two shapes would make every future "can this provider
 * do X?" question start with "which kind of provider is it?", which is exactly
 * the branching the provider-role work exists to remove.
 *
 * `externalAddressing` and `searchableCounterparts` sit on the SHARED arm on
 * purpose — a spend platform addresses vendors and coding options by external
 * id exactly as an accounting provider does, and Ramp already implements a
 * counterpart search.
 *
 * What is NOT a capability: per-entity enablement. That is `GlobalSyncConfig`,
 * read through `getSyncConfig`. Two sources of truth for "does this entity
 * sync?" is the defect, not the feature.
 */

import type { ExternalIdentityKind } from "../accounting/core/counterpart-types";

/** Which identifier a provider addresses an entity kind by. */
export type ExternalAddressing = "id" | "code";

type SharedCapabilities = {
  /**
   * How the provider is reached: "rest" = Carbon calls the provider API
   * synchronously; "bridge" = a third-party vendor bridge performs the calls.
   */
  transport: "rest" | "bridge";
  /** Whether the provider can push change notifications to Carbon. */
  supportsWebhooks: boolean;
  /**
   * How this provider addresses each external entity kind — the Rillet/Xero
   * `account_code` vs QBO `AccountRef.value` split. Consumed by the identity
   * resolver; absent kinds fall back to the documented default below.
   */
  externalAddressing?: Partial<
    Record<ExternalIdentityKind, ExternalAddressing>
  >;
  /**
   * Entity kinds this provider can search for an existing counterpart before
   * creating one (`accounting/core/counterpart.ts`). Empty = always create.
   */
  searchableCounterparts?: ExternalIdentityKind[];
  /**
   * Entity kinds this provider can ENUMERATE — every remote record of that
   * kind, for the one-shot master-data import. A different question from
   * `searchableCounterparts`: Xero and QuickBooks can look a name up without
   * being able to hand back the whole book cheaply, and a provider may well
   * enumerate vendors but not items. Empty = the import has nothing to pull.
   */
  importableEntities?: ExternalIdentityKind[];
  /**
   * Party kinds this provider CANNOT create a counterpart for unless the party
   * has BOTH a reachable (emailable) contact AND a location carrying a country
   * — so Carbon should require them at the document boundary rather than
   * discovering the gap at push time.
   *
   * Ramp declares `["supplier"]`. Verified field-by-field against the sandbox on
   * 2026-09-28 (`POST /developer/v1/vendors`): no `country` is
   * `422 {"country": [...]}`, no `business_vendor_contacts` is
   * `422 {"business_vendor_contacts": [...]}`, a contact with no email is
   * `422 {"business_vendor_contacts": {"email": [...]}}`, and `US` with no state
   * is `400 DEVELOPER_7080`. So an incomplete supplier fails EVERY bill, long
   * after the person who could have fixed it moved on.
   *
   * Both facts travel together because the platform needs all of it or none of
   * it: a supplier with a contact but no location fails exactly as hard as one
   * with neither, so a provider cannot meaningfully demand just one.
   *
   * A CAPABILITY rather than a line in one provider's install hook, because the
   * question "does connecting this platform make these mandatory?" is a fact
   * about the platform. A second spend provider declares it and inherits the
   * enforcement; nothing branches on a provider id.
   */
  requiresPartyContactAndLocation?: PartyContactKind[];
};

/** The party kinds a provider can demand a complete record for. */
export type PartyContactKind = "supplier" | "customer";

export type AccountingCapabilities = SharedCapabilities & {
  role: "accounting";
  /** Whether Carbon journals can be pushed as provider journal entries. */
  supportsJournalPush: boolean;
  /**
   * Structural cap on how many dimension slots the provider's journal lines can
   * carry (QBO: 2 — one ClassRef + one DepartmentRef). Absent = no cap.
   */
  maxJournalDimensionSlots?: number;
};

export type SpendCapabilities = SharedCapabilities & {
  role: "spend";
  /**
   * Carbon holds this platform's accounting-connection seat, and therefore owns
   * the coding options it offers. False means another system holds it, and
   * anything Carbon pushes must carry THAT system's identifiers.
   */
  ownsRemoteCodingSurface: boolean;
  /**
   * GL families this platform posts instead of Carbon. Keyed on the
   * `postingSync.families` keys — NOT `PostingSourceFamily`, whose `per-line`
   * and `per-party` members are resolution strategies, not ownable families.
   */
  ownsLedgerFamilies: LedgerFamilyKey[];
};

/** The families a company can delegate: the keys of `postingSync.families`. */
export type LedgerFamilyKey = "ar" | "ap" | "creditMemo" | "supplierCredit";

export type SyncProviderCapabilities =
  | AccountingCapabilities
  | SpendCapabilities;

/**
 * A provider's capabilities with every optional field resolved.
 *
 * Every read goes through here rather than `provider.capabilities?.x`: the
 * declaration is optional, so the raw field answers `undefined` to every
 * question for any provider that has not declared one.
 */
export type ResolvedCapabilities = Required<
  Pick<SharedCapabilities, "transport" | "supportsWebhooks">
> & {
  role: "accounting" | "spend";
  externalAddressing: Partial<Record<ExternalIdentityKind, ExternalAddressing>>;
  searchableCounterparts: ExternalIdentityKind[];
  importableEntities: ExternalIdentityKind[];
  supportsJournalPush: boolean;
  maxJournalDimensionSlots?: number;
  ownsRemoteCodingSurface: boolean;
  ownsLedgerFamilies: LedgerFamilyKey[];
  requiresPartyContactAndLocation: PartyContactKind[];
};

/**
 * The documented defaults an undeclared provider resolves to. `account: "code"`
 * is correct for Xero (`AccountCode`) and Rillet (`account_code`); QBO declares
 * `"id"` explicitly.
 */
export const CAPABILITY_DEFAULTS: ResolvedCapabilities = {
  role: "accounting",
  transport: "rest",
  supportsWebhooks: false,
  supportsJournalPush: true,
  externalAddressing: { account: "code" },
  searchableCounterparts: [],
  importableEntities: [],
  ownsRemoteCodingSurface: true,
  ownsLedgerFamilies: [],
  requiresPartyContactAndLocation: []
};

export function resolveCapabilities(
  declared: SyncProviderCapabilities | undefined
): ResolvedCapabilities {
  if (!declared) return { ...CAPABILITY_DEFAULTS };

  const shared = {
    role: declared.role,
    transport: declared.transport,
    supportsWebhooks: declared.supportsWebhooks,
    externalAddressing: {
      ...CAPABILITY_DEFAULTS.externalAddressing,
      ...(declared.externalAddressing ?? {})
    },
    searchableCounterparts: declared.searchableCounterparts ?? [],
    importableEntities: declared.importableEntities ?? [],
    requiresPartyContactAndLocation:
      declared.requiresPartyContactAndLocation ?? []
  };

  if (declared.role === "spend") {
    return {
      ...shared,
      role: "spend",
      supportsJournalPush: false,
      ownsRemoteCodingSurface: declared.ownsRemoteCodingSurface,
      ownsLedgerFamilies: declared.ownsLedgerFamilies
    };
  }

  return {
    ...shared,
    role: "accounting",
    supportsJournalPush: declared.supportsJournalPush,
    ...(declared.maxJournalDimensionSlots !== undefined
      ? { maxJournalDimensionSlots: declared.maxJournalDimensionSlots }
      : {}),
    ownsRemoteCodingSurface: CAPABILITY_DEFAULTS.ownsRemoteCodingSurface,
    ownsLedgerFamilies: CAPABILITY_DEFAULTS.ownsLedgerFamilies
  };
}
