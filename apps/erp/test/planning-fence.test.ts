// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  actionsInsideFence,
  effectiveFenceDate,
  isInsideFence,
  splitOrdersByFence
} from "../app/modules/production/ui/Planning/planning-fence";

describe("isInsideFence", () => {
  it("has no fence when the fence date is null", () => {
    expect(isInsideFence("2027-01-01", null)).toBe(true);
  });

  it("is inclusive of the fence date itself", () => {
    expect(isInsideFence("2026-10-31", "2026-10-31")).toBe(true);
    expect(isInsideFence("2026-11-01", "2026-10-31")).toBe(false);
  });

  it("keeps an undated suggestion visible", () => {
    expect(isInsideFence(null, "2026-10-31")).toBe(true);
    expect(isInsideFence(undefined, "2026-10-31")).toBe(true);
  });
});

describe("effectiveFenceDate", () => {
  it("prefers the on-screen override over the saved horizon", () => {
    expect(effectiveFenceDate("2026-10-31", "2026-12-30")).toBe("2026-12-30");
  });

  it("falls back to the saved horizon, then to no fence", () => {
    expect(effectiveFenceDate("2026-10-31", undefined)).toBe("2026-10-31");
    expect(effectiveFenceDate(null, undefined)).toBeNull();
    expect(effectiveFenceDate(undefined, null)).toBeNull();
  });

  it("has no fence when the planner cleared a saved horizon", () => {
    expect(effectiveFenceDate("2026-10-31", null)).toBeNull();
  });
});

describe("actionsInsideFence", () => {
  const actions = [
    // a Defer: its order sits inside the fence though the need is far out
    { id: "defer", horizonDate: "2026-10-08" },
    { id: "order-near", horizonDate: "2026-10-04" },
    { id: "order-far", horizonDate: "2026-11-29" }
  ];

  it("returns everything when there is no fence", () => {
    expect(actionsInsideFence(actions, null)).toBe(actions);
  });

  it("keeps only the actions dated on or before the fence", () => {
    expect(
      actionsInsideFence(actions, "2026-10-31").map((a) => a.id)
    ).toEqual(["defer", "order-near"]);
  });

  it("widening the fence brings the rest back", () => {
    expect(actionsInsideFence(actions, "2026-12-30")).toHaveLength(3);
  });
});

describe("splitOrdersByFence", () => {
  const orders = [
    { id: 1, dueDate: "2026-10-04" },
    { id: 2, dueDate: "2026-10-31" },
    { id: 3, dueDate: "2026-11-29" },
    { id: 4, dueDate: null }
  ];

  it("puts every order inside when there is no fence", () => {
    expect(splitOrdersByFence(orders, null)).toEqual({
      inside: orders,
      beyond: []
    });
  });

  it("splits on the required date, fence day included", () => {
    const { inside, beyond } = splitOrdersByFence(orders, "2026-10-31");
    expect(inside.map((o) => o.id)).toEqual([1, 2, 4]);
    expect(beyond.map((o) => o.id)).toEqual([3]);
  });
});
