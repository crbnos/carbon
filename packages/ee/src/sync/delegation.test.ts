// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { resolvePostingSyncSettings } from "../accounting/core/posting";
import { resolveSyncConfig } from "../accounting/core/service";
import { applyLedgerDelegation, backingEntitiesOfFamily } from "./delegation";
import { buildIntegrationTopology, type ProviderDescriptor } from "./topology";

const RILLET: ProviderDescriptor = {
  integrationId: "rillet",
  role: "accounting"
};

function ramp(
  ownsLedgerFamilies: Array<"ar" | "ap" | "creditMemo" | "supplierCredit">
) {
  return {
    integrationId: "ramp",
    role: "spend" as const,
    capabilities: {
      role: "spend" as const,
      transport: "rest" as const,
      supportsWebhooks: true,
      ownsRemoteCodingSurface: false,
      ownsLedgerFamilies
    }
  };
}

const ROWS = [
  { id: "rillet", active: true },
  { id: "ramp", active: true }
];

function apply(
  families: Array<"ar" | "ap" | "creditMemo" | "supplierCredit">,
  integrationId?: string
) {
  return applyLedgerDelegation({
    settings: resolvePostingSyncSettings(null),
    syncConfig: resolveSyncConfig(null),
    topology: buildIntegrationTopology(ROWS, [RILLET, ramp(families)]),
    integrationId
  });
}

describe("backingEntitiesOfFamily", () => {
  it("resolves ap from POSTING_POLICY, not a hard-coded 'bill'", () => {
    const entities = backingEntitiesOfFamily("ap");
    expect(entities).toContain("bill");
    // Reimbursement landed AFTER this rule was written and is picked up with no
    // edit. A version hard-coding "bill" would have kept pushing reimbursements
    // to the GL alongside the other system's copy.
    expect(entities).toContain("reimbursement");
  });

  it("resolves ar to the invoice entity", () => {
    expect(backingEntitiesOfFamily("ar")).toContain("invoice");
  });

  it("never returns the payment entity", () => {
    // Payment is a `per-line` family, resolved per journal from its
    // control-account lines. Disabling it wholesale would break the side that
    // is still Carbon-owned.
    expect(backingEntitiesOfFamily("ap")).not.toContain("payment");
    expect(backingEntitiesOfFamily("ar")).not.toContain("payment");
  });

  it("never returns the per-party sentinel as an entity", () => {
    for (const family of [
      "ar",
      "ap",
      "creditMemo",
      "supplierCredit"
    ] as const) {
      expect(backingEntitiesOfFamily(family)).not.toContain(
        "per-party" as never
      );
    }
  });

  it("resolves a memo family to its own entity", () => {
    expect(backingEntitiesOfFamily("creditMemo")).toEqual(["creditMemo"]);
    expect(backingEntitiesOfFamily("supplierCredit")).toEqual([
      "supplierCredit"
    ]);
  });
});

describe("applyLedgerDelegation", () => {
  it("is a no-op when nothing is delegated", () => {
    const before = resolvePostingSyncSettings(null);
    const result = apply([]);
    expect(result.delegated).toEqual([]);
    expect(result.settings.families).toEqual(before.families);
    expect(result.syncConfig.entities.bill.enabled).toBe(
      resolveSyncConfig(null).entities.bill.enabled
    );
  });

  it("moves BOTH halves for a delegated family", () => {
    // Each alone is wrong: families-only leaves the document pushing, and
    // entity-only parks a DOC_SYNC_DISABLED Warning forever.
    const result = apply(["ap"]);
    expect(result.settings.families.ap).toBe("none");
    expect(result.syncConfig.entities.bill.enabled).toBe(false);
    expect(result.syncConfig.entities.reimbursement.enabled).toBe(false);
  });

  it("leaves the undelegated side untouched", () => {
    const result = apply(["ap"]);
    expect(result.settings.families.ar).toBe("documents");
    expect(result.syncConfig.entities.invoice.enabled).toBe(true);
  });

  it("does not disable the shared payment entity", () => {
    const result = apply(["ap"]);
    expect(result.syncConfig.entities.payment.enabled).toBe(
      resolveSyncConfig(null).entities.payment.enabled
    );
  });

  it("works for AR without any AP-shaped special case", () => {
    const result = apply(["ar"]);
    expect(result.settings.families.ar).toBe("none");
    expect(result.syncConfig.entities.invoice.enabled).toBe(false);
    expect(result.settings.families.ap).toBe("documents");
    expect(result.syncConfig.entities.bill.enabled).toBe(true);
  });

  it("reports what was delegated and to whom", () => {
    const result = apply(["ap", "supplierCredit"]);
    expect(result.delegated).toEqual(
      expect.arrayContaining([
        { family: "ap", integrationId: "ramp" },
        { family: "supplierCredit", integrationId: "ramp" }
      ])
    );
  });

  it("marks the settings as delegation-applied", () => {
    expect(apply([]).settings.ledgerDelegationApplied).toBe(true);
  });
});

describe("the owner of a delegated family keeps it", () => {
  /**
   * Delegation redirects a family TO an integration. Resolving that
   * integration's own configuration must not then switch the family off, or the
   * delegate stops receiving the documents the delegation exists to route to it.
   *
   * Observed live 2026-09-26: with Ramp in push-only (owning `ap`) and Rillet
   * installed, reconciling for RAMP disabled Ramp's own `bill` entity, so no bill
   * operation was ever enqueued — while purchase orders, which belong to no
   * ledger family, pushed normally.
   */
  it("disables the AP entities for everyone EXCEPT ramp", () => {
    // Rillet's config: AP is delegated away, so its bill entity is off.
    expect(apply(["ap"], "rillet").syncConfig.entities.bill?.enabled).toBe(
      false
    );
    // Ramp's own config: it OWNS ap, so its bill entity stays on.
    expect(apply(["ap"], "ramp").syncConfig.entities.bill?.enabled).not.toBe(
      false
    );
  });

  it("omits the owned family from the owner's own delegated list", () => {
    // `delegated` is "families this configuration does not post itself", and the
    // owner DOES post this one — the `continue` that keeps its entities on skips
    // the push as well. Every other integration still sees the delegation, which
    // is what the second assertion holds.
    const asOwner = apply(["ap"], "ramp");
    expect(asOwner.delegated.map((d) => d.family)).not.toContain("ap");
    expect(apply(["ap"], "rillet").delegated).toEqual([
      { family: "ap", integrationId: "ramp" }
    ]);
  });

  it("is unchanged for callers that pass no integration id", () => {
    // Every accounting-provider caller predates this argument and never owns a
    // delegated family, so omitting it must behave exactly as before.
    expect(apply(["ap"]).syncConfig.entities.bill?.enabled).toBe(false);
  });
});
