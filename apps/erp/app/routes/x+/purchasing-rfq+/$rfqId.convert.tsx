import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getPurchasingRFQ,
  getPurchasingRFQLines,
  getPurchasingRFQSuppliers,
  updatePurchasingRFQStatus,
  upsertSupplierQuote,
  upsertSupplierQuoteLine
} from "~/modules/purchasing";
import { getNextSequence } from "~/modules/settings";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing"
  });

  const { rfqId } = params;
  if (!rfqId) throw new Error("Could not find rfqId");

  // Get RFQ, lines, and suppliers
  const [rfqResult, linesResult, suppliersResult] = await Promise.all([
    getPurchasingRFQ(client, rfqId),
    getPurchasingRFQLines(client, rfqId),
    getPurchasingRFQSuppliers(client, rfqId)
  ]);

  if (rfqResult.error) {
    throw redirect(
      path.to.purchasingRfqDetails(rfqId),
      await flash(request, error(rfqResult.error, "Failed to load RFQ"))
    );
  }

  if (linesResult.error) {
    throw redirect(
      path.to.purchasingRfqDetails(rfqId),
      await flash(request, error(linesResult.error, "Failed to load RFQ lines"))
    );
  }

  if (suppliersResult.error) {
    throw redirect(
      path.to.purchasingRfqDetails(rfqId),
      await flash(
        request,
        error(suppliersResult.error, "Failed to load RFQ suppliers")
      )
    );
  }

  //   const rfq = rfqResult.data;
  const lines = linesResult.data ?? [];
  const suppliers = suppliersResult.data ?? [];

  if (suppliers.length === 0) {
    throw redirect(
      path.to.purchasingRfqDetails(rfqId),
      await flash(request, error(null, "No suppliers found for this RFQ"))
    );
  }

  if (lines.length === 0) {
    throw redirect(
      path.to.purchasingRfqDetails(rfqId),
      await flash(request, error(null, "No line items found for this RFQ"))
    );
  }

  // Create a supplier quote for each supplier
  const createdQuotes: string[] = [];

  for (const rfqSupplier of suppliers) {
    const supplierId = rfqSupplier.supplierId;

    // Get next sequence number for the supplier quote
    const sequence = await getNextSequence(client, "supplierQuote", companyId);
    if (sequence.error || !sequence.data) {
      console.error("Failed to get sequence:", sequence.error);
      continue;
    }

    // Create the supplier quote
    const quoteResult = await upsertSupplierQuote(client, {
      supplierQuoteId: sequence.data,
      supplierQuoteType: "Purchase",
      supplierId,
      quotedDate: new Date().toISOString().split("T")[0],
      companyId,
      createdBy: userId
    });

    if (quoteResult.error || !quoteResult.data) {
      console.error("Failed to create supplier quote:", quoteResult.error);
      continue;
    }

    const supplierQuoteId = quoteResult.data.id;
    createdQuotes.push(supplierQuoteId);

    // Create quote lines for each RFQ line that has an itemId
    for (const line of lines) {
      // Skip lines without an itemId since supplierQuoteLine.itemId is NOT NULL
      if (!line.itemId) {
        console.warn("Skipping line without itemId:", line.id);
        continue;
      }

      const uom = line.unitOfMeasureCode ?? "EA";

      await upsertSupplierQuoteLine(client, {
        supplierQuoteId,
        itemId: line.itemId,
        description: line.description ?? "",
        quantity: line.quantity ?? [1],
        inventoryUnitOfMeasureCode: uom,
        purchaseUnitOfMeasureCode: uom,
        companyId,
        createdBy: userId
      });
    }

    // Link RFQ to supplier quote
    await client.from("purchasingRfqToSupplierQuote").insert({
      purchasingRfqId: rfqId,
      supplierQuoteId,
      companyId
    });
  }

  // Update RFQ status to Received
  await updatePurchasingRFQStatus(client, {
    id: rfqId,
    status: "Requested",
    updatedBy: userId
  });

  throw redirect(
    path.to.purchasingRfqDetails(rfqId),
    await flash(
      request,
      success(`Created ${createdQuotes.length} supplier quote(s)`)
    )
  );
}
