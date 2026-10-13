// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { toDocumentApprovalState, withdrawalVerdict } from "./document";

const access = { isRequired: true, canApprove: false };

const decided = {
  id: "req-1",
  requestedBy: "requester",
  decisionBy: "approver",
  decisionNotes: "Needs a drawing",
  decisionAt: "2026-10-08T10:00:00Z"
};

describe("toDocumentApprovalState", () => {
  it("shows a pending request with no last decision", () => {
    const state = toDocumentApprovalState(
      {
        ...decided,
        status: "Pending",
        decisionBy: null,
        decisionNotes: null,
        decisionAt: null
      },
      access
    );

    expect(state.pendingRequestId).toBe("req-1");
    expect(state.pendingRequestedBy).toBe("requester");
    expect(state.lastDecision).toBeNull();
  });

  it("shows the decision of a decided request", () => {
    // The supplier page's "Approved By" / "Rejected By" card and the change
    // notice's "Approval Rejected" badge both read this.
    const state = toDocumentApprovalState(
      { ...decided, status: "Rejected" },
      access
    );

    expect(state.pendingRequestId).toBeNull();
    expect(state.lastDecision).toEqual({
      status: "Rejected",
      decisionBy: "approver",
      notes: "Needs a drawing",
      decisionAt: "2026-10-08T10:00:00Z"
    });
  });

  it("shows nothing for a document that was never submitted", () => {
    const state = toDocumentApprovalState(null, access);

    expect(state.pendingRequestId).toBeNull();
    expect(state.lastDecision).toBeNull();
    expect(state.isRequired).toBe(true);
  });
});

describe("withdrawalVerdict", () => {
  it("refuses when the pending requests could not be read", () => {
    // A failed read used to count as "no one else's request", which let any
    // user withdraw another user's pending quality-document approval.
    const verdict = withdrawalVerdict(
      { data: null, error: { message: "timeout" } },
      "user",
      false
    );

    expect(verdict.error?.code).toBe("failed");
  });

  it("forbids withdrawing someone else's request without approval rights", () => {
    const verdict = withdrawalVerdict(
      { data: [{ requestedBy: "someone-else" }], error: null },
      "user",
      false
    );

    expect(verdict.error?.code).toBe("forbidden");
  });

  it("lets the requester withdraw their own request", () => {
    const verdict = withdrawalVerdict(
      { data: [{ requestedBy: "user" }], error: null },
      "user",
      false
    );

    expect(verdict.error).toBeNull();
  });

  it("lets an approver withdraw anyone's request", () => {
    const verdict = withdrawalVerdict(
      { data: [{ requestedBy: "someone-else" }], error: null },
      "user",
      true
    );

    expect(verdict.error).toBeNull();
  });
});
