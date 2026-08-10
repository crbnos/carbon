import type {
  SnapshotFieldEntry,
  TableConfig
} from "@carbon/database/audit.config";
import {
  auditConfig,
  fkDisplayHops,
  fkDisplayRegistry,
  getSnapshotFields
} from "@carbon/database/audit.config";
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

describe("resolveSnapshotSpec — junction hops (fkDisplayHops)", () => {
  it("resolves a contact-junction FK to a two-stage hop spec", () => {
    // invoiceSupplierContactId → supplierContact (a link row with no name);
    // the display value is contact.fullName, one hop away.
    const fkMap = fkMapOf({
      tableName: "purchaseInvoice",
      columnName: "invoiceSupplierContactId",
      targetTable: "supplierContact",
      targetHasCompanyId: true
    });
    expect(
      resolveSnapshotSpec(
        "purchaseInvoice",
        "invoiceSupplierContactId",
        NO_OVERRIDES,
        fkMap
      )
    ).toEqual({
      table: "supplierContact",
      displayColumns: ["fullName"],
      hasCompanyId: true,
      // "contact" has no FK entry in this map, so tenancy defaults to
      // scoped — correct, contact is tenant-scoped.
      hop: { column: "contactId", table: "contact", hasCompanyId: true }
    });
  });

  it("prefers a per-column override over the hop", () => {
    const override: SnapshotFieldEntry = {
      column: "customerContactId",
      table: "customerContact",
      displayColumns: ["id"]
    };
    const fkMap = fkMapOf({
      tableName: "salesOrder",
      columnName: "customerContactId",
      targetTable: "customerContact",
      targetHasCompanyId: true
    });
    const spec = resolveSnapshotSpec(
      "salesOrder",
      "customerContactId",
      new Map([["customerContactId", override]]),
      fkMap
    );
    expect(spec?.hop).toBeUndefined();
    expect(spec?.displayColumns).toEqual(["id"]);
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

  it("derives tenancy from other FKs to the same target when the override column has no constraint", () => {
    // salesOrder.salesPersonId has no FK constraint, but "user" appears as
    // the target of other schema FKs (createdBy etc.) — the override must
    // inherit its global (non-tenant) tenancy or the snapshot lookup would
    // filter "user" by a companyId column it doesn't have.
    const userOverride: SnapshotFieldEntry = {
      column: "salesPersonId",
      table: "user",
      displayColumns: ["fullName"]
    };
    const fkMap = fkMapOf({
      tableName: "salesOrder",
      columnName: "createdBy",
      targetTable: "user",
      targetHasCompanyId: false
    });
    expect(
      resolveSnapshotSpec(
        "salesOrder",
        "salesPersonId",
        new Map([["salesPersonId", userOverride]]),
        fkMap
      )
    ).toEqual({
      table: "user",
      displayColumns: ["fullName"],
      hasCompanyId: false
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

describe("fkDisplayHops / fkDisplayRegistry invariants", () => {
  const hopTables = Object.keys(fkDisplayHops);

  it("no table appears in both the hops and the registry", () => {
    // Resolution checks hops before the registry, so a table in both would
    // leave the registry entry as silently-dead config.
    for (const table of hopTables) {
      expect(
        (fkDisplayRegistry as Record<string, unknown>)[table],
        `"${table}" is in fkDisplayHops AND fkDisplayRegistry — hops win, so the registry entry is dead config; remove one of the two`
      ).toBeUndefined();
    }
  });

  it("no snapshotFields override targets a hop table", () => {
    // Overrides are single-hop: one pointing at a junction would freeze the
    // junction's raw columns, and its column set could collide with the
    // hop's in the same batched lookup. Point overrides at tables whose
    // display columns are reachable in one hop.
    for (const entity of Object.values(auditConfig.entities)) {
      for (const [tableName, tableConfig] of Object.entries(entity.tables)) {
        for (const snap of getSnapshotFields(tableConfig as TableConfig)) {
          expect(
            hopTables,
            `snapshotFields override ${tableName}.${snap.column} targets hop table "${snap.table}"`
          ).not.toContain(snap.table);
        }
      }
    }
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
