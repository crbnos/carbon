// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { many, selectRows } from "@carbon/database/rows";
import { datetime, groupBy } from "@carbon/utils";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError, NotFoundError, ServerFnError } from "../errors";

export const finalizeSupplierQuoteInput = z.object({
  supplierQuoteId: z.string()
});

/**
 * Marks a supplier quote Active and copies its prices into the supplier's
 * price list, in one transaction: a supplier part per quoted item (created
 * when the supplier has none), one price break per quoted quantity, and the
 * lowest quoted price as the part's own.
 */
const finalizeSupplierQuote = defineServerFn({
  name: "finalize-supplier-quote",
  input: finalizeSupplierQuoteInput,
  permissions: { create: "purchasing" },
  async run({ db, companyId, userId }, { supplierQuoteId }) {
    await db.transaction().execute(async (trx) => {
      const quote = await trx
        .selectFrom("supplierQuote")
        .select(["id", "supplierId"])
        .where("id", "=", supplierQuoteId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!quote) throw new NotFoundError("Supplier quote not found");
      if (!quote.supplierId) {
        throw new ServerFnError("Supplier quote has no supplier", 400);
      }
      const supplierId = quote.supplierId;

      const lines = await selectRows(
        trx,
        "supplierQuoteLine",
        { supplierQuoteId, companyId },
        {
          columns: [
            "id",
            "itemId",
            "supplierPartId",
            "purchaseUnitOfMeasureCode",
            "conversionFactor"
          ],
          orderBy: ["sortOrder", "id"]
        }
      );
      const prices = await many(trx, "supplierQuoteLinePrice", {
        supplierQuoteId,
        companyId
      });
      const pricesByLine = groupBy(
        prices.data,
        (price) => price.supplierQuoteLineId
      );

      // Every line needs one quantity with a price and a lead time: a price
      // list entry without either is worse than none.
      const unpriced = lines.find(
        (line) =>
          !(pricesByLine[line.id] ?? []).some(
            (price) => price.supplierUnitPrice && price.leadTime
          )
      );
      if (unpriced) {
        const item = unpriced.itemId
          ? await trx
              .selectFrom("item")
              .select("readableIdWithRevision")
              .where("id", "=", unpriced.itemId)
              .where("companyId", "=", companyId)
              .executeTakeFirst()
          : undefined;
        throw new InvalidInputError(
          `Line ${item?.readableIdWithRevision ?? unpriced.id} must have at least one quantity with price and lead time`
        );
      }

      await trx
        .updateTable("supplierQuote")
        .set({
          status: "Active",
          updatedAt: datetime.timestamp(),
          updatedBy: userId
        })
        .where("id", "=", supplierQuoteId)
        .where("companyId", "=", companyId)
        .execute();

      const pricedLines = lines.flatMap((line) => {
        const linePrices = pricesByLine[line.id] ?? [];
        return line.itemId && linePrices.length > 0
          ? [{ ...line, itemId: line.itemId, prices: linePrices }]
          : [];
      });
      if (pricedLines.length === 0) return;

      // An item the supplier already has a part for keeps that part as it is.
      await trx
        .insertInto("supplierPart")
        .values(
          pricedLines.map((line) => ({
            itemId: line.itemId,
            supplierId,
            supplierPartId: line.supplierPartId ?? undefined,
            supplierUnitOfMeasureCode:
              line.purchaseUnitOfMeasureCode ?? undefined,
            conversionFactor: line.conversionFactor ?? 1,
            companyId,
            createdBy: userId
          }))
        )
        .onConflict((oc) =>
          oc.columns(["itemId", "supplierId", "companyId"]).doNothing()
        )
        .execute();

      const supplierParts = await trx
        .selectFrom("supplierPart")
        .select(["id", "itemId"])
        .where("supplierId", "=", supplierId)
        .where("companyId", "=", companyId)
        .where("itemId", "in", [
          ...new Set(pricedLines.map((line) => line.itemId))
        ])
        .execute();
      const supplierPartIdByItem = new Map(
        supplierParts.map((part) => [part.itemId, part.id])
      );

      // Keyed by (part, quantity): when two lines quote one item at one
      // quantity the later line wins, as it did when these were written in turn.
      const priceBreaks = new Map<
        string,
        {
          supplierPartId: string;
          quantity: number;
          unitPrice: number;
          leadTime: number;
        }
      >();
      const updatedAt = datetime.timestamp();

      for (const line of pricedLines) {
        const supplierPartId = supplierPartIdByItem.get(line.itemId);
        if (!supplierPartId) {
          throw new ServerFnError("Failed to create supplier part", 500);
        }
        const conversionFactor = line.conversionFactor ?? 1;

        for (const price of line.prices) {
          if (!price.supplierUnitPrice) continue;
          const quantity = price.quantity ?? 1;
          priceBreaks.set(`${supplierPartId}:${quantity}`, {
            supplierPartId,
            quantity,
            unitPrice: (price.unitPrice ?? 0) / conversionFactor,
            leadTime: price.leadTime ?? 0
          });
        }

        const bestPrice = line.prices
          .filter((price) => price.unitPrice != null && price.unitPrice !== 0)
          .sort(
            (a, b) => (a.unitPrice ?? Infinity) - (b.unitPrice ?? Infinity)
          )[0];
        if (bestPrice) {
          await trx
            .updateTable("supplierPart")
            .set({
              unitPrice: (bestPrice.unitPrice ?? 0) / conversionFactor,
              minimumOrderQuantity: bestPrice.quantity ?? 1
            })
            .where("id", "=", supplierPartId)
            .where("companyId", "=", companyId)
            .execute();
        }
      }

      if (priceBreaks.size > 0) {
        await trx
          .insertInto("supplierPartPrice")
          .values(
            [...priceBreaks.values()].map((priceBreak) => ({
              ...priceBreak,
              sourceType: "Quote" as const,
              sourceDocumentId: supplierQuoteId,
              companyId,
              createdBy: userId,
              updatedBy: userId,
              updatedAt
            }))
          )
          .onConflict((oc) =>
            oc.columns(["supplierPartId", "quantity"]).doUpdateSet((eb) => ({
              unitPrice: eb.ref("excluded.unitPrice"),
              leadTime: eb.ref("excluded.leadTime"),
              sourceType: eb.ref("excluded.sourceType"),
              sourceDocumentId: eb.ref("excluded.sourceDocumentId"),
              companyId: eb.ref("excluded.companyId"),
              createdBy: eb.ref("excluded.createdBy"),
              updatedBy: eb.ref("excluded.updatedBy"),
              updatedAt: eb.ref("excluded.updatedAt")
            }))
          )
          .execute();
      }
    });

    return { success: true };
  }
});

export default finalizeSupplierQuote;
