// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The enable's re-cost of a Project Issue changes the project's cost with it:
// a projectLedger adjustment row on the re-cost journal's project line, and
// for a Capitalize project a CIP row on the asset the issue builds.

import { sql } from "kysely";
import { expect } from "vitest";
import { databaseTest } from "../local-database-test-fixture";
import postProjectIssue from "../post-project-issue";
import {
  activationFixture,
  addReleasedProject,
  enableWithStockAtTen,
  type Fixture,
  moveBeforeCutover,
  receiveFiveParts,
  USER,
  unwrap
} from "./activation-test-fixture";

/** An asset under construction in a construction-in-progress class on the
 *  WIP account. */
async function assetUnderConstruction(f: Fixture) {
  const classId = `${f.prefix}-cip-class`;
  const assetId = `${f.prefix}-asset`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("fixedAssetClass")
      .values({
        id: classId,
        name: "Construction in Progress",
        isConstructionInProgress: true,
        assetAccountId: f.account("fixed-assets"),
        accumulatedDepreciationAccountId: f.account("accumulated-depreciation"),
        depreciationExpenseAccountId: f.account("depreciation"),
        lossOnDisposalAccountId: f.account("loss-on-disposal"),
        gainOnDisposalAccountId: f.account("sales"),
        writeOffAccountId: f.account("loss-on-disposal"),
        writeDownAccountId: f.account("loss-on-disposal"),
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("fixedAsset")
      .values({
        id: assetId,
        fixedAssetId: "FA-CIP",
        name: "Test cell",
        fixedAssetClassId: classId,
        status: "Under Construction",
        acquisitionCost: 0,
        acquisitionDate: f.today,
        depreciationStartDate: f.today,
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return { classId, assetId };
}

databaseTest(
  "the re-cost of a Capitalize project's issue adjusts its ledger and its asset",
  async () => {
    const f = await activationFixture();
    try {
      // 5 at 8.00 and 5 at 12.00 before the cutover; it opens 10 at 10.00.
      await receiveFiveParts(f, { id: "po-1", unitPrice: 8 });
      await receiveFiveParts(f, { id: "po-2", unitPrice: 12 });
      await moveBeforeCutover(f);
      const { classId, assetId } = await assetUnderConstruction(f);
      const { projectId, elementId } = await addReleasedProject(f, {
        costTreatment: "Capitalize",
        fixedAssetId: assetId,
        fixedAssetClassId: classId
      });

      // After the cutover 5 go to the project from the 8.00 layer: 40.00.
      const issued = unwrap(
        await postProjectIssue(f.ctx, {
          projectId,
          projectElementId: elementId,
          itemId: f.partId,
          locationId: f.locationId,
          quantity: 5,
          direction: "Issue"
        })
      );
      expect(issued.cost).toBe(40);

      await enableWithStockAtTen(f);

      // Against the opening layer the 5 cost 50.00: the issue and a 10.00
      // adjustment on the re-cost journal's project line.
      const ledger = await f.db
        .selectFrom("projectLedger as pl")
        .leftJoin("journalLine as line", (join) =>
          join
            .onRef("line.id", "=", "pl.journalLineId")
            .onRef("line.companyId", "=", "pl.companyId")
        )
        .leftJoin("journal", (join) =>
          join
            .onRef("journal.id", "=", "line.journalId")
            .onRef("journal.companyId", "=", "line.companyId")
        )
        .select([
          "pl.projectElementId",
          "pl.costType",
          "pl.documentId",
          "pl.quantity",
          "pl.amount",
          "line.accountId",
          "journal.description"
        ])
        .where("pl.companyId", "=", f.companyId)
        .orderBy("pl.amount", "desc")
        .execute();
      expect(
        ledger.map((row) => ({
          ...row,
          quantity: Number(row.quantity),
          amount: Number(row.amount)
        }))
      ).toEqual([
        {
          projectElementId: elementId,
          costType: "Material",
          documentId: issued.itemLedgerId,
          quantity: 5,
          amount: 40,
          accountId: f.account("fixed-assets"),
          description: expect.stringContaining("Issue to Project")
        },
        {
          projectElementId: elementId,
          costType: "Material",
          documentId: issued.itemLedgerId,
          quantity: 0,
          amount: 10,
          accountId: f.account("fixed-assets"),
          description: "Cutover recost"
        }
      ]);

      const cip = await f.db
        .selectFrom("fixedAssetCipCost")
        .select(["amount", "sourceDocumentId", "postCapitalization"])
        .where("companyId", "=", f.companyId)
        .where("fixedAssetId", "=", assetId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        cip.map((row) => ({ ...row, amount: Number(row.amount) }))
      ).toEqual([
        {
          amount: 40,
          sourceDocumentId: issued.itemLedgerId,
          postCapitalization: false
        },
        {
          amount: 10,
          sourceDocumentId: issued.itemLedgerId,
          postCapitalization: false
        }
      ]);
      const asset = await f.db
        .selectFrom("fixedAsset")
        .select("acquisitionCost")
        .where("id", "=", assetId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(Number(asset.acquisitionCost)).toBe(50);
    } finally {
      await f.cleanup();
    }
  }
);
