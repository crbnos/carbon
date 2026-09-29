import type { RampIntegrationMetadata } from "@carbon/ee/ramp.server";
import { describe, expect, it } from "vitest";
import {
  isRampEntityInScope,
  isRampInboundFamilyEnabled,
  type RampInboundFamily,
  rampEntityQuery
} from "./ramp-sync-policy";

const sync: RampIntegrationMetadata["sync"] = {
  pullTransactions: true,
  pullBills: false,
  pullReimbursements: true,
  pushPurchaseOrders: true,
  pushInvoices: true
};

/** Metadata carrying a mode and a toggle set. */
function meta(
  syncMode: RampIntegrationMetadata["syncMode"],
  overrides: Partial<RampIntegrationMetadata["sync"]> = {}
): Pick<RampIntegrationMetadata, "syncMode" | "sync"> {
  return { syncMode, sync: { ...sync, ...overrides } };
}

const ALL_FAMILIES: RampInboundFamily[] = [
  "transactions",
  "transfers",
  "cashbacks",
  "bills",
  "billPayments",
  "reimbursements",
  "repayments"
];

describe("install mode is a ceiling over the toggles", () => {
  it("pulls ONLY bill payments in push-only, whatever the toggles say", () => {
    // Every toggle forced ON: the mode must still refuse six of seven. If a
    // toggle could widen this, a settings save would silently re-enable an
    // inbound pull whose OAuth scope the install never requested — and for AP
    // that recreates the double-count fixed on 2026-09-10.
    const allOn = meta("push-only", {
      pullTransactions: true,
      pullBills: true,
      pullReimbursements: true
    });

    for (const family of ALL_FAMILIES) {
      expect(
        isRampInboundFamilyEnabled(family, allOn),
        `push-only must ${family === "billPayments" ? "allow" : "refuse"} ${family}`
      ).toBe(family === "billPayments");
    }
  });

  it("still lets the toggle narrow inside the push-only ceiling", () => {
    // The ceiling is a maximum, not an override — turning bills off must still
    // stop bill payments.
    expect(
      isRampInboundFamilyEnabled(
        "billPayments",
        meta("push-only", { pullBills: false })
      )
    ).toBe(false);
  });

  it("leaves provider mode exactly as it was", () => {
    const providerMode = meta("provider");
    expect(isRampInboundFamilyEnabled("transactions", providerMode)).toBe(true);
    expect(isRampInboundFamilyEnabled("bills", providerMode)).toBe(false);
    expect(isRampInboundFamilyEnabled("reimbursements", providerMode)).toBe(
      true
    );
  });

  it("treats an install with no stored mode as provider", () => {
    // Every install that predates modes. Resolving it any other way would
    // silently change what an existing customer's integration does.
    for (const family of ALL_FAMILIES) {
      expect(isRampInboundFamilyEnabled(family, meta(undefined))).toBe(
        isRampInboundFamilyEnabled(family, meta("provider"))
      );
    }
  });
});

describe("isRampInboundFamilyEnabled", () => {
  it.each<RampInboundFamily>([
    "transactions",
    "transfers",
    "cashbacks"
  ])("gates %s with pullTransactions", (family) => {
    expect(isRampInboundFamilyEnabled(family, meta("provider"))).toBe(true);
    expect(
      isRampInboundFamilyEnabled(
        family,
        meta("provider", { pullTransactions: false })
      )
    ).toBe(false);
  });

  it.each<RampInboundFamily>([
    "bills",
    "billPayments"
  ])("gates %s with pullBills", (family) => {
    expect(isRampInboundFamilyEnabled(family, meta("provider"))).toBe(false);
    expect(
      isRampInboundFamilyEnabled(family, meta("provider", { pullBills: true }))
    ).toBe(true);
  });

  it.each<RampInboundFamily>([
    "reimbursements",
    "repayments"
  ])("gates %s with pullReimbursements", (family) => {
    expect(isRampInboundFamilyEnabled(family, meta("provider"))).toBe(true);
    expect(
      isRampInboundFamilyEnabled(
        family,
        meta("provider", { pullReimbursements: false })
      )
    ).toBe(false);
  });
});

describe("Ramp entity policy", () => {
  it("accepts every row when no entity is configured", () => {
    expect(isRampEntityInScope(undefined, undefined)).toBe(true);
    expect(isRampEntityInScope(undefined, "entity-b")).toBe(true);
    expect(rampEntityQuery(undefined)).toEqual({});
  });

  it("accepts only the configured entity and adds its query filter", () => {
    expect(isRampEntityInScope("entity-a", "entity-a")).toBe(true);
    expect(isRampEntityInScope("entity-a", "entity-b")).toBe(false);
    expect(isRampEntityInScope("entity-a", null)).toBe(false);
    expect(rampEntityQuery("entity-a")).toEqual({ entity_id: "entity-a" });
  });
});
