// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  type BillingInput,
  billingRateFor,
  burdenBillingAdjustments,
  burdenCatchUp,
  computePoolRates,
  type ElementCells,
  fiscalYearRange,
  type GlCell,
  matchMapping,
  type PoolDef,
  type PoolMapping,
  type ProjectCell,
  projectBurdenTargets
} from "./compute";

function pool(
  id: string,
  sequence: number,
  poolType: PoolDef["poolType"],
  baseType: PoolDef["baseType"],
  overrides: Partial<PoolDef> = {}
): PoolDef {
  return {
    id,
    name: id,
    poolType,
    sequence,
    baseType,
    appliesToProjects: true,
    offsetAbsorbedOverhead: false,
    ...overrides
  };
}

let mappingId = 0;
function mapping(
  indirectPoolId: string,
  accountId: string,
  role: PoolMapping["role"],
  dimension?: { dimensionId: string; dimensionValueId: string }
): PoolMapping {
  mappingId += 1;
  return {
    id: `m${mappingId}`,
    indirectPoolId,
    accountId,
    role,
    dimensionId: dimension?.dimensionId ?? null,
    dimensionValueId: dimension?.dimensionValueId ?? null
  };
}

function gl(
  accountId: string,
  amount: number,
  unallowableAmount = 0,
  dims: Record<string, string> = {}
): GlCell {
  return { accountId, dims, amount, unallowableAmount };
}

function project(
  costObjective: ProjectCell["costObjective"],
  bucket: ProjectCell["bucket"],
  amount: number,
  unallowableAmount = 0
): ProjectCell {
  return { costObjective, bucket, amount, unallowableAmount };
}

const FRINGE = pool("fringe", 1, "Fringe", "Total Labor Dollars");
const OVERHEAD = pool("overhead", 2, "Overhead", "Direct Labor Dollars");

const byPool = (results: ReturnType<typeof computePoolRates>, id: string) =>
  results.find((r) => r.indirectPoolId === id)!;

describe("computePoolRates", () => {
  it("Rates: Fringe of 30,000.00 on a base of 100,000.00 is 30 %", () => {
    const results = computePoolRates({
      pools: [FRINGE],
      mappings: [
        mapping("fringe", "5000", "Cost"),
        mapping("fringe", "6100", "Base")
      ],
      glCells: [gl("5000", 30_000), gl("6100", 20_000)],
      projectCells: [project("Direct", "Labor", 80_000)],
      absorbedOverhead: 0
    });
    const fringe = byPool(results, "fringe");
    expect(fringe.poolCost).toEqual(30_000);
    expect(fringe.baseAmount).toEqual(100_000);
    expect(fringe.ytdRate).toEqual(0.3);
  });

  it("Overhead carries the fringe on its indirect labor into its cost", () => {
    const results = computePoolRates({
      pools: [OVERHEAD, FRINGE],
      mappings: [
        mapping("fringe", "5000", "Cost"),
        mapping("fringe", "6100", "Base"),
        mapping("overhead", "6100", "Cost")
      ],
      glCells: [gl("5000", 30_000), gl("6100", 20_000)],
      projectCells: [project("Direct", "Labor", 80_000)],
      absorbedOverhead: 0
    });
    const overhead = byPool(results, "overhead");
    expect(overhead.poolCost).toEqual(26_000);
    expect(overhead.baseAmount).toEqual(80_000);
    expect(overhead.ytdRate).toEqual(0.325);
    const carried = overhead.lines.filter(
      (l) => l.lineType === "Carried Burden"
    );
    expect(carried).toEqual([
      {
        lineType: "Carried Burden",
        accountId: null,
        dimensionValueId: null,
        sourcePoolId: "fringe",
        amount: 6_000,
        unallowableAmount: 0
      }
    ]);
  });

  it("Unallowable in the base: unallowable cost leaves the G&A numerator and stays in the TCI base", () => {
    const results = computePoolRates({
      pools: [pool("ga", 1, "G&A", "Total Cost Input")],
      mappings: [mapping("ga", "7000", "Cost"), mapping("ga", "7100", "Cost")],
      glCells: [gl("7000", 50_000), gl("7100", 5_000, 5_000)],
      projectCells: [
        project("Direct", "Labor", 300_000, 10_000),
        project("Direct", "Material", 200_000)
      ],
      absorbedOverhead: 0
    });
    const ga = byPool(results, "ga");
    expect(ga.poolCost).toEqual(50_000);
    expect(ga.unallowableCost).toEqual(5_000);
    expect(ga.baseAmount).toEqual(500_000);
    expect(ga.ytdRate).toEqual(0.1);
    expect(ga.lines.find((l) => l.accountId === "7100")).toMatchObject({
      lineType: "Account",
      amount: 5_000,
      unallowableAmount: 5_000
    });
  });

  it("A Total Cost Input base takes the Fringe and Overhead burden on direct labor", () => {
    const results = computePoolRates({
      pools: [FRINGE, OVERHEAD, pool("ga", 3, "G&A", "Total Cost Input")],
      mappings: [
        mapping("fringe", "5000", "Cost"),
        mapping("fringe", "6100", "Base"),
        mapping("overhead", "6100", "Cost"),
        mapping("ga", "7000", "Cost")
      ],
      glCells: [gl("5000", 30_000), gl("6100", 20_000), gl("7000", 50_000)],
      projectCells: [
        project("Direct", "Labor", 80_000),
        project("Direct", "Material", 20_000)
      ],
      absorbedOverhead: 0
    });
    // 80,000 labor + 20,000 material + 24,000 fringe + 26,000 overhead
    const ga = byPool(results, "ga");
    expect(ga.baseAmount).toEqual(150_000);
    expect(ga.ytdRate).toEqual(0.33333);
  });

  it("A Value Added base takes Overhead burden but not Material Handling burden", () => {
    const results = computePoolRates({
      pools: [
        pool("mh", 1, "Material Handling", "Direct Material Dollars"),
        pool("overhead", 2, "Overhead", "Direct Labor Dollars"),
        pool("ga", 3, "G&A", "Value Added")
      ],
      mappings: [
        mapping("mh", "5500", "Cost"),
        mapping("overhead", "6200", "Cost"),
        mapping("ga", "7000", "Cost")
      ],
      glCells: [gl("5500", 8_000), gl("6200", 6_000), gl("7000", 10_000)],
      projectCells: [
        project("Direct", "Labor", 60_000),
        project("Direct", "Material", 40_000)
      ],
      absorbedOverhead: 0
    });
    expect(byPool(results, "mh").ytdRate).toEqual(0.2);
    expect(byPool(results, "overhead").ytdRate).toEqual(0.1);
    // 60,000 labor + 6,000 overhead burden; no material, no handling burden
    expect(byPool(results, "ga").baseAmount).toEqual(66_000);
  });

  it("IR&D labor is in the Fringe base, outside the G&A base, and its fringe goes into G&A cost", () => {
    const results = computePoolRates({
      pools: [FRINGE, pool("ga", 2, "G&A", "Total Cost Input")],
      mappings: [
        mapping("fringe", "5000", "Cost"),
        mapping("ga", "7000", "Cost")
      ],
      glCells: [gl("5000", 30_000), gl("7000", 40_000)],
      projectCells: [
        project("Direct", "Labor", 80_000),
        project("IR&D", "Labor", 20_000)
      ],
      absorbedOverhead: 0
    });
    const fringe = byPool(results, "fringe");
    expect(fringe.baseAmount).toEqual(100_000);
    expect(fringe.ytdRate).toEqual(0.3);
    const ga = byPool(results, "ga");
    // 40,000 + 0.3 × 20,000 IR&D labor
    expect(ga.poolCost).toEqual(46_000);
    // 80,000 direct labor + 24,000 fringe on it; IR&D stays out
    expect(ga.baseAmount).toEqual(104_000);
    expect(ga.lines.find((l) => l.lineType === "Carried Burden")).toMatchObject(
      { sourcePoolId: "fringe", amount: 6_000 }
    );
  });

  it("A line with dimension value CC-10 matches the CC-10 mapping, not the account-only one", () => {
    const cc10 = { dimensionId: "dim-cc", dimensionValueId: "CC-10" };
    const mappings = [
      mapping("overhead", "6100", "Cost"),
      mapping("fringe", "6100", "Cost", cc10)
    ];
    const tagged = gl("6100", 1_000, 0, { "dim-cc": "CC-10" });
    const other = gl("6100", 2_000, 0, { "dim-cc": "CC-20" });
    expect(matchMapping(tagged, mappings, "Cost")?.indirectPoolId).toEqual(
      "fringe"
    );
    expect(matchMapping(other, mappings, "Cost")?.indirectPoolId).toEqual(
      "overhead"
    );

    const results = computePoolRates({
      pools: [FRINGE, OVERHEAD],
      mappings,
      glCells: [tagged, other],
      projectCells: [project("Direct", "Labor", 10_000)],
      absorbedOverhead: 0
    });
    expect(byPool(results, "fringe").poolCost).toEqual(1_000);
    expect(byPool(results, "fringe").lines[0]).toMatchObject({
      accountId: "6100",
      dimensionValueId: "CC-10"
    });
    expect(byPool(results, "overhead").poolCost).toEqual(2_000);
  });

  it("offsetAbsorbedOverhead adds an Absorbed Overhead line and leaves the rate unchanged", () => {
    const input = {
      mappings: [mapping("overhead", "6200", "Cost")],
      glCells: [gl("6200", 30_000)],
      projectCells: [project("Direct", "Labor", 100_000)],
      absorbedOverhead: -4_000,
      absorbedOverheadAccountId: "5900"
    };
    const plain = byPool(
      computePoolRates({ ...input, pools: [OVERHEAD] }),
      "overhead"
    );
    const offset = byPool(
      computePoolRates({
        ...input,
        pools: [{ ...OVERHEAD, offsetAbsorbedOverhead: true }]
      }),
      "overhead"
    );
    expect(offset.ytdRate).toEqual(0.3);
    expect(offset.ytdRate).toEqual(plain.ytdRate);
    expect(offset.poolCost).toEqual(30_000);
    expect(
      offset.lines.find((l) => l.lineType === "Absorbed Overhead")
    ).toEqual({
      lineType: "Absorbed Overhead",
      accountId: "5900",
      dimensionValueId: null,
      sourcePoolId: null,
      amount: -4_000,
      unallowableAmount: 0
    });
    expect(plain.lines.some((l) => l.lineType === "Absorbed Overhead")).toEqual(
      false
    );
  });
});

describe("fiscalYearRange", () => {
  it("FY2026 period 3 with an October start is December 2025", () => {
    expect(fiscalYearRange(2026, 3, 10)).toEqual({
      start: "2025-10-01",
      periodStart: "2025-12-01",
      periodEnd: "2025-12-31"
    });
  });
});

function element(
  buckets: ElementCells["buckets"],
  overrides: Partial<ElementCells> = {}
): ElementCells {
  return {
    projectId: "p1",
    projectElementId: "e1",
    costObjective: "Direct",
    buckets,
    absorbedOverhead: 0,
    ...overrides
  };
}

describe("projectBurdenTargets and burdenCatchUp", () => {
  it("Burden catch-up: a rate raised in month 2 posts months 1 and 2 at the new rate, less the burden posted", () => {
    // Month 1: 2,000.00 posted at 0.20 on 10,000.00.
    const posted = [
      {
        projectId: "p1",
        projectElementId: "e1",
        indirectPoolId: "overhead",
        unallowable: false,
        amount: 2_000
      }
    ];
    const month2 = element({ Labor: { amount: 25_000, unallowableAmount: 0 } });
    const targets = projectBurdenTargets(
      [OVERHEAD],
      new Map([["overhead", 0.25]]),
      month2
    );
    expect(burdenCatchUp(targets, posted, month2)).toEqual([
      {
        projectId: "p1",
        projectElementId: "e1",
        indirectPoolId: "overhead",
        unallowable: false,
        amount: 4_250
      }
    ]);
  });

  it("An unchanged rate and base post no row", () => {
    const cells = element({ Labor: { amount: 10_000, unallowableAmount: 0 } });
    const targets = projectBurdenTargets(
      [OVERHEAD],
      new Map([["overhead", 0.2]]),
      cells
    );
    const posted = [
      {
        projectId: "p1",
        projectElementId: "e1",
        indirectPoolId: "overhead",
        unallowable: false,
        amount: 2_000
      }
    ];
    expect(burdenCatchUp(targets, posted, cells)).toEqual([]);
  });

  it("offsetAbsorbedOverhead takes the absorbed overhead off the target, never below 0", () => {
    const offsetPool = { ...OVERHEAD, offsetAbsorbedOverhead: true };
    const rates = new Map([["overhead", 0.3]]);
    const labor = { Labor: { amount: 10_000, unallowableAmount: 0 } };
    expect(
      projectBurdenTargets(
        [offsetPool],
        rates,
        element(labor, { absorbedOverhead: 1_000 })
      ).get("overhead")?.allowable
    ).toEqual(2_000);
    expect(
      projectBurdenTargets(
        [offsetPool],
        rates,
        element(labor, { absorbedOverhead: 4_000 })
      ).get("overhead")?.allowable
    ).toEqual(0);
  });

  it("Burden on unallowable labor is a separate unallowable row", () => {
    const cells = element({
      Labor: { amount: 11_000, unallowableAmount: 1_000 }
    });
    const targets = projectBurdenTargets(
      [OVERHEAD],
      new Map([["overhead", 0.2]]),
      cells
    );
    const rows = burdenCatchUp(targets, [], cells);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => !r.unallowable)?.amount).toEqual(2_000);
    expect(rows.find((r) => r.unallowable)?.amount).toEqual(200);
  });
});

function billingLine(
  overrides: Partial<BillingInput["lines"][number]> = {}
): BillingInput["lines"][number] {
  return {
    customerContractLineId: "line-1",
    projectId: "p1",
    projectElementId: "e1",
    feePercent: 0,
    baseByYear: new Map([[2026, { Labor: 10_000 }]]),
    ceilings: new Map(),
    existing: new Map(),
    ...overrides
  };
}

describe("burden billing", () => {
  it("Ceiling: a 25 % ceiling bills overhead at 25 % when the Provisional rate is 28 %", () => {
    expect(
      billingRateFor({ final: null, provisional: 0.28, ceiling: 0.25 })
    ).toEqual(0.25);
    const { adjustments, warnings } = burdenBillingAdjustments({
      pools: [OVERHEAD],
      lines: [billingLine({ ceilings: new Map([["overhead", 0.25]]) })],
      rates: new Map([["overhead|2026", { final: null, provisional: 0.28 }]])
    });
    expect(warnings).toEqual([]);
    expect(adjustments).toEqual([
      {
        customerContractLineId: "line-1",
        projectId: "p1",
        projectElementId: "e1",
        indirectPoolId: "overhead",
        fiscalYear: 2026,
        burdenRate: 0.25,
        burdenBase: 10_000,
        amount: 2_500
      }
    ]);
  });

  it("True-up: a Final rate below Provisional bills the negative difference", () => {
    const { adjustments } = burdenBillingAdjustments({
      pools: [OVERHEAD],
      lines: [billingLine({ existing: new Map([["overhead|2026", 2_800]]) })],
      rates: new Map([["overhead|2026", { final: 0.22, provisional: 0.28 }]])
    });
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]).toMatchObject({ burdenRate: 0.22, amount: -600 });
  });

  it("A fee of 8 % on a burden of 2,500.00 bills 2,700.00", () => {
    const { adjustments } = burdenBillingAdjustments({
      pools: [OVERHEAD],
      lines: [billingLine({ feePercent: 0.08 })],
      rates: new Map([["overhead|2026", { final: null, provisional: 0.25 }]])
    });
    expect(adjustments.map((a) => a.amount)).toEqual([2_700]);
  });
});
