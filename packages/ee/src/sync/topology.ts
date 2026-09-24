/**
 * One resolved answer to "what is this company's integration landscape?".
 *
 * Before this, every consumer re-derived it: `Object.values(ProviderID)` in the
 * accounting sweeps, `ACCOUNTING_SYNC_INTEGRATION_IDS` in the ERP service, an
 * inline id array in the accounting layout, `category === "Accounting"` in the
 * settings route, and `.eq("id","ramp")` in the Ramp sweep. Replacing five
 * ad-hoc lookups with four new ones would be a rename, not an abstraction — so
 * this is ONE object, resolved once and threaded down.
 *
 * Consumers ask about roles and ownership. Nothing asks "is Rillet installed".
 */

import {
  type LedgerFamilyKey,
  type ResolvedCapabilities,
  resolveCapabilities,
  type SyncProviderCapabilities
} from "./capabilities";

/** An integration's behavioural role. Mirrors `IntegrationConfig.providerRole`. */
export type ProviderRole = "accounting" | "spend";

/**
 * The registry slice this core needs, INJECTED rather than imported.
 *
 * `packages/ee/src/index.ts` cannot be imported here: it pulls every descriptor,
 * one of which reaches `@carbon/auth`, which validates the full server env at
 * import time — so importing it would make this untestable and would boot env in
 * every consumer. The caller already holds the registry; it passes the slice in.
 */
export type ProviderDescriptor = {
  integrationId: string;
  role: ProviderRole;
  capabilities?: SyncProviderCapabilities;
};

/** Who posts a GL family: Carbon, or an external system that owns it. */
export type LedgerOwner =
  | { kind: "carbon" }
  | { kind: "external"; integrationId: string };

/** Whose identifiers an outbound target expects on the wire. */
export type IdentityScope =
  | { kind: "carbon" }
  | { kind: "delegated"; toIntegrationId: string };

export type InstalledProvider = {
  integrationId: string;
  capabilities: ResolvedCapabilities;
};

/** Every ownable family — the keys of `postingSync.families`. */
export const LEDGER_FAMILY_KEYS: readonly LedgerFamilyKey[] = [
  "ar",
  "ap",
  "creditMemo",
  "vendorCredit"
];

export type IntegrationTopology = {
  accounting: InstalledProvider | null;
  spend: InstalledProvider | null;
  /** Derived, never stored. */
  ledgerOwnership: Record<LedgerFamilyKey, LedgerOwner>;
  /** Derived, never stored. */
  identityScope: (targetIntegrationId: string) => IdentityScope;
};

/** The shape `resolveIntegrationTopology` needs from an integration row. */
export type CompanyIntegrationRow = {
  id: string;
  active?: boolean | null;
};

const CARBON: LedgerOwner = { kind: "carbon" };

function pickActive(
  rows: readonly CompanyIntegrationRow[],
  descriptors: readonly ProviderDescriptor[],
  role: ProviderRole
): InstalledProvider | null {
  const byId = new Map(
    descriptors.filter((d) => d.role === role).map((d) => [d.integrationId, d])
  );
  // The `companyIntegration_single_active_role` trigger guarantees at most one,
  // so taking the first is not a tiebreak — it is the only one there can be.
  const row = rows.find((r) => r.active === true && byId.has(r.id));
  if (!row) return null;
  return {
    integrationId: row.id,
    capabilities: resolveCapabilities(byId.get(row.id)?.capabilities)
  };
}

/**
 * Build the topology from already-loaded integration rows plus the registry
 * slice. Pure: no database, no env, no barrel import.
 */
export function buildIntegrationTopology(
  rows: readonly CompanyIntegrationRow[],
  descriptors: readonly ProviderDescriptor[]
): IntegrationTopology {
  const accounting = pickActive(rows, descriptors, "accounting");
  const spend = pickActive(rows, descriptors, "spend");

  // Ledger ownership. A family is external only when the installed spend
  // integration's mode declares it. Nothing declares any today, so every family
  // resolves to Carbon and behaviour is unchanged — that is the point of this
  // slice. Push-only mode is what first populates ownsLedgerFamilies.
  const owned = new Set(spend?.capabilities.ownsLedgerFamilies ?? []);
  const ledgerOwnership = Object.fromEntries(
    LEDGER_FAMILY_KEYS.map((family) => [
      family,
      owned.has(family) && spend
        ? ({ kind: "external", integrationId: spend.integrationId } as const)
        : CARBON
    ])
  ) as Record<LedgerFamilyKey, LedgerOwner>;

  /**
   * Identity scope is keyed on CODING AUTHORITY, not on ledger ownership.
   *
   * The two coincide for a push-only spend platform, but they answer different
   * questions: "whose identifiers does this target expect?" is settled by who
   * owns the target's coding surface, while ledgerOwnership settles "who posts
   * this GL family". A partner role that pushes coding while the GL posts AP
   * externally — the Brex/Coupa shape — breaks under the conflated rule.
   */
  const identityScope = (targetIntegrationId: string): IdentityScope => {
    if (
      spend &&
      accounting &&
      targetIntegrationId === spend.integrationId &&
      spend.capabilities.ownsRemoteCodingSurface === false
    ) {
      return { kind: "delegated", toIntegrationId: accounting.integrationId };
    }
    return { kind: "carbon" };
  };

  return { accounting, spend, ledgerOwnership, identityScope };
}

/** True when any family is posted by something other than Carbon. */
export function hasDelegatedLedgerFamily(
  topology: IntegrationTopology
): boolean {
  return Object.values(topology.ledgerOwnership).some(
    (owner) => owner.kind === "external"
  );
}
