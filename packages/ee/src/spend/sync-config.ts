// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * The sync config a spend-management provider resolves to.
 *
 * Mirrors what `build{Xero,Qbo,Rillet}SyncConfig` do for accounting providers —
 * constrain a config to what this provider actually supports — with one
 * difference that matters: an accounting provider starts from
 * `DEFAULT_SYNC_CONFIG` and turns a few things OFF, because it syncs most of the
 * entity set. A spend platform syncs two or three, so it starts from everything
 * off and turns its own entities ON. Forgetting one entry there is a no-op
 * rather than an accidental push.
 *
 * **Two gates, and the ceiling always wins.** `ceiling` is what the provider's
 * MODE permits at all; `toggles` is what the user asked for. A user cannot
 * toggle on something the mode forbids — which is the whole mechanism push-only
 * mode will rest on in slice 4, where the ceiling stops being a constant.
 */

import { DEFAULT_SYNC_CONFIG } from "../accounting/core/models";
import type {
  GlobalSyncConfig,
  SyncEntityType
} from "../accounting/core/types";

export type SpendEntityCeiling = Partial<Record<SyncEntityType, boolean>>;

export function buildSpendSyncConfig(args: {
  /** Entities this provider's mode permits. A `false` here cannot be raised. */
  ceiling: SpendEntityCeiling;
  /** The company's stored per-entity toggles. Absent = on, subject to the ceiling. */
  toggles?: SpendEntityCeiling;
}): GlobalSyncConfig {
  // Everything off first. `DEFAULT_SYNC_CONFIG` supplies the shape (and keeps a
  // newly added entity type present), never the enablement.
  const entities = Object.fromEntries(
    Object.entries(DEFAULT_SYNC_CONFIG.entities).map(([entityType, config]) => [
      entityType,
      { ...config, enabled: false }
    ])
  ) as GlobalSyncConfig["entities"];

  for (const [entityType, permitted] of Object.entries(args.ceiling)) {
    const key = entityType as SyncEntityType;
    const base = entities[key];
    // An entity the ceiling names but `DEFAULT_SYNC_CONFIG` does not have is
    // dropped rather than invented — the entity union is the source of truth.
    if (!base) continue;

    entities[key] = {
      ...base,
      enabled: permitted === true && (args.toggles?.[key] ?? true),
      // A spend platform is always a downstream mirror of Carbon's documents.
      // Inbound families (cards, reimbursements, bill payments) do not run
      // through this config — they key off the platform's own status feed.
      direction: "push-to-accounting",
      owner: "carbon"
    };
  }

  return { entities };
}
