import type { SnapshotFieldEntry } from "@carbon/database/audit.config";
import { fkDisplayRegistry } from "@carbon/database/audit.config";
import { describe, expect, it } from "vitest";
import type { FkMapRow } from "./fk-snapshots";
import { fkMapKey, parseFkMapRows, resolveSnapshotSpec } from "./fk-snapshots";

// resolveSnapshotSpec is the single decision point for "does this changed
// column get a human-readable snapshot, and from where" — these tests pin
// its precedence (override > schema FK + registry > nothing) so audit rows
// don't silently lose or misattribute snapshots.

const NO_OVERRIDES: ReadonlyMap<string, SnapshotFieldEntry> = new Map();

function fkMapOf(...rows: FkMapRow[]) {
  return parseFkMapRows(rows);
}

describe("parseFkMapRows / fkMapKey", () => {
  it("keys entries by table.column", () => {
    const map = fkMapOf({
      tableName: "purchaseOrder",
      columnName: "supplierId",
      targetTable: "supplier",
      targetHasCompanyId: true
    });
    expect(map.get(fkMapKey("purchaseOrder", "supplierId"))).toEqual({
      targetTable: "supplier",
      targetHasCompanyId: true
    });
    expect(map.get(fkMapKey("purchaseOrder", "locationId"))).toBeUndefined();
  });
});

describe("resolveSnapshotSpec — automatic path (schema FK + registry)", () => {
  it("resolves a schema-discovered FK whose target is in the registry", () => {
    const fkMap = fkMapOf({
      tableName: "purchaseOrder",
      columnName: "supplierId",
      targetTable: "supplier",
      targetHasCompanyId: true
    });
    expect(
      resolveSnapshotSpec("purchaseOrder", "supplierId", NO_OVERRIDES, fkMap)
    ).toEqual({
      table: "supplier",
      displayColumns: fkDisplayRegistry.supplier,
      hasCompanyId: true
    });
  });

  it("propagates hasCompanyId=false for global targets like user", () => {
    const fkMap = fkMapOf({
      tableName: "salesOrder",
      columnName: "assignee",
      targetTable: "user",
      targetHasCompanyId: false
    });
    expect(
      resolveSnapshotSpec("salesOrder", "assignee", NO_OVERRIDES, fkMap)
    ).toEqual({
      table: "user",
      displayColumns: fkDisplayRegistry.user,
      hasCompanyId: false
    });
  });

  it("returns null when the FK target has no registry entry", () => {
    const fkMap = fkMapOf({
      tableName: "job",
      columnName: "someObscureId",
      targetTable: "tableNobodyRegistered",
      targetHasCompanyId: true
    });
    expect(
      resolveSnapshotSpec("job", "someObscureId", NO_OVERRIDES, fkMap)
    ).toBeNull();
  });

  it("returns null for a non-FK column", () => {
    expect(
      resolveSnapshotSpec("purchaseOrder", "status", NO_OVERRIDES, fkMapOf())
    ).toBeNull();
  });

  it("returns null for nested diff keys", () => {
    const fkMap = fkMapOf({
      tableName: "purchaseOrder",
      columnName: "supplierId",
      targetTable: "supplier",
      targetHasCompanyId: true
    });
    expect(
      resolveSnapshotSpec(
        "purchaseOrder",
        "notes.supplierId",
        NO_OVERRIDES,
        fkMap
      )
    ).toBeNull();
  });
});

describe("resolveSnapshotSpec — overrides (declared snapshotFields)", () => {
  const override: SnapshotFieldEntry = {
    column: "supplierId",
    table: "supplier",
    displayColumns: ["name", "readableId"]
  };
  const overrides = new Map([["supplierId", override]]);

  it("prefers the override's display columns over the registry", () => {
    const fkMap = fkMapOf({
      tableName: "purchaseOrder",
      columnName: "supplierId",
      targetTable: "supplier",
      targetHasCompanyId: true
    });
    expect(
      resolveSnapshotSpec("purchaseOrder", "supplierId", overrides, fkMap)
    ).toEqual({
      table: "supplier",
      displayColumns: ["name", "readableId"],
      hasCompanyId: true
    });
  });

  it("resolves an override even when the fkMap is empty (RPC unavailable)", () => {
    expect(
      resolveSnapshotSpec("purchaseOrder", "supplierId", overrides, fkMapOf())
    ).toEqual({
      table: "supplier",
      displayColumns: ["name", "readableId"],
      hasCompanyId: true
    });
  });

  it("defaults to tenant-scoped when the override target disagrees with the schema FK", () => {
    const fkMap = fkMapOf({
      tableName: "purchaseOrder",
      columnName: "supplierId",
      targetTable: "someOtherTable",
      targetHasCompanyId: false
    });
    const spec = resolveSnapshotSpec(
      "purchaseOrder",
      "supplierId",
      overrides,
      fkMap
    );
    expect(spec?.table).toBe("supplier");
    expect(spec?.hasCompanyId).toBe(true);
  });
});

describe("fkDisplayRegistry", () => {
  it("covers every target the previously hand-declared snapshotFields used", () => {
    // The 7 tables the old per-FK allowlist pointed at — the registry must
    // keep them covered so the migration to automatic discovery loses nothing.
    for (const target of [
      "customerType",
      "customerStatus",
      "supplierType",
      "location",
      "process",
      "supplier",
      "supplierLocation",
      "paymentTerm",
      "shippingMethod",
      "shippingTerm",
      "customer",
      "customerLocation"
    ] as const) {
      expect(
        fkDisplayRegistry[target],
        `registry is missing "${target}"`
      ).toBeDefined();
      expect(fkDisplayRegistry[target]!.length).toBeGreaterThan(0);
    }
  });
});
