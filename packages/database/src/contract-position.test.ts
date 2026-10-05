// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  addMovement,
  applyContractMovement,
  type ContractPosition,
  EMPTY_POSITION,
  movementCredits,
  negatePosition,
  normalizePosition,
  positionFromEntries
} from "./contract-position.ts";

const invoice = (position: ContractPosition, amount: number, rate = 1) =>
  applyContractMovement({ position, amount, rate, counterpart: "receivable" });
const recognize = (position: ContractPosition, amount: number, rate = 1) =>
  applyContractMovement({
    position,
    amount: -amount,
    rate,
    counterpart: "revenue"
  });

describe("applyContractMovement — base currency", () => {
  it("bills ahead: the invoice defers, the run releases it", () => {
    const billed = invoice(EMPTY_POSITION, 1200);
    expect(billed).toMatchObject({
      deferredAmount: 1200,
      assetAmount: 0,
      counterBase: 1200,
      fxBase: 0
    });
    const afterBill = addMovement(EMPTY_POSITION, billed);
    const november = recognize(afterBill, 100);
    expect(november).toMatchObject({
      deferredAmount: -100,
      deferredBase: -100,
      assetAmount: 0,
      counterBase: 100
    });
    expect(addMovement(afterBill, november).deferredAmount).toBe(1100);
  });

  it("earned first: the run accrues a contract asset the invoice relieves", () => {
    // Spec acceptance: implementation billed later, Nov + Dec accrue 10,000 each.
    let position = EMPTY_POSITION;
    for (const month of [10_000, 10_000]) {
      const run = recognize(position, month);
      expect(run.assetAmount).toBe(month);
      expect(run.deferredAmount).toBe(0);
      position = addMovement(position, run);
    }
    expect(position.assetAmount).toBe(20_000);
    // The 1 Jan invoice of 30,000 relieves 20,000 and defers 10,000.
    const january = invoice(position, 30_000);
    expect(january).toMatchObject({
      assetAmount: -20_000,
      deferredAmount: 10_000,
      fxBase: 0
    });
    position = addMovement(position, january);
    expect(position).toEqual({
      deferredAmount: 10_000,
      deferredBase: 10_000,
      assetAmount: 0,
      assetBase: 0
    });
  });

  it("never leaves both pools open", () => {
    let position = addMovement(EMPTY_POSITION, invoice(EMPTY_POSITION, 300));
    position = addMovement(position, recognize(position, 500));
    expect(position.deferredAmount).toBe(0);
    expect(position.assetAmount).toBe(200);
  });

  it("a credit releases deferred revenue first, then the asset", () => {
    const position = addMovement(EMPTY_POSITION, invoice(EMPTY_POSITION, 420));
    const credit = invoice(position, -140);
    expect(credit).toMatchObject({
      deferredAmount: -140,
      assetAmount: 0,
      counterBase: 140,
      fxBase: 0
    });
  });

  it("a reversed recognition clears the asset before deferring", () => {
    let position = addMovement(EMPTY_POSITION, recognize(EMPTY_POSITION, 50));
    const reversal = applyContractMovement({
      position,
      amount: 80,
      rate: 1,
      counterpart: "revenue"
    });
    expect(reversal).toMatchObject({
      assetAmount: -50,
      deferredAmount: 30,
      counterBase: 80
    });
    position = addMovement(position, reversal);
    expect(position.assetAmount).toBe(0);
  });

  it("ignores a zero movement", () => {
    expect(invoice(EMPTY_POSITION, 0)).toEqual({
      ...EMPTY_POSITION,
      counterBase: 0,
      fxBase: 0
    });
  });
});

describe("applyContractMovement — foreign currency", () => {
  // EUR contract, base USD; rate = EUR per USD.
  it("releases deferred revenue at the funding invoice's base", () => {
    const billed = invoice(EMPTY_POSITION, 1000, 0.8); // 1,250 USD
    expect(billed.deferredBase).toBe(1250);
    const position = addMovement(EMPTY_POSITION, billed);
    // The run's rate is 0.9 — irrelevant to a release from the pool.
    const run = recognize(position, 100, 0.9);
    expect(run.deferredBase).toBe(-125);
    expect(run.counterBase).toBe(125);
  });

  it("accrues at the run's rate and books FX when an invoice relieves it", () => {
    let position = addMovement(
      EMPTY_POSITION,
      recognize(EMPTY_POSITION, 900, 0.9) // accrue 900 EUR = 1,000 USD
    );
    expect(position.assetBase).toBe(1000);
    const billed = invoice(position, 900, 0.75); // AR 1,200 USD
    expect(billed).toMatchObject({
      assetAmount: -900,
      assetBase: -1000,
      deferredAmount: 0,
      counterBase: 1200,
      fxBase: 200 // gain
    });
    position = addMovement(position, billed);
    expect(position).toEqual(EMPTY_POSITION);
  });

  it("carries a weighted-average base across two funding invoices", () => {
    let position = addMovement(
      EMPTY_POSITION,
      invoice(EMPTY_POSITION, 100, 0.5) // 200 USD
    );
    position = addMovement(position, invoice(position, 100, 1)); // 100 USD
    // 200 EUR carried at 300 USD → 150 USD per 100 EUR.
    const run = recognize(position, 100, 2);
    expect(run.deferredBase).toBe(-150);
    position = addMovement(position, run);
    // The last draw takes exactly what is left.
    expect(recognize(position, 100, 2).deferredBase).toBe(-150);
  });

  it("a credit at a different rate than the deferral books the difference", () => {
    const position = addMovement(
      EMPTY_POSITION,
      invoice(EMPTY_POSITION, 100, 0.5) // 200 USD deferred
    );
    const credit = invoice(position, -100, 1); // AR credit 100 USD
    expect(credit.deferredBase).toBe(-200);
    expect(credit.counterBase).toBe(100);
    expect(credit.fxBase).toBe(-100); // a debit of −100 = a gain of 100
  });
});

describe("positionFromEntries", () => {
  it("sums ledger rows, coercing NUMERIC strings", () => {
    expect(
      positionFromEntries([
        { deferredAmount: 10, deferredBase: 12 },
        {
          deferredAmount: "5" as unknown as number,
          assetAmount: 1,
          assetBase: 1
        }
      ])
    ).toEqual({
      deferredAmount: 15,
      deferredBase: 12,
      assetAmount: 1,
      assetBase: 1
    });
  });
});

describe("normalizePosition", () => {
  const position = (p: Partial<ContractPosition>): ContractPosition => ({
    ...EMPTY_POSITION,
    ...p
  });

  it("leaves a well-formed position alone", () => {
    expect(
      normalizePosition(position({ deferredAmount: 20, deferredBase: 20 }))
    ).toEqual(EMPTY_POSITION);
    expect(
      normalizePosition(position({ assetAmount: 5, assetBase: 5 }))
    ).toEqual(EMPTY_POSITION);
  });

  it("moves a negative deferred pool into Contract Assets (VOID after a recognition)", () => {
    // Billed 30,000, recognized 10,000, then the invoice voided.
    const billed = position({ deferredAmount: 30_000, deferredBase: 30_000 });
    const recognized = addMovement(billed, recognize(billed, 10_000));
    const voided = addMovement(
      recognized,
      negatePosition(position({ deferredAmount: 30_000, deferredBase: 30_000 }))
    );
    expect(voided.deferredAmount).toBe(-10_000);
    const reclass = normalizePosition(voided);
    expect(reclass).toEqual({
      deferredAmount: 10_000,
      deferredBase: 10_000,
      assetAmount: 10_000,
      assetBase: 10_000
    });
    expect(addMovement(voided, reclass)).toEqual(
      position({ assetAmount: 10_000, assetBase: 10_000 })
    );
  });

  it("moves a negative asset pool into Deferred Revenue", () => {
    const reclass = normalizePosition(
      position({ assetAmount: -400, assetBase: -360 })
    );
    expect(reclass).toEqual({
      deferredAmount: 400,
      deferredBase: 360,
      assetAmount: 400,
      assetBase: 360
    });
  });

  it("nets two positive pools into one, carrying the net base", () => {
    const both = position({
      deferredAmount: 30,
      deferredBase: 33,
      assetAmount: 10,
      assetBase: 9
    });
    const reclass = normalizePosition(both);
    expect(reclass).toEqual({
      deferredAmount: -10,
      deferredBase: -9,
      assetAmount: -10,
      assetBase: -9
    });
    expect(addMovement(both, reclass)).toEqual(
      position({ deferredAmount: 20, deferredBase: 24 })
    );
    // More assets than deferred: the net lands in Contract Assets.
    expect(
      addMovement(
        position({
          deferredAmount: 5,
          deferredBase: 5,
          assetAmount: 15,
          assetBase: 15
        }),
        normalizePosition(
          position({
            deferredAmount: 5,
            deferredBase: 5,
            assetAmount: 15,
            assetBase: 15
          })
        )
      )
    ).toEqual(position({ assetAmount: 10, assetBase: 10 }));
  });

  it("nets a negative pool against the other, carrying the net base", () => {
    const reclass = normalizePosition(
      position({
        deferredAmount: -100,
        deferredBase: -110,
        assetAmount: 50,
        assetBase: 45
      })
    );
    expect(
      addMovement(
        position({
          deferredAmount: -100,
          deferredBase: -110,
          assetAmount: 50,
          assetBase: 45
        }),
        reclass
      )
    ).toEqual(position({ assetAmount: 150, assetBase: 155 }));
    // One Contract Assets / Deferred Revenue pair: equal base deltas.
    expect(reclass.deferredBase).toBe(reclass.assetBase);
  });
});

describe("movementCredits", () => {
  it("splits an invoice over Contract Assets and Deferred Revenue (spec acceptance)", () => {
    // 2 × 10,000 accrued by the run, then a 30,000 invoice.
    const accrued = position({ assetAmount: 20_000, assetBase: 20_000 });
    const movement = invoice(accrued, 30_000);
    expect(movementCredits(movement, 30_000)).toEqual({
      asset: 20_000,
      deferred: 10_000,
      fx: 0
    });
  });

  it("puts the FX difference of clearing an accrual on the gain or loss account", () => {
    // 1,000 EUR accrued at 0.8 (1,250 base), invoiced at 1.0 (1,000 base).
    const accrued = position({ assetAmount: 1000, assetBase: 1250 });
    const movement = invoice(accrued, 1000, 1);
    expect(movementCredits(movement, 1000)).toEqual({
      asset: 1250,
      deferred: 0,
      fx: -250
    });
  });

  it("debits the pools for a credit against the receivable", () => {
    const deferred = position({ deferredAmount: 420, deferredBase: 420 });
    const movement = invoice(deferred, -500);
    expect(movementCredits(movement, -500)).toEqual({
      deferred: -420,
      asset: -80,
      fx: 0
    });
  });

  function position(p: Partial<ContractPosition>): ContractPosition {
    return { ...EMPTY_POSITION, ...p };
  }
});
