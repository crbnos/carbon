// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { lockedFields } from "./locks";

describe("lockedFields", () => {
  it("locks every field of a task on a Done or Cancelled change notice", () => {
    for (const status of ["Done", "Cancelled"]) {
      expect(
        lockedFields("changeOrderActionTask", { changeNoticeStatus: status })
      ).toEqual({
        fields: ["status", "assignee", "dueDate", "description"],
        reason: "the change notice is closed"
      });
    }
  });

  it("locks nothing while the change notice is open", () => {
    expect(
      lockedFields("changeOrderActionTask", {
        changeNoticeStatus: "Implementation"
      })
    ).toBeNull();
  });

  it("locks nothing on a quality action task", () => {
    expect(lockedFields("nonConformanceActionTask", {})).toBeNull();
  });
});

describe("lockedFields for a project element", () => {
  it("refuses only the name and description while the plan is locked", () => {
    expect(lockedFields("projectElement", { planLocked: true })).toEqual({
      fields: ["title", "description"],
      reason: "the project plan is locked"
    });
  });

  it("refuses every field of a Closed project, even with a locked plan", () => {
    expect(
      lockedFields("projectElement", {
        projectStatus: "Closed",
        planLocked: true
      })
    ).toEqual({
      fields: [
        "title",
        "description",
        "status",
        "assignee",
        "priority",
        "dueDate"
      ],
      reason: "the project is closed"
    });
  });

  it("refuses nothing on an open project with an open plan", () => {
    expect(
      lockedFields("projectElement", { projectStatus: "Released" })
    ).toBeNull();
  });
});
