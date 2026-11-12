// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { beforeEach, describe, expect, it, vi } from "vitest";

const companyHasFeature = vi.hoisted(() => vi.fn());
vi.mock("../plan.server", () => ({ companyHasFeature }));

import { EntitlementError } from "../entitlements.server";
import {
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
