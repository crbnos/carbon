// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { carbonValues, linearValues } from "./canonical";

const row = {
  id: "t1",
  status: "In Progress",
  assignee: "u1",
  dueDate: "2026-11-01",
  notes: { type: "doc", content: [{ type: "paragraph" }] }
};

describe("carbonValues", () => {
  it("gives the same values for the same row", () => {
    expect(carbonValues("nonConformanceActionTask", row)).toEqual(
      carbonValues("nonConformanceActionTask", structuredClone(row))
    );
  });

  it("changes only the description when the notes change", () => {
    const before = carbonValues("nonConformanceActionTask", row);
    const after = carbonValues("nonConformanceActionTask", {
      ...row,
      notes: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }]
      }
    });
    expect(after.description).not.toBe(before.description);
    expect({ ...after, description: null }).toEqual({
      ...before,
      description: null
    });
  });
});

describe("linearValues", () => {
  it("lowercases the assignee email and treats an empty description as none", () => {
    expect(
      linearValues({
        id: "i1",
        title: "T",
        url: "u",
        identifier: "ENG-1",
        description: "",
        state: { name: "Todo", color: "#000", type: "unstarted" as any },
        assignee: { email: "A@X.com" }
      })
    ).toEqual({
      title: "T",
      status: "unstarted",
      assignee: "a@x.com",
      priority: "0",
      dueDate: null,
      description: null
    });
  });
});

describe("carbonValues for a project element", () => {
  it("uses the state's group, the name, the owner and the target date", () => {
    expect(
      carbonValues(
        "projectElement",
        {
          id: "e1",
          name: "Bracket",
          stateId: "s1",
          ownerId: "u1",
          priority: "High",
          targetDate: "2026-12-01",
          description: null
        },
        { stateGroupById: new Map([["s1", "Started" as const]]) }
      )
    ).toEqual({
      title: "Bracket",
      status: "Started",
      assignee: "u1",
      priority: "High",
      dueDate: "2026-12-01",
      description: null
    });
  });
});
