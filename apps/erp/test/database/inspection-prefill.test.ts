// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.
// A serial lot whose plan inspects every unit starts with every unit as a
// sample, so nothing is scanned; a lot that samples some of its units does not.

import { prefillInspectionSamples } from "@carbon/database/quality";
import { expect } from "vitest";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { countUnits } from "./fixtures/count-units";
import { databaseTest } from "./fixtures/local-database";

/** A receipt lot over three serials, sampling `sampleSize` of them. */
async function receiptLot(sampleSize: number) {
  const f = await alwaysPostFixture();
  const units = await countUnits(f);
  const receiptLineId = `${f.prefix}-rl`;
  const lotId = `${f.prefix}-lot`;
  const ids = ["SN-3", "SN-1", "SN-2"].map(units.entity);
  await seed(f, async (trx) => {
    await trx
      .updateTable("trackedEntity")
      .set({
        status: "On Hold",
        attributes: JSON.stringify({ "Receipt Line": receiptLineId })
      })
      .where("id", "in", ids)
      .where("companyId", "=", f.companyId)
      .execute();
    await trx
      .insertInto("inspection")
      .values({
        id: lotId,
        inspectionId: `${f.prefix}-INS`,
        sourceDocument: "Receipt",
        sourceDocumentId: `${f.prefix}-receipt`,
        sourceDocumentLineId: receiptLineId,
        itemId: units.serialItemId,
        lotSize: 3,
        samplingStandard: "ANSI_Z1_4",
        samplingPlanType: sampleSize === 3 ? "All" : "First",
        sampleSize,
        acceptanceNumber: 0,
        rejectionNumber: 1,
        status: "Pending",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return { f, units, lotId };
}

async function samples(f: Fixture, inspectionId: string) {
  return f.db
    .selectFrom("inspectionSample")
    .select(["trackedEntityId", "status"])
    .where("inspectionId", "=", inspectionId)
    .orderBy("createdAt")
    .orderBy("id")
    .execute();
}

databaseTest(
  "an inspect-all serial lot starts with every unit as a sample, in serial order",
  async () => {
    const { f, units, lotId } = await receiptLot(3);
    const args = { inspectionId: lotId, companyId: f.companyId, userId: USER };

    expect(await prefillInspectionSamples(f.db, args)).toEqual({
      data: { added: 3 },
      error: null
    });
    expect(await samples(f, lotId)).toEqual(
      ["SN-1", "SN-2", "SN-3"].map((key) => ({
        trackedEntityId: units.entity(key),
        status: "Pending"
      }))
    );

    // Loading the lot again adds nothing.
    expect((await prefillInspectionSamples(f.db, args)).data).toEqual({
      added: 0
    });
  }
);

databaseTest("a lot that samples some of its units is left to the scanner", async () => {
  const { f, lotId } = await receiptLot(2);
  expect(
    (
      await prefillInspectionSamples(f.db, {
        inspectionId: lotId,
        companyId: f.companyId,
        userId: USER
      })
    ).data
  ).toEqual({ added: 0 });
  expect(await samples(f, lotId)).toEqual([]);
});
