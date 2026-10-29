// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  type DueWorkflow,
  OVERFLOW_WAKE_MS,
  planClaims,
  planWakeAt,
  WAKE_CEILING_MS
} from "./scheduler";

describe("planWakeAt", () => {
  const now = new Date("2026-08-01T10:00:00Z");

  it("returns ceiling when earliestFuture is far out", () => {
    const fiveHoursOut = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    expect(
      planWakeAt({ now, earliestFuture: fiveHoursOut, overflow: false })
    ).toBe(now.getTime() + WAKE_CEILING_MS);
  });

  it("returns earliestFuture when it is 90 seconds out", () => {
    const ninetySecondsOut = new Date(now.getTime() + 90 * 1000);
    expect(
      planWakeAt({ now, earliestFuture: ninetySecondsOut, overflow: false })
    ).toBe(ninetySecondsOut.getTime());
  });

  it("returns ceiling when there is no future run", () => {
    expect(planWakeAt({ now, earliestFuture: null, overflow: false })).toBe(
      now.getTime() + WAKE_CEILING_MS
    );
  });

  it("returns overflow delay when overflow is true, ignoring earliestFuture", () => {
    const oneSecondOut = new Date(now.getTime() + 1000);
    expect(
      planWakeAt({ now, earliestFuture: oneSecondOut, overflow: true })
    ).toBe(now.getTime() + OVERFLOW_WAKE_MS);
  });

  it("floors earliestFuture to at least now + 1s", () => {
    const past = new Date(now.getTime() - 1000);
    expect(planWakeAt({ now, earliestFuture: past, overflow: false })).toBe(
      now.getTime() + 1000
    );
  });
});

describe("planClaims", () => {
  const now = new Date("2026-08-01T10:00:00Z");

  const dueRow = (id: string, nodes: unknown): DueWorkflow => ({
    id,
    companyId: "cmp_1",
    ownerId: "usr_1",
    publishedVersionId: "wfv_1",
    nextRunAt: new Date("2026-08-01T09:00:00Z"),
    nodes
  });

  const scheduledNodes = [
    {
      id: "trigger",
      name: "trigger",
      type: "trigger",
      position: { x: 0, y: 0 },
      data: {
        events: [],
        schedule: { freq: "Daily", hour: 9, minute: 0, tz: "UTC" }
      }
    }
  ];

  const eventNodes = [
    {
      id: "trigger",
      name: "trigger",
      type: "trigger",
      position: { x: 0, y: 0 },
      data: { events: ["purchaseOrder.status.changed"] }
    }
  ];

  it("re-books a scheduled workflow from now, not from its due time", () => {
    const { claims, unscheduled } = planClaims(
      [dueRow("wf_1", scheduledNodes)],
      now
    );
    expect(unscheduled).toEqual([]);
    // Due 08-01 09:00 and now 10:00: tomorrow's slot, not today's missed one,
    // so a long outage cannot queue a cascade of catch-ups. The minutes are
    // the workflow's spread offset.
    expect(claims).toHaveLength(1);
    expect(claims[0]?.recomputed).toMatch(/^2026-08-02T09:/);
  });

  it("clears a workflow whose promoted version is no longer scheduled", () => {
    const { claims, unscheduled } = planClaims(
      [dueRow("wf_2", eventNodes)],
      now
    );
    expect(claims).toEqual([]);
    expect(unscheduled.map((row) => row.id)).toEqual(["wf_2"]);
  });

  it("keeps both kinds apart in one wake", () => {
    const { claims, unscheduled } = planClaims(
      [dueRow("wf_1", scheduledNodes), dueRow("wf_2", eventNodes)],
      now
    );
    expect(claims.map((claim) => claim.row.id)).toEqual(["wf_1"]);
    expect(unscheduled.map((row) => row.id)).toEqual(["wf_2"]);
  });
});
