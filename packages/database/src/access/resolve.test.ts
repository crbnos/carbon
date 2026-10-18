// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import cases from "./cases.json";
import { roundUp } from "./levels";
import { clampLevel, PAGES, REGISTRY_HASH } from "./registry";
import {
  expandClaims,
  type Grant,
  holds,
  holdsAny,
  type RawClaims,
  resolveLevel
} from "./resolve";

describe("resolveLevel", () => {
  it.each(cases)("$name", ({ grants, admin, pageId, expected }) => {
    expect(resolveLevel(grants as Grant[], pageId, { admin })).toBe(expected);
  });
});

describe("roundUp", () => {
  it.each([
    [{}, "None"],
    [{ view: true }, "View"],
    [{ view: true, create: true }, "Create"],
    [{ view: true, update: true }, "Edit"],
    [{ create: true }, "Create"],
    [{ view: true, delete: true }, "Full"],
    [{ view: true, create: true, update: true, delete: true }, "Full"]
  ] as const)("%o → %s", (flags, level) => {
    expect(roundUp(flags)).toBe(level);
  });
});

describe("clampLevel", () => {
  it("keeps a level at or below the page's maxLevel", () => {
    expect(clampLevel("inventory", "Edit")).toBe("Edit");
    expect(clampLevel("inventory", "Full")).toBe("Full");
  });

  it("leaves an unknown page alone", () => {
    expect(clampLevel("inventory.nowhere", "Full")).toBe("Full");
  });
});

describe("REGISTRY_HASH", () => {
  it("is eight hex characters", () => {
    expect(REGISTRY_HASH).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("expandClaims", () => {
  const raw: RawClaims = {
    role: "employee",
    admin: false,
    grants: [
      { subject: "role", module: "Inventory", page: null, level: "Edit" },
      { subject: "role", module: "Sales", page: null, level: "View" },
      { subject: "person", module: "Sales", page: null, level: "None" }
    ],
    portal: { customerPortal_view: ["c2"] }
  };
  const expanded = expandClaims(raw, "c1");

  it("gives every page an entry", () => {
    for (const page of PAGES) expect(expanded[page.id]).toBeDefined();
  });

  it("holds the actions of the resolved level", () => {
    expect(expanded.inventory).toEqual({
      view: ["c1"],
      create: ["c1"],
      update: ["c1"],
      delete: []
    });
    expect(holds(expanded, "inventory_update", "c1")).toBe(true);
    expect(holds(expanded, "inventory_delete", "c1")).toBe(false);
  });

  it("lets a person None remove the role's grant", () => {
    expect(holds(expanded, "sales_view", "c1")).toBe(false);
  });

  it("merges portal keys", () => {
    expect(holds(expanded, "customerPortal_view", "c2")).toBe(true);
    expect(holds(expanded, "customerPortal_view", "c1")).toBe(false);
  });

  it("gives an admin Full on every page", () => {
    const admin = expandClaims({ ...raw, admin: true }, "c1");
    for (const page of PAGES) {
      expect(holds(admin, `${page.id}_delete`, "c1")).toBe(true);
    }
  });

  it("refuses a key that is not <page>_<action>", () => {
    expect(holds(expanded, "inventory", "c1")).toBe(false);
  });
});

describe("holdsAny", () => {
  const expanded = {
    "inventory.receipts": { view: ["c1"], create: [], update: [], delete: [] },
    "inventory.shipments": { view: [], create: [], update: [], delete: [] },
    accounting: { view: [], create: [], update: [], delete: [] }
  };

  it("is true when any page of the module holds the action", () => {
    expect(holdsAny(expanded, "inventory", "view", "c1")).toBe(true);
  });

  it("is false for another action, company or module", () => {
    expect(holdsAny(expanded, "inventory", "create", "c1")).toBe(false);
    expect(holdsAny(expanded, "inventory", "view", "c2")).toBe(false);
    expect(holdsAny(expanded, "accounting", "view", "c1")).toBe(false);
  });
});
