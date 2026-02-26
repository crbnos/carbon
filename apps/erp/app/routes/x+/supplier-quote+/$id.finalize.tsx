import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  finalizeSupplierQuote,
  getSupplierQuote,
  getSupplierQuoteLinePricesByQuoteId,
  getSupplierQuoteLines
} from "~/modules/purchasing";
import { upsertExternalLink } from "~/modules/shared";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const { request, params } = args;
  assertIsPost(request);

  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing",
    role: "employee",
    bypassRls: true
  });

  const { id } = params;
  if (!id) throw new Error("Could not find supplier quote id");

  const [quote] = await Promise.all([getSupplierQuote(client, id)]);
  if (quote.error) {
    throw redirect(
      path.to.supplierQuote(id),
      await flash(request, error(quote.error, "Failed to get supplier quote"))
    );
  }

  // Reuse existing external link or create one if it doesn't exist
  const [externalLink] = await Promise.all([
    upsertExternalLink(client, {
      id: quote.data.externalLinkId ?? undefined,
      documentType: "SupplierQuote",
      documentId: id,
      supplierId: quote.data.supplierId,
      expiresAt: quote.data.expirationDate,
      companyId
    })
  ]);

  if (externalLink.data && quote.data.externalLinkId !== externalLink.data.id) {
    await client
      .from("supplierQuote")
      .update({
        externalLinkId: externalLink.data.id,
        status: "Active"
      })
      .eq("id", id);
  }

  // Validate that all quantities have price and lead time
  const [quoteLines, quoteLinePrices] = await Promise.all([
    getSupplierQuoteLines(client, id),
    getSupplierQuoteLinePricesByQuoteId(client, id)
  ]);

  if (quoteLines.error) {
    throw redirect(
      path.to.supplierQuote(id),
      await flash(
        request,
        error(quoteLines.error, "Failed to get supplier quote lines")
      )
    );
  }

  if (quoteLinePrices.error) {
    throw redirect(
      path.to.supplierQuote(id),
      await flash(
        request,
        error(quoteLinePrices.error, "Failed to get supplier quote line prices")
      )
    );
  }

  // Check that each line has at least one quantity with price and lead time
  // (not all quantities need them, just at least one per line)
  const lines = quoteLines.data ?? [];
  const prices = quoteLinePrices.data ?? [];

  for (const line of lines) {
    if (!line.id) continue;
    const linePrices = prices.filter((p) => p.supplierQuoteLineId === line.id);

    // Check if at least one quantity has both valid price and lead time
    const hasValidPriceAndLeadTime = linePrices.some(
      (price) =>
        price.supplierUnitPrice !== null &&
        price.supplierUnitPrice !== 0 &&
        price.leadTime !== null &&
        price.leadTime !== 0
    );

    if (!hasValidPriceAndLeadTime) {
      throw redirect(
        path.to.supplierQuote(id),
        await flash(
          request,
          error(
            null,
            `Line ${line.itemReadableId} must have at least one quantity with price and lead time`
          )
        )
      );
    }
  }

  // TODO: Add PDF generation for supplier quotes when available
  // TODO: Add document creation for supplier quotes when PDF is available

  try {
    const finalize = await finalizeSupplierQuote(client, id, userId);
    if (finalize.error) {
      throw redirect(
        path.to.supplierQuote(id),
        await flash(
          request,
          error(finalize.error, "Failed to finalize supplier quote")
        )
      );
    }

    const supplierId = quote.data.supplierId;
    if (!supplierId) throw new Error("Supplier quote has no supplier");

    for (const line of lines) {
      if (!line.id || !line.itemId) continue;

      const linePrices = prices.filter(
        (p) => p.supplierQuoteLineId === line.id
      );
      if (linePrices.length === 0) continue;

      const existingPart = await client
        .from("supplierPart")
        .select("id")
        .eq("itemId", line.itemId)
        .eq("supplierId", supplierId)
        .eq("companyId", companyId)
        .single();

      let supplierPartId: string | undefined;

      if (existingPart.data?.id) {
        supplierPartId = existingPart.data.id;
      } else {
        const newPart = await client
          .from("supplierPart")
          .insert({
            itemId: line.itemId,
            supplierId,
            supplierPartId: line.supplierPartId ?? undefined,
            supplierUnitOfMeasureCode:
              line.purchaseUnitOfMeasureCode ?? undefined,
            conversionFactor: line.conversionFactor ?? 1,
            companyId,
            createdBy: userId
          })
          .select("id")
          .single();

        if (newPart.error || !newPart.data?.id) {
          console.error("Error creating supplier part:", newPart.error);
          continue;
        }
        supplierPartId = newPart.data.id;
      }

      if (!supplierPartId) continue;

      const conversionFactor = line.conversionFactor ?? 1;

      for (const price of linePrices) {
        if (!price.supplierUnitPrice || price.supplierUnitPrice === 0) continue;

        const unitPriceInInventoryUnit =
          (price.unitPrice ?? 0) / conversionFactor;

        const upsertResult = await client.from("supplierPartPrice").upsert(
          {
            supplierPartId,
            quantity: price.quantity ?? 1,
            unitPrice: unitPriceInInventoryUnit,
            leadTime: price.leadTime ?? 0,
            sourceType: "Quote",
            sourceDocumentId: id,
            companyId,
            createdBy: userId,
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          },
          { onConflict: "supplierPartId,quantity" }
        );

        if (upsertResult.error) {
          console.error(
            "Error upserting supplier part price:",
            upsertResult.error
          );
        }
      }

      const bestPrice = linePrices
        .filter((p) => p.unitPrice != null && p.unitPrice !== 0)
        .sort(
          (a, b) => (a.unitPrice ?? Infinity) - (b.unitPrice ?? Infinity)
        )[0];

      if (bestPrice) {
        await client
          .from("supplierPart")
          .update({
            unitPrice: (bestPrice.unitPrice ?? 0) / conversionFactor,
            minimumOrderQuantity: bestPrice.quantity ?? 1
          })
          .eq("id", supplierPartId);
      }
    }
  } catch (err) {
    throw redirect(
      path.to.supplierQuote(id),
      await flash(request, error(err, "Failed to finalize supplier quote"))
    );
  }

  throw redirect(
    path.to.supplierQuote(id),
    await flash(request, success("Supplier quote finalized successfully"))
  );
}
