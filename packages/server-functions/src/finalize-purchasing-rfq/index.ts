// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { selectRows } from "@carbon/database/rows";
import { getNextSequence } from "@carbon/database/sequence";
import { datetime } from "@carbon/utils";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError, NotFoundError } from "../errors";

export const finalizePurchasingRfqInput = z.object({
  rfqId: z.string()
});

const ITEM_TYPES = [
  "Part",
  "Material",
  "Tool",
  "Consumable",
  "Service"
] as const;

export type FinalizedSupplierQuote = {
  id: string;
  supplierQuoteId: string;
  supplierId: string;
  externalLinkId: string;
};

/**
 * Sends a purchasing RFQ out: one Draft supplier quote per RFQ supplier, each
 * with its share link and a line per RFQ line that names an item, then the RFQ
 * is marked Requested. One transaction — a failure leaves no quotes behind,
 * and only a Draft RFQ is finalized, so a repeated request creates nothing.
 */
const finalizePurchasingRfq = defineServerFn({
  name: "finalize-purchasing-rfq",
  input: finalizePurchasingRfqInput,
  permissions: { create: "purchasing" },
  async run({ db, companyId, userId }, { rfqId }) {
    const quotes = await db.transaction().execute(async (trx) => {
      // Locked: a second submit waits here, then finds the RFQ Requested.
      const rfq = await trx
        .selectFrom("purchasingRfq")
        .select(["id", "status"])
        .where("id", "=", rfqId)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!rfq) throw new NotFoundError("RFQ not found");
      if (rfq.status !== "Draft") {
        throw new InvalidInputError(
          `Only a draft RFQ can be finalized; this one is ${rfq.status}`
        );
      }

      const suppliers = await trx
        .selectFrom("purchasingRfqSupplier")
        .select("supplierId")
        .where("purchasingRfqId", "=", rfqId)
        .where("companyId", "=", companyId)
        .orderBy("createdAt")
        .orderBy("id")
        .execute();
      if (suppliers.length === 0) {
        throw new InvalidInputError("No suppliers found for this RFQ");
      }

      const lines = await selectRows(
        trx,
        "purchasingRfqLines",
        { purchasingRfqId: rfqId, companyId },
        { orderBy: ["order"] }
      );
      if (lines.length === 0) {
        throw new InvalidInputError("No line items found for this RFQ");
      }
      // supplierQuoteLine.itemId is NOT NULL
      const quotableLines = lines.flatMap((line) =>
        line.itemId ? [{ ...line, itemId: line.itemId }] : []
      );

      const created: FinalizedSupplierQuote[] = [];
      for (const { supplierId } of suppliers) {
        const supplierQuoteId = await getNextSequence(
          trx,
          "supplierQuote",
          companyId
        );
        const interaction = await trx
          .insertInto("supplierInteraction")
          .values({ companyId, supplierId })
          .returning("id")
          .executeTakeFirstOrThrow();
        const now = datetime.timestamp();
        const quote = await trx
          .insertInto("supplierQuote")
          .values({
            supplierQuoteId,
            supplierId,
            supplierInteractionId: interaction.id,
            status: "Draft",
            exchangeRate: 1,
            exchangeRateUpdatedAt: now,
            quotedDate: now,
            supplierQuoteType: "Purchase",
            companyId,
            createdBy: userId,
            updatedBy: userId
          })
          .returning("id")
          .executeTakeFirstOrThrow();

        const externalLink = await trx
          .insertInto("externalLink")
          .values({
            documentType: "SupplierQuote",
            documentId: quote.id,
            supplierId,
            companyId
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .updateTable("supplierQuote")
          .set({ externalLinkId: externalLink.id })
          .where("id", "=", quote.id)
          .where("companyId", "=", companyId)
          .execute();

        if (quotableLines.length > 0) {
          await trx
            .insertInto("supplierQuoteLine")
            .values(
              quotableLines.map((line, index) => ({
                supplierQuoteId: quote.id,
                supplierQuoteLineType: ITEM_TYPES.some(
                  (type) => type === line.itemType
                )
                  ? (line.itemType as string)
                  : "Part",
                itemId: line.itemId,
                description: line.description ?? "",
                quantity: line.quantity ?? [1],
                inventoryUnitOfMeasureCode:
                  line.inventoryUnitOfMeasureCode ?? "EA",
                purchaseUnitOfMeasureCode:
                  line.purchaseUnitOfMeasureCode ?? "EA",
                conversionFactor: line.conversionFactor ?? 1,
                sortOrder: index + 1,
                companyId,
                createdBy: userId
              }))
            )
            .execute();
        }

        await trx
          .insertInto("purchasingRfqToSupplierQuote")
          .values({
            purchasingRfqId: rfqId,
            supplierQuoteId: quote.id,
            companyId
          })
          .execute();

        created.push({
          id: quote.id,
          supplierQuoteId,
          supplierId,
          externalLinkId: externalLink.id
        });
      }

      await trx
        .updateTable("purchasingRfq")
        .set({
          status: "Requested",
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .where("id", "=", rfqId)
        .where("companyId", "=", companyId)
        .execute();

      return created;
    });

    return { quotes };
  }
});

export default finalizePurchasingRfq;
