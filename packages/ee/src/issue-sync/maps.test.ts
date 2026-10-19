// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  groupToJiraCategory,
  groupToLinearType,
  hashText,
  jiraCategoryToGroup,
  jiraToPriority,
  linearToPriority,
  linearTypeToGroup,
  priorityToJira,
  priorityToLinear
} from "./maps";

describe("hashText", () => {
  it("returns null for no value", () => {
    expect(hashText(null)).toBeNull();
    expect(hashText(undefined)).toBeNull();
  });

  it("gives the same hash for the same JSON and a different one otherwise", () => {
    const doc = { type: "doc", content: [{ type: "text", text: "a" }] };
    expect(hashText(doc)).toBe(hashText(structuredClone(doc)));
    expect(hashText(doc)).not.toBe(
      hashText({ type: "doc", content: [{ type: "text", text: "b" }] })
    );
    expect(hashText("# Title")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("state group maps", () => {
  it("maps each group to a Linear type and back", () => {
    expect(groupToLinearType("Backlog")).toBe("backlog");
    expect(groupToLinearType("Unstarted")).toBe("unstarted");
    expect(groupToLinearType("Started")).toBe("started");
    expect(groupToLinearType("Completed")).toBe("completed");
    expect(groupToLinearType("Cancelled")).toBe("canceled");
    expect(linearTypeToGroup("triage")).toBe("Backlog");
    expect(linearTypeToGroup("backlog")).toBe("Backlog");
    expect(linearTypeToGroup("unstarted")).toBe("Unstarted");
    expect(linearTypeToGroup("started")).toBe("Started");
    expect(linearTypeToGroup("completed")).toBe("Completed");
    expect(linearTypeToGroup("canceled")).toBe("Cancelled");
    expect(linearTypeToGroup("duplicate")).toBe("Cancelled");
  });

  it("maps groups to Jira categories and keeps Backlog and Cancelled inbound", () => {
    expect(groupToJiraCategory("Backlog")).toBe("new");
    expect(groupToJiraCategory("Unstarted")).toBe("new");
    expect(groupToJiraCategory("Started")).toBe("indeterminate");
    expect(groupToJiraCategory("Completed")).toBe("done");
    expect(groupToJiraCategory("Cancelled")).toBe("done");
    expect(jiraCategoryToGroup("new", "Backlog")).toBe("Backlog");
    expect(jiraCategoryToGroup("new", "Started")).toBe("Unstarted");
    expect(jiraCategoryToGroup("indeterminate", "Backlog")).toBe("Started");
    expect(jiraCategoryToGroup("done", "Cancelled")).toBe("Cancelled");
    expect(jiraCategoryToGroup("done", "Started")).toBe("Completed");
  });
});

describe("priority maps", () => {
  it("maps element priorities to Linear numbers and back", () => {
    expect(priorityToLinear("None")).toBe(0);
    expect(priorityToLinear("Urgent")).toBe(1);
    expect(priorityToLinear("Low")).toBe(4);
    expect(linearToPriority(1)).toBe("Urgent");
    expect(linearToPriority("4")).toBe("Low");
    expect(linearToPriority(null)).toBe("None");
  });

  it("maps element priorities to Jira names and back", () => {
    expect(priorityToJira("Urgent")).toBe("Highest");
    expect(priorityToJira("None")).toBeNull();
    expect(jiraToPriority("Lowest")).toBe("Low");
    expect(jiraToPriority("Highest")).toBe("Urgent");
    expect(jiraToPriority("Blocker")).toBeNull();
  });
});
