// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.
// An inspection plan's versions are rows that share a root. A new version
// copies the plan; publishing one archives the Active version and moves the
// item's receipt assignment to it.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { sql } from "kysely";
import { expect, it } from "vitest";
import * as quality from "../../app/modules/quality/quality.server";
import {
  activateInspectionDocumentVersion,
  copyInspectionDocumentAsVersion,
  deleteInspectionDocument,
  replaceInspectionDocumentParameters
} from "../../app/modules/quality/quality.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";

const client = localServiceRoleClient();

const WORK_INSTRUCTION = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Clamp in F-12." }] }
  ]
};

async function activePlan(f: Fixture) {
  const id = `${f.prefix}-plan`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("inspectionDocument")
      .values({
        id,
        companyId: f.companyId,
        partId: f.partId,
        name: "Receipt plan",
        status: "Active",
        workInstruction: WORK_INSTRUCTION,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("inspectionFeature")
      .values({
        id: `${f.prefix}-f1`,
        companyId: f.companyId,
        inspectionDocumentId: id,
        label: "1",
        pageNumber: 1,
        nominalValue: "10",
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("balloon")
      .values({
        companyId: f.companyId,
        inspectionDocumentId: id,
        inspectionFeatureId: `${f.prefix}-f1`,
        pageNumber: 1,
        regionX: 0.1,
        regionY: 0.1,
        regionWidth: 0.1,
        regionHeight: 0.1,
        xCoordinate: 0.2,
        yCoordinate: 0.2,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("inspectionDocumentParameter")
      .values({
        companyId: f.companyId,
        inspectionDocumentId: id,
        key: "Fixture",
        value: "F-12",
        sortOrder: 0,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("itemInspectionDocumentAssignment")
      .values({
        companyId: f.companyId,
        itemId: f.partId,
        usage: "Receipt",
        inspectionDocumentId: id,
        createdBy: USER
      })
      .execute();
  });
  return id;
}

/** A lot inspected against `planId`, with one reading of its characteristic. */
async function inspectedLot(f: Fixture, planId: string) {
  const lotId = `${f.prefix}-lot`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("inspection")
      .values({
        id: lotId,
        inspectionId: `${f.prefix}-INS`,
        sourceDocument: "Manual",
        sourceDocumentId: lotId,
        itemId: f.partId,
        inspectionDocumentId: planId,
        lotSize: 1,
        samplingStandard: "ANSI_Z1_4",
        samplingPlanType: "All",
        sampleSize: 1,
        acceptanceNumber: 0,
        rejectionNumber: 1,
        status: "Passed",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("inspectionSample")
      .values({
        id: `${f.prefix}-s1`,
        inspectionId: lotId,
        status: "Passed",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("inspectionMeasurement")
      .values({
        inspectionId: lotId,
        inspectionSampleId: `${f.prefix}-s1`,
        inspectionFeatureId: `${f.prefix}-f1`,
        value: 10.01,
        status: "Passed",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return lotId;
}

// The system, so the permission gate passes: what refuses is the operation.
function serviceContext(f: Fixture) {
  return createServiceContext({
    actor: { type: "system", onBehalfOf: USER },
    company: { id: f.companyId, groupId: f.groupId },
    caller: client!,
    system: () => client!,
    pg: () => f.db,
    kv: () => {
      throw new Error("No operation here reads the cache");
    }
  });
}

function versions(f: Fixture) {
  return f.db
    .selectFrom("inspectionDocument")
    .select(["id", "version", "status", "rootInspectionDocumentId"])
    .where("companyId", "=", f.companyId)
    .orderBy("version")
    .execute();
}

databaseTest(
  "publishing a copied version archives the old one and moves the receipt assignment",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const v0 = await activePlan(f);
      const copy = await copyInspectionDocumentAsVersion(f.db, {
        copyFromId: v0,
        companyId: f.companyId,
        userId: USER
      });
      const v1 = copy!.id;

      expect(await versions(f)).toEqual([
        { id: v0, version: 0, status: "Active", rootInspectionDocumentId: null },
        { id: v1, version: 1, status: "Draft", rootInspectionDocumentId: v0 }
      ]);

      // The copy has its own characteristic, and its balloon names it.
      const feature = await f.db
        .selectFrom("inspectionFeature")
        .select(["id", "label", "nominalValue"])
        .where("inspectionDocumentId", "=", v1)
        .executeTakeFirstOrThrow();
      expect(feature.id).not.toBe(`${f.prefix}-f1`);
      expect(feature).toMatchObject({ label: "1", nominalValue: "10" });
      const balloon = await f.db
        .selectFrom("balloon")
        .select("inspectionFeatureId")
        .where("inspectionDocumentId", "=", v1)
        .executeTakeFirstOrThrow();
      expect(balloon.inspectionFeatureId).toBe(feature.id);
      const parameters = await f.db
        .selectFrom("inspectionDocumentParameter")
        .select(["key", "value"])
        .where("inspectionDocumentId", "=", v1)
        .execute();
      expect(parameters).toEqual([{ key: "Fixture", value: "F-12" }]);
      const plan = await f.db
        .selectFrom("inspectionDocument")
        .select("workInstruction")
        .where("id", "=", v1)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(plan.workInstruction).toEqual(WORK_INSTRUCTION);

      const published = await activateInspectionDocumentVersion(f.db, {
        id: v1,
        companyId: f.companyId,
        userId: USER
      });
      expect(published).toEqual({
        id: v1,
        archivedIds: [v0],
        assignments: 1,
        methodOperations: 0
      });
      expect(await versions(f)).toEqual([
        {
          id: v0,
          version: 0,
          status: "Archived",
          rootInspectionDocumentId: null
        },
        { id: v1, version: 1, status: "Active", rootInspectionDocumentId: v0 }
      ]);
      const assignment = await f.db
        .selectFrom("itemInspectionDocumentAssignment")
        .select("inspectionDocumentId")
        .where("itemId", "=", f.partId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(assignment.inspectionDocumentId).toBe(v1);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "deleting the first version keeps the other versions one plan",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const v0 = await activePlan(f);
      const copy = (copyFromId: string) =>
        copyInspectionDocumentAsVersion(f.db, {
          copyFromId,
          companyId: f.companyId,
          userId: USER
        });
      const v1 = (await copy(v0))!.id;
      const v2 = (await copy(v1))!.id;

      await deleteInspectionDocument(f.db, v0, f.companyId);

      expect(await versions(f)).toEqual([
        { id: v1, version: 1, status: "Draft", rootInspectionDocumentId: null },
        { id: v2, version: 2, status: "Draft", rootInspectionDocumentId: v1 }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a version a lot was inspected against is not deleted, and its readings stay",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const v0 = await activePlan(f);
      const lotId = await inspectedLot(f, v0);

      const deleted = await deleteInspectionDocument(f.db, v0, f.companyId);

      expect(deleted).toEqual({ refused: expect.any(String) });
      expect(await versions(f)).toEqual([
        { id: v0, version: 0, status: "Active", rootInspectionDocumentId: null }
      ]);
      const readings = await f.db
        .selectFrom("inspectionMeasurement")
        .select(["inspectionFeatureId", "value", "status"])
        .where("inspectionId", "=", lotId)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(readings).toEqual([
        {
          inspectionFeatureId: `${f.prefix}-f1`,
          value: 10.01,
          status: "Passed"
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a parameter save on an Active version writes nothing",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const v0 = await activePlan(f);

      const saved = await replaceInspectionDocumentParameters(f.db, {
        inspectionDocumentId: v0,
        companyId: f.companyId,
        userId: USER,
        parameters: [{ id: `${f.prefix}-p1`, key: "Torque", value: "4 Nm" }]
      });

      expect(saved).toBeNull();
      const parameters = await f.db
        .selectFrom("inspectionDocumentParameter")
        .select(["key", "value"])
        .where("inspectionDocumentId", "=", v0)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(parameters).toEqual([{ key: "Fixture", value: "F-12" }]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "the atomic save is refused on an Active version and saves a Draft one",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const v0 = await activePlan(f);
      const v1 = (await copyInspectionDocumentAsVersion(f.db, {
        copyFromId: v0,
        companyId: f.companyId,
        userId: USER
      }))!.id;
      // What a direct API call (or a save racing a Publish) would send.
      const save = (planId: string, featureId: string) =>
        sql`SELECT save_inspection_document_atomic(
          ${planId}, ${f.companyId}, ${USER}, NULL, NULL, NULL, NULL,
          ${JSON.stringify({
            create: [{ id: `${planId}-new`, label: "2", nominalValue: "5" }],
            update: [{ id: featureId, nominalValue: "99" }],
            delete: []
          })}::jsonb,
          '{}'::jsonb
        )`.execute(f.db);
      const features = (planId: string) =>
        f.db
          .selectFrom("inspectionFeature")
          .select(["label", "nominalValue"])
          .where("inspectionDocumentId", "=", planId)
          .where("companyId", "=", f.companyId)
          .orderBy("label")
          .execute();

      await expect(save(v0, `${f.prefix}-f1`)).rejects.toThrow();
      expect(await features(v0)).toEqual([{ label: "1", nominalValue: "10" }]);

      const v1Feature = await f.db
        .selectFrom("inspectionFeature")
        .select("id")
        .where("inspectionDocumentId", "=", v1)
        .executeTakeFirstOrThrow();
      await save(v1, v1Feature.id);
      expect(await features(v1)).toEqual([
        { label: "1", nominalValue: "99" },
        { label: "2", nominalValue: "5" }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

// The rename goes through PostgREST, so it needs the local stack too.
it.skipIf(!hasLocalDatabase || !client)(
  "renaming an Active version is refused and the name stays",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const v0 = await activePlan(f);

      const result = await quality.setInspectionDocumentName(serviceContext(f), {
        id: v0,
        name: "Renamed"
      });

      expect(result.error?.category).toBe("rule");
      const plan = await f.db
        .selectFrom("inspectionDocument")
        .select("name")
        .where("id", "=", v0)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(plan.name).toBe("Receipt plan");
    } finally {
      await f.cleanup();
    }
  },
  60_000
);
