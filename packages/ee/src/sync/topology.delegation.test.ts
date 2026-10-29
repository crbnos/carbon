// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { DEFAULT_SYNC_CONFIG } from "../accounting/core/models";
import { resolvePostingSyncSettings } from "../accounting/core/posting";
import { RAMP_MODE_PROFILES } from "../ramp/lib/modes";
import { applyLedgerDelegation } from "./delegation";
import { buildIntegrationTopology } from "./topology";

// The whole chain: a push-only Ramp install declares that it owns AP, the
// topology resolves it, and delegation turns AP posting off for Carbon.
const DESCRIPTORS = [
  {
    integrationId: "rillet",
    role: "accounting" as const
  },
  {
    integrationId: "ramp",
    role: "spend" as const,
    resolveInstallCapabilities: (metadata: unknown) =>
      RAMP_MODE_PROFILES[
        (metadata as { syncMode?: "provider" | "push-only" })?.syncMode ===
        "push-only"
          ? "push-only"
          : "provider"
      ].capabilities
  }
];

function topologyFor(syncMode: string | undefined) {
  return buildIntegrationTopology(
    [
      { id: "rillet", active: true },
      { id: "ramp", active: true, metadata: syncMode ? { syncMode } : {} }
    ],
    DESCRIPTORS
  );
}

function delegate(syncMode: string | undefined) {
  return applyLedgerDelegation({
    settings: resolvePostingSyncSettings({}),
    syncConfig: DEFAULT_SYNC_CONFIG,
    topology: topologyFor(syncMode)
  });
}

describe("push-only delegates the AP ledger family", () => {
  it("hands AP to the spend platform and leaves AR with Carbon", () => {
    const { settings, syncConfig, delegated } = delegate("push-only");

    expect(delegated).toEqual([{ family: "ap", integrationId: "ramp" }]);
    expect(settings.families.ap).toBe("none");
    expect(settings.families.ar).toBe(
      resolvePostingSyncSettings({}).families.ar
    );
    expect(syncConfig.entities.bill.enabled).toBe(false);
  });

  it.each(["provider", undefined])(
    "delegates nothing when the stored mode is %s",
    (syncMode) => {
      const { settings, syncConfig, delegated } = delegate(syncMode);

      expect(delegated).toEqual([]);
      expect(settings.families).toEqual(
        resolvePostingSyncSettings({}).families
      );
      expect(syncConfig.entities).toEqual(DEFAULT_SYNC_CONFIG.entities);
    }
  );
});
