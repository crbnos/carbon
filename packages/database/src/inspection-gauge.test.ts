import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "kysely";
import { CompiledQuery, Kysely, PostgresDialect, PostgresDriver } from "kysely";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { KyselyDatabase } from "./client.ts";
import {
  getRecentInspectionGauges,
  RECENT_INSPECTION_GAUGE_LIMIT,
  recordInspectionGauge
} from "./quality.ts";

// Runs against the local database, like the authz tests:
//   SUPABASE_DB_URL=… pnpm --filter @carbon/database test -- inspection-gauge
//
// Each test runs inside one transaction that is always rolled back, so it
// writes nothing. Fixtures are inserted with `session_replication_role =
// replica` (FKs and triggers off) so a lot needs no job, item or document
// behind it; the engine's own queries then run on real Postgres, its
// transaction becoming a savepoint inside the outer one.
const url = process.env.SUPABASE_DB_URL;

class SavepointDriver extends PostgresDriver {
  override async beginTransaction(connection: DatabaseConnection) {
    await connection.executeQuery(CompiledQuery.raw("SAVEPOINT engine"));
  }
  override async commitTransaction(connection: DatabaseConnection) {
    await connection.executeQuery(
      CompiledQuery.raw("RELEASE SAVEPOINT engine")
    );
  }
  override async rollbackTransaction(connection: DatabaseConnection) {
    await connection.executeQuery(
      CompiledQuery.raw("ROLLBACK TO SAVEPOINT engine")
    );
  }
}

type Row = Record<string, unknown>;

describe.skipIf(!url)("inspection gauges against a migrated database", () => {
  const client = new Client({ connectionString: url });
  const config = {
    pool: {
      connect: async () => Object.assign(client, { release: () => undefined }),
      end: async () => undefined
    }
  };
  const dialect = new PostgresDialect(config);
  const db = new Kysely<KyselyDatabase>({
    dialect: {
      createAdapter: () => dialect.createAdapter(),
      createDriver: () => new SavepointDriver(config),
      createIntrospector: (k) => dialect.createIntrospector(k),
      createQueryCompiler: () => dialect.createQueryCompiler()
    }
  });

  // The tables' ids are globally unique, so every id is unique to this run.
  const run = randomUUID().slice(0, 8);
  const id = (name: string) => `t-${run}-${name}`;
  const companyA = id("company-a");
  const companyB = id("company-b");

  // The NOT NULL columns each fixture table needs that the tests don't vary.
  const required = {
    inspection: (rowId: string): Row => ({
      inspectionId: rowId,
      itemId: id("item"),
      lotSize: 1,
      samplingStandard: "ANSI_Z1_4",
      samplingPlanType: "All",
      sampleSize: 1,
      acceptanceNumber: 0,
      rejectionNumber: 1,
      sourceDocumentId: id("document")
    }),
    inspectionSamplingPlan: (): Row => ({
      sampleSize: 1,
      acceptanceNumber: 0,
      rejectionNumber: 1
    }),
    inspectionFeature: (rowId: string): Row => ({
      inspectionDocumentId: id("drawing"),
      pageNumber: 1,
      label: rowId
    }),
    gauge: (rowId: string): Row => ({ gaugeId: rowId }),
    jobOperation: (): Row => ({ jobId: id("job"), processId: id("process") })
  };

  async function insert(table: keyof typeof required, rows: Row[]) {
    for (const given of rows) {
      const row: Row = {
        ...required[table](String(given.id)),
        createdBy: "system",
        ...given
      };
      const columns = Object.keys(row);
      await client.query(
        `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")})
         VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
        Object.values(row)
      );
    }
  }

  async function begin() {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
  }

  beforeAll(async () => {
    await client.connect();
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  afterAll(async () => {
    await client.end();
  });

  // ─── recordInspectionGauge ────────────────────────────────────────────────

  describe("recordInspectionGauge", () => {
    const lot = id("lot");
    const plan = id("plan");

    async function seed(status = "In Progress") {
      await begin();
      await insert("inspectionFeature", [
        { id: id("ftr"), companyId: companyA, gaugeTypeId: id("gt-caliper") },
        { id: id("ftr-any"), companyId: companyA, gaugeTypeId: null }
      ]);
      await insert("inspection", [
        { id: lot, companyId: companyA, status, sourceDocument: "Receipt" },
        {
          id: id("lot-b"),
          companyId: companyB,
          status: "In Progress",
          sourceDocument: "Receipt"
        }
      ]);
      await insert("inspectionSamplingPlan", [
        {
          id: plan,
          inspectionId: lot,
          inspectionFeatureId: id("ftr"),
          companyId: companyA
        },
        {
          id: id("plan-any"),
          inspectionId: lot,
          inspectionFeatureId: id("ftr-any"),
          companyId: companyA
        },
        {
          id: id("plan-b"),
          inspectionId: id("lot-b"),
          inspectionFeatureId: id("ftr"),
          companyId: companyB
        }
      ]);
      await insert("gauge", [
        {
          id: id("caliper"),
          companyId: companyA,
          gaugeTypeId: id("gt-caliper")
        },
        {
          id: id("mic"),
          companyId: companyA,
          gaugeTypeId: id("gt-micrometer")
        },
        {
          id: id("retired"),
          companyId: companyA,
          gaugeTypeId: id("gt-caliper"),
          gaugeStatus: "Inactive"
        },
        {
          id: id("caliper-b"),
          companyId: companyB,
          gaugeTypeId: id("gt-caliper")
        }
      ]);
    }

    const record = (
      gaugeId: string | null,
      args: { inspectionId?: string; inspectionFeatureId?: string } = {}
    ) =>
      recordInspectionGauge(db, {
        inspectionId: args.inspectionId ?? lot,
        inspectionFeatureId: args.inspectionFeatureId ?? id("ftr"),
        gaugeId,
        companyId: companyA,
        userId: "system"
      });

    // now() is the outer transaction's start, so "stamped by the database"
    // reads as equal to it.
    async function planRow(planId = plan) {
      const { rows } = await client.query(
        `SELECT "gaugeId",
                "gaugeRecordedAt" IS NOT NULL AS "recorded",
                "gaugeRecordedAt" = now() AS "recordedNow",
                "updatedBy",
                "updatedAt" = now() AS "updatedNow"
         FROM "inspectionSamplingPlan" WHERE id = $1`,
        [planId]
      );
      return rows[0];
    }

    it("records a gauge of the feature's required type, stamped now()", async () => {
      await seed();
      const result = await record(id("caliper"));
      expect(result).toEqual({
        data: { inspectionFeatureId: id("ftr"), gaugeId: id("caliper") },
        error: null
      });
      expect(await planRow()).toEqual({
        gaugeId: id("caliper"),
        recorded: true,
        recordedNow: true,
        updatedBy: "system",
        updatedNow: true
      });
    });

    it("refuses a gauge of a different type", async () => {
      await seed();
      const result = await record(id("mic"));
      expect(result.error?.message).toBe(
        "Gauge is not of the type this feature requires"
      );
      expect((await planRow()).gaugeId).toBeNull();
    });

    it("accepts any type when the feature names none", async () => {
      await seed();
      const result = await record(id("mic"), {
        inspectionFeatureId: id("ftr-any")
      });
      expect(result.error).toBeNull();
      expect((await planRow(id("plan-any"))).gaugeId).toBe(id("mic"));
    });

    it("refuses an inactive gauge", async () => {
      await seed();
      const result = await record(id("retired"));
      expect(result.error?.message).toBe("Gauge is inactive");
      expect((await planRow()).gaugeId).toBeNull();
    });

    it("refuses another company's gauge", async () => {
      await seed();
      const result = await record(id("caliper-b"));
      expect(result.error?.message).toBe("Gauge not found");
      expect((await planRow()).gaugeId).toBeNull();
    });

    it("refuses another company's lot", async () => {
      await seed();
      const result = await record(id("caliper"), { inspectionId: id("lot-b") });
      expect(result.error?.message).toBe("Inspection not found");
      expect((await planRow(id("plan-b"))).gaugeId).toBeNull();
    });

    it("refuses a plan row that belongs to another company", async () => {
      await seed();
      await client.query(
        `UPDATE "inspectionSamplingPlan" SET "companyId" = $1 WHERE id = $2`,
        [companyB, plan]
      );
      const result = await record(id("caliper"));
      expect(result.error?.message).toBe("Inspection feature not found");
      expect((await planRow()).gaugeId).toBeNull();
    });

    it.each([
      "Passed",
      "Failed",
      "Partial"
    ])("refuses a %s (closed) lot", async (status) => {
      await seed(status);
      const result = await record(id("caliper"));
      expect(result.error?.message).toBe("Inspection is closed");
      expect((await planRow()).gaugeId).toBeNull();
    });

    it("clears the gauge and its recorded time", async () => {
      await seed();
      await record(id("caliper"));
      const result = await record(null);
      expect(result.error).toBeNull();
      expect(await planRow()).toMatchObject({ gaugeId: null, recorded: false });
    });
  });

  // ─── Deleting a recorded gauge (20261001022340) ───────────────────────────

  describe("deleting a gauge recorded on a lot", () => {
    const gauge = id("recorded");

    // The delete's ON DELETE SET NULL re-checks every foreign key of a plan
    // row inserted in this transaction, so these fixtures need a real company
    // and feature behind them.
    async function seed(status: string) {
      await begin();
      const { rows } = await client.query(`SELECT id FROM "company" LIMIT 1`);
      const companyId = rows[0].id as string;
      await insert("inspectionFeature", [{ id: id("ftr"), companyId }]);
      await insert("inspection", [
        { id: id("lot"), companyId, status, sourceDocument: "Receipt" }
      ]);
      await insert("inspectionSamplingPlan", [
        {
          id: id("plan"),
          inspectionId: id("lot"),
          inspectionFeatureId: id("ftr"),
          companyId,
          gaugeId: gauge
        }
      ]);
      await insert("gauge", [
        { id: gauge, companyId, gaugeTypeId: id("gt-caliper") }
      ]);
      // Fixtures go in with triggers off; the delete must run with them on.
      await client.query("SET LOCAL session_replication_role = origin");
    }

    const deleteGauge = () =>
      client.query(`DELETE FROM "gauge" WHERE id = $1`, [gauge]);

    it.each([
      "Passed",
      "Failed",
      "Partial"
    ])("is refused when the lot is %s", async (status) => {
      await seed(status);
      await expect(deleteGauge()).rejects.toMatchObject({ code: "23503" });
    });

    it("clears the gauge from an open lot", async () => {
      await seed("In Progress");
      await deleteGauge();
      const { rows } = await client.query(
        `SELECT "gaugeId" FROM "inspectionSamplingPlan" WHERE id = $1`,
        [id("plan")]
      );
      expect(rows[0].gaugeId).toBeNull();
    });

    it("lets a company wipe through", async () => {
      await seed("Passed");
      await client.query(`SET LOCAL "app.sync_in_progress" = 'true'`);
      await expect(deleteGauge()).resolves.toMatchObject({ rowCount: 1 });
    });
  });

  // ─── getRecentInspectionGauges ────────────────────────────────────────────

  describe("getRecentInspectionGauges", () => {
    const lathe = id("wc-lathe");
    const mill = id("wc-mill");

    let planSeq = 0;
    const used = (
      inspection: string,
      gauge: string | null,
      gaugeRecordedAt: string | null,
      companyId = companyA
    ): Row => {
      planSeq++;
      return {
        id: id(`isp-${planSeq}`),
        inspectionId: id(inspection),
        inspectionFeatureId: id(`ftr-${planSeq}`),
        companyId,
        gaugeId: gauge && id(gauge),
        gaugeRecordedAt
      };
    };

    const lot = (
      name: string,
      companyId: string,
      sourceDocument: "Job Operation" | "Receipt",
      line: string
    ): Row => ({
      id: id(name),
      companyId,
      sourceDocument,
      sourceDocumentLineId: id(line)
    });

    async function seed() {
      await begin();
      await insert("jobOperation", [
        { id: id("op-lot"), companyId: companyA, workCenterId: lathe },
        { id: id("op-lathe"), companyId: companyA, workCenterId: lathe },
        { id: id("op-mill"), companyId: companyA, workCenterId: mill },
        { id: id("op-nowc"), companyId: companyA, workCenterId: null },
        // Another company's operations naming the same work center.
        { id: id("op-b"), companyId: companyB, workCenterId: lathe },
        { id: id("op-b2"), companyId: companyB, workCenterId: lathe }
      ]);
      await insert("inspection", [
        lot("lot", companyA, "Job Operation", "op-lot"),
        lot("lathe", companyA, "Job Operation", "op-lathe"),
        lot("mill", companyA, "Job Operation", "op-mill"),
        lot("nowc", companyA, "Job Operation", "op-nowc"),
        lot("receipt-lot", companyA, "Receipt", "rl-1"),
        lot("receipt", companyA, "Receipt", "rl-2"),
        lot("lot-b", companyB, "Job Operation", "op-b"),
        lot("receipt-b", companyB, "Receipt", "rl-3"),
        // Our lot, on another company's lathe operation.
        lot("cross-op", companyA, "Job Operation", "op-b2")
      ]);
      await insert("inspectionSamplingPlan", [
        // Same work center: g-old was used first AND last, so it leads only
        // when ordered by its most recent use.
        used("lathe", "g-old", "2026-09-01T08:00:00Z"),
        used("lathe", "g-new", "2026-09-03T08:00:00Z"),
        used("lot", "g-old", "2026-09-04T08:00:00Z"),
        used("lathe", null, null),
        // Other stations.
        used("mill", "g-mill", "2026-09-05T08:00:00Z"),
        used("receipt", "g-receipt", "2026-09-06T08:00:00Z"),
        used("nowc", "g-nowc", "2026-09-02T08:00:00Z"),
        // Another company's plan row, on its own lathe lot.
        used("lot-b", "g-b-plan", "2026-09-07T08:00:00Z", companyB),
        // Our plan row, on another company's lathe lot.
        used("lot-b", "g-b-lot", "2026-09-08T08:00:00Z"),
        // Our lot whose operation is another company's lathe operation.
        used("cross-op", "g-cross-op", "2026-09-09T08:00:00Z")
      ]);
    }

    const recent = async (name: string) => {
      const result = await getRecentInspectionGauges(db, {
        inspectionId: id(name),
        companyId: companyA
      });
      expect(result.error).toBeNull();
      return result.data;
    };

    it("lists a Job Operation lot's work-center gauges, most recent use first", async () => {
      await seed();
      expect(await recent("lot")).toEqual([id("g-old"), id("g-new")]);
    });

    it("treats every receipt lot as one station", async () => {
      await seed();
      expect(await recent("receipt-lot")).toEqual([id("g-receipt")]);
    });

    it("has no history for an operation without a work center", async () => {
      await seed();
      expect(await recent("nowc")).toEqual([]);
    });

    it("has no station for a lot whose operation is another company's", async () => {
      await seed();
      expect(await recent("cross-op")).toEqual([]);
    });

    it("returns nothing for another company's lot", async () => {
      await seed();
      expect(await recent("receipt-b")).toEqual([]);
      expect(await recent("lot-b")).toEqual([]);
    });

    it("keeps the newest gauges up to the limit", async () => {
      await seed();
      const days = Array.from(
        { length: RECENT_INSPECTION_GAUGE_LIMIT + 2 },
        (_, i) => 10 + i
      );
      await insert(
        "inspectionSamplingPlan",
        days.map((day) =>
          used("receipt", `g-${day}`, `2026-09-${day}T08:00:00Z`)
        )
      );
      expect(await recent("receipt-lot")).toEqual(
        days
          .slice(-RECENT_INSPECTION_GAUGE_LIMIT)
          .reverse()
          .map((day) => id(`g-${day}`))
      );
    });
  });
});
