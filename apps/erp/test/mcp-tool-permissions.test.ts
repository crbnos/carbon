// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import metadata from "../app/routes/api+/mcp+/lib/tool-metadata.json";

// Pins the permission every published operation gates on, against the REAL
// generated manifest. They are read off each service function's own gate,
// which every API-key call runs, so a change here is an authorization change —
// it must fail here first.

type Tool = {
  name: string;
  module: string;
  classification: "READ" | "WRITE" | "DESTRUCTIVE";
  permission: {
    module: string | null;
    actions: string[];
    oneOf?: { pages: string[]; level: string; by: string[] };
  };
};

const ITEM_PAGES = [
  "parts.parts",
  "parts.materials",
  "parts.tools",
  "parts.consumables",
  "parts.services"
];
const byItemType = (level: string) => ({
  pages: ITEM_PAGES,
  level,
  by: ["item.type"]
});

const allTools = metadata.tools as Tool[];

// Operations pinned exactly, and excluded from the general assertions below.
const OVERRIDES: Record<string, Tool["permission"]> = {
  // The page registry moved these tables to a page of another module, and
  // the gate follows the page. Each is pinned so the move stays visible.
  // Storage types are on Inventory → Storage Types (was parts).
  inventory_getStorageTypes: { module: "inventory", actions: ["view"] },
  inventory_getStorageType: { module: "inventory", actions: ["view"] },
  inventory_getStorageTypeUsage: { module: "inventory", actions: ["view"] },
  inventory_createStorageType: {
    module: "inventory",
    actions: ["view", "create"]
  },
  inventory_updateStorageType: {
    module: "inventory",
    actions: ["view", "create", "update"]
  },
  inventory_deleteStorageTypeWithCascade: {
    module: "inventory",
    actions: ["view", "create", "update", "delete"]
  },
  // Bank details need Accounting → Bank Accounts, not the partner page.
  purchasing_getSupplierBankAccounts: {
    module: "accounting",
    actions: ["view"]
  },
  purchasing_createSupplierBankAccount: {
    module: "accounting",
    actions: ["view", "create"]
  },
  purchasing_updateSupplierBankAccount: {
    module: "accounting",
    actions: ["view", "create", "update"]
  },
  purchasing_deleteSupplierBankAccount: {
    module: "accounting",
    actions: ["view", "create", "update", "delete"]
  },
  sales_getCustomerBankAccounts: {
    module: "accounting",
    actions: ["view"]
  },
  sales_createCustomerBankAccount: {
    module: "accounting",
    actions: ["view", "create"]
  },
  sales_updateCustomerBankAccount: {
    module: "accounting",
    actions: ["view", "create", "update"]
  },
  sales_deleteCustomerBankAccount: {
    module: "accounting",
    actions: ["view", "create", "update", "delete"]
  },
  // Batch properties hang off an item: the page of the item's type (was
  // inventory).
  inventory_upsertBatchProperty: {
    module: "parts",
    actions: ["view", "create", "update"],
    oneOf: byItemType("Edit")
  },
  inventory_updateBatchPropertyOrder: {
    module: "parts",
    actions: ["view", "create", "update"],
    oneOf: byItemType("Edit")
  },
  inventory_deleteBatchProperty: {
    module: "parts",
    actions: ["view", "create", "update", "delete"],
    oneOf: byItemType("Full")
  },
  // Failure modes, dispatches and schedules are Resources pages (was
  // production; the tables' RLS was already resources).
  production_getFailureMode: { module: "resources", actions: ["view"] },
  production_getFailureModes: { module: "resources", actions: ["view"] },
  production_getFailureModesList: { module: "resources", actions: ["view"] },
  production_createFailureMode: {
    module: "resources",
    actions: ["view", "create"]
  },
  production_updateFailureMode: {
    module: "resources",
    actions: ["view", "create", "update"]
  },
  production_deleteFailureMode: {
    module: "resources",
    actions: ["view", "create", "update", "delete"]
  },
  production_getMaintenanceDispatch: { module: "resources", actions: ["view"] },
  production_deleteMaintenanceDispatch: {
    module: "resources",
    actions: ["view", "create", "update", "delete"]
  },
  production_getMaintenanceDispatchComments: {
    module: "resources",
    actions: ["view"]
  },
  production_createMaintenanceDispatchComment: {
    module: "resources",
    actions: ["view", "create"]
  },
  production_updateMaintenanceDispatchComment: {
    module: "resources",
    actions: ["view", "create", "update"]
  },
  production_getMaintenanceDispatchEvents: {
    module: "resources",
    actions: ["view"]
  },
  production_createMaintenanceDispatchEvent: {
    module: "resources",
    actions: ["view", "create"]
  },
  production_updateMaintenanceDispatchEvent: {
    module: "resources",
    actions: ["view", "create", "update"]
  },
  production_deleteMaintenanceDispatchEvent: {
    module: "resources",
    actions: ["view", "create", "update", "delete"]
  },
  production_getMaintenanceDispatchItems: {
    module: "resources",
    actions: ["view"]
  },
  production_createMaintenanceDispatchItem: {
    module: "resources",
    actions: ["view", "create"]
  },
  production_updateMaintenanceDispatchItem: {
    module: "resources",
    actions: ["view", "create", "update"]
  },
  production_getMaintenanceSchedule: { module: "resources", actions: ["view"] },
  production_createMaintenanceSchedule: {
    module: "resources",
    actions: ["view", "create"]
  },
  production_updateMaintenanceSchedule: {
    module: "resources",
    actions: ["view", "create", "update"]
  },
  production_deleteMaintenanceSchedule: {
    module: "resources",
    actions: ["view", "create", "update", "delete"]
  },
  // A kanban's job link is on Inventory → Kanbans (was production).
  production_updateKanbanJob: {
    module: "inventory",
    actions: ["view", "create", "update"]
  },
  // Supplier processes are on Resources → Processes (was purchasing; the
  // table's RLS was already resources).
  purchasing_getSupplierProcessesByProcess: {
    module: "resources",
    actions: ["view"]
  },
  purchasing_createSupplierProcess: {
    module: "resources",
    actions: ["view", "create"]
  },
  purchasing_updateSupplierProcess: {
    module: "resources",
    actions: ["view", "create", "update"]
  },
  purchasing_deleteSupplierProcess: {
    module: "resources",
    actions: ["view", "create", "update", "delete"]
  },
  // Shifts are on People → Shifts (the table's RLS was already people).
  resources_deleteShift: {
    module: "people",
    actions: ["view", "create", "update", "delete"]
  },
  // MRP writes the Production → Material Planning tables (was inventory).
  production_runMRP: {
    module: "production",
    actions: ["view", "create", "update"]
  },
  // API keys are on Settings → API Keys (was users).
  settings_getApiKeys: {
    module: "settings",
    actions: ["view", "create", "update"]
  },
  // ITAR certifications are on Settings → ITAR Certifications (was users).
  users_getItarCertificationStatus: { module: "settings", actions: ["view"] },
  users_getItarCertificationReport: { module: "settings", actions: ["view"] },
  // Gated on another module than their own on purpose. Each must match the
  // permission the ERP route that does the same thing requires: an OAuth
  // connector or API key gated more loosely than the screen can do what the
  // screen forbids, and a service handed `db` writes past RLS, so this gate
  // is the only one.
  // Writes a GL journal: the Reconcile screen requires accounting.
  inventory_createInventoryReconciliationJournal: {
    module: "accounting",
    actions: ["view", "create"]
  },
  // A serial unit's carrying cost, and re-booking it, are accounting figures.
  inventory_getSerialUnitCosts: { module: "accounting", actions: ["view"] },
  inventory_recostSerialUnit: {
    module: "accounting",
    actions: ["view", "create", "update"]
  },
  // Issue Credit writes a memo: its route requires invoicing.
  purchasing_createPurchaseReturnOrderCredit: {
    module: "invoicing",
    actions: ["view", "create"]
  },
  sales_createSalesReturnOrderCredit: {
    module: "invoicing",
    actions: ["view", "create"]
  },
  // A leased asset's classification is an accounting decision.
  purchasing_overrideLeaseLineClassification: {
    module: "accounting",
    actions: ["view", "create", "update"]
  },
  purchasing_removeLeaseLineClassificationOverride: {
    module: "accounting",
    actions: ["view", "create", "update"]
  },
  // Creates a shipment: its route requires inventory.
  sales_shipSalesOrderLine: {
    module: "inventory",
    actions: ["view", "create"]
  },
  // Drafts a purchase return from an issue: its route requires purchasing.
  quality_draftIssueSupplierReturn: {
    module: "purchasing",
    actions: ["view", "create"]
  },
  // Opens a quality Issue from an RMA line: Returns AND Issues, which the
  // API cannot name as one module, so its own gate checks both.
  sales_escalateReturnOrderLine: { module: null, actions: [] },
  // A rental unit on a shipment or receipt: Rental Agreements AND Shipments
  // or Receipts. Selling it: Rental Agreements AND Sales Invoices.
  sales_deliverRentalUnit: { module: null, actions: [] },
  sales_returnRentalUnit: { module: null, actions: [] },
  sales_sellRentalUnit: { module: null, actions: [] },
  // The classification override is an accounting decision.
  sales_classifyRentalUnit: {
    module: "accounting",
    actions: ["view", "create", "update"]
  },
  // A tie-out adjustment drafts a GL journal: its route requires accounting.
  invoicing_adjustReceivables: {
    module: "accounting",
    actions: ["view", "create"]
  },
  invoicing_adjustPayables: {
    module: "accounting",
    actions: ["view", "create"]
  },
  // Buying or selling a fixed asset creates a purchase or sales order.
  accounting_purchaseFixedAsset: {
    module: "purchasing",
    actions: ["view", "create"]
  },
  accounting_sellFixedAsset: { module: "sales", actions: ["view", "create"] },
  // Inventory value is an accounting figure: the valuation report requires
  // accounting.
  inventory_getInventoryValuation: { module: "accounting", actions: ["view"] },
  inventory_getInventoryValuationTieOut: {
    module: "accounting",
    actions: ["view"]
  },
  // A method's steps and Save Method need Jobs AND the owning page (Parts or
  // Quotes), which the API cannot name as one module, so the function's own
  // gate checks both.
  production_updateMethodOperationStepOrder: { module: null, actions: [] },
  production_updateQuoteOperationStepOrder: { module: null, actions: [] },
  production_upsertMakeMethodFromJob: { module: null, actions: [] },
  production_upsertMakeMethodFromJobMethod: { module: null, actions: [] },
  // Enrolling the company in the Implementation Hub: Settings → Company.
  shared_enrollImplementationHub: {
    module: "settings",
    actions: ["view", "create", "update"]
  }
};

const tools = allTools.filter((t) => !(t.name in OVERRIDES));

describe("permission overrides", () => {
  it.each(Object.entries(OVERRIDES))(
    "%s gates on the permission its ERP route requires",
    (name, permission) => {
      const t = allTools.find((t) => t.name === name);
      expect(t, name).toBeDefined();
      expect(t?.permission, name).toEqual(permission);
    }
  );
});

// The caller's own account (`users.server.ts`): any member may read and edit
// their own, so these gate on membership alone.
const OWN_ACCOUNT = new Set([
  "users_getAccount",
  "users_getAllAttributeCategories",
  "users_getAttributeCategoryWithValues",
  "users_getCurrentUser",
  "users_getNotificationPreferences",
  "users_updatePublicAccount",
  "users_upsertNotificationPreference"
]);
const membershipModule = (t: Tool) =>
  t.module === "shared" || OWN_ACCOUNT.has(t.name);
// `"employee"`: any employee of the company. Published as no module and no actions.
const membershipOnly = (t: Tool) =>
  t.permission.module === null && t.permission.actions.length === 0;

describe("permission module mapping", () => {
  it("maps items_* to the 'parts' permission module", () => {
    for (const t of tools.filter(
      (t) => t.module === "items" && !membershipOnly(t)
    )) {
      expect(t.permission.module, t.name).toBe("parts");
    }
  });

  it("maps own-account and shared_* tools to null (valid-key-of-company gate only)", () => {
    for (const t of tools.filter(membershipModule)) {
      expect(t.permission.module, t.name).toBeNull();
    }
  });

  it("maps every other module to itself", () => {
    for (const t of tools.filter(
      (t) =>
        t.module !== "items" && !membershipModule(t) && !membershipOnly(t)
    )) {
      expect(t.permission.module, t.name).toBe(t.module);
    }
  });
});

describe("permission actions in the manifest", () => {
  const ACTIONS = new Set(["view", "create", "update", "delete"]);

  it("every op gates on known actions, or on membership alone", () => {
    for (const t of tools.filter((t) => !membershipOnly(t))) {
      expect(t.permission.actions.length, t.name).toBeGreaterThan(0);
      for (const action of t.permission.actions) {
        expect(ACTIONS.has(action), `${t.name}: ${action}`).toBe(true);
      }
    }
  });

  // A lookup every screen needs (locations, units) is "employee"; RLS filters
  // its rows. Only the caller's own account and shared tools may write on it.
  it("a tool gated on membership alone is a READ, or own-account or shared", () => {
    for (const t of tools.filter(membershipOnly)) {
      expect(
        membershipModule(t) || t.classification === "READ",
        t.name
      ).toBe(true);
    }
  });

  // A gate names a page and a level; a level holds every action below it.
  it("publishes the actions of a level: view, then create, update, delete", () => {
    const LEVEL_ACTIONS = ["view", "create", "update", "delete"];
    for (const t of tools.filter((t) => !membershipOnly(t))) {
      expect(t.permission.actions, t.name).toEqual(
        LEVEL_ACTIONS.slice(0, t.permission.actions.length)
      );
    }
  });

  it("a tool that gates on View alone is a READ", () => {
    for (const t of tools.filter(
      (t) => t.permission.actions.join() === "view"
    )) {
      expect(t.classification, t.name).toBe("READ");
    }
  });

  it("a READ gates on view only, or on membership alone", () => {
    for (const t of tools.filter((t) => t.classification === "READ")) {
      if (membershipOnly(t)) continue;
      expect(t.permission.actions, t.name).toEqual(["view"]);
    }
  });

  it("gating on delete means the tool is labelled DESTRUCTIVE", () => {
    for (const t of tools.filter((t) =>
      t.permission.actions.includes("delete")
    )) {
      expect(t.classification, t.name).toBe("DESTRUCTIVE");
    }
  });
});

// A table several pages share gates on its row: an item on the page of its
// type, a memo on the page of its party, a run on the page of its type. Each
// such tool publishes every page the row can pick.
describe("gates the row decides", () => {
  const oneOf = allTools.filter((t) => t.permission.oneOf);
  const named = (name: string) =>
    allTools.find((t) => t.name === name)?.permission;

  it("lets Tools at Edit change a tool's cost: the item's type picks the page", () => {
    expect(named("items_updateItemCost")).toEqual({
      module: "parts",
      actions: ["view", "create", "update"],
      oneOf: byItemType("Edit")
    });
    expect(named("items_getItemCost")?.oneOf).toEqual(byItemType("View"));
    expect(named("items_deleteItem")?.oneOf).toEqual(byItemType("Full"));
  });

  it("gates an item list on any one item page", () => {
    expect(named("items_getItemMpnsList")?.oneOf).toEqual({
      pages: ITEM_PAGES,
      level: "View",
      by: []
    });
  });

  it("gates a memo on the page of its party, and a run on the page of its type", () => {
    expect(named("invoicing_postMemo")?.oneOf).toEqual({
      pages: ["invoicing.supplierCredits", "invoicing.creditMemos"],
      level: "Edit",
      by: ["memo.supplierId", "memo.customerId"]
    });
    expect(named("accounting_postRevenueRecognitionRun")?.oneOf).toEqual({
      pages: ["accounting.leases", "accounting.revenueRecognition"],
      level: "Edit",
      by: ["revenueRecognitionRun.type"]
    });
  });

  it("names the pages of one shared table, in one module", () => {
    const tables: Record<string, string[]> = {
      parts: ITEM_PAGES,
      invoicing: ["invoicing.supplierCredits", "invoicing.creditMemos"],
      accounting: ["accounting.leases", "accounting.revenueRecognition"]
    };
    for (const t of oneOf) {
      const module = t.permission.module ?? "";
      expect(t.permission.oneOf?.pages, t.name).toEqual(tables[module]);
    }
    const counts = Object.fromEntries(
      Object.keys(tables).map((module) => [
        module,
        oneOf.filter((t) => t.permission.module === module).length
      ])
    );
    expect(counts).toEqual({ parts: 83, invoicing: 8, accounting: 7 });
  });
});
