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
  ownsLedgerFamilies: Array<"ar" | "ap" | "creditMemo" | "vendorCredit">
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

function apply(families: Array<"ar" | "ap" | "creditMemo" | "vendorCredit">) {
  return applyLedgerDelegation({
    settings: resolvePostingSyncSettings(null),
    syncConfig: resolveSyncConfig(null),
    topology: buildIntegrationTopology(ROWS, [RILLET, ramp(families)])
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
    for (const family of ["ar", "ap", "creditMemo", "vendorCredit"] as const) {
      expect(backingEntitiesOfFamily(family)).not.toContain(
        "per-party" as never
      );
    }
  });

  it("resolves a memo family to its own entity", () => {
    expect(backingEntitiesOfFamily("creditMemo")).toEqual(["creditMemo"]);
    expect(backingEntitiesOfFamily("vendorCredit")).toEqual(["vendorCredit"]);
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
    const result = apply(["ap", "vendorCredit"]);
    expect(result.delegated).toEqual(
      expect.arrayContaining([
        { family: "ap", integrationId: "ramp" },
        { family: "vendorCredit", integrationId: "ramp" }
      ])
    );
  });

  it("marks the settings as delegation-applied", () => {
    expect(apply([]).settings.ledgerDelegationApplied).toBe(true);
  });
});
