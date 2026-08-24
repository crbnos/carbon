import { describe, expect, it } from "vitest";

import {
  buildDeliveryLinkRegistry,
  type DeliveryLink,
  validateDeliveryLink
} from "./delivery-link";

const confirmedLink: DeliveryLink = {
  fromRef: {
    system: "sap-erp",
    entity: "SalesOrderItem",
    id: "SO-10001-10"
  },
  toRef: {
    system: "sap-erp",
    entity: "ProductionOrder",
    id: "50001234"
  },
  relationType: "sales-order-to-production-order",
  authority: "sap-erp",
  observedAt: "2026-08-24T00:00:00.000Z",
  confidence: "high",
  status: "confirmed",
  evidenceRefs: ["sap:relationship:SO-10001-10:50001234"]
};

describe("DeliveryLink registry and validation", () => {
  it("accepts a confirmed SAP sales-order to production-order relation", () => {
    const result = validateDeliveryLink({
      fromRef: {
        system: "sap-erp",
        entity: "SalesOrderItem",
        id: "SO-10001-10"
      },
      toRef: {
        system: "sap-erp",
        entity: "ProductionOrder",
        id: "50001234"
      },
      relationType: "sales-order-to-production-order",
      authority: "sap-erp",
      observedAt: "2026-08-24T00:00:00.000Z",
      confidence: "high",
      status: "confirmed",
      evidenceRefs: ["sap:relationship:SO-10001-10:50001234"]
    });

    expect(result.isValid).toBe(true);
  });

  it("rejects duplicate relations and unowned confirmed relations", () => {
    expect(() =>
      buildDeliveryLinkRegistry([confirmedLink, confirmedLink])
    ).toThrow("duplicate");
    expect(
      validateDeliveryLink({
        ...confirmedLink,
        authority: "factory-os",
        status: "confirmed"
      }).isValid
    ).toBe(false);
  });

  it("allows a non-confirmed link to omit evidence references", () => {
    expect(
      validateDeliveryLink({
        ...confirmedLink,
        status: "inferred",
        evidenceRefs: []
      }).isValid
    ).toBe(true);
  });

  it("rejects a non-confirmed link when evidenceRefs is missing or not an array", () => {
    expect(
      validateDeliveryLink({
        ...(confirmedLink as Omit<DeliveryLink, "evidenceRefs">),
        status: "unknown",
        evidenceRefs: undefined as never
      }).isValid
    ).toBe(false);

    expect(
      validateDeliveryLink({
        ...confirmedLink,
        status: "conflict",
        evidenceRefs: "sap:relationship:SO-10001-10:50001234" as never
      }).isValid
    ).toBe(false);
  });
});
