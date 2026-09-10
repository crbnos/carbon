import { describe, expect, it, vi } from "vitest";
import { assertBackupImportable } from "../inngest/functions/tasks/company-backup";
import {
  BACKUP_KIND,
  BACKUP_VERSION,
  type Catalog,
  type ColumnInfo,
  compatibilityStatus,
  type Manifest,
  reportBackupCompatibility,
  type TableInfo
} from "./schema";

vi.mock("./renames", () => ({
  // A dropped table, a renamed table, and a rename whose target is also gone.
  TABLE_RENAMES: {
    retiredFeature: null,
    oldName: "newName",
    danglingRename: "alsoMissing"
  }
}));

const col = (name: string, opts: Partial<ColumnInfo> = {}): ColumnInfo => ({
  name,
  dataType: "text",
  udtName: "text",
  isNullable: false,
  isGenerated: false,
  hasDefault: false,
  ...opts
});

const table = (name: string, columns: ColumnInfo[]): TableInfo => ({
  name,
  columns,
  scope: { kind: "direct", column: "companyId" },
  scopeColumn: "companyId",
  pkColumns: ["id", "companyId"],
  uniqueColumns: [],
  hasId: false,
  foreignKeys: []
});

const catalog = (tables: TableInfo[]): Catalog => ({
  schemaVersion: "test",
  tables
});

function backup(
  tables: Manifest["tables"],
  opts: { version?: number } = {}
): Manifest {
  return {
    kind: BACKUP_KIND,
    version: (opts.version ?? BACKUP_VERSION) as typeof BACKUP_VERSION,
    schemaVersion: "test",
    sourceCompanyId: "company-a",
    sourceCompanyGroupId: "group-a",
    sourceCompanyName: "Acme",
    exportedAt: "2026-02-01T00:00:00.000Z",
    exportedBy: "user-1",
    label: null,
    includeStorage: "none",
    tables,
    storage: [],
    excludedTables: []
  };
}

describe("reportBackupCompatibility", () => {
  it("reports nothing when the schema has not moved", () => {
    const result = reportBackupCompatibility(
      catalog([table("item", [col("id"), col("name")])]),
      backup([{ name: "item", rows: 3, columns: ["id", "name"] }])
    );

    expect(result.findings).toEqual([]);
    expect(result.blocked).toBe(false);
  });

  it("reports a new required column WITH a default as defaulted, not blocked", () => {
    const result = reportBackupCompatibility(
      catalog([
        table("item", [col("id"), col("unitOfMeasure", { hasDefault: true })])
      ]),
      backup([{ name: "item", rows: 1, columns: ["id"] }])
    );

    expect(result.blocked).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      kind: "defaulted",
      table: "item",
      column: "unitOfMeasure"
    });
  });

  it("blocks a new required column with NO default", () => {
    // This is the branch the D1 conformance check makes unreachable for new
    // migrations; existing backups can still hit it.
    const result = reportBackupCompatibility(
      catalog([table("item", [col("id"), col("unitOfMeasure")])]),
      backup([{ name: "item", rows: 1, columns: ["id"] }])
    );

    expect(result.blocked).toBe(true);
    expect(result.findings[0]).toMatchObject({
      kind: "blocked",
      table: "item",
      column: "unitOfMeasure"
    });
  });

  it("ignores a new NULLABLE column — routine additive growth, not a finding", () => {
    const result = reportBackupCompatibility(
      catalog([table("item", [col("id"), col("notes", { isNullable: true })])]),
      backup([{ name: "item", rows: 1, columns: ["id"] }])
    );

    expect(result.findings).toEqual([]);
  });

  it("reports a column the backup has but the schema no longer does as discarded", () => {
    const result = reportBackupCompatibility(
      catalog([table("item", [col("id")])]),
      backup([{ name: "item", rows: 1, columns: ["id", "legacyCode"] }])
    );

    expect(result.blocked).toBe(false);
    expect(result.findings[0]).toMatchObject({
      kind: "discarded",
      table: "item",
      column: "legacyCode"
    });
  });

  it("blocks an unsupported format generation", () => {
    const result = reportBackupCompatibility(
      catalog([table("item", [col("id")])]),
      backup([{ name: "item", rows: 1, columns: ["id"] }], { version: 0 })
    );

    expect(result.blocked).toBe(true);
    expect(result.findings[0]?.reason).toContain("no longer supported");
  });

  it("blocks account defaults arriving without a chart of accounts", () => {
    // An empty table is omitted from the manifest, so "no account entry" is how a
    // groupless export's missing chart of accounts actually presents.
    const result = reportBackupCompatibility(
      catalog([table("accountDefault", [col("id")])]),
      backup([{ name: "accountDefault", rows: 1, columns: ["id"] }])
    );

    expect(result.blocked).toBe(true);
    expect(result.findings[0]?.table).toBe("accountDefault");
  });

  it("allows account defaults when the chart of accounts travels with them", () => {
    const result = reportBackupCompatibility(
      catalog([
        table("accountDefault", [col("id")]),
        table("account", [col("id")])
      ]),
      backup([
        { name: "accountDefault", rows: 1, columns: ["id"] },
        { name: "account", rows: 40, columns: ["id"] }
      ])
    );

    expect(result.blocked).toBe(false);
  });

  it("skips a table the catalog now excludes by design", () => {
    // MRP output the next run regenerates — absent by design, not drift.
    const result = reportBackupCompatibility(
      catalog([table("item", [col("id")])]),
      backup([
        { name: "item", rows: 1, columns: ["id"] },
        { name: "demandActual", rows: 5, columns: ["id"] }
      ])
    );

    expect(result.findings).toEqual([]);
  });
});

describe("reportBackupCompatibility — TABLE_RENAMES", () => {
  it("blocks a missing table with no mapping, and says so", () => {
    const result = reportBackupCompatibility(
      catalog([table("item", [col("id")])]),
      backup([{ name: "vanished", rows: 2, columns: ["id"] }])
    );

    expect(result.blocked).toBe(true);
    expect(result.findings[0]?.reason).toContain("no rename mapping");
  });

  it("treats a null mapping as dropped with its feature — discarded, not blocked", () => {
    const result = reportBackupCompatibility(
      catalog([table("item", [col("id")])]),
      backup([{ name: "retiredFeature", rows: 2, columns: ["id"] }])
    );

    expect(result.blocked).toBe(false);
    expect(result.findings[0]).toMatchObject({
      kind: "discarded",
      table: "retiredFeature"
    });
  });

  it("follows a rename to the new table and compares columns there", () => {
    const result = reportBackupCompatibility(
      catalog([table("newName", [col("id"), col("name")])]),
      backup([{ name: "oldName", rows: 2, columns: ["id", "name"] }])
    );

    expect(result.findings).toEqual([]);
    expect(result.blocked).toBe(false);
  });

  it("blocks when the rename target is also missing", () => {
    const result = reportBackupCompatibility(
      catalog([table("item", [col("id")])]),
      backup([{ name: "danglingRename", rows: 2, columns: ["id"] }])
    );

    expect(result.blocked).toBe(true);
    expect(result.findings[0]?.reason).toContain("alsoMissing");
  });
});

// The gate is the boolean form of the report and delegates to it. These pin that
// the delegation refuses exactly the `blocked` findings and nothing else — the
// report's `discarded`/`defaulted` findings must NOT stop a restore.
describe("assertBackupImportable", () => {
  const gate = (cat: Catalog, mf: Manifest) =>
    assertBackupImportable(cat, { manifest: mf, data: {} });

  it("passes a backup the schema has not moved away from", () => {
    expect(
      gate(
        catalog([table("item", [col("id"), col("name")])]),
        backup([{ name: "item", rows: 3, columns: ["id", "name"] }])
      )
    ).toEqual({ ok: true });
  });

  it("refuses an unsupported backup format", () => {
    const result = gate(
      catalog([table("item", [col("id")])]),
      backup([{ name: "item", rows: 1, columns: ["id"] }], { version: 0 })
    );
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain(
      "is no longer supported"
    );
  });

  it("refuses a table the schema no longer has and cannot map", () => {
    const result = gate(
      catalog([table("item", [col("id")])]),
      backup([{ name: "vanished", rows: 1, columns: ["id"] }])
    );
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain("vanished");
  });

  it("refuses a new required column with no default, naming table and column", () => {
    const result = gate(
      catalog([table("item", [col("id"), col("mandatory")])]),
      backup([{ name: "item", rows: 1, columns: ["id"] }])
    );
    expect(result).toEqual({
      ok: false,
      reason:
        '"item" now requires column "mandatory", which this backup predates'
    });
  });

  it("REFUSES a rename whose target the backup also carries", () => {
    // Applying the rename would merge two tables; the loader keys off name, so
    // letting it through drops oldName's rows in silence.
    const result = gate(
      catalog([table("newName", [col("id")])]),
      backup([
        { name: "oldName", rows: 2, columns: ["id"] },
        { name: "newName", rows: 5, columns: ["id"] }
      ])
    );
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain(
      "which this backup also contains"
    );
  });

  it("ACCEPTS a renamed table, the case the hand-kept copy used to refuse", () => {
    expect(
      gate(
        catalog([table("newName", [col("id")])]),
        backup([{ name: "oldName", rows: 2, columns: ["id"] }])
      )
    ).toEqual({ ok: true });
  });

  it("accepts a dropped-with-its-feature table — discarded is not blocking", () => {
    expect(
      gate(
        catalog([table("item", [col("id")])]),
        backup([
          { name: "item", rows: 1, columns: ["id"] },
          { name: "retiredFeature", rows: 9, columns: ["id"] }
        ])
      )
    ).toEqual({ ok: true });
  });

  it("accepts a removed column — those values are discarded, not blocking", () => {
    expect(
      gate(
        catalog([table("item", [col("id")])]),
        backup([{ name: "item", rows: 1, columns: ["id", "goneNow"] }])
      )
    ).toEqual({ ok: true });
  });

  it("accepts a new required column that has a default", () => {
    expect(
      gate(
        catalog([
          table("item", [col("id"), col("added", { hasDefault: true })])
        ]),
        backup([{ name: "item", rows: 1, columns: ["id"] }])
      )
    ).toEqual({ ok: true });
  });

  it("refuses account defaults arriving without a chart of accounts", () => {
    const result = gate(
      catalog([
        table("account", [col("id")]),
        table("accountDefault", [col("id")])
      ]),
      backup([{ name: "accountDefault", rows: 4, columns: ["id"] }])
    );
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain(
      "no chart of accounts"
    );
  });
});

describe("compatibilityStatus", () => {
  it("is ready when nothing differs", () => {
    expect(compatibilityStatus({ findings: [], blocked: false })).toBe("ready");
  });

  it("is restorable-with-changes when there are findings but none block", () => {
    expect(
      compatibilityStatus({
        findings: [
          { kind: "defaulted", table: "item", column: "x", reason: "r" }
        ],
        blocked: false
      })
    ).toBe("restorable-with-changes");
  });

  it("is not-restorable as soon as one finding blocks", () => {
    expect(
      compatibilityStatus({
        findings: [
          { kind: "defaulted", table: "item", column: "x", reason: "r" },
          { kind: "blocked", table: "item", column: "y", reason: "r" }
        ],
        blocked: true
      })
    ).toBe("not-restorable");
  });
});
