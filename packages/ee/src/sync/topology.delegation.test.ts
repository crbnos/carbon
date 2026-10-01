// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { DEFAULT_SYNC_CONFIG } from "../accounting/core/models";
import { resolvePostingSyncSettings } from "../accounting/core/posting";
import { RAMP_MODE_PROFILES } from "../ramp/lib/modes";
import { applyLedgerDelegation } from "./delegation";
import { buildIntegrationTopology } from "./topology";

/**
 * End-to-end proof that a push-only spend install delegates AP — through the
 * real descriptor resolver and the real POSTING_POLICY derivation, not a
 * hand-built topology.
 *
 * Slice 2 built the derivation and left it dormant because nothing declared
 * `ownsLedgerFamilies`. Push-only mode is what first declares it, so this is the
 * first test that can observe the whole chain.
 */
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

    expect(settings.families.ap).toBe("none");
    expect(delegated).toEqual([{ family: "ap", integrationId: "ramp" }]);

    // AR is untouched — Carbon still owns customer invoicing, and its payment
    // sync-back must keep working while AP stops.
    expect(settings.families.ar).toBe(
      resolvePostingSyncSettings({}).families.ar
    );

    // The backing entity moves WITH the family. Each half alone is wrong:
    // families-only leaves the bill still pushing; entity-only parks a
    // DOC_SYNC_DISABLED warning forever.
    expect(syncConfig.entities.bill.enabled).toBe(false);
  });

  it("derives the backing entity from POSTING_POLICY, not a hard-coded 'bill'", () => {
    const { syncConfig } = delegate("push-only");

    // `reimbursement` is also an AP-family document, so it must move too — that
    // is only true if the derivation reads POSTING_POLICY.
    expect(syncConfig.entities.reimbursement.enabled).toBe(false);
  });

  it("does NOT disable payment", () => {
    // `Payment` is a per-line family: disabling it wholesale would break the AR
    // side, which push-only explicitly keeps.
    const { syncConfig } = delegate("push-only");
    expect(syncConfig.entities.payment.enabled).toBe(
      DEFAULT_SYNC_CONFIG.entities.payment.enabled
    );
  });

  it("delegates nothing in provider mode", () => {
    const { settings, syncConfig, delegated } = delegate("provider");

    expect(delegated).toEqual([]);
    expect(settings.families.ap).toBe(
      resolvePostingSyncSettings({}).families.ap
    );
    expect(syncConfig.entities.bill.enabled).toBe(
      DEFAULT_SYNC_CONFIG.entities.bill.enabled
    );
  });

  it("treats an install with no stored mode as provider", () => {
    // Every install that predates modes must be untouched.
    expect(delegate(undefined).delegated).toEqual([]);
  });

  it("marks the settings as delegation-applied", () => {
    // The branded type is what stops a posting decision being made from raw
    // settings — `getJournalPostingPolicyDecision` accepts only these.
    expect(delegate("push-only").settings.ledgerDelegationApplied).toBe(true);
  });
});
