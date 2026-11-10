// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  countedProcessorFee,
  MISSING_PROCESSOR_FEE_ACCOUNT_ERROR,
  processorFeeAccount
} from "./payment-processor-fee";

const payment = { id: "pay-1", currencyCode: "USD", reference: "INV-0042" };
const mapping = (metadata: unknown) => ({ externalId: "in_123", metadata });

describe("countedProcessorFee", () => {
  it("counts a positive fee in the payment's currency", () => {
    expect(
      countedProcessorFee(
        payment,
        mapping({ feeAmount: 3.2, feeCurrency: "USD" })
      )
    ).toEqual({ amount: 3.2, description: "Stripe processing fee — INV-0042" });
  });

  it("names the Stripe invoice id when the payment has no reference", () => {
    expect(
      countedProcessorFee(
        { ...payment, reference: null },
        mapping({ feeAmount: 1, feeCurrency: "USD" })
      )?.description
    ).toEqual("Stripe processing fee — in_123");
  });

  it("does not count a fee with no currency", () => {
    expect(
      countedProcessorFee(payment, mapping({ feeAmount: 3.2 }))
    ).toBeNull();
    expect(
      countedProcessorFee(
        payment,
        mapping({ feeAmount: 3.2, feeCurrency: null })
      )
    ).toBeNull();
    expect(
      countedProcessorFee(
        { ...payment, currencyCode: null },
        mapping({ feeAmount: 3.2, feeCurrency: null })
      )
    ).toBeNull();
  });

  it("does not count a fee in another currency, a zero fee or no metadata", () => {
    expect(
      countedProcessorFee(
        payment,
        mapping({ feeAmount: 3.2, feeCurrency: "EUR" })
      )
    ).toBeNull();
    expect(
      countedProcessorFee(
        payment,
        mapping({ feeAmount: 0, feeCurrency: "USD" })
      )
    ).toBeNull();
    expect(countedProcessorFee(payment, mapping(null))).toBeNull();
  });
});

describe("processorFeeAccount", () => {
  it("uses the integration's fee account, else the service charge default", () => {
    expect(processorFeeAccount({ paymentFeeAccount: "fees" }, "service")).toBe(
      "fees"
    );
    expect(processorFeeAccount({}, "service")).toBe("service");
    expect(processorFeeAccount(null, "service")).toBe("service");
  });

  it("refuses when neither account is set", () => {
    expect(() => processorFeeAccount({}, null)).toThrow(
      MISSING_PROCESSOR_FEE_ACCOUNT_ERROR
    );
  });
});
