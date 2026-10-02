// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * What each Ramp install mode permits.
 *
 * The mode is chosen before consent and fixed for the life of the install (see
 * `spend/types.ts`), so everything here is a CEILING: a settings toggle can
 * narrow it but never widen it. Defaulting the toggles off instead would let a
 * later settings save silently re-enable an inbound pull that the mode's scopes
 * do not even cover — and in push-only that would recreate the AP double-count
 * fixed on 2026-09-10.
 */

import type { SpendEntityCeiling } from "../../spend/sync-config";
import {
  DEFAULT_SPEND_INSTALL_MODE,
  isSpendInstallMode,
  type SpendInstallMode
} from "../../spend/types";
import type { SpendCapabilities } from "../../sync/capabilities";
import type { RampIntegrationMetadata } from "./models";

/** Ramp's own vocabulary for the things it sends Carbon. */
export type RampInboundFamily =
  | "transactions"
  | "transfers"
  | "cashbacks"
  | "bills"
  | "billPayments"
  | "reimbursements"
  | "repayments";

const ALL_INBOUND_FAMILIES: readonly RampInboundFamily[] = [
  "transactions",
  "transfers",
  "cashbacks",
  "bills",
  "billPayments",
  "reimbursements",
  "repayments"
];

export type RampModeProfile = {
  capabilities: SpendCapabilities;
  /** Outbound entities this mode may push at all. */
  outboundCeiling: SpendEntityCeiling;
  /** Inbound families this mode may pull at all. */
  inboundCeiling: ReadonlySet<RampInboundFamily>;
};

export const RAMP_MODE_PROFILES: Record<SpendInstallMode, RampModeProfile> = {
  /** Carbon holds Ramp's accounting-connection seat — today's behaviour. */
  provider: {
    capabilities: {
      role: "spend",
      transport: "rest",
      supportsWebhooks: true,
      ownsRemoteCodingSurface: true,
      ownsLedgerFamilies: [],
      // A Ramp spend-vendor create needs a contact email AND a country (plus a
      // state for US), all verified live 2026-09-28. BOTH modes push vendors and
      // bills, so both need it. On the mode profiles rather than beside them
      // because everything else about Ramp's capabilities already lives here.
      requiresPartyContactAndLocation: ["supplier"]
    },
    outboundCeiling: { purchaseOrder: true, bill: true },
    inboundCeiling: new Set(ALL_INBOUND_FAMILIES)
  },

  /**
   * Another system holds the seat. Carbon pushes documents in and takes back
   * only what tells a Carbon invoice it was paid.
   */
  "push-only": {
    capabilities: {
      role: "spend",
      transport: "rest",
      supportsWebhooks: true,
      // Carbon does NOT hold the accounting connection, so the coding options
      // Ramp offers belong to whichever system does — anything Carbon pushes
      // must carry THAT system's identifiers (slice 5).
      ownsRemoteCodingSurface: false,
      // Ramp → the other provider is the GL path for payables, so Carbon stops
      // forwarding AP. `applyLedgerDelegation` turns this into
      // `families.ap = "none"` PLUS disabling AP's backing entities, derived
      // from POSTING_POLICY rather than a hard-coded "bill".
      ownsLedgerFamilies: ["ap"],
      requiresPartyContactAndLocation: ["supplier"]
    },
    outboundCeiling: { purchaseOrder: true, bill: true },
    // Bill payments ONLY. Every other family is the seat-holder's to post, and
    // pulling one here would double-count against the ledger they already own.
    inboundCeiling: new Set<RampInboundFamily>(["billPayments"])
  }
};

/**
 * The stored mode, defaulting to `provider`.
 *
 * An install that predates modes has no `syncMode` and must resolve to today's
 * behaviour — anything else would silently change what an existing customer's
 * integration does.
 */
export function resolveRampMode(
  metadata: Pick<RampIntegrationMetadata, "syncMode">
): SpendInstallMode {
  return isSpendInstallMode(metadata.syncMode)
    ? metadata.syncMode
    : DEFAULT_SPEND_INSTALL_MODE;
}

export function resolveRampModeProfile(
  metadata: Pick<RampIntegrationMetadata, "syncMode">
): RampModeProfile {
  return RAMP_MODE_PROFILES[resolveRampMode(metadata)];
}

/**
 * Whether Carbon holds Ramp's accounting-connection seat.
 *
 * This is the ONE gate behind every call that needs `accounting:write`. Ramp
 * exposes no token-revocation endpoint (confirmed 2026-09-25 against both
 * `llms-api.txt` and the OpenAPI spec — the only disconnect-shaped endpoint is
 * `DELETE /accounting/connection`, which retires the connection, not the grant),
 * so a reinstall CANNOT narrow a previously granted scope set. A push-only
 * install may therefore still HOLD `accounting:write`.
 *
 * The product decision was to accept that stale grant and make "Carbon never
 * USES it" the enforcement instead. That only holds if every write-scope call
 * sits behind this predicate, so keep the list here current:
 *
 * - `POST /accounting/connection`   (ensureRampConnection)
 * - `DELETE /accounting/connection` (uninstall)
 * - `POST /accounting/accounts`     (pushChartOfAccounts)
 * - `POST /accounting/fields`       (pushCostCenters / pushProjects)
 * - `POST /accounting/field-options`(pushCostCenters / pushProjects)
 * - `POST /accounting/syncs`        (confirmSyncs)
 */
export function rampOwnsCodingSurface(
  metadata: Pick<RampIntegrationMetadata, "syncMode">
): boolean {
  return resolveRampModeProfile(metadata).capabilities.ownsRemoteCodingSurface;
}

/**
 * Whether an inbound family runs: the mode's ceiling AND the customer's toggle.
 *
 * The ceiling is checked FIRST and independently — a toggle cannot turn on a
 * family whose scope the install never requested, and a family Ramp would 403 on
 * should not even be attempted.
 *
 * Note the three stored toggles are coarser than the seven families and do not
 * map onto `GlobalSyncConfig` entity types cleanly: transactions, transfers,
 * cashbacks AND repayments all post as `charge`, so routing this through the
 * resolved entities would collapse `pullTransactions` and `pullReimbursements`
 * into one switch. The ceiling is therefore per-FAMILY, in Ramp's own vocabulary.
 */
export function isRampInboundFamilyEnabled(
  family: RampInboundFamily,
  metadata: Pick<RampIntegrationMetadata, "syncMode" | "sync">
): boolean {
  if (!resolveRampModeProfile(metadata).inboundCeiling.has(family)) {
    return false;
  }

  const { sync } = metadata;
  switch (family) {
    case "transactions":
    case "transfers":
    case "cashbacks":
      return sync.pullTransactions;
    case "bills":
    case "billPayments":
      return sync.pullBills;
    case "reimbursements":
    case "repayments":
      return sync.pullReimbursements;
  }
}
