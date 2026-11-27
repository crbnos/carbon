// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { beforeEach, describe, expect, it, vi } from "vitest";

const companyHasFeature = vi.hoisted(() => vi.fn());
vi.mock("../plan.server", () => ({ companyHasFeature }));

import { EntitlementError } from "../entitlements.server";
import {
  getIndirectRates,
  INDIRECT_RATE_ACTUAL_REFUSED,
  setIndirectRate,
  upsertIndirectPool
} from "./service.server";

// The upsert boundary only: it records the rows the function writes and
// returns them, as PostgREST would.
function recordingClient() {
  const written: Record<string, unknown>[][] = [];
  const client = {
    from: () => ({
      upsert: (rows: Record<string, unknown>[]) => {
        written.push(rows);
        return {
          select: async () => ({ data: rows, error: null })
        };
      }
    })
  };
  return { client: client as never, written };
}

const entry = {
  companyId: "company-1",
  userId: "user-1",
  indirectPoolId: "pool-1",
  fiscalYear: 2026,
  fromPeriod: 10,
  rate: 0.28
};

describe("indirect rates authoring", () => {
  beforeEach(() => {
    companyHasFeature.mockReset();
  });

  it("upsertIndirectPool throws EntitlementError without the feature", async () => {
    companyHasFeature.mockResolvedValue(false);
    const { client, written } = recordingClient();
    await expect(
      upsertIndirectPool(client, {
        companyId: "company-1",
        userId: "user-1",
        name: "Fringe",
        poolType: "Fringe",
        sequence: 1,
        baseType: "Total Labor Dollars",
        appliesToProjects: true,
        offsetAbsorbedOverhead: false,
        active: true
      })
    ).rejects.toBeInstanceOf(EntitlementError);
    expect(written).toEqual([]);
  });

  it("setIndirectRate from period 10 writes periods 10, 11 and 12", async () => {
    companyHasFeature.mockResolvedValue(true);
    const { client, written } = recordingClient();
    const result = await setIndirectRate(client, {
      ...entry,
      rateType: "Provisional"
    });
    expect(result.error).toBeNull();
    expect(written).toHaveLength(1);
    expect(
      written[0]!.map((row) => [
        row.periodNumber,
        row.periodRate,
        row.ytdRate,
        row.rateType
      ])
    ).toEqual([
      [10, 0.28, 0.28, "Provisional"],
      [11, 0.28, 0.28, "Provisional"],
      [12, 0.28, 0.28, "Provisional"]
    ]);
  });

  it("setIndirectRate refuses an Actual rate", async () => {
    companyHasFeature.mockResolvedValue(true);
    const { client, written } = recordingClient();
    const result = await setIndirectRate(client, {
      ...entry,
      rateType: "Actual"
    });
    expect(result.error?.message).toEqual(INDIRECT_RATE_ACTUAL_REFUSED);
    expect(written).toEqual([]);
  });
});

// A table read the way PostgREST serves it: the filters a query names, and
// at most the row cap per request, by `range`.
function pagingClient(rows: Record<string, unknown>[], rowCap: number) {
  const client = {
    from: () => {
      const filters: [string, unknown][] = [];
      const query = {
        select: () => query,
        order: () => query,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return query;
        },
        range: async (from: number, to: number) => {
          const kept = rows.filter((row) =>
            filters.every(([column, value]) => row[column] === value)
          );
          return {
            data: kept.slice(from, Math.min(to + 1, from + rowCap)),
            error: null
          };
        },
        then: (resolve: (value: unknown) => unknown) =>
          resolve({ data: rows.slice(0, rowCap), error: null })
      };
      return query;
    }
  };
  return client as never;
}

describe("indirect rates reading", () => {
  it("getIndirectRates returns a year's every rate past the API's row cap", async () => {
    // 27 pools x 12 periods x 4 rate types = 1,296 rows, over a cap of 1,000.
    const year = [...Array(27).keys()].flatMap((pool) =>
      [...Array(12).keys()].flatMap((period) =>
        ["Actual", "Final", "Provisional", "Target"].map((rateType) => ({
          companyId: "company-1",
          fiscalYear: 2026,
          indirectPoolId: `pool-${pool}`,
          periodNumber: period + 1,
          rateType
        }))
      )
    );
    const otherYear = { ...year[0]!, fiscalYear: 2025 };
    const result = await getIndirectRates(
      pagingClient([...year, otherYear], 1000),
      { companyId: "company-1", fiscalYear: 2026 }
    );
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1296);
    expect(result.data).toEqual(year);
  });
});
