// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  isProjectPlanLocked,
  projectPlanLockedMessage
} from "~/modules/projects/projects.models";

describe("the plan lock", () => {
  it("is unlocked with no lock milestone", () => {
    expect(isProjectPlanLocked({ lockMilestone: null })).toBe(false);
  });

  it("is unlocked while the lock milestone is not completed", () => {
    expect(isProjectPlanLocked({ lockMilestone: { completedAt: null } })).toBe(
      false
    );
  });

  it("is locked after the lock milestone completes, and names it", () => {
    expect(
      isProjectPlanLocked({
        lockMilestone: { completedAt: "2026-10-09T10:00:00Z" }
      })
    ).toBe(true);
    expect(projectPlanLockedMessage("Critical Design Review")).toBe(
      "The plan is locked after Critical Design Review. Open a change request to change it."
    );
  });
});
