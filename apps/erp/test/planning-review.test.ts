// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/content/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => []
}));

import {
  isPlanningActionLate,
  isStaleRelease,
  planningActionDot,
  planningActionNeedsReview,
  purchaseOrderPlanningMenu,
  type ReviewableAction
} from "../app/modules/production/ui/Planning/planning-review";

const poAction = (overrides: Partial<ReviewableAction>): ReviewableAction => ({
  type: "Increase",
  requiresManualAction: true,
  purchaseOrderLineId: "line-1",
  purchaseOrderStatus: "To Receive",
  purchaseOrderLinePromisedDate: null,
  jobId: null,
  jobStatus: null,
  ...overrides
});

describe("planningActionNeedsReview", () => {
  it("reviews an action on a PO that was sent", () => {
    expect(planningActionNeedsReview(poAction({}))).toBe(true);
  });

  it("applies once the PO is reopened, before MRP runs again", () => {
    // MRP's stamp still says review; the live status says Planned
    expect(
      planningActionNeedsReview(poAction({ purchaseOrderStatus: "Planned" }))
    ).toBe(false);
  });

  it("reviews a PO waiting for approval", () => {
    expect(
      planningActionNeedsReview(
        poAction({
          purchaseOrderStatus: "Needs Approval",
          requiresManualAction: false
        })
      )
    ).toBe(true);
  });

  it("reviews a date move on a promised line, even on a Planned PO", () => {
    for (const type of ["Expedite", "Defer"]) {
      expect(
        planningActionNeedsReview(
          poAction({
            type,
            purchaseOrderStatus: "Planned",
            purchaseOrderLinePromisedDate: "2026-10-20"
          })
        )
      ).toBe(true);
    }
  });

  it("applies a quantity change on a promised line", () => {
    expect(
      planningActionNeedsReview(
        poAction({
          purchaseOrderStatus: "Planned",
          purchaseOrderLinePromisedDate: "2026-10-20"
        })
      )
    ).toBe(false);
  });

  it("follows the job's live status", () => {
    const jobAction = poAction({
      purchaseOrderLineId: null,
      purchaseOrderStatus: null,
      jobId: "job-1"
    });
    expect(planningActionNeedsReview({ ...jobAction, jobStatus: "Ready" })).toBe(
      true
    );
    expect(
      planningActionNeedsReview({ ...jobAction, jobStatus: "Planned" })
    ).toBe(false);
  });

  it("falls back to MRP's stamp when the order was not read", () => {
    expect(
      planningActionNeedsReview(poAction({ purchaseOrderStatus: null }))
    ).toBe(true);
    expect(
      planningActionNeedsReview(
        poAction({ purchaseOrderStatus: null, requiresManualAction: false })
      )
    ).toBe(false);
  });
});

describe("purchaseOrderPlanningMenu", () => {
  it("offers reopen and a revision on a sent PO", () => {
    expect(
      purchaseOrderPlanningMenu({
        id: "po",
        status: "To Receive",
        orderDate: "2026-09-01"
      })
    ).toEqual({ canReopen: true, canReopenAsRevision: true, canFinalize: false });
  });

  it("offers no revision on a PO that never reached the supplier", () => {
    expect(
      purchaseOrderPlanningMenu({
        id: "po",
        status: "Needs Approval",
        orderDate: null
      })
    ).toEqual({
      canReopen: true,
      canReopenAsRevision: false,
      canFinalize: false
    });
  });

  it("offers finalize on a Draft or Planned PO", () => {
    for (const status of ["Draft", "Planned"] as const) {
      expect(
        purchaseOrderPlanningMenu({ id: "po", status, orderDate: null })
      ).toEqual({
        canReopen: false,
        canReopenAsRevision: false,
        canFinalize: true
      });
    }
  });

  it("offers nothing when the status is unknown", () => {
    expect(
      purchaseOrderPlanningMenu({ id: "po", status: null, orderDate: null })
    ).toEqual({
      canReopen: false,
      canReopenAsRevision: false,
      canFinalize: false
    });
  });
});

describe("planningActionDot", () => {
  const open = (type: string, isASAP: boolean) => ({
    type,
    status: "Open",
    isASAP
  });

  it("is red for an ASAP action that adds or advances supply", () => {
    for (const type of ["Order", "Make", "Expedite", "Increase"]) {
      expect(planningActionDot([open(type, true)])).toBe("red");
    }
  });

  it("is green for an on-time action that adds or advances supply", () => {
    for (const type of ["Order", "Make", "Expedite", "Increase"]) {
      expect(planningActionDot([open(type, false)])).toBe("green");
    }
  });

  it("is not lit by a Decrease, Defer or Cancel, whatever its flag", () => {
    for (const type of ["Decrease", "Defer", "Cancel"]) {
      expect(planningActionDot([open(type, true)])).toBeNull();
      expect(planningActionDot([open(type, false)])).toBeNull();
    }
  });

  it("follows the supply actions when a Decrease sits beside them", () => {
    expect(
      planningActionDot([open("Decrease", false), open("Increase", false)])
    ).toBe("green");
    expect(
      planningActionDot([open("Cancel", false), open("Order", true)])
    ).toBe("red");
  });

  it("is null when nothing is open", () => {
    expect(
      planningActionDot([{ type: "Order", status: "Dismissed", isASAP: true }])
    ).toBeNull();
  });
});

describe("isPlanningActionLate", () => {
  const today = "2026-10-06";
  const action = (type: string, suggestedDate: string) => ({
    type,
    status: "Open",
    isASAP: false,
    suggestedDate
  });

  it("marks an urgent action whose date has passed", () => {
    expect(isPlanningActionLate(action("Expedite", "2026-10-04"), today)).toBe(
      true
    );
    expect(isPlanningActionLate(action("Order", "2026-10-07"), today)).toBe(
      false
    );
  });

  // A Decrease is dated where its order sits; an overdue order is not a
  // late decrease.
  it("never marks a Decrease, Defer or Cancel late", () => {
    for (const type of ["Decrease", "Defer", "Cancel"]) {
      expect(isPlanningActionLate(action(type, "2026-10-04"), today)).toBe(
        false
      );
    }
  });

  it("never marks a dismissed action late", () => {
    expect(
      isPlanningActionLate(
        { ...action("Order", "2026-10-01"), status: "Dismissed" },
        today
      )
    ).toBe(false);
  });
});

describe("Release", () => {
  const today = "2026-10-06";
  const release = (suggestedDate: string, isASAP: boolean) => ({
    type: "Release",
    status: "Open",
    isASAP,
    suggestedDate
  });

  // Every planned order has one: a green dot for each would say nothing.
  it("lights the dot red once its day has come, and not before", () => {
    expect(planningActionDot([release(today, true)])).toBe("red");
    expect(planningActionDot([release("2026-10-20", false)])).toBeNull();
    expect(
      planningActionDot([
        release("2026-10-20", false),
        { type: "Order", status: "Open", isASAP: false }
      ])
    ).toBe("green");
  });

  it("is late once its day has passed, not on the day", () => {
    expect(isPlanningActionLate(release(today, true), today)).toBe(false);
    expect(isPlanningActionLate(release("2026-10-05", true), today)).toBe(true);
  });

  const target = {
    type: "Release",
    purchaseOrderLineId: "pol-1",
    purchaseOrderStatus: "Planned" as const,
    jobId: null,
    jobStatus: null
  };

  it("applies only while its order is Planned", () => {
    expect(isStaleRelease(target)).toBe(false);
    expect(
      isStaleRelease({ ...target, purchaseOrderStatus: "To Receive" })
    ).toBe(true);
    expect(
      isStaleRelease({
        ...target,
        purchaseOrderLineId: null,
        purchaseOrderStatus: null,
        jobId: "job-1",
        jobStatus: "Ready"
      })
    ).toBe(true);
    expect(
      isStaleRelease({
        ...target,
        purchaseOrderLineId: null,
        purchaseOrderStatus: null,
        jobId: "job-1",
        jobStatus: "Planned"
      })
    ).toBe(false);
  });

  it("keeps a Release whose order status was not read", () => {
    expect(isStaleRelease({ ...target, purchaseOrderStatus: null })).toBe(false);
  });

  it("is never stale for another action type", () => {
    expect(
      isStaleRelease({
        ...target,
        type: "Increase",
        purchaseOrderStatus: "To Receive"
      })
    ).toBe(false);
  });
});
