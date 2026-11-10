// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.
// An inspection plan's versions are rows that share a root. A new version
// copies the plan; publishing one archives the Active version and moves the
// item's receipt assignment to it.

import { expect } from "vitest";
import {
  activateInspectionDocumentVersion,
  copyInspectionDocumentAsVersion,
  deleteInspectionDocument
} from "../../app/modules/quality/quality.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { databaseTest } from "./fixtures/local-database";

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
