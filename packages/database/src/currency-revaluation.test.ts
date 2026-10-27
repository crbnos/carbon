// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildCurrencyRevaluationJournals,
  type ExposureType,
  exposureSide,
  type RevaluationExposure,
  revalueExposure
} from "./currency-revaluation.ts";

function base(overrides: Partial<RevaluationExposure>): RevaluationExposure {
  return {
    exposureType: "Receivable",
    documentType: "Invoice",
    documentId: "inv-1",
    documentNumber: "INV-0001",
    accountId: "ar-adjust",
    accountClass: "Asset",
    currencyCode: "EUR",
    openAmount: 1000,
    bookedBaseAmount: 1111.11,
    ...overrides
  };
}

const journalArgs = {
  readableId: "REV-0001",
  gainAccountId: "fx-gain",
  lossAccountId: "fx-loss"
};

describe("revalueExposure", () => {
  it("books a gain when a receivable is worth more at the new rate", () => {
    // 1000 / 0.85 = 1176.470588… → 1176.47059 at SCALE 5;
    // 1176.47059 − 1111.11 = 65.36059, side +1.
    expect(revalueExposure(base({}), 0.85)).toEqual({
      ...base({}),
      revaluedBaseAmount: 1176.47059,
      differenceAmount: 65.36059
    });
  });

  it("books a loss when a payable is worth more at the new rate", () => {
    // Same numbers as the receivable, side −1: −(1176.47059 − 1111.11).
    const payable = base({
      exposureType: "Payable",
      accountClass: "Liability"
    });
    expect(revalueExposure(payable, 0.85)).toEqual({
      ...payable,
      revaluedBaseAmount: 1176.47059,
      differenceAmount: -65.36059
    });
  });

  it("books a loss when an AR credit memo is worth more at the new rate", () => {
    // −100 / 0.85 = −117.647058… → −117.64706;
    // side +1: −117.64706 − (−111.11) = −6.53706.
    const memo = base({
      documentType: "Credit Memo",
      openAmount: -100,
      bookedBaseAmount: -111.11
    });
    expect(revalueExposure(memo, 0.85)).toEqual({
      ...memo,
      revaluedBaseAmount: -117.64706,
      differenceAmount: -6.53706
    });
  });

  it("leaves both results null when the open amount was not entered", () => {
    const balance = base({ exposureType: "Account Balance", openAmount: null });
    expect(revalueExposure(balance, 0.85)).toEqual({
      ...balance,
      revaluedBaseAmount: null,
      differenceAmount: null
    });
  });
});

describe("exposureSide", () => {
  it.each<[ExposureType, "Asset" | "Liability", 1 | -1]>([
    ["Receivable", "Asset", 1],
    ["Unapplied Disbursement", "Asset", 1],
    ["Payable", "Liability", -1],
    ["Unapplied Receipt", "Liability", -1],
    ["Account Balance", "Asset", 1],
    ["Account Balance", "Liability", -1]
  ])("treats a rise in a %s (%s) as %i", (exposureType, accountClass, side) => {
    expect(exposureSide(base({ exposureType, accountClass }))).toBe(side);
  });
});

describe("buildCurrencyRevaluationJournals", () => {
  it("adjusts each exposure and books the gains and losses, then reverses it all", () => {
    // Gain: 65.36059 (as above). Loss: 500 / 0.85 = 588.235294… → 588.23529;
    // −(588.23529 − 555.56) = −32.67529.
    const lines = [
      revalueExposure(base({}), 0.85),
      revalueExposure(
        base({
          exposureType: "Payable",
          documentType: "Purchase Invoice",
          documentId: "pinv-1",
          documentNumber: "PI-0001",
          accountId: "ap-adjust",
          accountClass: "Liability",
          openAmount: 500,
          bookedBaseAmount: 555.56
        }),
        0.85
      )
    ];

    expect(buildCurrencyRevaluationJournals({ ...journalArgs, lines })).toEqual(
      {
        valuation: {
          description: "Currency revaluation REV-0001",
          sourceType: "Currency Revaluation",
          lines: [
            {
              accountId: "ar-adjust",
              description: "Unrealized FX revaluation: INV-0001",
              amount: 65.36059,
              documentType: "Invoice",
              documentId: "inv-1",
              dimensions: {}
            },
            {
              accountId: "ap-adjust",
              description: "Unrealized FX revaluation: PI-0001",
              amount: 32.67529,
              documentType: "Purchase Invoice",
              documentId: "pinv-1",
              dimensions: {}
            },
            {
              accountId: "fx-gain",
              description: "Unrealized FX Gain",
              amount: 65.36059,
              dimensions: {}
            },
            {
              accountId: "fx-loss",
              description: "Unrealized FX Loss",
              amount: 32.67529,
              dimensions: {}
            }
          ]
        },
        reversal: {
          description: "Reversal of REV-0001",
          sourceType: "Currency Revaluation",
          lines: [
            {
              accountId: "ar-adjust",
              description: "Unrealized FX revaluation: INV-0001",
              amount: -65.36059,
              documentType: "Invoice",
              documentId: "inv-1",
              dimensions: {}
            },
            {
              accountId: "ap-adjust",
              description: "Unrealized FX revaluation: PI-0001",
              amount: -32.67529,
              documentType: "Purchase Invoice",
              documentId: "pinv-1",
              dimensions: {}
            },
            {
              accountId: "fx-gain",
              description: "Unrealized FX Gain",
              amount: -65.36059,
              dimensions: {}
            },
            {
              accountId: "fx-loss",
              description: "Unrealized FX Loss",
              amount: -32.67529,
              dimensions: {}
            }
          ]
        }
      }
    );
  });

  it.each([
    // 850 / 0.85 = 1000, booked at 1000: no difference.
    ["a zero difference", base({ openAmount: 850, bookedBaseAmount: 1000 })],
    ["an open amount not entered", base({ openAmount: null })]
  ])("writes no line for %s", (_, exposure) => {
    expect(
      buildCurrencyRevaluationJournals({
        ...journalArgs,
        lines: [revalueExposure(exposure, 0.85)]
      })
    ).toEqual({
      valuation: {
        description: "Currency revaluation REV-0001",
        sourceType: "Currency Revaluation",
        lines: []
      },
      reversal: {
        description: "Reversal of REV-0001",
        sourceType: "Currency Revaluation",
        lines: []
      }
    });
  });
});
