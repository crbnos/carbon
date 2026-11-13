// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import cases from "./cases.json";
import {
  ACTION_LEVEL,
  type Action,
  actionsGained,
  higherLevel,
  lowerLevel,
  parsePermissionKey,
  permissionKey,
  roundUp
} from "./levels";
import {
  clampLevel,
  ITEM_PAGES,
  ITEM_TYPE_PAGES,
  PAGES,
  pageById,
  pagesOf
} from "./registry";
import {
  accessHolders,
  anyOf,
  claimKeys,
  claimsFor,
  claimsFromJson,
  expandClaims,
  type Grant,
  holdsGate,
  isAdminType,
  isLegacyClaims,
  landingOf,
  legacyGrants,
  levelOf,
  type PageGate,
  type RawClaims,
  widenReads
} from "./resolve";

/** A gate on one page at the lowest level that holds `action`. */
const at = (page: string, action: Action): PageGate =>
  ({ [page]: ACTION_LEVEL[action] }) as PageGate;

// A case's grants and Admin type are in company "A" unless they name another,
// and it asks about "A" unless `askCompany` names another. get_claims hands the
// resolver one company's grants and its own Admin flag; this is that filter.
// `expected` is the level after the page's maxLevel; `granted`, when a case
// has it, the level before.
type Case = (typeof cases)[number] & {
  adminCompany?: string;
  askCompany?: string;
  granted?: string;
  grants: (Grant & { company?: string })[];
};

const subjectOf = (c: Case) => {
  const asked = c.askCompany ?? "A";
  return {
    grants: c.grants.filter((g) => (g.company ?? "A") === asked),
    admin: c.admin && (c.adminCompany ?? "A") === asked
  };
};

describe("levelOf", () => {
  it.each(cases as Case[])("$name", (c) => {
    const of = levelOf(subjectOf(c), c.pageId);
    expect(of.level).toBe(c.expected);
    expect(of.granted).toBe(c.granted ?? c.expected);
    expect(of.clamped).toBe(c.granted !== undefined);
  });

  it("names what decided the level", () => {
    const g = (
      subject: Grant["subject"],
      page: string | null,
      level: Grant["level"]
    ): Grant => ({ subject, module: "Inventory", page, level });
    const source = (grants: Grant[], admin = false) =>
      levelOf({ admin, grants }, "inventory.receipts").source;
    expect(source([], true)).toBe("admin");
    expect(source([g("role", null, "View")])).toBe("role-module");
    expect(source([g("role", "inventory.receipts", "View")])).toBe("role-page");
    expect(source([g("person", null, "None"), g("role", null, "Full")])).toBe(
      "person-module"
    );
    expect(source([g("person", "inventory.receipts", "Edit")])).toBe(
      "person-page"
    );
    expect(source([g("key", null, "View")])).toBe("key-module");
    expect(source([g("key", "inventory.receipts", "View")])).toBe("key-page");
    expect(source([])).toBe("none");
  });

  it("matches a module grant by its enum label only", () => {
    const items: Grant = {
      subject: "role",
      module: "Items",
      page: null,
      level: "Full"
    };
    expect(levelOf({ grants: [items] }, "parts.parts").level).toBe("None");
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

describe("lowerLevel and higherLevel", () => {
  it("pick the lower and the higher of two levels", () => {
    expect(lowerLevel("View", "Full")).toBe("View");
    expect(higherLevel("View", "Full")).toBe("Full");
    expect(higherLevel("Edit", "None")).toBe("Edit");
    expect(lowerLevel("Edit", "Edit")).toBe("Edit");
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

  it("gives every page of the module the module grant's actions, up to its maxLevel", () => {
    for (const page of pagesOf("inventory")) {
      // Traceability is Inventory's one page capped below Edit.
      expect(holdsGate(expanded, at(page, "update"), "c1")).toBe(
        page !== "inventory.traceability"
      );
      expect(holdsGate(expanded, at(page, "delete"), "c1")).toBe(false);
    }
    expect(
      holdsGate(expanded, at("inventory.traceability", "view"), "c1")
    ).toBe(true);
    expect(
      holdsGate(expanded, at("inventory.traceability", "update"), "c1")
    ).toBe(false);
    expect(expanded["inventory.receipts"]).toEqual({
      view: ["c1"],
      create: ["c1"],
      update: ["c1"],
      delete: []
    });
  });

  it("expands no module key", () => {
    expect(expanded.inventory).toBeUndefined();
    expect(holdsGate(expanded, at("inventory", "view"), "c1")).toBe(false);
  });

  it("lets a person None remove the role's grant", () => {
    for (const page of pagesOf("sales")) {
      expect(holdsGate(expanded, at(page, "view"), "c1")).toBe(false);
    }
  });

  it("leaves portal keys out of the pages", () => {
    expect(expanded.customerPortal).toBeUndefined();
    expect(holdsGate(expanded, at("customerPortal", "view"), "c2")).toBe(false);
  });

  it("gives an admin every page's maxLevel", () => {
    const admin = expandClaims({ ...raw, admin: true }, "c1");
    for (const page of PAGES) {
      expect(holdsGate(admin, at(page.id, "view"), "c1")).toBe(true);
      expect(holdsGate(admin, at(page.id, "delete"), "c1")).toBe(
        page.maxLevel === "Full"
      );
    }
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
});

describe("holdsGate forms", () => {
  const view = { view: ["c1"], create: [], update: [], delete: [] };
  const expanded = { "inventory.shipments": view };

  it("reads an { anyOf } list like a bare list", () => {
    const pages = ["inventory.receipts", "inventory.shipments"] as const;
    expect(
      holdsGate(expanded, { anyOf: anyOf([...pages], "View") }, "c1")
    ).toBe(true);
    expect(holdsGate(expanded, anyOf([...pages], "View"), "c1")).toBe(true);
    expect(holdsGate(expanded, { anyOf: [] }, "c1")).toBe(false);
    expect(holdsGate(expanded, [], "c1")).toBe(false);
  });

  it("passes {} and an entry with no level, and refuses no claims", () => {
    expect(holdsGate({}, {}, "c1")).toBe(true);
    expect(holdsGate({}, { "inventory.receipts": undefined }, "c1")).toBe(true);
    expect(holdsGate(null, {}, "c1")).toBe(false);
    expect(holdsGate(undefined, { "inventory.receipts": "View" }, "c1")).toBe(
      false
    );
  });

  it("checks a page exactly, and a widened read as widened", () => {
    const gate = { "inventory.receipts": "View" } as const;
    expect(holdsGate(expanded, gate, "c1")).toBe(false);
    expect(holdsGate(expanded, widenReads(gate), "c1")).toBe(true);
    expect(holdsGate({ "sales.quotes": view }, widenReads(gate), "c1")).toBe(
      false
    );
  });

  it("never widens a write", () => {
    const edit = { view: ["c1"], create: ["c1"], update: ["c1"], delete: [] };
    expect(
      holdsGate(
        { "inventory.shipments": edit },
        widenReads({ "inventory.receipts": "Edit" }),
        "c1"
      )
    ).toBe(false);
  });
});

describe("widenReads", () => {
  // The pages a View on any one Inventory page widens to: its own module.
  const inventory = anyOf(
    [
      "inventory.quantities",
      "inventory.movements",
      "inventory.inventoryCount",
      "inventory.kanbans",
      "inventory.receipts",
      "inventory.shipments",
      "inventory.pickingLists",
      "inventory.stockTransfers",
      "inventory.warehouseTransfers",
      "inventory.trackedEntities",
      "inventory.traceability",
      "inventory.storageUnits",
      "inventory.storageTypes",
      "inventory.storageRules",
      "inventory.shippingMethods"
    ],
    "View"
  );
  // The item pages are all Parts pages, so each widens to the Parts module:
  // the pages whose View RLS admits for an item row.
  const parts = anyOf(
    [
      "parts.parts",
      "parts.materials",
      "parts.tools",
      "parts.consumables",
      "parts.services",
      "parts.changeNotices",
      "parts.changeNoticeTypes",
      "parts.changeNoticeActions",
      "parts.dimensions",
      "parts.finishes",
      "parts.grades",
      "parts.shapes",
      "parts.substances",
      "parts.types",
      "parts.itemGroups",
      "parts.units"
    ],
    "View"
  );

  it("widens View on one page to the pages that read what it owns", () => {
    expect(widenReads({ "inventory.receipts": "View" })).toEqual({
      anyOf: inventory
    });
    // Receipts and Purchase Invoices list purchaseOrder in `readers`.
    const order = widenReads({ "purchasing.purchaseOrders": "View" });
    expect(order).toEqual({
      anyOf: anyOf(
        [
          ...pagesOf("purchasing"),
          "inventory.receipts",
          "invoicing.purchaseInvoices"
        ],
        "View"
      )
    });
  });

  it("leaves a write, two pages and an unknown page as written", () => {
    const edit = { "inventory.receipts": "Edit" } as const;
    expect(widenReads(edit)).toBe(edit);
    const two = {
      "inventory.receipts": "View",
      "inventory.shipments": "View"
    } as const;
    expect(widenReads(two)).toBe(two);
    const unknown = { "inventory.nowhere": "View" } as never;
    expect(widenReads(unknown)).toBe(unknown);
  });

  it("widens each entry of a list as it widens one page", () => {
    expect(widenReads({ anyOf: anyOf(ITEM_PAGES, "View") })).toEqual({
      anyOf: parts
    });
    expect(
      widenReads([{ "parts.parts": "View" }, { "inventory.receipts": "View" }])
    ).toEqual({
      anyOf: [...parts, ...inventory]
    });
  });

  it("widens a shared page to its module's pages", () => {
    expect(widenReads({ "parts.tools": "View" })).toEqual({ anyOf: parts });
  });

  it("lists each widened page once", () => {
    const widened = widenReads({
      anyOf: [
        { "inventory.receipts": "View" },
        { "inventory.shipments": "View" }
      ]
    }) as { anyOf: Record<string, string>[] };
    const ids = widened.anyOf.flatMap((gate) => Object.keys(gate));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === "inventory.receipts")).toHaveLength(1);
    // Shipments are also read from a sales order.
    expect(ids).toContain("sales.salesOrders");
  });
});

describe("landingOf", () => {
  const view = { view: ["c1"], create: [], update: [], delete: [] };

  it("takes the first page in sidebar order the person can view", () => {
    const [first, second] = pagesOf("inventory");
    expect(
      landingOf(
        "inventory",
        { [first as string]: view, [second as string]: view },
        "c1"
      )
    ).toEqual({ page: first, path: pageById(first as string)?.paths[0] });
    expect(landingOf("inventory", { [second as string]: view }, "c1")).toEqual({
      page: second,
      path: pageById(second as string)?.paths[0]
    });
  });

  it("is undefined when the person can view no page of the module", () => {
    expect(landingOf("inventory", { "sales.quotes": view }, "c1")).toBe(
      undefined
    );
    expect(landingOf("inventory", null, "c1")).toBe(undefined);
  });

  it("returns the page's first path", () => {
    expect(
      landingOf("service", { "service.customerAssets": view }, "c1")
    ).toEqual({
      page: "service.customerAssets",
      path: "/x/service-jobs/assets"
    });
  });
});

describe("claimKeys", () => {
  it("flattens expanded claims, leaving out empty actions", () => {
    expect(
      claimKeys({
        "sales.quotes": {
          view: ["c1"],
          create: [],
          update: ["c1"],
          delete: []
        },
        "parts.parts": { view: [], create: [], update: [], delete: [] }
      })
    ).toEqual({
      "sales.quotes_view": ["c1"],
      "sales.quotes_update": ["c1"]
    });
  });
});

describe("levelOf grant", () => {
  it("is the grant precedence picks, or null", () => {
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
    expect(levelOf({ grants: [role, person] }, "sales.quotes").grant).toBe(
      person
    );
    expect(levelOf({ grants: [role] }, "sales.quotes").grant).toBe(role);
    expect(levelOf({ grants: [role] }, "parts.parts").grant).toBeNull();
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
        { id: "nobody", admin: false, grants: [] },
        {
          // A page grant beats the module grant of the same subject.
          id: "quoter",
          admin: false,
          grants: [sales("View"), { ...sales("Edit"), page: "sales.quotes" }]
        },
        {
          id: "orders",
          admin: false,
          grants: [
            sales("View"),
            { ...sales("Edit"), page: "sales.salesOrders" }
          ]
        }
      ],
      "sales.quotes",
      "Edit"
    );
    expect(holders.map((h) => [h.id, h.level, h.grant?.page ?? null])).toEqual([
      ["editor", "Edit", null],
      ["admin", "Full", null],
      ["quoter", "Edit", "sales.quotes"]
    ]);
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
    expect(holdsGate(expanded, at("inventory.receipts", "view"), "co1")).toBe(
      false
    );
    expect(holdsGate(expanded, at("sales.quotes", "view"), "co1")).toBe(true);
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

  it("leaves out an old module key with no pages", () => {
    expect(
      legacyGrants({ items_view: ["co1"], parts_view: ["co1"] }, "co1", "key")
    ).toEqual([{ subject: "key", module: "Parts", page: null, level: "View" }]);
  });
});

describe("claimsFor", () => {
  it("expands the grants into page permissions in the company", () => {
    const json = {
      role: "employee",
      admin: false,
      grants: [{ subject: "role", module: "Sales", page: null, level: "View" }],
      portal: {}
    };
    const claims = claimsFor(json, "co1");
    expect(claims.role).toBe("employee");
    expect(claims.admin).toBe(false);
    expect(claims.grants).toEqual([
      { subject: "role", module: "Sales", page: null, level: "View" }
    ]);
    expect(claims.permissions["sales.quotes"]).toEqual({
      view: ["co1"],
      create: [],
      update: [],
      delete: []
    });
    expect(claims.permissions["inventory.receipts"]?.view ?? []).toEqual([]);
  });
});

describe("isAdminType", () => {
  it("is the company's own Admin type only", () => {
    expect(isAdminType({ systemType: "Admin", companyId: "c1" }, "c1")).toBe(
      true
    );
    expect(isAdminType({ systemType: "Admin", companyId: "c2" }, "c1")).toBe(
      false
    );
    expect(isAdminType({ systemType: null, companyId: "c1" }, "c1")).toBe(
      false
    );
  });
});

describe("permissionKey", () => {
  it("formats and parses <subject>_<action>", () => {
    expect(permissionKey("inventory.receipts", "update")).toBe(
      "inventory.receipts_update"
    );
    expect(parsePermissionKey("inventory.receipts_update")).toEqual({
      subject: "inventory.receipts",
      action: "update"
    });
    expect(parsePermissionKey("customerPortal_view")).toEqual({
      subject: "customerPortal",
      action: "view"
    });
    expect(parsePermissionKey("inventory")).toBeNull();
    expect(parsePermissionKey("inventory_edit")).toBeNull();
    expect(parsePermissionKey("_view")).toBeNull();
  });
});
