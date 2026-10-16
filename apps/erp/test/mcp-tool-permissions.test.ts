// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { MCP_VERBS } from "../app/routes/api+/mcp+/lib/mcp-exposure";
import metadata from "../app/routes/api+/mcp+/lib/tool-metadata.json";

// Pins what a tool's declared verb means for the permission it gates on, against
// the REAL generated manifest. These permissions gate every API-key call at the
// oRPC layer, so a change to the verb table is an authorization change — it must
// fail here first. Nothing below looks at a function's name: a tool is what its
// `@mcp <verb>` tag says it is.

type Tool = {
  name: string;
  module: string;
  classification: "READ" | "WRITE" | "DESTRUCTIVE";
  permission: { module: string | null; actions: string[] };
};

const allTools = metadata.tools as Tool[];

// `@mcp permission` on the function — a route-verified exception that wins over
// the verb. Pinned exactly below and excluded from the verb-based assertions.
// Each must match the permission the ERP route that does the same thing
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
  // A training's fields are edited on the people side: its route requires
  // people_update.
  resources_updateTrainingField: { module: "people", actions: ["update"] },
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

describe("permission module mapping", () => {
  it("maps items_* to the 'parts' permission module", () => {
    for (const t of tools.filter((t) => t.module === "items")) {
      expect(t.permission.module, t.name).toBe("parts");
    }
  });

  it("maps account_* and shared_* to null (valid-key-of-company gate only)", () => {
    for (const t of tools.filter(
      (t) => t.module === "account" || t.module === "shared"
    )) {
      expect(t.permission.module, t.name).toBeNull();
    }
  });

  it("maps every other module to itself", () => {
    for (const t of tools.filter(
      (t) => !["items", "account", "shared"].includes(t.module)
    )) {
      expect(t.permission.module, t.name).toBe(t.module);
    }
  });
});

describe("the verb table", () => {
  it("is the authorization contract — changing it is deliberate", () => {
    expect(
      Object.fromEntries(
        Object.entries(MCP_VERBS).map(([verb, rule]) => [
          verb,
          `${rule.classification} ${rule.actions.join("+")} [${rule.audit.join(",")}]`
        ])
      )
    ).toEqual({
      read: "READ view []",
      create: "WRITE create [createdBy,updatedBy]",
      update: "WRITE update [updatedBy]",
      // Pinned so a change is deliberate: an upsert needs BOTH, since one call
      // can insert or modify.
      upsert: "WRITE create+update [createdBy,updatedBy]",
      delete: "DESTRUCTIVE delete []",
      action: "WRITE update []"
    });
  });
});

describe("permission actions in the manifest", () => {
  const verbActions = Object.values(MCP_VERBS).map((rule) =>
    rule.actions.join("+")
  );
  // `{}`: any member of the company. Published as no module and no actions.
  const membershipOnly = (t: Tool) =>
    t.permission.module === null && t.permission.actions.length === 0;

  it("every op gates on one verb's actions, or on membership alone", () => {
    for (const t of tools.filter((t) => !membershipOnly(t))) {
      expect(verbActions, t.name).toContain(t.permission.actions.join("+"));
    }
  });

  it("only account and shared tools gate on membership alone", () => {
    for (const t of tools.filter(membershipOnly)) {
      expect(["account", "shared"], t.name).toContain(t.module);
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
