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
  permission: { module: string | null; actions: string[] };
};

const allTools = metadata.tools as Tool[];

// Operations gated on another module than their own, or on more than one.
// Pinned exactly below and excluded from the general assertions. Each must match the permission the ERP route that does the same thing
// requires: an OAuth connector or API key gated more loosely than the screen
// can do what the screen forbids — and a service handed `db` writes past RLS,
// so this gate is the only one.
const OVERRIDES: Record<string, Tool["permission"]> = {
  // API-key management. The writes (upsert/delete) moved to
  // @carbon/ee/api-keys.server behind requireEntitlement and are no longer
  // tools; only the read remains.
  settings_getApiKeys: { module: "users", actions: ["update"] },
  // Writes a GL journal: the Reconcile screen requires accounting_create.
  inventory_createInventoryReconciliationJournal: {
    module: "accounting",
    actions: ["create"]
  },
  // A serial unit's carrying cost, and re-booking it, are accounting figures.
  inventory_getSerialUnitCosts: { module: "accounting", actions: ["view"] },
  inventory_recostSerialUnit: { module: "accounting", actions: ["update"] },
  // Bank accounts: the table's RLS and every bank-account screen are accounting.
  purchasing_getSupplierBankAccounts: { module: "accounting", actions: ["view"] },
  purchasing_createSupplierBankAccount: {
    module: "accounting",
    actions: ["create"]
  },
  purchasing_updateSupplierBankAccount: {
    module: "accounting",
    actions: ["update"]
  },
  purchasing_deleteSupplierBankAccount: {
    module: "accounting",
    actions: ["delete"]
  },
  sales_getCustomerBankAccounts: { module: "accounting", actions: ["view"] },
  sales_createCustomerBankAccount: {
    module: "accounting",
    actions: ["create"]
  },
  sales_updateCustomerBankAccount: {
    module: "accounting",
    actions: ["update"]
  },
  sales_deleteCustomerBankAccount: {
    module: "accounting",
    actions: ["delete"]
  },
  // Issue Credit writes a memo: its route requires invoicing_create.
  purchasing_createPurchaseReturnOrderCredit: {
    module: "invoicing",
    actions: ["create"]
  },
  sales_createSalesReturnOrderCredit: {
    module: "invoicing",
    actions: ["create"]
  },
  // A leased asset's classification is an accounting decision: its route
  // requires accounting_update, not the lease's purchasing permission.
  purchasing_overrideLeaseLineClassification: {
    module: "accounting",
    actions: ["update"]
  },
  purchasing_removeLeaseLineClassificationOverride: {
    module: "accounting",
    actions: ["update"]
  },
  // Creates a shipment: its route requires inventory_create.
  sales_shipSalesOrderLine: { module: "inventory", actions: ["create"] },
  // Drafts a purchase return from an issue: its route requires
  // purchasing_create.
  quality_draftIssueSupplierReturn: {
    module: "purchasing",
    actions: ["create"]
  },
  // Opens a quality Issue from an RMA line: quality_create AND sales_update,
  // which the API cannot name as one module, so its own gate checks both.
  sales_escalateReturnOrderLine: { module: null, actions: [] },
  // A rental unit on a shipment or receipt: sales_update AND
  // inventory_create. Selling it: sales and invoicing create.
  sales_deliverRentalUnit: { module: null, actions: [] },
  sales_returnRentalUnit: { module: null, actions: [] },
  sales_sellRentalUnit: { module: null, actions: [] },
  // The classification override is an accounting decision: its route
  // requires accounting_update.
  sales_classifyRentalUnit: {
    module: "accounting",
    actions: ["update"]
  },
  // A tie-out adjustment drafts a GL journal: its route requires
  // accounting_create.
  invoicing_adjustReceivables: { module: "accounting", actions: ["create"] },
  invoicing_adjustPayables: { module: "accounting", actions: ["create"] },
  // Buying or selling a fixed asset creates a purchase or sales order: its
  // route requires purchasing_create or sales_create.
  accounting_purchaseFixedAsset: { module: "purchasing", actions: ["create"] },
  accounting_sellFixedAsset: { module: "sales", actions: ["create"] },
  // Inventory value is an accounting figure: the valuation report requires
  // accounting_view.
  inventory_getInventoryValuation: { module: "accounting", actions: ["view"] },
  inventory_getInventoryValuationTieOut: {
    module: "accounting",
    actions: ["view"]
  },
  // Storage types belong to the item master: their routes and the table's
  // RLS are parts.
  inventory_getStorageTypes: { module: "parts", actions: ["view"] },
  inventory_getStorageType: { module: "parts", actions: ["view"] },
  inventory_getStorageTypeUsage: { module: "parts", actions: ["view"] },
  inventory_createStorageType: { module: "parts", actions: ["create"] },
  inventory_updateStorageType: { module: "parts", actions: ["update"] },
  inventory_deleteStorageTypeWithCascade: {
    module: "parts",
    actions: ["delete"]
  },
  // MRP: its route requires inventory_update.
  production_runMRP: { module: "inventory", actions: ["update"] },
  // A method's steps and Save Method need production AND the owning module
  // (parts or sales), which the API cannot name as one module, so the
  // function's own gate checks both.
  production_updateMethodOperationStepOrder: { module: null, actions: [] },
  production_updateQuoteOperationStepOrder: { module: null, actions: [] },
  production_upsertMakeMethodFromJob: { module: null, actions: [] },
  production_upsertMakeMethodFromJobMethod: { module: null, actions: [] },
  // Enrolling the company in the Implementation Hub: its route requires
  // settings_update.
  shared_enrollImplementationHub: { module: "settings", actions: ["update"] }
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

describe("permission module mapping", () => {
  it("maps items_* to the 'parts' permission module", () => {
    for (const t of tools.filter((t) => t.module === "items")) {
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
      (t) => t.module !== "items" && !membershipModule(t)
    )) {
      expect(t.permission.module, t.name).toBe(t.module);
    }
  });
});

describe("permission actions in the manifest", () => {
  const ACTIONS = new Set(["view", "create", "update", "delete"]);
  // `{}`: any member of the company. Published as no module and no actions.
  const membershipOnly = (t: Tool) =>
    t.permission.module === null && t.permission.actions.length === 0;

  it("every op gates on known actions, or on membership alone", () => {
    for (const t of tools.filter((t) => !membershipOnly(t))) {
      expect(t.permission.actions.length, t.name).toBeGreaterThan(0);
      for (const action of t.permission.actions) {
        expect(ACTIONS.has(action), `${t.name}: ${action}`).toBe(true);
      }
    }
  });

  it("only own-account and shared tools gate on membership alone", () => {
    for (const t of tools.filter(membershipOnly)) {
      expect(membershipModule(t), t.name).toBe(true);
    }
  });

  it("a tool that gates on view is a READ", () => {
    for (const t of tools.filter((t) =>
      t.permission.actions.includes("view")
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
