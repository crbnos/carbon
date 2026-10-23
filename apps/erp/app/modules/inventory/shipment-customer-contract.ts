// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A contract delivery hands over the parts of an Active project contract's
// part CLINs (spec section 10.4). The job that built each part consumed it to
// the project, so nothing moves in stock and no journal is posted: the
// delivery records custody, the typed serial and the date. A Fixed Price
// line's delivered units move their share of its next billing event to the
// delivery date (D34); void puts it back.

import { InvalidInputError, NotFoundError } from "@carbon/api/errors";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import {
  restoreBillingRowAfterVoid,
  splitBillingRowForDelivery
} from "~/modules/sales/contract-delivery-billing";
import { futureDeliveryError } from "~/modules/sales/sales.service";

export async function postContractShipment(
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
  const scope = { companyId, userId };

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
    if (!shipment.sourceDocumentId) {
      throw new NotFoundError("Contract not found");
    }

    const contract = await trx
      .selectFrom("customerContract")
      .select(["id", "customerContractId", "status"])
      .where("id", "=", shipment.sourceDocumentId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!contract) throw new NotFoundError("Contract not found");
    if (contract.status !== "Active") {
      throw new InvalidInputError(
        `Contract ${contract.customerContractId} is ${contract.status}; parts are delivered on an Active contract`
      );
    }

    const deliveryLines = (
      await trx
        .selectFrom("shipmentLine")
        .select(["id", "lineId", "shippedQuantity"])
        .where("shipmentId", "=", shipmentId)
        .where("companyId", "=", companyId)
        .orderBy("createdAt")
        .orderBy("id")
        .execute()
    ).filter((line) => line.lineId && Number(line.shippedQuantity) > 0);
    if (deliveryLines.length === 0) {
      throw new InvalidInputError("Enter a quantity to deliver");
    }
    const lineIds = [...new Set(deliveryLines.map((line) => line.lineId!))];

    const [contractLines, jobs, delivered] = await Promise.all([
      trx
        .selectFrom("customerContractLine as l")
        .leftJoin("item as i", (join) =>
          join
            .onRef("i.id", "=", "l.itemId")
            .onRef("i.companyId", "=", "l.companyId")
        )
        .select([
          "l.id",
          "l.customerContractId",
          "l.lineItemNumber",
          "l.description",
          "l.quantity",
          "l.rate",
          "l.billingMethod",
          "i.readableIdWithRevision"
        ])
        .where("l.id", "in", lineIds)
        .where("l.companyId", "=", companyId)
        .execute(),
      trx
        .selectFrom("job")
        .select(["customerContractLineId", "quantityComplete"])
        .where("customerContractLineId", "in", lineIds)
        .where("companyId", "=", companyId)
        .where("status", "<>", "Cancelled")
        .execute(),
      trx
        .selectFrom("shipmentLine as sl")
        .innerJoin("shipment as s", (join) =>
          join
            .onRef("s.id", "=", "sl.shipmentId")
            .onRef("s.companyId", "=", "sl.companyId")
        )
        .select(["sl.lineId", "sl.shippedQuantity"])
        .where("s.sourceDocument", "=", "Customer Contract")
        .where("s.status", "=", "Posted")
        .where("sl.lineId", "in", lineIds)
        .where("sl.companyId", "=", companyId)
        .execute()
    ]);
    const lineById = new Map(contractLines.map((line) => [line.id, line]));
    const sum = (rows: { key: string | null; value: number }[]) => {
      const totals = new Map<string, number>();
      for (const row of rows) {
        if (!row.key) continue;
        totals.set(row.key, (totals.get(row.key) ?? 0) + row.value);
      }
      return totals;
    };
    const completed = sum(
      jobs.map((job) => ({
        key: job.customerContractLineId,
        value: Number(job.quantityComplete)
      }))
    );
    const deliveredBefore = sum(
      delivered.map((row) => ({
        key: row.lineId,
        value: Number(row.shippedQuantity)
      }))
    );
    const deliveringNow = sum(
      deliveryLines.map((line) => ({
        key: line.lineId,
        value: Number(line.shippedQuantity)
      }))
    );

    for (const [lineId, quantity] of deliveringNow) {
      const line = lineById.get(lineId);
      if (!line || line.customerContractId !== contract.id) {
        throw new NotFoundError("Contract line not found");
      }
      const label =
        line.lineItemNumber ??
        line.description ??
        line.readableIdWithRevision ??
        "The line";
      const done = deliveredBefore.get(lineId) ?? 0;
      const open = Math.min(
        (completed.get(lineId) ?? 0) - done,
        Number(line.quantity) - done
      );
      if (quantity > open + 1e-9) {
        throw new InvalidInputError(
          `${label}: ${quantity} to deliver, but only ${Math.max(open, 0)} built and not delivered`
        );
      }
    }

    for (const deliveryLine of deliveryLines) {
      const line = lineById.get(deliveryLine.lineId!)!;
      if (line.billingMethod !== "Fixed") continue;
      const moved = await splitBillingRowForDelivery(trx, {
        scope,
        contractId: contract.id,
        customerContractLineId: line.id,
        amount: Number(deliveryLine.shippedQuantity) * Number(line.rate),
        deliveredOn
      });
      if (!moved) continue;
      await trx
        .updateTable("shipmentLine")
        .set({
          customerContractInvoiceLineId: moved.rowId,
          previousInvoiceDate: moved.previousInvoiceDate,
          updatedBy: userId
        })
        .where("id", "=", deliveryLine.id)
        .where("companyId", "=", companyId)
        .execute();
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

/** Voids a Posted contract delivery: each Fixed Price line's billing returns
 *  to where it was. Refused once a moved billing event is invoiced. */
export async function voidContractShipment(
  db: Kysely<KyselyDatabase>,
  args: { shipmentId: string; companyId: string; userId: string }
): Promise<void> {
  const { shipmentId, companyId, userId } = args;
  const scope = { companyId, userId };

  await db.transaction().execute(async (trx) => {
    const shipment = await trx
      .selectFrom("shipment")
      .select(["id", "sourceDocumentId", "status"])
      .where("id", "=", shipmentId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!shipment) throw new NotFoundError("Shipment not found");
    if (!shipment.sourceDocumentId) {
      throw new NotFoundError("Contract not found");
    }
    const contract = await trx
      .selectFrom("customerContract")
      .select(["id"])
      .where("id", "=", shipment.sourceDocumentId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!contract) throw new NotFoundError("Contract not found");

    const moved = await trx
      .selectFrom("shipmentLine")
      .select(["id", "customerContractInvoiceLineId", "previousInvoiceDate"])
      .where("shipmentId", "=", shipmentId)
      .where("companyId", "=", companyId)
      .where("customerContractInvoiceLineId", "is not", null)
      .execute();
    for (const line of moved) {
      await restoreBillingRowAfterVoid(trx, {
        scope,
        contractId: contract.id,
        row: {
          rowId: line.customerContractInvoiceLineId!,
          previousInvoiceDate: line.previousInvoiceDate
        }
      });
    }
    if (moved.length > 0) {
      await trx
        .updateTable("shipmentLine")
        .set({
          customerContractInvoiceLineId: null,
          previousInvoiceDate: null,
          updatedBy: userId
        })
        .where(
          "id",
          "in",
          moved.map((line) => line.id)
        )
        .where("companyId", "=", companyId)
        .execute();
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
