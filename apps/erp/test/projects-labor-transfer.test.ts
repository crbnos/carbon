// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  assertCanApprove,
  LABOR_TRANSFER_SAME_APPROVER
} from "~/modules/projects/projects.models";

const transfer = { correctionOfId: "tse-original", createdBy: "requester" };

describe("assertCanApprove", () => {
  it("refuses the requester's own labor transfer in DCAA mode", () => {
    expect(() =>
      assertCanApprove({
        mode: "DCAA",
        approverId: "requester",
        entry: transfer
      })
    ).toThrow(LABOR_TRANSFER_SAME_APPROVER);
  });

  it("lets another user approve the transfer in DCAA mode", () => {
    expect(() =>
      assertCanApprove({
        mode: "DCAA",
        approverId: "manager",
        entry: transfer
      })
    ).not.toThrow();
  });

  it("lets the requester approve in Standard mode", () => {
    expect(() =>
      assertCanApprove({
        mode: "Standard",
        approverId: "requester",
        entry: transfer
      })
    ).not.toThrow();
  });
});
