// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { ProjectElementLinkRef } from "~/modules/projects/projects.models";
import { canLink } from "~/modules/projects/projects.models";

const requirement = { id: "req", type: "Requirement" as const };
const testCase = { id: "test", type: "Test Case" as const };
const task = { id: "task", type: "Task" as const };

describe("canLink", () => {
  it("allows a Test Case to verify a Requirement", () => {
    expect(canLink(testCase, requirement, "verifies", [])).toEqual({
      ok: true
    });
  });

  it("refuses a Task that verifies a Requirement", () => {
    expect(canLink(task, requirement, "verifies", []).ok).toBe(false);
  });

  it("refuses a self link", () => {
    expect(canLink(task, task, "relates to", []).ok).toBe(false);
  });

  it("refuses a duplicate", () => {
    const existing: ProjectElementLinkRef[] = [
      { fromElementId: "test", toElementId: "req", linkType: "verifies" }
    ];
    expect(canLink(testCase, requirement, "verifies", existing).ok).toBe(false);
  });

  it("refuses a cycle of precedes links", () => {
    const a = { id: "a", type: "Task" as const };
    const c = { id: "c", type: "Task" as const };
    const existing: ProjectElementLinkRef[] = [
      { fromElementId: "a", toElementId: "b", linkType: "precedes" },
      { fromElementId: "b", toElementId: "c", linkType: "precedes" }
    ];
    expect(canLink(c, a, "precedes", existing).ok).toBe(false);
    // The same ends with another link type are not a cycle.
    expect(canLink(c, a, "blocks", existing).ok).toBe(true);
  });

  it("refuses a feeds link that a user makes", () => {
    const p1 = { id: "p1", type: "Parameter" as const };
    const p2 = { id: "p2", type: "Parameter" as const };
    expect(canLink(p1, p2, "feeds", []).ok).toBe(false);
  });
});
