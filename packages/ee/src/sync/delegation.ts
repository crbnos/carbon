/**
 * Applying ledger delegation: when another system posts a GL family, Carbon
 * must stop sending BOTH that family's journals and its backing documents.
 *
 * Each half alone is wrong, which is why this is one derivation rather than two
 * settings a human keeps in sync:
 *
 * - `families[x] = "none"` alone does NOT stop the document push —
 *   `reconcileDocument` never reads `families`, only `entityPushEnabled`.
 * - disabling the entity alone parks a `DOC_SYNC_DISABLED` Warning on every
 *   posted document forever (`posting.ts`), because the policy then sees a
 *   document-represented journal whose backing document does not sync.
 *
 * WHICH entity to disable is derived from `POSTING_POLICY`, never hard-coded.
 * That table already declares each source type's family and backing entity, so
 * delegating `ap` disables `bill` AND `reimbursement` — the latter landed after
 * this rule was written and needed no edit. A version hard-coding `"bill"`
 * would have kept pushing reimbursements to the GL alongside the other
 * system's copy.
 */

import { POSTING_POLICY } from "../accounting/core/models";
import type { PostingSyncSettings } from "../accounting/core/posting";
import type { GlobalSyncConfig } from "../accounting/core/types";
import type { LedgerFamilyKey } from "./capabilities";
import type { IntegrationTopology } from "./topology";

/**
 * `PostingSyncSettings` that have been through {@link applyLedgerDelegation}.
 *
 * The policy decision accepts only this type, so a caller cannot reach a
 * posting decision with raw settings — the compiler is the enforcement, at the
 * one place the decision is made rather than at every place metadata is parsed.
 */
export type EffectivePostingSyncSettings = PostingSyncSettings & {
  readonly ledgerDelegationApplied: true;
};

/**
 * The backing entities of a family, from `POSTING_POLICY`.
 *
 * Two sentinels are skipped, for the same reason: a `per-line` family
 * (`Payment`) is shared between AR and AP and resolved per journal from its
 * control-account lines, and a `per-party` backing entity (the memos) is
 * resolved per record from the memo's party. Disabling either wholesale would
 * break the side that is still Carbon-owned.
 */
export function backingEntitiesOfFamily(
  family: LedgerFamilyKey
): Array<keyof GlobalSyncConfig["entities"]> {
  const entities = new Set<keyof GlobalSyncConfig["entities"]>();

  for (const entry of Object.values(POSTING_POLICY)) {
    const backing = entry.backingEntityType;
    if (!backing || backing === "per-party") continue;

    if (entry.family === "ar" || entry.family === "ap") {
      if (entry.family === family) {
        entities.add(backing as keyof GlobalSyncConfig["entities"]);
      }
      continue;
    }
    // per-line / per-party families resolve per record — never wholesale.
  }

  // The memo families have no static POSTING_POLICY row (their source types are
  // "per-party"), but they DO have their own entities, and delegating one means
  // Carbon stops pushing that document.
  if (family === "creditMemo" || family === "vendorCredit") {
    entities.add(family as keyof GlobalSyncConfig["entities"]);
  }

  return [...entities];
}

export type DelegationResult = {
  settings: EffectivePostingSyncSettings;
  syncConfig: GlobalSyncConfig;
  /** Families this company does not post itself, for messaging. */
  delegated: Array<{ family: LedgerFamilyKey; integrationId: string }>;
};

export function applyLedgerDelegation(args: {
  settings: PostingSyncSettings;
  syncConfig: GlobalSyncConfig;
  topology: IntegrationTopology;
}): DelegationResult {
  const families = { ...args.settings.families };
  const entities = { ...args.syncConfig.entities };
  const delegated: DelegationResult["delegated"] = [];

  for (const [family, owner] of Object.entries(args.topology.ledgerOwnership)) {
    if (owner.kind !== "external") continue;
    const key = family as LedgerFamilyKey;
    delegated.push({ family: key, integrationId: owner.integrationId });

    families[key] = "none";

    for (const entity of backingEntitiesOfFamily(key)) {
      const current = entities[entity];
      if (current) entities[entity] = { ...current, enabled: false };
    }
  }

  return {
    settings: {
      ...args.settings,
      families,
      ledgerDelegationApplied: true
    } as EffectivePostingSyncSettings,
    syncConfig: { entities },
    delegated
  };
}

/**
 * Treat settings as if nothing is delegated.
 *
 * For the SECONDARY gates only — a provider syncer's own
 * `getPostingSyncSourceTypeSkipReason` check, which runs after the primary gate
 * has already decided. A delegated family cannot reach a syncer: its backing
 * entity is disabled, so `reconcileDocument` enqueues nothing, and its journals
 * record `FAMILY_OFF` rather than a push. The syncer is defence-in-depth on a
 * path that is already closed.
 *
 * Never use this where the decision is actually MADE — that is what
 * `applyLedgerDelegation` is for, and the branded type is what stops the two
 * being confused.
 */
export function asCarbonOwnedSettings(
  settings: PostingSyncSettings
): EffectivePostingSyncSettings {
  return { ...settings, ledgerDelegationApplied: true };
}
