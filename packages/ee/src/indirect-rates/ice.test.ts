// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import type { PoolDef } from "./compute";
import {
  buildScheduleB,
  buildScheduleG,
  buildScheduleH,
  buildScheduleI
} from "./ice";

const pool = (
  id: string,
  sequence: number,
  overrides: Partial<PoolDef> = {}
): PoolDef => ({
  id,
  name: id,
  poolType: "Overhead",
  sequence,
  baseType: "Direct Labor Dollars",
  appliesToProjects: true,
  offsetAbsorbedOverhead: false,
  ...overrides
});

const overhead = pool("Overhead", 1);
const ga = pool("G&A", 2, { poolType: "G&A", baseType: "Total Cost Input" });
const rates = new Map([
  ["Overhead", 0.5],
  ["G&A", 0.1]
]);
const contract = {
  customerContractId: "cc-1",
  contract: "CON-1",
  customer: "Navy"
};

describe("ICE schedules", () => {
  it("H: 10,000.00 of labor carries 5,000.00 of overhead and 1,500.00 of G&A", () => {
    const table = buildScheduleH({
      pools: [overhead, ga],
      rates,
      contracts: [{ ...contract, buckets: { Labor: 10000, LaborHours: 100 } }]
    });
    expect(table.fields).toEqual([
      "Contract",
      "Customer",
      "Labor",
      "Material",
      "Subcontract",
      "Other Direct",
      "Direct total",
      "Overhead",
      "G&A",
      "Total"
    ]);
    expect(table.rows).toEqual([
      ["CON-1", "Navy", 10000, 0, 0, 0, 10000, 5000, 1500, 16500]
    ]);
  });

  it("I: 16,500.00 this year and 10,000.00 before, against 24,000.00 billed", () => {
    const table = buildScheduleI({
      pools: [overhead, ga],
      fiscalYear: 2026,
      // The prior year has no claimed rates: its claim is its direct cost.
      ratesByYear: new Map([[2026, rates]]),
      contracts: [
        {
          ...contract,
          bucketsByYear: new Map([
            [2025, { Labor: 10000 }],
            [2026, { Labor: 10000 }]
          ]),
          billed: 24000
        }
      ]
    });
    expect(table.rows).toEqual([["CON-1", 16500, 10000, 26500, 24000, 2500]]);
  });

  it("B: an unallowable account shows its amount in its own column", () => {
    const table = buildScheduleB(
      [overhead, ga],
      [
        {
          indirectPoolId: "G&A",
          lineType: "Account",
          accountNumber: "7100",
          accountName: "Entertainment",
          sourcePoolName: null,
          amount: 5000,
          unallowableAmount: 5000
        },
        {
          indirectPoolId: "G&A",
          lineType: "Account",
          accountNumber: "7000",
          accountName: "General and administrative",
          sourcePoolName: null,
          amount: 50000,
          unallowableAmount: 0
        },
        {
          indirectPoolId: "G&A",
          lineType: "Carried Burden",
          accountNumber: null,
          accountName: null,
          sourcePoolName: "Overhead",
          amount: 1200,
          unallowableAmount: 0
        },
        {
          indirectPoolId: "Overhead",
          lineType: "Account",
          accountNumber: "6100",
          accountName: "Indirect labor",
          sourcePoolName: null,
          amount: 20000,
          unallowableAmount: 0
        }
      ]
    );
    expect(table.rows).toEqual([
      ["7000", "General and administrative", 50000, 0, 50000],
      ["7100", "Entertainment", 5000, 5000, 0],
      ["", "Burden from Overhead", 1200, 0, 1200]
    ]);
  });

  it("G: every ledger row with a journal line reconciles to a difference of 0", () => {
    const table = buildScheduleG({
      ledgerAmount: 25000,
      unallowableAmount: 1000,
      journalAmount: 25000,
      memoAmount: 0
    });
    expect(table.rows).toEqual([
      ["Direct cost in the project ledger", 25000],
      ["Less unallowable", -1000],
      ["Claimed direct cost", 24000],
      ["Journal lines behind the ledger rows", 25000],
      ["Ledger rows with no journal line", 0],
      ["Difference", 0]
    ]);
  });
});
