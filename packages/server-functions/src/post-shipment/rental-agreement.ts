// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A rental shipment delivers the ticked units of one Active agreement: each
// line goes On Rent on the delivery date. The units stay fleet assets, so
// nothing moves in stock and no journal is posted.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import type { Transaction } from "kysely";
import { InvalidInputError, NotFoundError } from "../errors";
import {
  insertUnitActivity,
  lockAgreement
} from "../post-rental-agreement/agreement";
import {
  futureDeliveryError,
  rentalShipmentVoidBlocker,
  unitLabel
} from "../post-rental-agreement/validators";

export async function postRentalShipment(
  db: Kysely<KyselyDatabase>,
  args: {
    shipmentId: string;
    companyId: string;
    userId: string;
    today: string;
    postingDate?: string;
  }
): Promise<void> {
  const { shipmentId, companyId, userId, today } = args;

  await db.transaction().execute(async (trx) => {
    const deliveredOn = args.postingDate ?? today;
    const future = futureDeliveryError(deliveredOn, today);
    if (future) throw new InvalidInputError(future);

    const shipment = await trx
      .selectFrom("shipment")
      .select(["id", "shipmentId", "sourceDocumentId", "status"])
      .where("id", "=", shipmentId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!shipment) throw new NotFoundError("Shipment not found");

    const assetLines = await trx
      .selectFrom("shipmentFixedAssetLine")
      .select(["id", "rentalAgreementLineId", "meter"])
      .where("shipmentId", "=", shipmentId)
      .where("companyId", "=", companyId)
      .where("shipped", "=", true)
      .where("rentalAgreementLineId", "is not", null)
      .orderBy("createdAt")
      .orderBy("id")
      .execute();
    if (assetLines.length === 0) {
      throw new InvalidInputError("Select at least one unit to deliver");
    }

    if (!shipment.sourceDocumentId) {
      throw new NotFoundError("Rental agreement not found");
    }
    const agreement = await lockAgreement(
      trx,
      companyId,
      shipment.sourceDocumentId
    );
    if (agreement.status !== "Active") {
      throw new InvalidInputError(
        `Rental agreement ${agreement.rentalAgreementId} is ${agreement.status}; units are delivered from an Active agreement`
      );
    }

    const { linesById, assetsById } = await lockRentalUnits(
      trx,
      companyId,
      assetLines.map((line) => line.rentalAgreementLineId!)
    );

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
      if (line.status !== "Pending") {
        throw new InvalidInputError(
          `${label} is ${line.status}; only a Pending unit can be delivered`
        );
      }
      if (asset?.outOfServiceSince) {
        throw new InvalidInputError(
          `${label} is out of service: ${asset.outOfServiceReason ?? "no reason given"}`
        );
      }
      return { line, meter: assetLine.meter };
    });

    for (const { line, meter } of units) {
      await trx
        .updateTable("rentalAgreementLine")
        .set({
          status: "On Rent",
          deliveredAt: deliveredOn,
          meterOut: meter,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .where("id", "=", line.id)
        .where("companyId", "=", companyId)
        .execute();
    }

    for (const { line } of units) {
      if (!line.trackedEntityId) continue;
      await insertUnitActivity(trx, {
        type: "Rental Delivery",
        direction: "input",
        sourceDocument: "Shipment",
        sourceDocumentId: shipment.id,
        sourceDocumentReadableId: shipment.shipmentId,
        attributes: { Shipment: shipment.id, "Rental Agreement": agreement.id },
        trackedEntityId: line.trackedEntityId,
        companyId,
        userId
      });
    }

    await trx
      .updateTable("shipment")
      .set({
        status: "Posted",
        postingDate: deliveredOn,
        postedBy: userId
      })
      .where("id", "=", shipmentId)
      .where("companyId", "=", companyId)
      .execute();
  });
}

/** Voids a Posted rental shipment: its units go back to Pending, as if never
 *  delivered. Refused once a unit has moved on or its accrued rent is in a
 *  posted or draft recognition run. */
export async function voidRentalShipment(
  db: Kysely<KyselyDatabase>,
  args: { shipmentId: string; companyId: string; userId: string }
): Promise<void> {
  const { shipmentId, companyId, userId } = args;

  await db.transaction().execute(async (trx) => {
    const shipment = await trx
      .selectFrom("shipment")
      .select(["id", "shipmentId", "sourceDocumentId"])
      .where("id", "=", shipmentId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!shipment) throw new NotFoundError("Shipment not found");

    const assetLines = await trx
      .selectFrom("shipmentFixedAssetLine")
      .select(["id", "rentalAgreementLineId"])
      .where("shipmentId", "=", shipmentId)
      .where("companyId", "=", companyId)
      .where("shipped", "=", true)
      .where("rentalAgreementLineId", "is not", null)
      .orderBy("createdAt")
      .orderBy("id")
      .execute();

    if (!shipment.sourceDocumentId) {
      throw new NotFoundError("Rental agreement not found");
    }
    const agreement = await lockAgreement(
      trx,
      companyId,
      shipment.sourceDocumentId
    );

    const lineIds = assetLines.map((line) => line.rentalAgreementLineId!);
    const { linesById, assetsById } = await lockRentalUnits(
      trx,
      companyId,
      lineIds
    );

    const accruals =
      lineIds.length === 0
        ? []
        : await trx
            .selectFrom("revenueRecognitionSchedule")
            .select(["rentalAgreementLineId", "status", "runLineId"])
            .where("type", "=", "Accrual")
            .where("companyId", "=", companyId)
            .where("rentalAgreementLineId", "in", lineIds)
            .execute();

    const units = assetLines.map((assetLine) => {
      const lineId = assetLine.rentalAgreementLineId!;
      const line = linesById.get(lineId);
      const asset = line?.fixedAssetId
        ? assetsById.get(line.fixedAssetId)
        : undefined;
      if (!line || line.rentalAgreementId !== agreement.id) {
        throw new NotFoundError("Rental agreement line not found");
      }
      const rows = accruals.filter(
        (row) => row.rentalAgreementLineId === lineId
      );
      const accrual: "Posted" | "Draft run" | null = rows.some(
        (row) => row.status === "Posted"
      )
        ? "Posted"
        : rows.some((row) => row.status === "Planned" && row.runLineId)
          ? "Draft run"
          : null;
      return {
        line,
        label: unitLabel(asset, lineId),
        status: line.status,
        accrual
      };
    });

    const blocker = rentalShipmentVoidBlocker(units);
    if (blocker) throw new InvalidInputError(blocker);

    if (lineIds.length > 0) {
      await trx
        .deleteFrom("revenueRecognitionSchedule")
        .where("type", "=", "Accrual")
        .where("status", "=", "Planned")
        .where("runLineId", "is", null)
        .where("companyId", "=", companyId)
        .where("rentalAgreementLineId", "in", lineIds)
        .execute();
    }

    for (const { line } of units) {
      await trx
        .updateTable("rentalAgreementLine")
        .set({
          status: "Pending",
          deliveredAt: null,
          meterOut: null,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .where("id", "=", line.id)
        .where("companyId", "=", companyId)
        .execute();
    }

    for (const { line } of units) {
      if (!line.trackedEntityId) continue;
      await insertUnitActivity(trx, {
        type: "Void Shipment",
        direction: "input",
        sourceDocument: "Shipment",
        sourceDocumentId: shipment.id,
        sourceDocumentReadableId: shipment.shipmentId,
        attributes: { Shipment: shipment.id, "Rental Agreement": agreement.id },
        trackedEntityId: line.trackedEntityId,
        companyId,
        userId
      });
    }

    await trx
      .updateTable("shipment")
      .set({
        status: "Voided",
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", shipmentId)
      .where("companyId", "=", companyId)
      .execute();
  });
}

// Locks the agreement lines a rental document names and reads their assets,
// whose numbers name the units in a refusal.
async function lockRentalUnits(
  trx: Transaction<KyselyDatabase>,
  companyId: string,
  lineIds: string[]
) {
  const lines =
    lineIds.length === 0
      ? []
      : await trx
          .selectFrom("rentalAgreementLine")
          .select([
            "id",
            "rentalAgreementId",
            "status",
            "fixedAssetId",
            "trackedEntityId"
          ])
          .where("id", "in", lineIds)
          .where("companyId", "=", companyId)
          .forUpdate()
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
          .select([
            "id",
            "fixedAssetId",
            "name",
            "outOfServiceSince",
            "outOfServiceReason"
          ])
          .where("id", "in", assetIds)
          .where("companyId", "=", companyId)
          .execute();
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  return { linesById, assetsById };
}
