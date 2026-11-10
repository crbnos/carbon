// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Level } from "@carbon/database/access";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.hoisted(() => vi.fn());
const replaceGrants = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@carbon/auth", () => ({
  error: (_cause: unknown, message: string) => ({ success: false, message }),
  success: (message: string) => ({ success: true, message }),
  getClaims,
  getPermissionCacheKey: (id: string) => `permissions:${id}`
}));
vi.mock("@carbon/auth/auth-events.server", () => ({
  logPermissionChange: vi.fn(),
  logRoleAccessChange: vi.fn()
}));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: "u_1" }, error: null })
          })
        })
      })
    })
  })
}));
vi.mock("@carbon/kv", () => ({ redis: { del: vi.fn() } }));
vi.mock("./entitlements.server", () => ({
  requireEntitlement: vi.fn(async () => undefined)
}));
vi.mock("@carbon/database/access-write", () => ({
  readGrants: vi.fn(async () => []),
  replaceGrants
}));

import { bulkEditGrants, updatePermissions } from "./permissions.server";

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

describe("updatePermissions", () => {
  const db = {
    selectFrom: () => {
      const q = {
        leftJoin: () => q,
        select: () => q,
        where: () => q,
        executeTakeFirst: async () => ({
          employeeTypeId: null,
          systemType: null
        })
      };
      return q;
    }
  };
  const run = () =>
    updatePermissions({} as never, db as never, {
      id: "u_1",
      companyId: "co_1",
      grants: [g("Sales", null, "Edit")],
      actorId: "actor"
    });

  beforeEach(() => {
    replaceGrants.mockClear();
  });

  it("refuses an actor without Users → Accounts at Edit", async () => {
    getClaims.mockResolvedValue({
      data: {
        role: "employee",
        admin: false,
        grants: [
          {
            subject: "role",
            module: "Users",
            page: "users.accounts",
            level: "View"
          }
        ],
        portal: {}
      },
      error: null
    });
    const result = await run();
    expect(result.success).toBe(false);
    expect(replaceGrants).not.toHaveBeenCalled();
  });

  it("writes for an actor with Users → Accounts at Edit", async () => {
    getClaims.mockResolvedValue({
      data: {
        role: "employee",
        admin: false,
        grants: [
          { subject: "role", module: "Users", page: null, level: "Edit" }
        ],
        portal: {}
      },
      error: null
    });
    const result = await run();
    expect(result.success).toBe(true);
    expect(replaceGrants).toHaveBeenCalledOnce();
  });
});
