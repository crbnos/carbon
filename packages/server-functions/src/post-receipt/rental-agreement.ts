// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A rental receipt returns the ticked units of one Active agreement on the
// return date, each one through the same `returnRentalUnit` the agreement's
// own return used. A `Pending` unit can come back too: it was never
// delivered, so its billing just stops at the return date (spec Q8).

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import { InvalidInputError, NotFoundError } from "../errors";
import {
  insertUnitActivity,
  lockAgreement
} from "../post-rental-agreement/agreement";
import {
  type RentalUnitReturn,
  returnRentalUnit
} from "../post-rental-agreement/return-unit";
import {
  futureReturnError,
  receiptReturnError,
  unitLabel,
  unitReturnValidator
} from "../post-rental-agreement/validators";

export async function postRentalReceipt(
  db: Kysely<KyselyDatabase>,
  args: {
    receiptId: string;
    companyId: string;
    userId: string;
    today: string;
    postingDate?: string;
  }
): Promise<void> {
  const { receiptId, companyId, userId, today } = args;

  await db.transaction().execute(async (trx) => {
    const returnedAt = args.postingDate ?? today;
    const future = futureReturnError(returnedAt, today);
    if (future) throw new InvalidInputError(future);

    const receipt = await trx
      .selectFrom("receipt")
      .select(["id", "receiptId", "sourceDocumentId", "locationId"])
      .where("id", "=", receiptId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!receipt) throw new NotFoundError("Receipt not found");

    const assetLines = await trx
      .selectFrom("receiptFixedAssetLine")
      .select([
        "id",
        "rentalAgreementLineId",
        "meter",
        "notes",
        "takeOutOfService",
        "outOfServiceReason",
        "residualDestination"
      ])
      .where("receiptId", "=", receiptId)
      .where("companyId", "=", companyId)
      .where("received", "=", true)
      .where("rentalAgreementLineId", "is not", null)
      .orderBy("createdAt")
      .orderBy("id")
      .execute();
    if (assetLines.length === 0) {
      throw new InvalidInputError("Select at least one unit to return");
    }

    if (!receipt.sourceDocumentId) {
      throw new NotFoundError("Rental agreement not found");
    }
    const agreement = await lockAgreement(
      trx,
      companyId,
      receipt.sourceDocumentId
    );
    if (agreement.status !== "Active") {
      throw new InvalidInputError(
        `Rental agreement ${agreement.rentalAgreementId} is ${agreement.status}; units are returned from an Active agreement`
      );
    }

    const lineIds = assetLines.map((line) => line.rentalAgreementLineId!);
    const lines = await trx
      .selectFrom("rentalAgreementLine")
      .select([
        "id",
        "rentalAgreementId",
        "status",
        "lessorClassification",
        "fixedAssetId",
        "trackedEntityId"
      ])
      .where("id", "in", lineIds)
      .where("companyId", "=", companyId)
      .execute();
    const linesById = new Map(lines.map((line) => [line.id, line]));
    const assetIds = lines
      .map((line) => line.fixedAssetId)
      .filter((id): id is string => id !== null);
    const assets =
      assetIds.length === 0
        ? []
        : await trx
            .selectFrom("fixedAsset")
            .select(["id", "fixedAssetId", "name"])
            .where("id", "in", assetIds)
            .where("companyId", "=", companyId)
            .execute();
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

    const units = assetLines.map((assetLine) => {
      const lineId = assetLine.rentalAgreementLineId!;
      const line = linesById.get(lineId);
      const asset = line?.fixedAssetId
        ? assetsById.get(line.fixedAssetId)
        : undefined;
      const label = unitLabel(asset, lineId);
      if (!line || line.rentalAgreementId !== agreement.id) {
        throw new NotFoundError("Rental agreement line not found");
      }
      const statusProblem = receiptReturnError(label, line.status);
      if (statusProblem) throw new InvalidInputError(statusProblem);

      const parsed = unitReturnValidator.safeParse({
        rentalAgreementLineId: lineId,
        returnedAt,
        meterIn: assetLine.meter === null ? null : Number(assetLine.meter),
        returnNotes: assetLine.notes,
        takeOutOfService: assetLine.takeOutOfService,
        outOfServiceReason: assetLine.outOfServiceReason,
        residualDestination: assetLine.residualDestination
      });
      if (!parsed.success) {
        throw new InvalidInputError(
          `${label}: ${parsed.error.issues[0]?.message ?? "invalid return"}`
        );
      }
      const unit: RentalUnitReturn = parsed.data;
      return { line, unit };
    });

    for (const { line, unit } of units) {
      const { fixedAssetId } = await returnRentalUnit(trx, {
        agreement,
        unit,
        companyId,
        userId,
        today,
        locationId: receipt.locationId ?? undefined
      });

      if (fixedAssetId && receipt.locationId) {
        await trx
          .updateTable("fixedAsset")
          .set({
            locationId: receipt.locationId,
            updatedBy: userId,
            updatedAt: datetime.timestamp()
          })
          .where("id", "=", fixedAssetId)
          .where("companyId", "=", companyId)
          .execute();
      }

      if (line.lessorClassification === "Rental" && line.trackedEntityId) {
        await insertUnitActivity(trx, {
          type: "Rental Return",
          direction: "output",
          sourceDocument: "Receipt",
          sourceDocumentId: receipt.id,
          sourceDocumentReadableId: receipt.receiptId,
          attributes: { Receipt: receipt.id, "Rental Agreement": agreement.id },
          trackedEntityId: line.trackedEntityId,
          companyId,
          userId
        });
      }
    }

    await trx
      .updateTable("receipt")
      .set({
        status: "Posted",
        postingDate: returnedAt,
        postedBy: userId
      })
      .where("id", "=", receiptId)
      .where("companyId", "=", companyId)
      .execute();
  });
}
