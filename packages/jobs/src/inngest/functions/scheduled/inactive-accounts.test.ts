import { describe, expect, it } from "vitest";
import {
  type InactiveAccountCandidate,
  selectInactiveAccounts
} from "./inactive-accounts";

const NOW = "2026-08-18T12:00:00.000Z";

function candidate(
  overrides: Partial<InactiveAccountCandidate> &
    Pick<InactiveAccountCandidate, "userId">
): InactiveAccountCandidate {
  return {
    companyId: "co-1",
    lastSignInAt: null,
    createdAt: "2020-01-01T00:00:00.000Z",
    protected: false,
    ...overrides
  };
}

describe("selectInactiveAccounts", () => {
  it("keeps an account whose last sign-in is within the threshold", () => {
    // 10 days ago — well within a 35-day threshold.
    const result = selectInactiveAccounts(
      [candidate({ userId: "u1", lastSignInAt: "2026-08-08T12:00:00.000Z" })],
      { nowIso: NOW, thresholdDays: 35 }
    );
    expect(result).toEqual([]);
  });

  it("selects an account idle beyond the threshold", () => {
    // 40 days ago — past a 35-day threshold.
    const result = selectInactiveAccounts(
      [candidate({ userId: "u1", lastSignInAt: "2026-07-09T12:00:00.000Z" })],
      { nowIso: NOW, thresholdDays: 35 }
    );
    expect(result).toEqual([
      {
        userId: "u1",
        companyId: "co-1",
        lastActivityAt: "2026-07-09T12:00:00.000Z"
      }
    ]);
  });

  it("treats a sign-in exactly at the cutoff as still active (not idle)", () => {
    // Exactly 35 days ago — the boundary is inclusive of activity.
    const result = selectInactiveAccounts(
      [candidate({ userId: "u1", lastSignInAt: "2026-07-14T12:00:00.000Z" })],
      { nowIso: NOW, thresholdDays: 35 }
    );
    expect(result).toEqual([]);
  });

  it("never selects a protected account, however idle", () => {
    const result = selectInactiveAccounts(
      [
        candidate({
          userId: "admin",
          lastSignInAt: "2000-01-01T00:00:00.000Z",
          protected: true
        })
      ],
      { nowIso: NOW, thresholdDays: 35 }
    );
    expect(result).toEqual([]);
  });

  it("never selects an account in the system/acting exclusion set", () => {
    const result = selectInactiveAccounts(
      [
        candidate({
          userId: "system-user",
          lastSignInAt: "2000-01-01T00:00:00.000Z"
        })
      ],
      { nowIso: NOW, thresholdDays: 35, systemUserIds: ["system-user"] }
    );
    expect(result).toEqual([]);
  });

  it("floors to createdAt when there is no login record — recent creation is kept", () => {
    // Never logged in, created 5 days ago → not yet idle.
    const result = selectInactiveAccounts(
      [
        candidate({
          userId: "u1",
          lastSignInAt: null,
          createdAt: "2026-08-13T12:00:00.000Z"
        })
      ],
      { nowIso: NOW, thresholdDays: 35 }
    );
    expect(result).toEqual([]);
  });

  it("floors to createdAt when there is no login record — old creation is idle", () => {
    // Never logged in, created 100 days ago → abandoned, select it.
    const result = selectInactiveAccounts(
      [
        candidate({
          userId: "u1",
          lastSignInAt: null,
          createdAt: "2026-05-10T12:00:00.000Z"
        })
      ],
      { nowIso: NOW, thresholdDays: 35 }
    );
    expect(result).toEqual([
      {
        userId: "u1",
        companyId: "co-1",
        lastActivityAt: "2026-05-10T12:00:00.000Z"
      }
    ]);
  });

  it("returns nothing when the threshold is not a positive finite number (safety)", () => {
    const idle = candidate({
      userId: "u1",
      lastSignInAt: "2000-01-01T00:00:00.000Z"
    });
    expect(
      selectInactiveAccounts([idle], { nowIso: NOW, thresholdDays: 0 })
    ).toEqual([]);
    expect(
      selectInactiveAccounts([idle], { nowIso: NOW, thresholdDays: -5 })
    ).toEqual([]);
    expect(
      selectInactiveAccounts([idle], { nowIso: NOW, thresholdDays: NaN })
    ).toEqual([]);
  });

  it("skips a candidate with an unparseable activity instant rather than deactivating on bad data", () => {
    const result = selectInactiveAccounts(
      [
        candidate({
          userId: "u1",
          lastSignInAt: "not-a-timestamp",
          createdAt: "also-bad"
        })
      ],
      { nowIso: NOW, thresholdDays: 35 }
    );
    expect(result).toEqual([]);
  });

  it("evaluates each membership independently across companies", () => {
    const result = selectInactiveAccounts(
      [
        candidate({
          userId: "u1",
          companyId: "co-1",
          lastSignInAt: "2026-07-09T12:00:00.000Z"
        }),
        candidate({
          userId: "u1",
          companyId: "co-2",
          lastSignInAt: "2026-08-15T12:00:00.000Z"
        })
      ],
      { nowIso: NOW, thresholdDays: 35 }
    );
    expect(result).toEqual([
      {
        userId: "u1",
        companyId: "co-1",
        lastActivityAt: "2026-07-09T12:00:00.000Z"
      }
    ]);
  });
});
