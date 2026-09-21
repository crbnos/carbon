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

describe("isRampInboundFamilyEnabled", () => {
  it.each<RampInboundFamily>([
    "transactions",
    "transfers",
    "cashbacks"
  ])("gates %s with pullTransactions", (family) => {
    expect(isRampInboundFamilyEnabled(family, sync)).toBe(true);
    expect(
      isRampInboundFamilyEnabled(family, {
        ...sync,
        pullTransactions: false
      })
    ).toBe(false);
  });

  it.each<RampInboundFamily>([
    "bills",
    "billPayments"
  ])("gates %s with pullBills", (family) => {
    expect(isRampInboundFamilyEnabled(family, sync)).toBe(false);
    expect(
      isRampInboundFamilyEnabled(family, { ...sync, pullBills: true })
    ).toBe(true);
  });

  it.each<RampInboundFamily>([
    "reimbursements",
    "repayments"
  ])("gates %s with pullReimbursements", (family) => {
    expect(isRampInboundFamilyEnabled(family, sync)).toBe(true);
    expect(
      isRampInboundFamilyEnabled(family, {
        ...sync,
        pullReimbursements: false
      })
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
