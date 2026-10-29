// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "kysely";
import { CompiledQuery, Kysely, PostgresDialect, PostgresDriver } from "kysely";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { KyselyDatabase } from "./client.ts";
import {
  createPmiInspectionPlan,
  deleteUnusedPmiInspectionPlans,
  type PmiPlanCharacteristic
} from "./quality.ts";

// Runs against the local database, like inspection-gauge.test.ts:
//   SUPABASE_DB_URL=… pnpm --filter @carbon/database test -- pmi-inspection-plan
//
// Each test runs inside one transaction that is always rolled back. Fixtures
// are inserted with `session_replication_role = replica` (FKs and triggers
// off); the partial unique index `inspectionDocument_part_model_key` still
// holds, which is what makes a second plan for one item and model a no-op.
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

describe.skipIf(!url)(
  "PMI inspection plans against a migrated database",
  () => {
    const client = new Client({ connectionString: url });
    const config = {
      pool: {
        connect: async () =>
          Object.assign(client, { release: () => undefined }),
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

    const run = randomUUID().slice(0, 8);
    const id = (name: string) => `t-${run}-${name}`;
    const companyId = id("company");
    const model = id("model");

    const characteristics: PmiPlanCharacteristic[] = [
      {
        pmiItemId: "d1",
        label: "1",
        description: "Diameter ⌀10 ±0.05",
        nominalValue: "10",
        tolerancePlus: "0.05",
        toleranceMinus: "0.05",
        unit: "mm"
      },
      {
        pmiItemId: "t1",
        label: "2",
        description: "Flatness ⏥ | 0.02",
        nominalValue: "0",
        tolerancePlus: "0.02",
        toleranceMinus: "0",
        unit: "mm"
      }
    ];

    async function begin() {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
    }

    async function insertItem(itemId: string, readableId: string) {
      await client.query(
        `INSERT INTO "item" ("id", "companyId", "readableId", "name", "type", "itemTrackingType", "createdBy")
       VALUES ($1, $2, $3, 'Bracket', 'Part', 'Inventory', 'system')`,
        [itemId, companyId, readableId]
      );
    }

    const createPlan = (itemId: string) =>
      db.transaction().execute((trx) =>
        createPmiInspectionPlan(trx, {
          companyId,
          itemId,
          modelUploadId: model,
          characteristics,
          createdBy: "system"
        })
      );

    beforeAll(async () => {
      await client.connect();
    });

    afterEach(async () => {
      await client.query("ROLLBACK");
    });

    afterAll(async () => {
      await client.end();
    });

    it("makes one plan per item and model, with a feature per characteristic", async () => {
      await begin();
      await insertItem(id("item"), id("BRK"));

      const planId = await createPlan(id("item"));
      expect(planId).not.toBeNull();
      // A second event for the same item and model (a re-optimise) makes none.
      expect(await createPlan(id("item"))).toBeNull();

      const plans = await client.query(
        `SELECT "drawingNumber", "storagePath" FROM "inspectionDocument"
       WHERE "companyId" = $1 AND "partId" = $2 AND "modelUploadId" = $3`,
        [companyId, id("item"), model]
      );
      expect(plans.rows).toEqual([
        { drawingNumber: id("BRK"), storagePath: null }
      ]);

      const features = await client.query(
        `SELECT "label", "pmiItemId", "pageNumber", "type", "nominalValue"
       FROM "inspectionFeature" WHERE "inspectionDocumentId" = $1 ORDER BY "label"`,
        [planId]
      );
      expect(features.rows).toEqual([
        {
          label: "1",
          pmiItemId: "d1",
          pageNumber: 1,
          type: "Measurement",
          nominalValue: "10"
        },
        {
          label: "2",
          pmiItemId: "t1",
          pageNumber: 1,
          type: "Measurement",
          nominalValue: "0"
        }
      ]);
    });

    it("suffixes a drawing number another plan already holds", async () => {
      await begin();
      await insertItem(id("item"), id("BRK"));
      await client.query(
        `INSERT INTO "inspectionDocument" ("id", "companyId", "partId", "drawingNumber", "createdBy")
       VALUES ($1, $2, $3, $4, 'system')`,
        [id("pdf-plan"), companyId, id("item"), id("BRK")]
      );

      const planId = await createPlan(id("item"));
      const plan = await client.query(
        `SELECT "drawingNumber" FROM "inspectionDocument" WHERE "id" = $1`,
        [planId]
      );
      expect(plan.rows[0].drawingNumber).toBe(`${id("BRK")} (1)`);
    });

    it("deletes the items' unused PMI plans before an item delete, and keeps the rest", async () => {
      await begin();
      await insertItem(id("item"), id("BRK"));
      const unused = await createPlan(id("item"));
      await insertItem(id("item-used"), id("BRK-USED"));
      const used = await createPlan(id("item-used"));
      await client.query(
        `INSERT INTO "inspection" ("id", "companyId", "inspectionId", "itemId", "lotSize",
         "samplingStandard", "samplingPlanType", "sampleSize", "acceptanceNumber",
         "rejectionNumber", "sourceDocument", "sourceDocumentId", "inspectionDocumentId", "createdBy")
       VALUES ($1, $2, $1, $3, 1, 'ANSI_Z1_4', 'All', 1, 0, 1, 'Receipt', $4, $5, 'system')`,
        [id("lot"), companyId, id("item-used"), id("receipt"), used]
      );
      // A plan made by hand (no model) is never touched.
      await client.query(
        `INSERT INTO "inspectionDocument" ("id", "companyId", "partId", "drawingNumber", "createdBy")
       VALUES ($1, $2, $3, 'Manual', 'system')`,
        [id("manual"), companyId, id("item")]
      );

      const deleted = await db.transaction().execute((trx) =>
        deleteUnusedPmiInspectionPlans(trx, {
          companyId,
          itemIds: [id("item"), id("item-used")]
        })
      );
      expect(deleted).toBe(1);

      const left = await client.query(
        `SELECT "id" FROM "inspectionDocument" WHERE "companyId" = $1 ORDER BY "id"`,
        [companyId]
      );
      expect(left.rows.map((row) => row.id).sort()).toEqual(
        [used, id("manual")].sort()
      );
      expect(left.rows.map((row) => row.id)).not.toContain(unused);
    });
  }
);
