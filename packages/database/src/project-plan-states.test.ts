// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { completedAtForGroup, pickStateForGroup } from "./project-plan";

const states = [
  { id: "todo", group: "Unstarted" as const, isDefault: true, sortOrder: 1 },
  { id: "doing", group: "Started" as const, isDefault: true, sortOrder: 2 },
  { id: "review", group: "Started" as const, isDefault: false, sortOrder: 3 },
  { id: "done", group: "Completed" as const, isDefault: false, sortOrder: 5 },
  { id: "shipped", group: "Completed" as const, isDefault: false, sortOrder: 4 }
];

describe("pickStateForGroup", () => {
  it("keeps the current state when it is already in the group", () => {
    expect(pickStateForGroup(states, "Started", "review")).toBe("review");
  });

  it("takes the group's default state otherwise", () => {
    expect(pickStateForGroup(states, "Started", "todo")).toBe("doing");
  });

  it("takes the first state by sortOrder when the group has no default", () => {
    expect(pickStateForGroup(states, "Completed", "todo")).toBe("shipped");
  });

  it("returns null when the company has no state in the group", () => {
    expect(pickStateForGroup(states, "Cancelled", "todo")).toBeNull();
  });
});

describe("completedAtForGroup", () => {
  it("sets the time for Completed and clears it otherwise", () => {
    expect(completedAtForGroup("Completed", "2026-10-19T00:00:00Z")).toBe(
      "2026-10-19T00:00:00Z"
    );
    expect(completedAtForGroup("Started", "2026-10-19T00:00:00Z")).toBeNull();
  });
});
