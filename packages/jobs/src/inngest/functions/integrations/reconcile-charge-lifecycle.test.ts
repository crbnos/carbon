// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The reconcile half of a card void. The syncer half (delete remotely, mark
// the mapping voided only on confirmed deletion) is pinned by the Xero and
// QuickBooks charge tests in @carbon/ee.
import { resolvePostingSyncSettings } from "@carbon/ee/accounting";
import { asCarbonOwnedSettings } from "@carbon/ee/sync";
import { describe, expect, it } from "vitest";
import {
  computeReconcileDecision,
  type ReconcileEntityInput
} from "./reconcile";
import { providerSupportsNativeVoid } from "./reconcile-executor";

describe("providerSupportsNativeVoid", () => {
  it.each([
    ["charge", "xero", true],
    ["charge", "quickbooks", true],
    ["charge", "rillet", true],
    // Invoices and bills fall back to the default set: Rillet only.
    ["invoice", "xero", false],
    ["invoice", "rillet", true]
  ] as const)("%s on %s: %s", (entityType, providerId, expected) => {
    expect(providerSupportsNativeVoid(entityType, providerId)).toBe(expected);
  });
});

describe("a voided card charge", () => {
  function voidedCharge(
    overrides: Partial<ReconcileEntityInput>
  ): ReconcileEntityInput {
    return {
      entityType: "charge",
      entityId: "charge-1",
      snapshot: { status: "Voided" },
      hasMappingWithExternalId: true,
      hasUnvoidedPushMapping: true,
      lastSyncedAt: "2026-09-10T00:00:00Z",
      hasLiveOperation: false,
      latestOperation: {
        id: "op-push",
        status: "Completed",
        errorCode: null,
        attemptCount: 1,
        createdAt: "2026-09-09T10:00:00Z"
      },
      context: {
        journalEntryPushEnabled: true,
        entityPushEnabled: true,
        providerSupportsPaymentPush: true,
        providerSupportsNativeVoid: true,
        settings: asCarbonOwnedSettings(
          resolvePostingSyncSettings({
            settings: { postingSync: { enabled: true } }
          })
        ),
        docSync: {
          invoiceEnabled: true,
          billEnabled: true,
          chargeEnabled: true,
          chargeCreditEnabled: false
        },
        inventoryAdjustmentEnabled: false,
        paymentFamily: null
      },
      ...overrides
    };
  }

  it("enqueues a void while its push mapping is not yet voided", () => {
    expect(computeReconcileDecision(voidedCharge({})).actions).toEqual([
      {
        kind: "enqueue",
        request: expect.objectContaining({
          entityType: "charge",
          entityId: "charge-1"
        })
      }
    ]);
  });

  it("does nothing once the mapping records the confirmed deletion", () => {
    expect(
      computeReconcileDecision(
        voidedCharge({ hasUnvoidedPushMapping: false })
      ).actions.map((action) => action.kind)
    ).toEqual(["nothing"]);
  });
});
