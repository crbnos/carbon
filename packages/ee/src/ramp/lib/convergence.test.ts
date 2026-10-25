// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  extractEntityIds,
  planRampConvergence,
  type RampConvergencePlan
} from "./convergence";

type Metadata = Parameters<typeof planRampConvergence>[0];

function base(overrides: Partial<Metadata> = {}): Metadata {
  return {
    syncMode: "provider",
    cardLiabilityAccountId: "account-1",
    ...overrides
  };
}

const providerReady: RampConvergencePlan = {
  claimConnection: true,
  refreshConnectionOwner: false,
  validateEntityId: null,
  pushCodingMasters: true,
  launchSync: true
};

describe("planRampConvergence", () => {
  it("claims the connection, pushes coding masters and syncs in provider mode", () => {
    expect(planRampConvergence(base())).toEqual(providerReady);
  });

  it("treats an install with no stored mode as provider", () => {
    // Every install predating modes must keep claiming its connection.
    expect(planRampConvergence(base({ syncMode: undefined }))).toEqual(
      providerReady
    );
  });

  it("connects but pushes and syncs nothing until the card liability account is mapped", () => {
    expect(
      planRampConvergence(
        base({ cardLiabilityAccountId: undefined, entityId: "entity-1" })
      )
    ).toEqual({
      claimConnection: true,
      refreshConnectionOwner: false,
      validateEntityId: null,
      pushCodingMasters: false,
      launchSync: false
    });
  });

  it.each([["account-1"], [undefined]])(
    "in push-only never claims the connection or pushes masters, but still syncs (card liability %s)",
    (cardLiabilityAccountId) => {
      // Ramp allows one accounting connection; push-only leaves it to the
      // customer's other system, and has no card journal to need the account.
      expect(
        planRampConvergence(
          base({ syncMode: "push-only", cardLiabilityAccountId })
        )
      ).toEqual({
        claimConnection: false,
        refreshConnectionOwner: true,
        validateEntityId: null,
        pushCodingMasters: false,
        launchSync: true
      });
    }
  );

  it("validates a configured entity before pushing", () => {
    expect(planRampConvergence(base({ entityId: "entity-1" }))).toEqual({
      ...providerReady,
      validateEntityId: "entity-1"
    });
  });
});

describe("extractEntityIds", () => {
  it.each([
    ["{ data }", { data: [{ id: "a" }, { id: "b" }] }],
    ["{ entities }", { entities: [{ id: "a" }, { id: "b" }] }],
    ["a bare array", [{ id: "a" }, { id: "b" }]]
  ])("reads ids from %s", (_shape, response) => {
    expect(extractEntityIds(response)).toEqual(new Set(["a", "b"]));
  });

  it("skips rows without a string id and unknown shapes", () => {
    expect(
      extractEntityIds({ data: [{ id: 7 }, null, { name: "x" }, { id: "a" }] })
    ).toEqual(new Set(["a"]));
    expect(extractEntityIds({ rows: [{ id: "a" }] })).toEqual(new Set());
    expect(extractEntityIds(null)).toEqual(new Set());
  });
});
