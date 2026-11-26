// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

const formWeeks = [
  { id: "period-1", startDate: "2026-11-22" },
  { id: "period-2", startDate: "2026-11-29" }
];

vi.mock("@carbon/ee/forecast.server", () => ({
  deleteDemandProjections: vi.fn(async () => ({ data: null, error: null })),
  upsertDemandProjections: vi.fn(async () => ({ data: [], error: null }))
}));

import { createServiceContext } from "@carbon/api/service-fn.server";
import {
  deleteDemandProjections as eeDeleteDemandProjections,
  upsertDemandProjections
} from "@carbon/ee/forecast.server";
import { EntitlementError } from "@carbon/ee/entitlements.server";
import { clearDemandProjections } from "../app/modules/production/production.service";
import { pageClaims } from "./page-claims";

// The delete is the stubbed ee call: the client is only handed on to it.
const caller = {};

const ctx = () =>
  createServiceContext({
    actor: {
      type: "user",
      role: "employee",
      userId: "user-1",
      permissions: pageClaims({
        production: {
          view: ["company-1"],
          create: ["company-1"],
          update: ["company-1"],
          delete: ["company-1"]
        }
      })
    },
    company: { id: "company-1", groupId: "group-1" },
    caller: caller as never,
    system: () => caller as never,
    pg: () => ({}) as never,
    kv: () => ({}) as never
  });

beforeEach(() => {
  vi.mocked(eeDeleteDemandProjections).mockClear();
  vi.mocked(upsertDemandProjections).mockClear();
});

describe("clearDemandProjections", () => {
  // A delete per week, sent at once, left some weeks behind when one failed.
  it("removes the form's weeks in one delete and answers each at 0", async () => {
    const result = await clearDemandProjections(
      ctx(),
      { itemId: "item-1", locationId: "location-1" },
      formWeeks
    );

    expect(result).toEqual({
      itemId: "item-1",
      locationId: "location-1",
      weeks: [
        { weekStart: "2026-11-22", periodId: "period-1", quantity: 0 },
        { weekStart: "2026-11-29", periodId: "period-2", quantity: 0 }
      ]
    });
    expect(vi.mocked(eeDeleteDemandProjections).mock.calls).toEqual([
      [
        caller,
        {
          itemId: "item-1",
          locationId: "location-1",
          companyId: "company-1",
          futurePeriodIds: ["period-1", "period-2"]
        }
      ]
    ]);
    expect(upsertDemandProjections).not.toHaveBeenCalled();
  });

  it("answers a company without demand forecasting with an entitlement error", async () => {
    vi.mocked(eeDeleteDemandProjections).mockRejectedValueOnce(
      new EntitlementError("FORECAST")
    );

    const result = await clearDemandProjections(
      ctx(),
      { itemId: "item-1", locationId: "location-1" },
      formWeeks
    );

    expect(result).toMatchObject({ category: "entitlement" });
  });
});
