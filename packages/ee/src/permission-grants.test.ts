// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import {
  claimsFor,
  type Grant,
  type Level,
  type ModuleEnum,
  pagesOf
} from "@carbon/database/access";
import { describe, expect, it } from "vitest";

import {
  ACCESS_READER_GATE,
  accessSubject,
  bulkEditGrants,
  claimsMayEditAccounts,
  keyGrantsAboveActor,
  pageName,
  refusedModules,
  rowLevel,
  subjectGates,
  subjectTypeOf,
  toModule
} from "./permission-grants";

const g = (module: ModuleEnum, page: string | null, level: Level) => ({
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

describe("rowLevel", () => {
  const role = (module: string, page: string | null, level: Level) => ({
    subject: "role" as const,
    module,
    page,
    level
  });
  const person = (module: string, page: string | null, level: Level) => ({
    ...role(module, page, level),
    subject: "person" as const
  });

  it("shows a role's Full on a View-only page as View, as the resolver does", () => {
    const subject = { grants: [role("Accounting", null, "Full")] };
    expect(
      rowLevel(subject, { module: "Accounting", page: "accounting.syncTieOut" })
    ).toBe("View");
  });

  it("reads a module row from module grants only", () => {
    const subject = {
      grants: [
        role("Inventory", null, "View"),
        role("Inventory", "inventory.receipts", "Full")
      ]
    };
    expect(rowLevel(subject, { module: "Inventory", page: null })).toBe("View");
  });

  it("without the person's grant, is what the row inherits", () => {
    const subject = {
      grants: [
        person("Inventory", "inventory.receipts", "None"),
        person("Inventory", null, "Create"),
        role("Inventory", null, "View")
      ]
    };
    const row = { module: "Inventory" as const, page: "inventory.receipts" };
    expect(rowLevel(subject, row)).toBe("None");
    expect(rowLevel(subject, row, "person")).toBe("Create");
  });

  it("is Full on every row for Admin", () => {
    expect(
      rowLevel({ admin: true, grants: [] }, { module: "Sales", page: null })
    ).toBe("Full");
  });
});

describe("toModule", () => {
  it("reads a module id or label, and refuses a module with no pages", () => {
    expect(toModule("parts")).toBe("Parts");
    expect(toModule("Inventory")).toBe("Inventory");
    expect(toModule("Items")).toBeNull();
  });
});

describe("refusedModules", () => {
  it("refuses Workflows on an API key and accepts Full on Accounting", () => {
    expect(
      refusedModules("key", [
        { module: "Accounting", page: null, level: "Full" },
        { module: "Workflows", page: null, level: "View" }
      ])
    ).toEqual(["Workflows"]);
  });

  it("refuses nothing on a role", () => {
    expect(
      refusedModules("role", [
        { module: "Workflows", page: null, level: "Edit" }
      ])
    ).toEqual([]);
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

describe("subjectGates", () => {
  it("gates each subject's grants on the page that owns them", () => {
    expect(subjectGates("Edit")).toEqual({
      role: { "users.employeeTypes": "Edit" },
      person: { "users.accounts": "Edit" },
      key: { "settings.apiKeys": "Edit" }
    });
  });
});

describe("accessSubject", () => {
  it("round-trips through subjectTypeOf", () => {
    for (const type of ["role", "person", "key"] as const) {
      expect(subjectTypeOf(accessSubject(type, "id_1"))).toBe(type);
    }
  });
});

describe("keyGrantsAboveActor", () => {
  const companyId = "co_1";
  const actor = (grants: Grant[], admin = false) =>
    claimsFor({ role: "employee", admin, grants }, companyId).permissions;
  const person = (module: ModuleEnum, page: string | null, level: Level) => ({
    subject: "person" as const,
    ...g(module, page, level)
  });

  it("never refuses an Admin", () => {
    expect(
      keyGrantsAboveActor({
        actor: actor([], true),
        companyId,
        before: [],
        after: [g("Users", null, "Full"), g("Settings", null, "Full")]
      })
    ).toEqual([]);
  });

  it("refuses a page grant above the actor's level there", () => {
    expect(
      keyGrantsAboveActor({
        actor: actor([person("Settings", null, "Full")]),
        companyId,
        before: [],
        after: [g("Users", "users.accounts", "Full")]
      })
    ).toEqual(["users.accounts"]);
  });

  it("refuses a module grant on each page of the module the actor holds lower", () => {
    expect(
      keyGrantsAboveActor({
        actor: actor([
          person("Users", null, "Edit"),
          person("Users", "users.groups", "View")
        ]),
        companyId,
        before: [],
        after: [g("Users", null, "Edit")]
      })
    ).toEqual(["users.groups"]);
  });

  it("allows what the actor holds, at each page's maxLevel", () => {
    expect(
      keyGrantsAboveActor({
        actor: actor([person("Settings", null, "Full")]),
        companyId,
        before: [],
        after: [g("Settings", null, "Full")]
      })
    ).toEqual([]);
  });

  it("allows lowering, removing and keeping what the key already held", () => {
    const before = [g("Users", null, "Full"), g("Sales", null, "Edit")];
    expect(
      keyGrantsAboveActor({
        actor: actor([person("Users", null, "View")]),
        companyId,
        before,
        after: [
          g("Users", null, "Edit"),
          { module: "Sales", page: null, level: null },
          g("Inventory", null, "None")
        ]
      })
    ).toEqual([]);
    expect(
      keyGrantsAboveActor({
        actor: actor([]),
        companyId,
        before,
        after: before
      })
    ).toEqual([]);
  });

  it("caps a key that writes a key at its own grants", () => {
    const writer = actor([{ subject: "key", ...g("Inventory", null, "Edit") }]);
    expect(
      keyGrantsAboveActor({
        actor: writer,
        companyId,
        before: [],
        after: [g("Inventory", null, "Edit")]
      })
    ).toEqual([]);
    const above = keyGrantsAboveActor({
      actor: writer,
      companyId,
      before: [],
      after: [g("Inventory", null, "Full")]
    });
    expect(above).toContain("inventory.receipts");
    // Traceability stops at View (its maxLevel), which the writer holds.
    expect(above).not.toContain("inventory.traceability");
    expect(above.every((page) => pagesOf("inventory").includes(page))).toBe(
      true
    );
  });

  it("reads the actor's claims in the company only", () => {
    expect(
      keyGrantsAboveActor({
        actor: actor([person("Users", null, "Full")]),
        companyId: "co_2",
        before: [],
        after: [g("Users", "users.accounts", "View")]
      })
    ).toEqual(["users.accounts"]);
  });
});

describe("pageName", () => {
  it("names a page as the access grid does", () => {
    expect(pageName("users.accounts")).toBe("Users → Accounts");
  });
});

describe("ACCESS_READER_GATE", () => {
  it("admits a viewer of the page each person and role is read on", () => {
    expect(ACCESS_READER_GATE.anyOf).toEqual([
      subjectGates("View").person,
      subjectGates("View").role
    ]);
  });
});
