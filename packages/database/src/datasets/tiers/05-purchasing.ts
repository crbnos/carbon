import { resolveDate, resolveTimestamp } from "../dates.ts";
import { insertId, insertRow, need, nextSequence, RICH } from "../sql.ts";
import type { Ctx } from "../types.ts";

// Supplier quotes come back shortly before the RFQ closes and stay open well
// past it, so the Compare Quotes drawer is never looking at expired prices.
const SUPPLIER_QUOTE_QUOTED_OFFSET = -16;
const SUPPLIER_QUOTE_EXPIRATION_OFFSET = 140;
const SUPPLIER_QUOTE_EXPIRATION_TIME_OF_DAY = "23:59:59";

export async function runTier5(ctx: Ctx): Promise<void> {
  const data = ctx.dataset.purchasing;
  const { companyId, locationId } = ctx;
  const plantId = ctx.refs.locations.Plant ?? locationId;
  const shippingMethodId = need(
    ctx.refs.shippingMethods,
    ctx.dataset.foundation.defaultShippingMethod
  );
  const paymentTermId = ctx.refs.misc.paymentTermId;

  // ── Purchase orders written directly, each with its own receipt/invoice ────
  for (const spec of data.purchaseOrders) {
    if (spec.source !== "direct") continue;
    ctx.log(spec.log);

    const supplierId = need(ctx.refs.suppliers, spec.supplier);
    const interactionId = await insertId(ctx, "supplierInteraction", {
      supplierId
    });
    const poReadableId = await nextSequence(ctx, "purchaseOrder");
    const poId = await insertId(ctx, "purchaseOrder", {
      purchaseOrderId: poReadableId,
      purchaseOrderType: spec.purchaseOrderType,
      status: spec.status,
      supplierId,
      supplierInteractionId: interactionId,
      orderDate: resolveDate(ctx.anchor, spec.orderDateOffset)
    });
    await insertRow(ctx, "purchaseOrderDelivery", {
      id: poId,
      locationId: plantId,
      shippingMethodId,
      companyId
    });
    await insertRow(ctx, "purchaseOrderPayment", {
      id: poId,
      paymentTermId,
      companyId
    });

    // A receipt line points at the PO line for the same item.
    const lineIdByItem: Record<string, string> = {};
    for (const line of spec.lines) {
      const item = need(ctx.refs.items, line.item);
      lineIdByItem[line.item] = await insertId(ctx, "purchaseOrderLine", {
        purchaseOrderId: poId,
        purchaseOrderLineType: "Part",
        itemId: item.id,
        description: item.name,
        purchaseQuantity: line.purchaseQuantity,
        supplierUnitPrice: line.supplierUnitPrice,
        inventoryUnitOfMeasureCode: "EA",
        purchaseUnitOfMeasureCode: "EA",
        locationId: plantId
      });
    }
    if (spec.ref) ctx.refs.documents[spec.ref] = poId;

    if (spec.receipt) {
      const receiptReadableId = await nextSequence(ctx, "receipt");
      const receiptId = await insertId(ctx, "receipt", {
        receiptId: receiptReadableId,
        status: spec.receipt.status,
        locationId: plantId,
        sourceDocument: "Purchase Order",
        sourceDocumentId: poId,
        sourceDocumentReadableId: poReadableId,
        supplierId
      });
      for (const line of spec.receipt.lines) {
        const item = need(ctx.refs.items, line.item);
        await insertId(ctx, "receiptLine", {
          receiptId,
          lineId: need(lineIdByItem, line.item),
          itemId: item.id,
          orderQuantity: line.orderQuantity,
          outstandingQuantity: line.outstandingQuantity,
          receivedQuantity: line.receivedQuantity,
          locationId: plantId,
          unitOfMeasure: "EA",
          unitPrice: line.unitPrice,
          requiresBatchTracking: line.requiresBatchTracking
        });
      }
      ctx.refs.documents[spec.receipt.ref] = receiptId;
    }

    if (spec.invoice) {
      const invoiceReadableId = await nextSequence(ctx, "purchaseInvoice");
      const invoiceId = await insertId(ctx, "purchaseInvoice", {
        invoiceId: invoiceReadableId,
        status: spec.invoice.status,
        supplierId,
        supplierInteractionId: interactionId,
        currencyCode: spec.invoice.currencyCode,
        paymentTermId,
        subtotal: spec.invoice.subtotal,
        totalAmount: spec.invoice.totalAmount,
        dateIssued: resolveDate(ctx.anchor, spec.invoice.dateIssuedOffset)
      });
      await insertRow(ctx, "purchaseInvoiceDelivery", {
        id: invoiceId,
        locationId: plantId,
        shippingMethodId,
        companyId
      });
      for (const line of spec.invoice.lines) {
        const item = need(ctx.refs.items, line.item);
        await insertId(ctx, "purchaseInvoiceLine", {
          invoiceId,
          invoiceLineType: "Part",
          purchaseOrderId: poId,
          itemId: item.id,
          description: item.name,
          quantity: line.quantity,
          supplierUnitPrice: line.supplierUnitPrice,
          inventoryUnitOfMeasureCode: "EA",
          purchaseUnitOfMeasureCode: "EA"
        });
      }
      ctx.refs.documents[spec.invoice.ref] = invoiceId;
    }
  }

  // ── RFQ: 2 lines, finalized (Requested), fanned out to 3 suppliers ────────
  ctx.log("purchasing RFQ — Requested (3 suppliers)");
  const rfqReadableId = await nextSequence(ctx, "purchasingRfq");
  const rfq = await insertId(ctx, "purchasingRfq", {
    rfqId: rfqReadableId,
    status: data.rfqHeader.status,
    employeeId: ctx.userId,
    locationId: plantId,
    rfqDate: resolveDate(ctx.anchor, data.rfqHeader.rfqDateOffset),
    expirationDate: resolveDate(ctx.anchor, data.rfqHeader.expirationOffset),
    notes: RICH(data.rfqHeader.notes),
    internalNotes: RICH(data.rfqHeader.internalNotes)
  });
  ctx.refs.documents[data.rfqHeader.ref] = rfq;

  let rfqLineOrder = 1;
  for (const spec of data.rfqLines) {
    const item = need(ctx.refs.items, spec.item);
    await insertId(ctx, "purchasingRfqLine", {
      purchasingRfqId: rfq,
      itemId: item.id,
      description: spec.description,
      quantity: data.rfqQuantityBreaks,
      purchaseUnitOfMeasureCode: "EA",
      inventoryUnitOfMeasureCode: "EA",
      conversionFactor: 1,
      order: rfqLineOrder++
    });
  }

  // ── One Active supplier quote per RFQ supplier, linked back to the RFQ ────
  let winningInteractionId = "";
  for (const spec of data.rfqQuotes) {
    ctx.log(`supplier quote — ${spec.supplier} (Active)`);
    const supplierId = need(ctx.refs.suppliers, spec.supplier);

    await insertId(ctx, "purchasingRfqSupplier", {
      purchasingRfqId: rfq,
      supplierId
    });

    const interactionId = await insertId(ctx, "supplierInteraction", {
      supplierId
    });
    const quoteReadableId = await nextSequence(ctx, "supplierQuote");
    const quoteId = await insertId(ctx, "supplierQuote", {
      supplierQuoteId: quoteReadableId,
      supplierQuoteType: "Purchase",
      status: "Active",
      supplierId,
      supplierContactId: need(ctx.refs.contacts, `sc:${spec.supplier}`),
      supplierLocationId: need(ctx.refs.misc, `sloc:${spec.supplier}`),
      supplierReference: spec.supplierReference,
      supplierInteractionId: interactionId,
      quotedDate: resolveDate(ctx.anchor, SUPPLIER_QUOTE_QUOTED_OFFSET),
      expirationDate: resolveDate(ctx.anchor, SUPPLIER_QUOTE_EXPIRATION_OFFSET),
      currencyCode: "USD",
      exchangeRate: 1,
      externalNotes: RICH(`Quote against ${rfqReadableId}. Prices FOB origin.`)
    });

    // Same two steps as supplier-quote finalize: create the external link, then
    // point the quote at it — that id is what /share/supplier-quote/:id reads.
    // No fixed id — externalLink's PK is global, so a literal collides on the
    // second company to get this dataset. Let the column default mint it.
    const linkId = await insertId(ctx, "externalLink", {
      documentType: "SupplierQuote",
      documentId: quoteId,
      supplierId,
      expiresAt: resolveTimestamp(
        ctx.anchor,
        SUPPLIER_QUOTE_EXPIRATION_OFFSET,
        SUPPLIER_QUOTE_EXPIRATION_TIME_OF_DAY
      )
    });
    await ctx.client.query(
      `UPDATE "supplierQuote" SET "externalLinkId" = $1 WHERE id = $2 AND "companyId" = $3`,
      [linkId, quoteId, ctx.companyId]
    );
    ctx.refs.misc[`sqlink:${spec.key}`] = linkId;

    let quoteLineSort = 1;
    for (const line of spec.lines) {
      const item = need(ctx.refs.items, line.item);
      const quoteLineId = await insertId(ctx, "supplierQuoteLine", {
        supplierQuoteId: quoteId,
        supplierQuoteLineType: "Part",
        itemId: item.id,
        description: item.name,
        supplierPartId: line.supplierPartId,
        quantity: data.rfqQuantityBreaks,
        purchaseUnitOfMeasureCode: "EA",
        inventoryUnitOfMeasureCode: "EA",
        conversionFactor: 1,
        sortOrder: quoteLineSort++
      });

      // A short break list would silently drop a tier from the comparison.
      if (line.breaks.length !== data.rfqQuantityBreaks.length) {
        throw new Error(
          `Seed: ${spec.key}/${line.item} must price every quantity break`
        );
      }

      for (const [index, [unitPrice, leadTime]] of line.breaks.entries()) {
        await insertRow(ctx, "supplierQuoteLinePrice", {
          supplierQuoteId: quoteId,
          supplierQuoteLineId: quoteLineId,
          quantity: data.rfqQuantityBreaks[index],
          supplierUnitPrice: unitPrice,
          leadTime,
          exchangeRate: 1,
          supplierShippingCost: spec.shippingCost,
          supplierTaxAmount: 0
        });
      }
    }

    await insertRow(ctx, "purchasingRfqToSupplierQuote", {
      purchasingRfqId: rfq,
      supplierQuoteId: quoteId
    });
    ctx.refs.documents[`sq:${spec.key}`] = quoteId;

    if (spec.key === data.rfqWinningQuote) winningInteractionId = interactionId;
  }

  // ── Purchase orders converted from the winning quote ──────────────────────
  // The convert edge function reuses the quote's supplier interaction, and a PO
  // with nothing received and nothing invoiced is exactly the state post-receipt
  // and post-purchase-invoice call "To Receive and Invoice".
  const winner = data.rfqQuotes.find((q) => q.key === data.rfqWinningQuote);
  if (!winner) {
    throw new Error(`Seed: unknown winning quote "${data.rfqWinningQuote}"`);
  }
  const orderBreak = data.rfqQuantityBreaks.indexOf(data.rfqOrderQuantity);
  if (orderBreak === -1) {
    throw new Error(`Seed: no quantity break for ${data.rfqOrderQuantity}`);
  }

  for (const spec of data.purchaseOrders) {
    if (spec.source !== "winningQuote") continue;
    ctx.log(spec.log);

    const poReadableId = await nextSequence(ctx, "purchaseOrder");
    const poId = await insertId(ctx, "purchaseOrder", {
      purchaseOrderId: poReadableId,
      purchaseOrderType: spec.purchaseOrderType,
      status: spec.status,
      supplierId: need(ctx.refs.suppliers, winner.supplier),
      supplierContactId: need(ctx.refs.contacts, `sc:${winner.supplier}`),
      supplierReference: winner.supplierReference,
      supplierInteractionId: winningInteractionId,
      currencyCode: spec.currencyCode,
      exchangeRate: spec.exchangeRate,
      orderDate: resolveDate(ctx.anchor, spec.orderDateOffset)
    });
    await insertRow(ctx, "purchaseOrderDelivery", {
      id: poId,
      locationId: plantId,
      shippingMethodId,
      companyId
    });
    await insertRow(ctx, "purchaseOrderPayment", {
      id: poId,
      paymentTermId,
      companyId
    });

    let poLineSort = 1;
    for (const line of winner.lines) {
      const item = need(ctx.refs.items, line.item);
      const orderPrice = line.breaks[orderBreak];
      if (!orderPrice) {
        throw new Error(
          `Seed: ${line.item} has no price at ${data.rfqOrderQuantity}`
        );
      }
      await insertId(ctx, "purchaseOrderLine", {
        purchaseOrderId: poId,
        purchaseOrderLineType: "Part",
        itemId: item.id,
        description: item.name,
        purchaseQuantity: data.rfqOrderQuantity,
        supplierUnitPrice: orderPrice[0],
        supplierShippingCost: winner.shippingCost,
        exchangeRate: 1,
        inventoryUnitOfMeasureCode: "EA",
        purchaseUnitOfMeasureCode: "EA",
        locationId: plantId,
        sortOrder: poLineSort++
      });
    }

    await insertRow(ctx, "purchasingRfqToPurchaseOrder", {
      purchasingRfqId: rfq,
      purchaseOrderId: poId
    });
    ctx.refs.documents[`po:sq-${data.rfqWinningQuote}`] = poId;
  }
}
