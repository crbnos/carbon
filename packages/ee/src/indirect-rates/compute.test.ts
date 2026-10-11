// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  computePoolRates,
  fiscalYearRange,
  type GlCell,
  matchMapping,
  type PoolDef,
  type PoolMapping,
  type ProjectCell
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
