// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { buildIntegrationTopology } from "@carbon/ee/sync";
import { describe, expect, it } from "vitest";
import { reconcileSyncConfig } from "./reconcile-executor";

const entityConfig = (enabled: boolean) => ({
  enabled,
  direction: "push-to-accounting" as const,
  owner: "carbon" as const
});

/** Whether reconciliation would push a bill, for a plain install holding the accounting seat. */
function billEnabled(
  providerId: string,
  provider?: { getSyncConfig: () => ReturnType<typeof entityConfig> }
) {
  return reconcileSyncConfig({
    topology: buildIntegrationTopology([], []),
    providerId,
    // A spend platform stores its toggles under `sync`, never under
    // `syncConfig`, the only key the metadata resolver reads.
    integrationMetadata: {
      syncMode: "provider",
      sync: { pushPurchaseOrders: false, pushInvoices: false }
    },
    ...(provider ? { provider: provider as never } : {})
  }).syncConfig.entities.bill.enabled;
}

describe("reconcileSyncConfig", () => {
  // Otherwise reconciliation enqueues a push the drain then skips, and the
  // ledger fills with "Sync disabled in config" rows.
  it.each([false, true])(
    "follows a spend provider's own config for a bill (enabled=%s)",
    (enabled) => {
      expect(
        billEnabled("ramp", { getSyncConfig: () => entityConfig(enabled) })
      ).toBe(enabled);
    }
  );

  it("keeps an accounting provider on its metadata-resolved config", () => {
    // getProviderIntegration forces entities for accounting providers that
    // the generic default has off; substituting here would change them.
    expect(
      billEnabled("rillet", { getSyncConfig: () => entityConfig(false) })
    ).toBe(true);
  });

  it("uses the metadata-resolved config when no provider is supplied", () => {
    expect(billEnabled("ramp")).toBe(true);
  });
});
