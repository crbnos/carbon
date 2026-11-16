// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { moduleOf, PAGES, readPages } from "@carbon/database/access";
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
    page?: string;
    actions: string[];
    oneOf?: { pages: string[]; level: string; by: string[] };
    allOf?: { page: string; level: string }[];
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

// A gate that needs pages of several modules: each page at its level, in
// registry order, and the actions of its highest level.
const VIEW = ["view"];
const EDIT = ["view", "create", "update"];
const allOf = (
  actions: string[],
  ...gates: [page: string, level: string][]
): Tool["permission"] => ({
  module: null,
  actions,
  allOf: gates.map(([page, level]) => ({ page, level }))
});

// A read on one page admits View on any page of its module and on its
// cross-module readers (`readPages`, the gate `readGate` runs), in registry order.
const ORDER = PAGES.map((page) => page.id as string);
const readPagesOf = (page: string) =>
  [...readPages(page)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
const read = (page: string): Tool["permission"] => {
  const pages = readPagesOf(page);
  const modules = new Set(pages.map(moduleOf));
  const [module] = modules;
  const oneOf = { pages, level: "View", by: [] };
  return modules.size === 1 && module
    ? { module, actions: ["view"], oneOf }
    : { module: null, actions: [], oneOf };
};
/** A read gated on any of `pages`, each widened as a read is. */
const readAny = (...pages: string[]): Tool["permission"] => ({
  module: null,
  actions: [],
  oneOf: { pages: [...new Set(pages.flatMap(readPagesOf))], level: "View", by: [] }
});
/** A write any one of `pages` passes at `level`. */
const choice = (level: string, ...pages: string[]): Tool["permission"] => ({
  module: null,
  actions: [],
  oneOf: { pages, level, by: [] }
});
/** A tool whose gate is a widened read: its pages hold a whole module. */
const isWidenedRead = (t: Tool) => {
  const pages = t.permission.oneOf?.pages ?? [];
  if (t.permission.oneOf?.by.length) return false;
  return pages.some((page) =>
    PAGES.every(
      (p) => moduleOf(p.id) !== moduleOf(page) || pages.includes(p.id)
    )
  );
};

// Operations pinned exactly, and excluded from the general assertions below.
const OVERRIDES: Record<string, Tool["permission"]> = {
  // The page registry moved these tables to a page of another module, and
  // the gate follows the page. Each is pinned so the move stays visible.
  // Parts → Parts keeps writing storageType (alsoWrittenBy).
  inventory_getStorageTypes: readAny("inventory.storageTypes", "parts.parts"),
  inventory_getStorageType: readAny("inventory.storageTypes", "parts.parts"),
  inventory_getStorageTypeUsage: readAny("inventory.storageTypes", "parts.parts"),
  inventory_createStorageType: choice("Create", "inventory.storageTypes", "parts.parts"),
  inventory_updateStorageType: choice("Edit", "inventory.storageTypes", "parts.parts"),
  inventory_deleteStorageTypeWithCascade: choice("Full", "inventory.storageTypes", "parts.parts"),
  // Bank details need Accounting → Bank Accounts, not the partner page.
  purchasing_getSupplierBankAccounts: read("accounting.bankAccounts"),
  purchasing_createSupplierBankAccount: {
    module: "accounting", page: "accounting.bankAccounts",
    actions: ["view", "create"]
  },
  purchasing_updateSupplierBankAccount: {
    module: "accounting", page: "accounting.bankAccounts",
    actions: ["view", "create", "update"]
  },
  purchasing_deleteSupplierBankAccount: {
    module: "accounting", page: "accounting.bankAccounts",
    actions: ["view", "create", "update", "delete"]
  },
  sales_getCustomerBankAccounts: read("accounting.bankAccounts"),
  sales_createCustomerBankAccount: {
    module: "accounting", page: "accounting.bankAccounts",
    actions: ["view", "create"]
  },
  sales_updateCustomerBankAccount: {
    module: "accounting", page: "accounting.bankAccounts",
    actions: ["view", "create", "update"]
  },
  sales_deleteCustomerBankAccount: {
    module: "accounting", page: "accounting.bankAccounts",
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
  production_getFailureMode: read("resources.failureModes"),
  production_getFailureModes: read("resources.failureModes"),
  production_getFailureModesList: read("resources.failureModes"),
  production_createFailureMode: {
    module: "resources", page: "resources.failureModes",
    actions: ["view", "create"]
  },
  production_updateFailureMode: {
    module: "resources", page: "resources.failureModes",
    actions: ["view", "create", "update"]
  },
  production_deleteFailureMode: {
    module: "resources", page: "resources.failureModes",
    actions: ["view", "create", "update", "delete"]
  },
  production_getMaintenanceDispatch: read("resources.dispatches"),
  production_deleteMaintenanceDispatch: {
    module: "resources", page: "resources.dispatches",
    actions: ["view", "create", "update", "delete"]
  },
  production_getMaintenanceDispatchComments: read("resources.dispatches"),
  production_createMaintenanceDispatchComment: {
    module: "resources", page: "resources.dispatches",
    actions: ["view", "create"]
  },
  production_updateMaintenanceDispatchComment: {
    module: "resources", page: "resources.dispatches",
    actions: ["view", "create", "update"]
  },
  production_getMaintenanceDispatchEvents: read("resources.dispatches"),
  production_createMaintenanceDispatchEvent: {
    module: "resources", page: "resources.dispatches",
    actions: ["view", "create"]
  },
  production_updateMaintenanceDispatchEvent: {
    module: "resources", page: "resources.dispatches",
    actions: ["view", "create", "update"]
  },
  production_deleteMaintenanceDispatchEvent: {
    module: "resources", page: "resources.dispatches",
    actions: ["view", "create", "update", "delete"]
  },
  production_getMaintenanceDispatchItems: read("resources.dispatches"),
  production_createMaintenanceDispatchItem: {
    module: "resources", page: "resources.dispatches",
    actions: ["view", "create"]
  },
  production_updateMaintenanceDispatchItem: {
    module: "resources", page: "resources.dispatches",
    actions: ["view", "create", "update"]
  },
  production_getMaintenanceSchedule: read("resources.schedules"),
  production_createMaintenanceSchedule: {
    module: "resources", page: "resources.schedules",
    actions: ["view", "create"]
  },
  production_updateMaintenanceSchedule: {
    module: "resources", page: "resources.schedules",
    actions: ["view", "create", "update"]
  },
  production_deleteMaintenanceSchedule: {
    module: "resources", page: "resources.schedules",
    actions: ["view", "create", "update", "delete"]
  },
  // A kanban's job link is on Inventory → Kanbans (was production).
  production_updateKanbanJob: {
    module: "inventory", page: "inventory.kanbans",
    actions: ["view", "create", "update"]
  },
  // Supplier processes are on Resources → Processes (was purchasing; the
  // table's RLS was already resources).
  purchasing_getSupplierProcessesByProcess: read("resources.processes"),
  purchasing_createSupplierProcess: {
    module: "resources", page: "resources.processes",
    actions: ["view", "create"]
  },
  purchasing_updateSupplierProcess: {
    module: "resources", page: "resources.processes",
    actions: ["view", "create", "update"]
  },
  purchasing_deleteSupplierProcess: {
    module: "resources", page: "resources.processes",
    actions: ["view", "create", "update", "delete"]
  },
  // Shifts are on People → Shifts (the table's RLS was already people).
  resources_deleteShift: {
    module: "people", page: "people.shifts",
    actions: ["view", "create", "update", "delete"]
  },
  // MRP writes the Production → Material Planning tables (was inventory).
  production_runMRP: {
    module: "production", page: "production.materialPlanning",
    actions: ["view", "create", "update"]
  },
  // API keys are on Settings → API Keys (was users).
  settings_getApiKeys: {
    module: "settings", page: "settings.apiKeys",
    actions: ["view", "create", "update"]
  },
  // ITAR certifications are on Settings → ITAR Certifications (was users).
  users_getItarCertificationStatus: read("settings.itarCertifications"),
  users_getItarCertificationReport: read("settings.itarCertifications"),
  // Gated on another module than their own on purpose. Each must match the
  // permission the ERP route that does the same thing requires: an OAuth
  // connector or API key gated more loosely than the screen can do what the
  // screen forbids, and a service handed `db` writes past RLS, so this gate
  // is the only one.
  // Writes a GL journal: the Reconcile screen requires accounting.
  inventory_createInventoryReconciliationJournal: {
    module: "accounting", page: "accounting.journalEntries",
    actions: ["view", "create"]
  },
  // A serial unit's carrying cost, and re-booking it, are accounting figures.
  inventory_getSerialUnitCosts: read("accounting.reporting"),
  inventory_recostSerialUnit: {
    module: "accounting", page: "accounting.reporting",
    actions: ["view", "create", "update"]
  },
  // Issue Credit writes a memo: its route requires invoicing.
  purchasing_createPurchaseReturnOrderCredit: {
    module: "invoicing", page: "invoicing.supplierCredits",
    actions: ["view", "create"]
  },
  sales_createSalesReturnOrderCredit: {
    module: "invoicing", page: "invoicing.creditMemos",
    actions: ["view", "create"]
  },
  // A leased asset's classification is an accounting decision.
  purchasing_overrideLeaseLineClassification: {
    module: "accounting", page: "accounting.leases",
    actions: ["view", "create", "update"]
  },
  purchasing_removeLeaseLineClassificationOverride: {
    module: "accounting", page: "accounting.leases",
    actions: ["view", "create", "update"]
  },
  // Creates a shipment: its route requires inventory.
  sales_shipSalesOrderLine: {
    module: "inventory", page: "inventory.shipments",
    actions: ["view", "create"]
  },
  // Drafts a purchase return from an issue: its route requires purchasing.
  quality_draftIssueSupplierReturn: {
    module: "purchasing", page: "purchasing.returns",
    actions: ["view", "create"]
  },
  // Opens a quality Issue from an RMA line: Returns AND Issues.
  sales_escalateReturnOrderLine: allOf(
    EDIT,
    ["quality.issues", "Create"],
    ["sales.returns", "Edit"]
  ),
  // A rental unit on a shipment or receipt: Rental Agreements AND Shipments
  // or Receipts. Selling it: Rental Agreements AND Sales Invoices.
  sales_deliverRentalUnit: allOf(
    EDIT,
    ["inventory.shipments", "Create"],
    ["sales.rentalAgreements", "Edit"]
  ),
  sales_returnRentalUnit: allOf(
    EDIT,
    ["inventory.receipts", "Create"],
    ["sales.rentalAgreements", "Edit"]
  ),
  sales_sellRentalUnit: allOf(
    EDIT,
    ["invoicing.salesInvoices", "Create"],
    ["sales.rentalAgreements", "Edit"]
  ),
  // A part CLIN's delivery: Contracts AND Shipments.
  sales_deliverContractLine: allOf(
    EDIT,
    ["inventory.shipments", "Create"],
    ["sales.serviceContracts", "Edit"]
  ),
  // The classification override is an accounting decision.
  sales_classifyRentalUnit: {
    module: "accounting", page: "accounting.revenueRecognition",
    actions: ["view", "create", "update"]
  },
  // A tie-out adjustment drafts a GL journal: its route requires accounting.
  invoicing_adjustReceivables: {
    module: "accounting", page: "accounting.journalEntries",
    actions: ["view", "create"]
  },
  invoicing_adjustPayables: {
    module: "accounting", page: "accounting.journalEntries",
    actions: ["view", "create"]
  },
  // Buying or selling a fixed asset creates a purchase or sales order.
  accounting_purchaseFixedAsset: {
    module: "purchasing", page: "purchasing.purchaseOrders",
    actions: ["view", "create"]
  },
  accounting_sellFixedAsset: { module: "sales", page: "sales.salesOrders", actions: ["view", "create"] },
  // Inventory value is an accounting figure: the valuation report requires
  // accounting.
  inventory_getInventoryValuation: read("accounting.reporting"),
  inventory_getInventoryValuationTieOut: read("accounting.reporting"),
  // A quote's steps need Jobs AND Quotes.
  production_updateQuoteOperationStepOrder: allOf(
    EDIT,
    ["production.jobs", "Edit"],
    ["sales.quotes", "Edit"]
  ),
  // An item method's steps and Save Method follow the item's type, like the
  // method editor; Save Method also checks Jobs in `run`.
  production_updateMethodOperationStepOrder: {
    module: "parts",
    actions: ["view", "create", "update"],
    oneOf: byItemType("Edit")
  },
  production_upsertMakeMethodFromJob: {
    module: "parts",
    actions: ["view", "create", "update"],
    oneOf: byItemType("Edit")
  },
  production_upsertMakeMethodFromJobMethod: {
    module: "parts",
    actions: ["view", "create", "update"],
    oneOf: byItemType("Edit")
  },
  // Enrolling the company in the Implementation Hub: Settings → Company.
  shared_enrollImplementationHub: {
    module: "settings", page: "settings.company",
    actions: ["view", "create", "update"]
  },
  // Project states and labels are company-wide settings: Settings → Projects.
  projects_upsertProjectState: {
    module: "settings", page: "settings.projects",
    actions: ["view", "create", "update"]
  },
  projects_deleteProjectState: {
    module: "settings", page: "settings.projects",
    actions: ["view", "create", "update"]
  },
  projects_setProjectStateDefault: {
    module: "settings", page: "settings.projects",
    actions: ["view", "create", "update"]
  },
  projects_upsertProjectLabel: {
    module: "settings", page: "settings.projects",
    actions: ["view", "create", "update"]
  },
  projects_deleteProjectLabel: {
    module: "settings", page: "settings.projects",
    actions: ["view", "create", "update"]
  },
  // A member deletes their own comment on an element they can view: the
  // comments route needs View on Projects, and the delete runs as the caller,
  // so RLS limits it to the author.
  projects_deleteProjectElementComment: read("projects.projects"),
  // An employee corrects their own posted time (the My Time route requires
  // the employee role); the function refuses an entry that is not the
  // caller's.
  projects_createTimesheetCorrection: { module: null, actions: [] },
  // Your own time needs company membership, as the My Time routes do. Saving
  // another employee's week is decided in the function's body.
  projects_logTimesheetEntry: { module: null, actions: [] },
  projects_saveTimesheetEntry: { module: null, actions: [] },
  service_setServiceJobDayHours: { module: null, actions: [] },
  // Each needs two pages, as its route does. A Kysely read or a posting has
  // no RLS behind that gate.
  projects_postProjectIssue: allOf(
    EDIT,
    ["inventory.quantities", "Edit"],
    ["projects.projects", "Edit"]
  ),
  projects_placeProjectAssetsInService: allOf(
    EDIT,
    ["accounting.assets", "Create"],
    ["projects.projects", "Edit"]
  ),
  projects_getLaborDistribution: allOf(
    VIEW,
    ["people.employees", "View"],
    ["projects.reports", "View"]
  ),
  projects_getLaborDistributionPeriods: allOf(
    VIEW,
    ["people.employees", "View"],
    ["projects.reports", "View"]
  ),
  projects_getRdSection174AReport: allOf(
    VIEW,
    ["accounting.reporting", "View"],
    ["projects.reports", "View"]
  ),
  projects_getRdForm6765GReport: allOf(
    VIEW,
    ["accounting.reporting", "View"],
    ["projects.reports", "View"]
  ),
  sales_buildContractLineJob: allOf(
    EDIT,
    ["production.jobs", "Create"],
    ["sales.serviceContracts", "Edit"]
  ),
  sales_createProjectBillingInvoices: allOf(
    EDIT,
    ["invoicing.salesInvoices", "Create"],
    ["sales.serviceContracts", "Edit"]
  ),
  // Creating and editing a labor category need different permissions, and
  // contract billing needs Approvals AND either contracts list, a gate the
  // manifest cannot publish, so each function's own gate checks them.
  projects_upsertLaborCategory: { module: null, actions: [] },
  projects_getContractBillableItems: { module: null, actions: [] },
  projects_getContractBillingLines: { module: null, actions: [] },
  projects_updateProjectBillableItems: { module: null, actions: [] },
  // Changing a warranty return line to a billable service line edits the RMA
  // (sales) AND re-posts the job's coverage (service).
  sales_changeReturnLineToService: allOf(
    EDIT,
    ["sales.returns", "Edit"],
    ["service.jobs", "Edit"]
  ),
  // Invoicing a completed service job needs Edit on Service Jobs AND
  // Create on Sales Invoices.
  service_createServiceInvoice: allOf(
    EDIT,
    ["invoicing.salesInvoices", "Create"],
    ["service.jobs", "Edit"]
  )
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

  it("reads an item list on any Parts page, as one item page reads", () => {
    expect(named("items_getItemMpnsList")).toEqual(read("parts.parts"));
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

  it("widens a one-page read to its module and cross-module readers", () => {
    const view = (module: string | null, pages: string[]) => ({
      module,
      actions: module ? ["view"] : [],
      oneOf: { pages, level: "View", by: [] }
    });
    expect(named("inventory_getReceipts")).toEqual(
      view("inventory", [
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
      ])
    );
    expect(named("users_getEmployeeTypes")).toEqual(
      view("users", [
        "users.accounts",
        "users.operators",
        "users.groups",
        "users.employeeTypes"
      ])
    );
    expect(named("purchasing_getSupplier")).toEqual(
      view("purchasing", [
        "purchasing.suppliers",
        "purchasing.purchaseOrders",
        "purchasing.returns",
        "purchasing.leases",
        "purchasing.materialPlanning",
        "purchasing.rfqs",
        "purchasing.supplierQuotes",
        "purchasing.supplierStages",
        "purchasing.types"
      ])
    );
    // Writes stay per page.
    expect(named("inventory_createReceipt")).toEqual({
      module: "inventory",
      page: "inventory.receipts",
      actions: ["view", "create"]
    });
  });

  it("widens each entry of a cross-module read list", () => {
    expect(named("sales_getOpportunityDocuments")).toEqual({
      module: null,
      actions: [],
      oneOf: {
        pages: [
          "invoicing.payables",
          "invoicing.purchaseInvoices",
          "invoicing.supplierCredits",
          "invoicing.charges",
          "invoicing.reimbursements",
          "invoicing.receivables",
          "invoicing.salesInvoices",
          "invoicing.creditMemos",
          "invoicing.payments",
          "sales.customers",
          "sales.portals",
          "sales.rfqs",
          "sales.quotes",
          "sales.salesOrders",
          "sales.returns",
          "sales.serviceContracts",
          "sales.projectContracts",
          "sales.rentalAgreements",
          "sales.priceLists",
          "sales.pricingRules",
          "sales.salesRules",
          "sales.noQuoteReasons",
          "sales.returnReasons",
          "sales.statuses",
          "sales.types"
        ],
        level: "View",
        by: []
      }
    });
  });

  it("names the pages of one shared table, in one module", () => {
    const tables: Record<string, string[]> = {
      parts: ITEM_PAGES,
      invoicing: ["invoicing.supplierCredits", "invoicing.creditMemos"],
      accounting: ["accounting.leases", "accounting.revenueRecognition"]
    };
    for (const t of oneOf.filter((t) => !isWidenedRead(t) && !(t.name in OVERRIDES))) {
      const module = t.permission.module ?? "";
      expect(t.permission.oneOf?.pages, t.name).toEqual(tables[module]);
    }
    // Each module has such a tool, so the loop above is not vacuous.
    for (const module of Object.keys(tables)) {
      expect(
        oneOf.some((t) => t.permission.module === module && !isWidenedRead(t)),
        module
      ).toBe(true);
    }
  });

  it("lets Tools at Edit change a tool's bill of material: the method's item picks the page", () => {
    expect(named("items_createMethodMaterial")?.oneOf).toEqual(
      byItemType("Create")
    );
    expect(named("items_updateMethodOperationStep")?.oneOf).toEqual(
      byItemType("Edit")
    );
    expect(named("items_deleteMethodOperationTool")?.oneOf).toEqual(
      byItemType("Full")
    );
    expect(named("items_getMethodTree")?.oneOf).toEqual(byItemType("View"));
  });
});

describe("gates of several modules", () => {
  it("publish every page and level, and the actions of the highest", () => {
    const LEVEL_ACTIONS: Record<string, string[]> = {
      View: ["view"],
      Create: ["view", "create"],
      Edit: ["view", "create", "update"],
      Full: ["view", "create", "update", "delete"]
    };
    const gated = allTools.filter((t) => t.permission.allOf);
    expect(gated.length).toBeGreaterThan(0);
    for (const t of gated) {
      const entries = t.permission.allOf ?? [];
      expect(t.permission.module, t.name).toBeNull();
      expect(
        new Set(entries.map((e) => moduleOf(e.page))).size,
        t.name
      ).toBeGreaterThan(1);
      expect(
        entries.map((e) => ORDER.indexOf(e.page)),
        t.name
      ).toEqual(entries.map((e) => ORDER.indexOf(e.page)).sort((a, b) => a - b));
      const widest = entries
        .map((e) => LEVEL_ACTIONS[e.level] ?? [])
        .reduce((a, b) => (b.length > a.length ? b : a), []);
      expect(t.permission.actions, t.name).toEqual(widest);
    }
  });
});

describe("gates of one page", () => {
  it("publish the page, in the module they publish", () => {
    // A write names its page; a read admits its module (`readGate`).
    const paged = allTools.filter((t) => t.permission.page);
    expect(paged.length).toBeGreaterThan(750);
    for (const t of paged) {
      expect(t.permission.page?.split(".")[0], t.name).toBe(
        t.permission.module
      );
      expect(t.permission.oneOf, t.name).toBeUndefined();
    }
  });
});
