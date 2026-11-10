// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Level } from "@carbon/database/access";
import { describe, expect, it } from "vitest";

import { bulkEditGrants, claimsMayEditAccounts } from "./permission-grants";

const g = (module: string, page: string | null, level: Level) => ({
  module,
  page,
  level
});

describe("bulkEditGrants", () => {
  it("Add never lowers a level the person has through a module override", () => {
    const result = bulkEditGrants({
      chosen: [g("Inventory", "inventory.receipts", "Create")],
      own: [g("Inventory", null, "Edit")],
      role: [g("Inventory", null, "View")],
      admin: false,
      addOnly: true
    });
    // Edit through the module override: nothing to store on the page.
    expect(result).toEqual([
      { module: "Inventory", page: null, level: "Edit" },
      { module: "Inventory", page: "inventory.receipts", level: null }
    ]);
  });

  it("Update keeps a page override that differs from the person's module override", () => {
    const result = bulkEditGrants({
      chosen: [g("Inventory", "inventory.receipts", "View")],
      own: [g("Inventory", null, "Edit")],
      role: [g("Inventory", null, "View")],
      admin: false,
      addOnly: false
    });
    // View equals the role but not the person's module override (Edit).
    expect(result).toContainEqual({
      module: "Inventory",
      page: "inventory.receipts",
      level: "View"
    });
  });

  it("Update stores nothing when the level is what the person inherits", () => {
    const result = bulkEditGrants({
      chosen: [g("Inventory", "inventory.receipts", "Edit")],
      own: [g("Inventory", null, "Edit")],
      role: [g("Inventory", null, "View")],
      admin: false,
      addOnly: false
    });
    expect(result).toContainEqual({
      module: "Inventory",
      page: "inventory.receipts",
      level: null
    });
  });

  it("a page with no person override inherits the role's page, then its module", () => {
    const result = bulkEditGrants({
      chosen: [
        g("Inventory", "inventory.receipts", "Edit"),
        g("Inventory", "inventory.shipments", "View")
      ],
      own: [],
      role: [
        g("Inventory", null, "View"),
        g("Inventory", "inventory.receipts", "Edit")
      ],
      admin: false,
      addOnly: false
    });
    expect(result).toEqual([
      { module: "Inventory", page: "inventory.receipts", level: null },
      { module: "Inventory", page: "inventory.shipments", level: null }
    ]);
  });

  it("Add raises above the inherited level and keeps other grants", () => {
    const result = bulkEditGrants({
      chosen: [g("Sales", null, "Edit")],
      own: [g("Inventory", "inventory.receipts", "Full")],
      role: [g("Sales", null, "View")],
      admin: false,
      addOnly: true
    });
    expect(result).toEqual([
      { module: "Inventory", page: "inventory.receipts", level: "Full" },
      { module: "Sales", page: null, level: "Edit" }
    ]);
  });

  it("an Admin type inherits Full", () => {
    const result = bulkEditGrants({
      chosen: [g("Sales", null, "Full")],
      own: [],
      role: [],
      admin: true,
      addOnly: false
    });
    expect(result).toEqual([{ module: "Sales", page: null, level: null }]);
  });
});

describe("claimsMayEditAccounts", () => {
  const claims = (grants: unknown[]) => ({
    role: "employee",
    admin: false,
    grants,
    portal: {}
  });

  it("refuses an actor without Users → Accounts at Edit", () => {
    expect(
      claimsMayEditAccounts(
        claims([
          {
            subject: "role",
            module: "Users",
            page: "users.accounts",
            level: "View"
          }
        ]),
        "co_1"
      )
    ).toBe(false);
  });

  it("admits an actor with Users at Edit", () => {
    expect(
      claimsMayEditAccounts(
        claims([
          { subject: "role", module: "Users", page: null, level: "Edit" }
        ]),
        "co_1"
      )
    ).toBe(true);
  });

  it("admits an Admin", () => {
    expect(claimsMayEditAccounts({ ...claims([]), admin: true }, "co_1")).toBe(
      true
    );
  });
});
