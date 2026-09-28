import { describe, expect, it } from "vitest";
import { CLASSIFICATION_OVERRIDES } from "../../../scripts/lib/service-metadata";
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
const OVERRIDDEN = new Set(["settings_getApiKeys"]);

// CLASSIFICATION_OVERRIDES entries whose permission is set explicitly because
// the UI gate for the same call differs from what the classification derives
// (a WRITE hint on a call the UI serves under `view`). Pinned one by one: each
// is an authorization decision.
const CLASSIFICATION_PERMISSION_PINS: Record<
  string,
  { module: string; actions: string[] }
> = {
  // Consumes a sequence number; the gate is unchanged from the name-derived
  // one pending the product decision (block it, or name a permission).
  settings_getNextSequence: { module: "settings", actions: ["view"] },
  // Upserts period-close tasks inside the close page LOADER (accounting view).
  accounting_getPeriodCloseChecklist: { module: "accounting", actions: ["view"] }
};

const tools = allTools.filter(
  (t) => !OVERRIDDEN.has(t.name) && !(t.name in CLASSIFICATION_PERMISSION_PINS)
);

const funcName = (t: Tool) => t.name.slice(t.module.length + 1).toLowerCase();

describe("permission overrides", () => {
  it("API-key management gates on users_update, matching its ERP routes", () => {
    for (const name of OVERRIDDEN) {
      const t = allTools.find((t) => t.name === name);
      expect(t, name).toBeDefined();
      expect(t?.permission, name).toEqual({
        module: "users",
        actions: ["update"]
      });
    }
  });
});

describe("classification overrides", () => {
  it("pins every explicit permission a CLASSIFICATION_OVERRIDES entry sets", () => {
    const explicit = Object.fromEntries(
      Object.entries(CLASSIFICATION_OVERRIDES)
        .filter(([, o]) => o.permission)
        .map(([name, o]) => [name, o.permission])
    );
    expect(explicit).toEqual(CLASSIFICATION_PERMISSION_PINS);
    for (const [name, permission] of Object.entries(
      CLASSIFICATION_PERMISSION_PINS
    )) {
      expect(allTools.find((t) => t.name === name)?.permission, name).toEqual(
        permission
      );
    }
  });

  it("an override without a permission derives it from its classification", () => {
    for (const [name, o] of Object.entries(CLASSIFICATION_OVERRIDES)) {
      if (o.permission) continue;
      const t = allTools.find((t) => t.name === name);
      expect(t?.classification, name).toBe(o.classification);
    }
  });

  it("the READ overrides of pure lookups gate on view", () => {
    for (const name of [
      "items_lookupBuyPrice",
      "sales_resolvePrice",
      "sales_resolvePriceList",
      "production_calculateJobPriority"
    ]) {
      expect(allTools.find((t) => t.name === name)?.permission.actions, name).toEqual(
        ["view"]
      );
    }
  });

  it("getOrCreateAccountingPeriod gates on accounting update, like its only UI callers", () => {
    expect(
      allTools.find((t) => t.name === "accounting_getOrCreateAccountingPeriod")
        ?.permission
    ).toEqual({ module: "accounting", actions: ["update"] });
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
