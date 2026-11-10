// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import cases from "./cases.json";
import { actionsGained, roundUp } from "./levels";
import {
  clampLevel,
  ITEM_TYPE_PAGES,
  PAGES,
  pagesOf,
  REGISTRY_HASH
} from "./registry";
import {
  accessHolders,
  anyOf,
  claimKeys,
  claimsFromJson,
  expandClaims,
  type Grant,
  holds,
  holdsAny,
  holdsGate,
  isLegacyClaims,
  type RawClaims,
  resolveLevel,
  winningGrant
} from "./resolve";

// A case's grants and Admin type are in company "A" unless they name another,
// and it asks about "A" unless `askCompany` names another. get_claims hands the
// resolver one company's grants and its own Admin flag; this is that filter.
type Case = (typeof cases)[number] & {
  adminCompany?: string;
  askCompany?: string;
  grants: (Grant & { company?: string })[];
};

describe("resolveLevel", () => {
  it.each(cases as Case[])("$name", (c) => {
    const asked = c.askCompany ?? "A";
    const grants = c.grants.filter((g) => (g.company ?? "A") === asked);
    const admin = c.admin && (c.adminCompany ?? "A") === asked;
    expect(resolveLevel(grants, c.pageId, { admin })).toBe(c.expected);
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
    expect(clampLevel("inventory.receipts", "Edit")).toBe("Edit");
    expect(clampLevel("inventory.traceability", "Full")).toBe("View");
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

  it("gives every page of the module the module grant's actions", () => {
    for (const page of pagesOf("inventory")) {
      expect(holds(expanded, `${page}_update`, "c1")).toBe(true);
      expect(holds(expanded, `${page}_delete`, "c1")).toBe(false);
    }
    expect(expanded["inventory.receipts"]).toEqual({
      view: ["c1"],
      create: ["c1"],
      update: ["c1"],
      delete: []
    });
  });

  it("expands no module key", () => {
    expect(expanded.inventory).toBeUndefined();
    expect(holds(expanded, "inventory_view", "c1")).toBe(false);
  });

  it("lets a person None remove the role's grant", () => {
    for (const page of pagesOf("sales")) {
      expect(holds(expanded, `${page}_view`, "c1")).toBe(false);
    }
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

describe("holdsGate", () => {
  const none = { view: [], create: [], update: [], delete: [] };
  const expanded = {
    "inventory.receipts": { ...none, view: ["c1"], create: ["c1"] },
    "parts.tools": { view: ["c1"], create: ["c1"], update: ["c1"], delete: [] },
    "parts.parts": { ...none, view: ["c1"] }
  };

  it("reads the highest action of each entry's level", () => {
    expect(holdsGate(expanded, { "inventory.receipts": "Create" }, "c1")).toBe(
      true
    );
    expect(holdsGate(expanded, { "inventory.receipts": "Edit" }, "c1")).toBe(
      false
    );
    expect(holdsGate(expanded, { "inventory.receipts": "View" }, "c2")).toBe(
      false
    );
  });

  it("needs every entry of one gate", () => {
    expect(
      holdsGate(
        expanded,
        { "inventory.receipts": "View", "parts.parts": "Edit" },
        "c1"
      )
    ).toBe(false);
  });

  it("passes a list when any one gate passes", () => {
    const edit = anyOf(Object.values(ITEM_TYPE_PAGES), "Edit");
    expect(holdsGate(expanded, edit, "c1")).toBe(true);
    expect(holdsGate(expanded, anyOf(["parts.parts"], "Edit"), "c1")).toBe(
      false
    );
  });

  it("maps each item type to its page", () => {
    expect(ITEM_TYPE_PAGES.Tool).toBe("parts.tools");
    expect(Object.keys(ITEM_TYPE_PAGES)).toEqual([
      "Part",
      "Material",
      "Tool",
      "Consumable",
      "Service"
    ]);
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

describe("claimKeys", () => {
  it("flattens expanded claims, leaving out empty actions", () => {
    expect(
      claimKeys({
        sales: { view: ["c1"], create: [], update: ["c1"], delete: [] },
        parts: { view: [], create: [], update: [], delete: [] }
      })
    ).toEqual({ sales_view: ["c1"], sales_update: ["c1"] });
  });
});

describe("winningGrant", () => {
  it("returns the grant precedence picks, or null", () => {
    const role = {
      subject: "role" as const,
      module: "Sales",
      page: null,
      level: "Edit" as const
    };
    const person = {
      ...role,
      subject: "person" as const,
      level: "None" as const
    };
    expect(winningGrant([role, person], "sales")).toBe(person);
    expect(winningGrant([role], "sales")).toBe(role);
    expect(winningGrant([role], "parts")).toBeNull();
  });
});

describe("accessHolders", () => {
  const sales = (level: "View" | "Edit" | "None") => ({
    subject: "role" as const,
    module: "Sales",
    page: null,
    level
  });
  it("keeps subjects at or above the level, with the deciding grant", () => {
    const holders = accessHolders(
      [
        { id: "viewer", admin: false, grants: [sales("View")] },
        { id: "editor", admin: false, grants: [sales("Edit")] },
        { id: "admin", admin: true, grants: [sales("None")] },
        { id: "nobody", admin: false, grants: [] }
      ],
      "sales",
      "Edit"
    );
    expect(holders.map((h) => [h.id, h.level, h.grant?.level ?? null])).toEqual(
      [
        ["editor", "Edit", "Edit"],
        ["admin", "Full", null]
      ]
    );
  });
});

describe("actionsGained", () => {
  it("lists what the round-up added to the old checkboxes", () => {
    expect(actionsGained("Edit", ["view", "update"])).toEqual(["create"]);
    expect(actionsGained("Full", ["delete"])).toEqual([
      "view",
      "create",
      "update"
    ]);
    expect(actionsGained("View", ["view"])).toEqual([]);
    expect(actionsGained("Edit", null)).toEqual([]);
  });
});

describe("claimsFromJson", () => {
  it("reads grants, admin and portal, and ignores the transitional old keys", () => {
    const json = {
      role: "employee",
      admin: false,
      grants: [{ subject: "role", module: "Sales", page: null, level: "View" }],
      portal: {},
      // What get_claims also emits for app versions from before pages.
      inventory_view: ["co1"],
      inventory_delete: ["co1"]
    };
    expect(isLegacyClaims(json)).toBe(false);
    const raw = claimsFromJson(json, "co1");
    expect(raw.grants).toEqual([
      { subject: "role", module: "Sales", page: null, level: "View" }
    ]);
    const expanded = expandClaims(raw, "co1");
    expect(holds(expanded, "inventory.receipts_view", "co1")).toBe(false);
    expect(holds(expanded, "sales.quotes_view", "co1")).toBe(true);
  });

  // A database that has not run the permission migrations yet.
  it("reads the old shape as module grants in the company", () => {
    const json = {
      role: "employee",
      inventory_view: ["co1", "co2"],
      inventory_update: ["co1"],
      sales_delete: ["co1"],
      parts_view: ["co2"],
      "not-a-key": ["co1"]
    };
    expect(isLegacyClaims(json)).toBe(true);
    const raw = claimsFromJson(json, "co1");
    expect(raw).toEqual({
      role: "employee",
      admin: false,
      grants: [
        // view + update → Edit, the conversion's round-up
        { subject: "person", module: "Inventory", page: null, level: "Edit" },
        { subject: "person", module: "Sales", page: null, level: "Full" }
      ],
      portal: {}
    });
    expect(claimsFromJson(json, "co2").grants).toEqual([
      { subject: "person", module: "Inventory", page: null, level: "View" },
      { subject: "person", module: "Parts", page: null, level: "View" }
    ]);
  });

  it("reads the old shape of a portal account as portal keys", () => {
    const raw = claimsFromJson(
      { role: "customer", sales_view: ["co1"], parts_view: ["co2"] },
      "co1"
    );
    expect(raw.grants).toEqual([]);
    expect(raw.portal).toEqual({ sales_view: ["co1"] });
  });

  it("grants nothing from the old shape without a company", () => {
    expect(
      claimsFromJson({ role: "employee", sales_view: ["co1"] }).grants
    ).toEqual([]);
  });
});
