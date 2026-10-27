// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { RampIntegrationMetadata } from "./models";
import { rampOwnsCodingSurface } from "./modes";

/**
 * What `convergeRamp` does for one install, decided from its stored metadata.
 * Subscriptions and the webhook always converge, so they are not in the plan.
 */
export type RampConvergencePlan = {
  /** Create Ramp's accounting connection (an `accounting:write` call). */
  claimConnection: boolean;
  /** Re-read which other system holds the seat. */
  refreshConnectionOwner: boolean;
  /** Entity to check against the business before anything is pushed. */
  validateEntityId: string | null;
  /** Push chart of accounts, cost centers and projects. */
  pushCodingMasters: boolean;
  launchSync: boolean;
};

export function planRampConvergence(
  metadata: Pick<
    RampIntegrationMetadata,
    "syncMode" | "cardLiabilityAccountId" | "entityId"
  >
): RampConvergencePlan {
  // Only the seat-holder may write accounting masters: in push-only another
  // system holds Ramp's single accounting connection.
  const owns = rampOwnsCodingSurface(metadata);
  // The seat-holder posts card journals against this account, so nothing is
  // pushed or synced until it is mapped. Push-only posts no card journal.
  const ready = !owns || Boolean(metadata.cardLiabilityAccountId);
  return {
    claimConnection: owns,
    refreshConnectionOwner: !owns,
    validateEntityId: ready ? (metadata.entityId ?? null) : null,
    pushCodingMasters: owns && ready,
    launchSync: ready
  };
}

/** Extract entity ids from Ramp's `{ data }`, `{ entities }`, or bare-array shape. */
export function extractEntityIds(response: unknown): Set<string> {
  let rows: unknown[] = [];
  if (Array.isArray(response)) {
    rows = response;
  } else if (response && typeof response === "object") {
    const value = response as { data?: unknown; entities?: unknown };
    if (Array.isArray(value.data)) rows = value.data;
    else if (Array.isArray(value.entities)) rows = value.entities;
  }

  return new Set(
    rows.flatMap((row) =>
      row &&
      typeof row === "object" &&
      typeof (row as { id?: unknown }).id === "string"
        ? [(row as { id: string }).id]
        : []
    )
  );
}
