// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  type ChargePaymentMapping,
  refundedChargePayments
} from "./refund-attribution";

const mapping = (
  paymentId: string,
  createdAt: string,
  chargeIds: string[]
): ChargePaymentMapping => ({ paymentId, createdAt, chargeIds });

describe("refundedChargePayments", () => {
  // Two installments: the first payment recorded ch_A, the second was recorded
  // after ch_B and lists both (the list is cumulative).
  const installments = [
    mapping("pay_2", "2026-11-02T10:00:00Z", ["ch_A", "ch_B"]),
    mapping("pay_1", "2026-11-01T10:00:00Z", ["ch_A"])
  ];

  it("voids only the payment that first recorded the refunded charge", () => {
    expect(refundedChargePayments(installments, "ch_A")).toEqual({
      status: "void",
      paymentIds: ["pay_1"]
    });
  });

  it("voids the later installment for a charge only it recorded", () => {
    expect(refundedChargePayments(installments, "ch_B")).toEqual({
      status: "void",
      paymentIds: ["pay_2"]
    });
  });

  it("orders mappings read back from Kysely as Dates", () => {
    const fromDb = installments.map((m) => ({
      ...m,
      createdAt: new Date(m.createdAt as string)
    }));
    expect(refundedChargePayments(fromDb, "ch_A")).toEqual({
      status: "void",
      paymentIds: ["pay_1"]
    });
  });

  it("leaves a payment that recorded two charges at once for a person", () => {
    const result = refundedChargePayments(
      [mapping("pay_1", "2026-11-01T10:00:00Z", ["ch_A", "ch_B"])],
      "ch_A"
    );
    expect(result.status).toBe("manual");
  });

  it("leaves a charge no payment recorded for a person", () => {
    expect(refundedChargePayments(installments, "ch_Z").status).toBe("manual");
  });
});
