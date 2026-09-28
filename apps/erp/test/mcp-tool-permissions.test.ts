import { describe, expect, it } from "vitest";
import metadata from "../app/routes/api+/mcp+/lib/tool-metadata.json";

// Pins the permission-derivation rules in scripts/lib/service-metadata.ts
// (derivePermission + permissionActionsFor) against the REAL generated manifest.
// These permissions gate every API-key call at the oRPC layer, so a generator
// change that silently re-derives them is an authorization change — it must fail
// here first.

type Tool = {
  name: string;
  module: string;
  classification: "READ" | "WRITE" | "DESTRUCTIVE";
  permission: { module: string | null; actions: string[] };
};

const allTools = metadata.tools as Tool[];

// PERMISSION_OVERRIDES in scripts/lib/service-metadata.ts — route-verified
// exceptions that win over the derivation rules. Pinned exactly below and
// excluded from the rule-based assertions. The API-key WRITES (upsert/delete)
// moved to @carbon/ee/api-keys.server behind requireEntitlement, so they are no
// longer MCP tools — only the read (getApiKeys) remains and keeps the override.
// The companion tools ({module}.mcp.server.ts) publish exactly what their ERP
// route's requirePermissions checks.
const OVERRIDES: Record<string, { module: string; actions: string[] }> = {
  // x+/settings+/api-keys.tsx
  settings_getApiKeys: { module: "users", actions: ["update"] },
  // x+/settings+/custom-fields.$table.new.tsx and .$id.tsx
  settings_upsertCustomField: { module: "settings", actions: ["create"] },
  // x+/settings+/custom-fields.$table.tsx (reorder action)
  settings_updateCustomFieldsSortOrder: {
    module: "resources",
    actions: ["update"]
  },
  // x+/inspection+/$id.sample.tsx, $id.measurement.tsx
  quality_upsertInspectionSample: { module: "quality", actions: ["update"] },
  quality_upsertInspectionMeasurement: {
    module: "quality",
    actions: ["update"]
  }
};
const OVERRIDDEN = new Set(Object.keys(OVERRIDES));

const tools = allTools.filter((t) => !OVERRIDDEN.has(t.name));

const funcName = (t: Tool) => t.name.slice(t.module.length + 1).toLowerCase();

describe("permission overrides", () => {
  it("each override publishes its route's requirePermissions", () => {
    for (const [name, expected] of Object.entries(OVERRIDES)) {
      const t = allTools.find((t) => t.name === name);
      expect(t, name).toBeDefined();
      expect(t?.permission, name).toEqual(expected);
    }
  });

  // Companion tools whose verb-derived permission already equals the route's
  // requirePermissions — pinned so a generator change cannot move them.
  it("companion tools without an override gate like their routes", () => {
    const expected: Record<string, { module: string; actions: string[] }> = {
      // x+/settings+/custom-fields.$table.delete.$id.tsx
      settings_deleteCustomField: { module: "settings", actions: ["delete"] },
      // x+/inspection+/$id.accept.tsx, $id.partial.tsx
      quality_dispositionInspection: { module: "quality", actions: ["update"] },
      // x+/fixed-asset+/$fixedAssetId.register.tsx, .dispose.tsx
      accounting_registerFixedAsset: {
        module: "accounting",
        actions: ["update"]
      },
      accounting_disposeFixedAsset: {
        module: "accounting",
        actions: ["update"]
      },
      // x+/depreciation-run+/$depreciationRunId.post.tsx
      accounting_postDepreciationRun: {
        module: "accounting",
        actions: ["update"]
      },
      // x+/accounting+/depreciation-runs.new.tsx
      accounting_createDepreciationRun: {
        module: "accounting",
        actions: ["create"]
      },
      // x+/receipt+/new.tsx, x+/shipment+/new.tsx,
      // x+/sales-order+/$orderId.$lineId.shipment.tsx
      inventory_createReceipt: { module: "inventory", actions: ["create"] },
      inventory_createShipment: { module: "inventory", actions: ["create"] },
      inventory_createSalesOrderLineShipment: {
        module: "inventory",
        actions: ["create"]
      },
      // x+/receipt+/$receiptId.{post,void}.tsx, x+/shipment+/$shipmentId.{post,void}.tsx
      inventory_postReceipt: { module: "inventory", actions: ["update"] },
      inventory_voidReceipt: { module: "inventory", actions: ["update"] },
      inventory_postShipment: { module: "inventory", actions: ["update"] },
      inventory_voidShipment: { module: "inventory", actions: ["update"] },
      // x+/{receipt,shipment}+/lines.update.tsx
      inventory_updateReceiptLines: {
        module: "inventory",
        actions: ["update"]
      },
      inventory_updateShipmentLines: {
        module: "inventory",
        actions: ["update"]
      },
      // x+/payments+/$paymentId.{post,void}.tsx, x+/credits+/$memoId.{post,void}.tsx,
      // x+/invoicing+/card-transactions.$id.void.tsx
      invoicing_postPayment: { module: "invoicing", actions: ["update"] },
      invoicing_voidPayment: { module: "invoicing", actions: ["update"] },
      invoicing_postMemo: { module: "invoicing", actions: ["update"] },
      invoicing_voidMemo: { module: "invoicing", actions: ["update"] },
      invoicing_voidCardTransaction: {
        module: "invoicing",
        actions: ["update"]
      }
    };
    for (const [name, permission] of Object.entries(expected)) {
      const t = allTools.find((t) => t.name === name);
      expect(t, name).toBeDefined();
      expect(t?.permission, name).toEqual(permission);
    }
  });
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

describe("permission action derivation", () => {
  it("every READ op gates on view only", () => {
    for (const t of tools.filter((t) => t.classification === "READ")) {
      expect(t.permission.actions, t.name).toEqual(["view"]);
    }
  });

  it("every delete* op gates on delete", () => {
    for (const t of tools.filter(
      (t) => t.classification !== "READ" && funcName(t).startsWith("delete")
    )) {
      expect(t.permission.actions, t.name).toEqual(["delete"]);
    }
  });

  it("every upsert* op gates on create AND update (open question 2 in the parent plan — pinned so a change is deliberate)", () => {
    for (const t of tools.filter(
      (t) => t.classification !== "READ" && funcName(t).startsWith("upsert")
    )) {
      expect(t.permission.actions, t.name).toEqual(["create", "update"]);
    }
  });

  it("insert|create|add|new|copy|duplicate|generate* ops gate on create", () => {
    for (const t of tools.filter(
      (t) =>
        t.classification !== "READ" &&
        !funcName(t).startsWith("upsert") &&
        /^(insert|create|add|new|copy|duplicate|generate)/.test(funcName(t))
    )) {
      expect(t.permission.actions, t.name).toEqual(["create"]);
    }
  });

  it("every remaining write verb gates on update", () => {
    for (const t of tools.filter(
      (t) =>
        t.classification !== "READ" &&
        !/^(upsert|delete|insert|create|add|new|copy|duplicate|generate)/.test(
          funcName(t)
        )
    )) {
      expect(t.permission.actions, t.name).toEqual(["update"]);
    }
  });

  it("every op has a non-empty actions array", () => {
    for (const t of tools) {
      expect(t.permission.actions.length, t.name).toBeGreaterThan(0);
    }
  });
});
