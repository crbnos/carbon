// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  moduleLanding,
  orderedGroups,
  submoduleKey,
  submoduleLayout,
  visibleGroups
} from "./submodule-visibility";

const parts = { to: "/x/items/parts" };
const materials = { to: "/x/items/materials" };
const tools = { to: "/x/items/tools" };
const units = { to: "/x/items/units" };
const groups = [
  { name: "Items", routes: [parts, materials, tools] },
  { name: "Configure", routes: [units] }
];

const layout = (hidden: string[], order: string[] = []) => ({
  hidden: new Set(hidden),
  order: new Map(order.map((key, index) => [key, index]))
});

describe("submoduleKey", () => {
  it("tells apart links that differ only by q", () => {
    const all = { to: "/x/documents/search" };
    const mine = { to: "/x/documents/search", q: "my" };
    expect(submoduleKey(all)).toBe("/x/documents/search");
    expect(submoduleKey(mine)).toBe("/x/documents/search?q=my");
  });
});

describe("submoduleLayout", () => {
  it("joins the lists of every module row", () => {
    const result = submoduleLayout([
      { hiddenSubmodules: [parts.to], submoduleOrder: [tools.to, parts.to] },
      { hiddenSubmodules: [], submoduleOrder: [units.to] },
      {}
    ]);
    expect([...result.hidden]).toEqual([parts.to]);
    expect([...result.order]).toEqual([
      [tools.to, 0],
      [parts.to, 1],
      [units.to, 0]
    ]);
  });
});

describe("orderedGroups", () => {
  it("puts each group in the user's order", () => {
    const result = orderedGroups(
      groups,
      layout([], [tools.to, parts.to, materials.to]).order
    );
    expect(result[0].routes).toEqual([tools, parts, materials]);
    expect(result[1].routes).toEqual([units]);
  });

  it("puts a sub-module with no saved place last, in code order", () => {
    const result = orderedGroups(groups, layout([], [tools.to]).order);
    expect(result[0].routes).toEqual([tools, parts, materials]);
  });
});

describe("visibleGroups", () => {
  it("removes hidden routes and keeps the rest of the group", () => {
    const result = visibleGroups(groups, new Set([parts.to]));
    expect(result[0].routes).toEqual([materials, tools]);
  });

  it("removes a group with no routes left", () => {
    const result = visibleGroups(groups, new Set([units.to]));
    expect(result.map((group) => group.name)).toEqual(["Items"]);
  });

  it("shows everything if the user hid all that they can still see", () => {
    const hidden = new Set([parts.to, materials.to, tools.to, units.to]);
    expect(visibleGroups(groups, hidden)).toEqual(groups);
  });
});

describe("moduleLanding", () => {
  it("keeps the link if the module does not open on a hidden sub-module", () => {
    expect(moduleLanding(parts.to, parts.to, groups, layout([units.to]))).toBe(
      parts.to
    );
  });

  it("opens on the first sub-module left", () => {
    expect(moduleLanding(parts.to, parts.to, groups, layout([parts.to]))).toBe(
      materials.to
    );
  });

  it("opens on the first sub-module left in the user's order", () => {
    const moved = layout([parts.to], [tools.to, parts.to, materials.to]);
    expect(moduleLanding(parts.to, parts.to, groups, moved)).toBe(tools.to);
  });

  it("skips a sub-module outside the module, which has no module sidebar", () => {
    const projects = { to: "/x/projects" };
    const myTime = { to: "/x/timesheet" };
    const reports = { to: "/x/projects/reports" };
    const manage = [{ name: "Manage", routes: [projects, myTime, reports] }];
    expect(
      moduleLanding(projects.to, projects.to, manage, layout([projects.to]))
    ).toBe(reports.to);
  });

  it("opens the hidden sub-module if nothing else is left inside the module", () => {
    const projects = { to: "/x/projects" };
    const myTime = { to: "/x/timesheet" };
    const manage = [{ name: "Manage", routes: [projects, myTime] }];
    expect(
      moduleLanding(projects.to, projects.to, manage, layout([projects.to]))
    ).toBe(projects.to);
  });

  it("follows a module link that redirects to a hidden sub-module", () => {
    expect(
      moduleLanding("/x/items", parts.to, groups, layout([parts.to]))
    ).toBe(materials.to);
  });

  it("carries the q of the first sub-module left", () => {
    const all = { to: "/x/documents/search" };
    const mine = { to: "/x/documents/search", q: "my" };
    const documents = [{ name: "", routes: [all, mine] }];
    expect(moduleLanding(all.to, all.to, documents, layout([all.to]))).toBe(
      "/x/documents/search?q=my"
    );
  });
});
