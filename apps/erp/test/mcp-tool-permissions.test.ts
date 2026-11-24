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
  permission: { module: string | null; actions: string[]; scopes?: string[] };
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
  // Opens a quality Issue from an RMA line: quality_create AND sales_update.
  sales_escalateReturnOrderLine: { module: null, actions: [], scopes: ["quality_create", "sales_update"] },
  // A rental unit on a shipment or receipt: sales_update AND
  // inventory_create. Selling it: sales and invoicing create.
  sales_deliverRentalUnit: { module: null, actions: [], scopes: ["inventory_create", "sales_update"] },
  sales_returnRentalUnit: { module: null, actions: [], scopes: ["inventory_create", "sales_update"] },
  sales_sellRentalUnit: { module: null, actions: [], scopes: ["invoicing_create", "sales_create", "sales_update"] },
  // A part CLIN's delivery: sales_update AND inventory_create.
  sales_deliverContractLine: { module: null, actions: [], scopes: ["inventory_create", "sales_update"] },
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
  // (parts or sales).
  production_updateMethodOperationStepOrder: { module: null, actions: [], scopes: ["parts_update", "production_update"] },
  production_updateQuoteOperationStepOrder: { module: null, actions: [], scopes: ["production_update", "sales_update"] },
  production_upsertMakeMethodFromJob: { module: null, actions: [], scopes: ["parts_update", "production_update"] },
  production_upsertMakeMethodFromJobMethod: { module: null, actions: [], scopes: ["parts_update", "production_update"] },
  // Enrolling the company in the Implementation Hub: its route requires
  // settings_update.
  shared_enrollImplementationHub: { module: "settings", actions: ["update"] },
  // Project states and labels are company-wide settings: Settings → Projects
  // requires settings_update.
  projects_upsertProjectState: { module: "settings", actions: ["update"] },
  projects_deleteProjectState: { module: "settings", actions: ["update"] },
  projects_setProjectStateDefault: { module: "settings", actions: ["update"] },
  projects_upsertProjectLabel: { module: "settings", actions: ["update"] },
  projects_deleteProjectLabel: { module: "settings", actions: ["update"] },
  // A member deletes their own comment on an element they can view: the
  // comments route requires projects_view, and the delete runs as the caller,
  // so RLS limits it to the author.
  projects_deleteProjectElementComment: {
    module: "projects",
    actions: ["view"]
  },
  // An employee corrects their own posted time (the My Time route requires
  // the employee role); the function refuses an entry that is not the
  // caller's.
  projects_createTimesheetCorrection: { module: null, actions: [] },
  // Your own time needs company membership, as the My Time routes do. Saving
  // another employee's week is decided in the function's body.
  projects_logTimesheetEntry: { module: null, actions: [] },
  projects_saveTimesheetEntry: { module: null, actions: [] },
  service_setServiceJobDayHours: { module: null, actions: [] },
  // Each needs two modules, as its route does, so the function's own gate
  // checks them. A Kysely read or a posting has no RLS behind that gate.
  projects_postProjectIssue: { module: null, actions: [], scopes: ["inventory_update", "projects_update"] },
  projects_placeProjectAssetsInService: { module: null, actions: [], scopes: ["accounting_create", "projects_update"] },
  projects_getLaborDistribution: { module: null, actions: [], scopes: ["people_view", "projects_view"] },
  projects_getLaborDistributionPeriods: { module: null, actions: [], scopes: ["people_view", "projects_view"] },
  projects_getRdSection174AReport: { module: null, actions: [], scopes: ["accounting_view", "projects_view"] },
  projects_getRdForm6765GReport: { module: null, actions: [], scopes: ["accounting_view", "projects_view"] },
  sales_buildContractLineJob: { module: null, actions: [], scopes: ["production_create", "sales_update"] },
  sales_createProjectBillingInvoices: { module: null, actions: [], scopes: ["invoicing_create", "sales_update"] },
  // Creating and editing a labor category need different permissions, which
  // its own body checks; contract billing needs projects AND sales.
  projects_upsertLaborCategory: { module: null, actions: [] },
  projects_getContractBillableItems: { module: null, actions: [], scopes: ["projects_view", "sales_view"] },
  projects_getContractBillingLines: { module: null, actions: [], scopes: ["projects_view", "sales_view"] },
  projects_updateProjectBillableItems: { module: null, actions: [], scopes: ["projects_update", "sales_view"] },
  // Changing a warranty return line to a billable service line edits the RMA
  // (sales) AND re-posts the job's coverage (service).
  sales_changeReturnLineToService: { module: null, actions: [], scopes: ["sales_update", "service_update"] },
  // Needs invoicing_update AND accounting_update.
  invoicing_changePurchaseInvoiceLineAccount: { module: null, actions: [], scopes: ["accounting_update", "invoicing_update"] },
  invoicing_changeSalesInvoiceLineAccount: { module: null, actions: [], scopes: ["accounting_update", "invoicing_update"] },
  // Invoicing a completed service job needs service_update AND
  // invoicing_create (the old service order invoice's rule).
  service_createServiceInvoice: { module: null, actions: [], scopes: ["invoicing_create", "service_update"] },
  // A plan line's Create Job, and a job for a part on a task: production
  // create AND projects view, as the route requires.
  projects_createJobFromMaterial: {
    module: null,
    actions: [],
    scopes: ["production_create", "projects_view"]
  },
  projects_createProjectElementJob: {
    module: null,
    actions: [],
    scopes: ["production_create", "projects_view"]
  },
  // A plan line's Create PO line: purchasing create AND projects view.
  projects_createPurchaseOrderLineFromMaterial: {
    module: null,
    actions: [],
    scopes: ["projects_view", "purchasing_create"]
  },
  // The missing-time report's Timesheet Required toggle.
  projects_updateTimesheetRequired: {
    module: null,
    actions: [],
    scopes: ["people_update", "projects_view"]
  },
  // A request for quote's lines read parts and purchasing.
  purchasing_getRequestQuoteRows: {
    module: null,
    actions: [],
    scopes: ["parts_view", "purchasing_view"]
  },
  // The cutover repair journals documents: settings AND accounting update.
  settings_writeMissingJournals: {
    module: null,
    actions: [],
    scopes: ["accounting_update", "settings_update"]
  },
  // Create or update by whether an id is sent; the body checks the pair
  // (ctx.can) and refuses a key without it (refuseKeyWithout).
  projects_upsertIndirectPool: { module: null, actions: [] },
  projects_upsertPlanningGroup: { module: null, actions: [] },
  // Any employee scans a kanban card, as on the shop floor; a key also needs
  // inventory_update, and production_create for a Make card.
  inventory_scanKanban: { module: null, actions: [] },
  // Any employee may record a risk, as the New Risk route lets one; a key
  // also needs quality_create (refuseKeyWithout).
  quality_createRisk: { module: null, actions: [] },
  // Any record's custom field values: RLS decides per record; a key also
  // needs update on the table's module, checked in the body.
  settings_setRecordCustomFields: { module: null, actions: [] },
  // The group edit route has always required users_view; RLS decides the
  // write. Published as a WRITE (@mcp write); a key also needs users_update.
  users_updateGroup: { module: "users", actions: ["view"] },
  // The sales invoice header fields: the page's panel and update route have
  // always required sales_update (the table's RLS adds invoicing_update).
  invoicing_updateSalesInvoiceField: { module: "sales", actions: ["update"] },
  // Indirect rates are accounting: the pool and rate screens require
  // accounting_view to read, accounting_update to change, and
  // accounting_delete to delete a pool.
  projects_upsertIndirectPoolAccount: {
    module: "accounting",
    actions: ["update"]
  },
  projects_deleteIndirectPoolAccount: {
    module: "accounting",
    actions: ["update"]
  },
  projects_deleteIndirectPool: { module: "accounting", actions: ["delete"] },
  projects_setIndirectRate: { module: "accounting", actions: ["update"] },
  projects_runIndirectRatePeriod: { module: "accounting", actions: ["update"] },
  projects_runFinalTrueUp: { module: "accounting", actions: ["update"] },
  projects_getIndirectPools: { module: "accounting", actions: ["view"] },
  projects_getIndirectPool: { module: "accounting", actions: ["view"] },
  projects_getIndirectRates: { module: "accounting", actions: ["view"] },
  projects_getIndirectRateRuns: { module: "accounting", actions: ["view"] },
  // The custom field form's edit route has always required settings_create.
  settings_updateCustomField: { module: "settings", actions: ["create"] }
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
