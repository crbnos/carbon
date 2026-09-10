import { describe, expect, it, vi } from "vitest";

// vitest doesn't run the Lingui macro transform, so `msg` must be stubbed
// before the module under test loads (same pattern as ui/Builder/ports.test.ts).
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""),
      ""
    )
}));

import { areaLabel, BACKUP_SUMMARY_GROUPS, tableArea } from "./backups.areas";

describe("tableArea", () => {
  it("maps a headline entity to its popover group", () => {
    expect(tableArea("salesOrder")).toBe("sales");
    expect(tableArea("job")).toBe("production");
  });

  it("maps a child table the popover never lists", () => {
    // The disclosure screen names tables the popover has no headline for, so
    // the map has to reach further than the groups do.
    expect(tableArea("jobOperationDependency")).toBe("production");
    expect(tableArea("salesOrderLine")).toBe("sales");
  });

  it("returns other for an unmapped table rather than guessing", () => {
    expect(tableArea("someTableThatDoesNotExist")).toBe("other");
  });

  it("keeps every group's own tables consistent with the group area", () => {
    // Guards against the two sources drifting: a table listed under quality in
    // the popover must not resolve to items on the disclosure screen.
    for (const group of BACKUP_SUMMARY_GROUPS) {
      for (const [, table] of group.entities) {
        expect(tableArea(table)).toBe(group.area);
      }
    }
  });
});

describe("areaLabel", () => {
  it("has copy for every area a table can resolve to", () => {
    for (const group of BACKUP_SUMMARY_GROUPS) {
      expect(areaLabel(group.area)).toBeTruthy();
    }
    expect(areaLabel("other")).toBeTruthy();
  });

  it("reads an unknown key as Other instead of crashing", () => {
    expect(areaLabel("nonsense")).toBe(areaLabel("other"));
  });
});
