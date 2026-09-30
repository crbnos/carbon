import { beforeEach, describe, expect, it } from "vitest";
import type { Kysely, KyselyDatabase } from "./client.ts";
import { recordInspectionGauge } from "./quality.ts";

type Row = Record<string, unknown>;

// In-memory stand-in for the Kysely transaction — just enough of the builder
// for recordInspectionGauge. The plan rows carry the joined feature's
// gaugeTypeId, so innerJoin is a no-op and qualified columns match bare keys.
let tables: Record<string, Row[]>;

function query(table: string, kind: "select" | "update") {
  const filters: [string, unknown][] = [];
  let patch: Row = {};
  const run = () => {
    const hit = (tables[table] ?? []).filter((row) =>
      filters.every(
        ([column, value]) =>
          String(row[column.split(".").pop()!]) === String(value)
      )
    );
    if (kind === "update") for (const row of hit) Object.assign(row, patch);
    return hit;
  };
  const builder: any = {
    select: () => builder,
    innerJoin: () => builder,
    set: (value: Row) => {
      patch = value;
      return builder;
    },
    where: (column: string, _op: string, value: unknown) => {
      filters.push([column, value]);
      return builder;
    },
    execute: async () => run(),
    executeTakeFirst: async () => run()[0]
  };
  return builder;
}

const trx = {
  selectFrom: (table: string) => query(table, "select"),
  updateTable: (table: string) => query(table, "update")
};
const db = {
  transaction: () => ({
    execute: async (fn: (t: typeof trx) => unknown) => fn(trx)
  })
} as unknown as Kysely<KyselyDatabase>;

const record = (gaugeId: string | null) =>
  recordInspectionGauge(db, {
    inspectionId: "insp-1",
    inspectionFeatureId: "ftr-1",
    gaugeId,
    companyId: "c-1",
    userId: "u-1"
  });

const plan = () => tables.inspectionSamplingPlan[0]!;

beforeEach(() => {
  tables = {
    inspection: [{ id: "insp-1", companyId: "c-1", status: "In Progress" }],
    inspectionSamplingPlan: [
      {
        id: "isp-1",
        inspectionId: "insp-1",
        inspectionFeatureId: "ftr-1",
        companyId: "c-1",
        gaugeTypeId: "gt-caliper",
        gaugeId: null,
        gaugeRecordedAt: null
      }
    ],
    gauge: [
      {
        id: "g-caliper",
        companyId: "c-1",
        gaugeTypeId: "gt-caliper",
        gaugeStatus: "Active"
      },
      {
        id: "g-mic",
        companyId: "c-1",
        gaugeTypeId: "gt-micrometer",
        gaugeStatus: "Active"
      },
      {
        id: "g-retired",
        companyId: "c-1",
        gaugeTypeId: "gt-caliper",
        gaugeStatus: "Inactive"
      },
      {
        id: "g-other-company",
        companyId: "c-2",
        gaugeTypeId: "gt-caliper",
        gaugeStatus: "Active"
      }
    ]
  };
});

describe("recordInspectionGauge", () => {
  it("records a gauge of the feature's required type", async () => {
    const result = await record("g-caliper");
    expect(result.error).toBeNull();
    expect(plan().gaugeId).toBe("g-caliper");
    expect(plan().gaugeRecordedAt).toEqual(expect.any(String));
    expect(plan().updatedBy).toBe("u-1");
  });

  it("refuses a gauge of a different type", async () => {
    const result = await record("g-mic");
    expect(result.error?.message).toMatch(/type this feature requires/);
    expect(plan().gaugeId).toBeNull();
  });

  it("accepts any type when the feature names none", async () => {
    plan().gaugeTypeId = null;
    const result = await record("g-mic");
    expect(result.error).toBeNull();
    expect(plan().gaugeId).toBe("g-mic");
  });

  it("refuses an inactive gauge", async () => {
    const result = await record("g-retired");
    expect(result.error?.message).toBe("Gauge is inactive");
  });

  it("refuses another company's gauge", async () => {
    const result = await record("g-other-company");
    expect(result.error?.message).toBe("Gauge not found");
  });

  it("refuses a closed lot", async () => {
    tables.inspection[0]!.status = "Passed";
    const result = await record("g-caliper");
    expect(result.error?.message).toBe("Inspection is closed");
  });

  it("clears the gauge and its recorded time", async () => {
    await record("g-caliper");
    const result = await record(null);
    expect(result.error).toBeNull();
    expect(plan().gaugeId).toBeNull();
    expect(plan().gaugeRecordedAt).toBeNull();
  });
});
