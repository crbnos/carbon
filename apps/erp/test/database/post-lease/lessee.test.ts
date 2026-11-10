// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { InvalidInputError } from "@carbon/api/errors";
import { lesseeTerminationLegs, normalizeLesseeLegs } from "@carbon/utils";
import { describe, expect, it } from "vitest";
import {
  commencementLines,
  type LesseeAccounts,
  openingBalanceLines,
  purchaseLines,
  remeasurementLines,
  terminationLines
} from "../../../app/modules/purchasing/purchasing.service";

const accounts: LesseeAccounts = {
  rightOfUseAsset: { id: "rou", class: "Asset" },
  accumulatedRightOfUseAmortization: { id: "acc", class: "Asset" },
  leaseLiability: { id: "liab", class: "Liability" },
  operatingLeaseExpense: { id: "opex", class: "Expense" },
  rightOfUseAmortizationExpense: { id: "amort", class: "Expense" },
  leaseInterestExpense: { id: "interest", class: "Expense" },
  gain: { id: "gain", class: "Revenue" },
  loss: { id: "loss", class: "Expense" }
};

const byAccount = (lines: { accountId: string; amount: number }[]) =>
  Object.fromEntries(lines.map((line) => [line.accountId, line.amount]));

describe("commencementLines", () => {
  it("debits the ROU asset and credits the lease liability at the PV", () => {
    expect(
      byAccount(commencementLines({ liability: 328710.16, accounts }))
    ).toEqual({ rou: 328710.16, liab: 328710.16 });
  });
});

describe("remeasurementLines", () => {
  it("moves the ROU asset by an increase in the liability", () => {
    expect(
      byAccount(remeasurementLines({ adjustment: 5000, gain: 0, accounts }))
    ).toEqual({ rou: 5000, liab: 5000 });
  });

  it("books the part of a decrease beyond the ROU asset as a gain", () => {
    // Liability falls 15,000; the ROU asset had 10,000 left.
    expect(
      byAccount(
        remeasurementLines({ adjustment: -15000, gain: 5000, accounts })
      )
    ).toEqual({ rou: -10000, liab: -15000, gain: 5000 });
  });
});

describe("terminationLines", () => {
  it("derecognizes both balances, leaving the penalty in the liability", () => {
    const { lines, gainLoss } = terminationLines({
      carryingLiability: 113000,
      penalty: 5000,
      rouAssetCost: 328710.16,
      accumulated: 219140.16,
      accounts
    });
    // NBV 109,570.00; liability less penalty 108,000.00 → loss 1,570.00.
    expect(gainLoss).toBeCloseTo(-1570, 5);
    expect(byAccount(lines)).toEqual({
      liab: -108000,
      acc: 219140.16,
      rou: -328710.16,
      loss: 1570
    });
  });
});

describe("purchaseLines", () => {
  it("moves the net ROU asset into PP&E adjusted by price less liability", () => {
    const { lines, assetCost } = purchaseLines({
      carryingLiability: 20000,
      price: 20000,
      rouAssetCost: 345423.06,
      accumulated: 148038.48,
      assetAccount: { id: "ppe", class: "Asset" },
      accounts
    });
    expect(assetCost).toBeCloseTo(197384.58, 5);
    expect(lines.map(({ accountId, amount }) => [accountId, amount])).toEqual([
      ["ppe", 197384.58],
      ["acc", 148038.48],
      ["liab", -20000],
      ["rou", -345423.06],
      ["liab", 20000]
    ]);
  });

  it("refuses a price that leaves the asset a negative cost, as a 400", () => {
    expect(() =>
      purchaseLines({
        carryingLiability: 50000,
        price: 0,
        rouAssetCost: 345423.06,
        accumulated: 340000,
        assetAccount: { id: "ppe", class: "Asset" },
        accounts
      })
    ).toThrow(InvalidInputError);
  });
});

describe("openingBalanceLines", () => {
  it("puts the lease cost before the opening date to retained earnings", () => {
    expect(
      byAccount(
        openingBalanceLines({
          rouAssetCost: 1000,
          accumulated: 300,
          carryingLiability: 650,
          retainedEarnings: { id: "re", class: "Equity" },
          accounts
        })
      )
    ).toEqual({ rou: 1000, acc: -300, liab: 650, re: 50 });
  });
});

describe("the shared lifecycle legs", () => {
  it("posts exactly the legs the app's preview shows", () => {
    const args = {
      carryingLiability: 113000,
      penalty: 5000,
      rouAssetCost: 328710.16,
      accumulated: 219140.16
    };
    const preview = normalizeLesseeLegs(lesseeTerminationLegs(args).legs);
    const posted = terminationLines({ ...args, accounts }).lines;
    expect(posted.map((line) => line.description)).toEqual(
      preview.map((leg) => leg.description)
    );
    expect(posted.map((line) => Math.abs(line.amount))).toEqual(
      preview.map((leg) => leg.amount)
    );
  });
});
