import { resolveDate } from "../dates.ts";
import { insertId, insertRow, need, nextSequence, RICH } from "../sql.ts";
import type { Ctx, PriceBreak, SalesOpportunitySpec } from "../types.ts";

async function insertPriceBreaks(
  ctx: Ctx,
  quoteId: string,
  quoteLineId: string,
  breaks: readonly PriceBreak[]
): Promise<void> {
  for (const brk of breaks) {
    await insertRow(ctx, "quoteLinePrice", {
      quoteId,
      quoteLineId,
      quantity: brk.quantity,
      unitPrice: brk.unitPrice,
      leadTime: brk.leadTime,
      discountPercent: brk.discountPercent ?? 0,
      shippingCost: brk.shippingCost ?? 0,
      exchangeRate: 1,
      priceSource: "system"
    });
  }
}

export async function runTier4(ctx: Ctx): Promise<void> {
  const data = ctx.dataset.sales;
  const { companyId, userId, locationId } = ctx;
  const plantId = ctx.refs.locations.Plant ?? locationId;
  const paymentTermId = ctx.refs.misc.paymentTermId;
  const shippingMethodId = need(
    ctx.refs.shippingMethods,
    ctx.dataset.foundation.defaultShippingMethod,
    "shipping method"
  );

  // companySettings has no companyId column, so the wipe preserves it — the row
  // already exists and only needs the digital-quote flags flipped on. Without
  // digitalQuoteEnabled the public quote page renders no Accept/Reject buttons,
  // and without digitalQuoteIncludesPurchaseOrders the PO-upload field is gone.
  ctx.log("company settings — digital quotes enabled");
  await insertRow(
    ctx,
    "companySettings",
    {
      id: companyId,
      digitalQuoteEnabled: true,
      digitalQuoteIncludesPurchaseOrders: true
    },
    {
      onConflict:
        '("id") DO UPDATE SET "digitalQuoteEnabled" = true, "digitalQuoteIncludesPurchaseOrders" = true'
    }
  );

  // One opportunity and whichever of rfq → quote → order → shipment → invoice
  // the spec carries, in that order — each document links back to the ones above.
  async function insertOpportunity(spec: SalesOpportunitySpec): Promise<void> {
    ctx.log(spec.log);
    const customerId = need(ctx.refs.customers, spec.customer);
    const customerLocationId = ctx.refs.misc[`cloc:${spec.customer}`] ?? null;

    const opportunityId = await insertId(ctx, "opportunity", { customerId });
    ctx.refs.documents[spec.ref] = opportunityId;

    if (spec.rfq) {
      const rfqReadableId = await nextSequence(ctx, "salesRfq");
      const rfqId = await insertId(ctx, "salesRfq", {
        rfqId: rfqReadableId,
        status: spec.rfq.status,
        customerId,
        customerLocationId,
        locationId: plantId,
        opportunityId,
        rfqDate: resolveDate(ctx.anchor, spec.rfq.rfqDateOffset),
        expirationDate:
          spec.rfq.expirationOffset === undefined
            ? undefined
            : resolveDate(ctx.anchor, spec.rfq.expirationOffset),
        externalNotes: RICH(spec.rfq.externalNotes)
      });
      for (const line of spec.rfq.lines) {
        const item = need(ctx.refs.items, line.item);
        await insertId(ctx, "salesRfqLine", {
          salesRfqId: rfqId,
          itemId: item.id,
          description: item.name,
          unitOfMeasureCode: "EA",
          customerPartId: line.customerPartId,
          quantity: line.quantity,
          order: line.order
        });
      }
      ctx.refs.documents[spec.rfq.ref] = rfqId;
    }

    if (spec.quote) {
      const quoteReadableId = await nextSequence(ctx, "quote");
      const quoteId = await insertId(ctx, "quote", {
        quoteId: quoteReadableId,
        status: spec.quote.status,
        customerId,
        customerLocationId,
        locationId: plantId,
        currencyCode: "USD",
        opportunityId,
        expirationDate:
          spec.quote.expirationOffset === undefined
            ? undefined
            : resolveDate(ctx.anchor, spec.quote.expirationOffset),
        externalNotes: spec.quote.externalNotes
          ? RICH(spec.quote.externalNotes)
          : undefined
      });
      // quotePayment and quoteShipment — id = quote.id
      await insertRow(ctx, "quotePayment", {
        id: quoteId,
        paymentTermId,
        companyId
      });
      await insertRow(ctx, "quoteShipment", {
        id: quoteId,
        locationId: plantId,
        shippingMethodId,
        companyId
      });

      for (const line of spec.quote.lines) {
        const item = need(ctx.refs.items, line.item);
        const quoteLineId = await insertId(ctx, "quoteLine", {
          quoteId,
          itemId: item.id,
          itemType: "Part",
          description: item.name,
          methodType: "Make to Order",
          unitOfMeasureCode: "EA",
          // The public page filters price rows against the line's own quantity
          // array, so a break that isn't in quoteLine.quantity is invisible.
          quantity: line.priceBreaks.map((brk) => brk.quantity),
          status: line.status,
          sortOrder: line.sortOrder
        });
        await insertPriceBreaks(ctx, quoteId, quoteLineId, line.priceBreaks);
        ctx.refs.documents[line.ref] = quoteLineId;
      }

      // The external link is what /share/quote/:id resolves against. It has to be
      // created after the quote (it stores the quote's id) and pointed back at it,
      // which is the same two-step upsertExternalLink does when a quote is created.
      if (spec.quote.externalLink) {
        // No fixed id — externalLink's PK is global, so a literal collides on
        // the second company to get this dataset. Let the column default mint it.
        const linkId = await insertId(ctx, "externalLink", {
          documentType: "Quote",
          documentId: quoteId,
          customerId,
          expiresAt: resolveDate(
            ctx.anchor,
            spec.quote.externalLink.expiresOffset
          )
        });
        await ctx.client.query(
          `UPDATE "quote" SET "externalLinkId" = $1 WHERE id = $2 AND "companyId" = $3`,
          [linkId, quoteId, companyId]
        );
        ctx.refs.documents[spec.quote.externalLink.ref] = linkId;
      }

      ctx.refs.documents[spec.quote.ref] = quoteId;
    }

    // A shipment/invoice line points at the order line for the same item.
    let orderId: string | null = null;
    let orderReadableId: string | null = null;
    const orderLineIdByItem: Record<string, string> = {};

    if (spec.order) {
      orderReadableId = await nextSequence(ctx, "salesOrder");
      orderId = await insertId(ctx, "salesOrder", {
        salesOrderId: orderReadableId,
        status: spec.order.status,
        customerId,
        customerLocationId,
        locationId: plantId,
        currencyCode: "USD",
        opportunityId,
        orderDate: resolveDate(ctx.anchor, spec.order.orderDateOffset)
      });
      await insertRow(ctx, "salesOrderPayment", {
        id: orderId,
        paymentTermId,
        companyId
      });
      await insertRow(ctx, "salesOrderShipment", {
        id: orderId,
        locationId: plantId,
        shippingMethodId,
        customerId,
        customerLocationId,
        companyId
      });

      for (const line of spec.order.lines) {
        const promisedDate =
          line.promisedDateOffset === undefined
            ? undefined
            : resolveDate(ctx.anchor, line.promisedDateOffset);
        if (line.log) {
          ctx.log(
            promisedDate ? `${line.log} — promised ${promisedDate}` : line.log
          );
        }
        const item = need(ctx.refs.items, line.item);
        const lineId = await insertId(ctx, "salesOrderLine", {
          salesOrderId: orderId,
          salesOrderLineType: "Part",
          itemId: item.id,
          description: item.name,
          saleQuantity: line.saleQuantity,
          unitPrice: line.unitPrice,
          unitOfMeasureCode: "EA",
          locationId: plantId,
          methodType: "Make to Order",
          status: line.status,
          promisedDate,
          sortOrder: line.sortOrder
        });
        orderLineIdByItem[line.item] = lineId;
        ctx.refs.documents[line.ref] = lineId;
      }
      ctx.refs.documents[spec.order.ref] = orderId;
    }

    // Shipment (Draft — Posted shipments need the edge function)
    let shipmentId: string | null = null;
    if (spec.shipment) {
      if (!orderId || !orderReadableId) {
        throw new Error(`Seed: shipment on "${spec.ref}" has no sales order`);
      }
      const shipmentReadableId = await nextSequence(ctx, "shipment");
      shipmentId = await insertId(ctx, "shipment", {
        shipmentId: shipmentReadableId,
        status: spec.shipment.status,
        locationId: plantId,
        sourceDocument: "Sales Order",
        sourceDocumentId: orderId,
        sourceDocumentReadableId: orderReadableId,
        shippingMethodId,
        customerId,
        opportunityId
      });
      for (const line of spec.shipment.lines) {
        const item = need(ctx.refs.items, line.item);
        await insertId(ctx, "shipmentLine", {
          shipmentId,
          lineId: need(orderLineIdByItem, line.item),
          itemId: item.id,
          orderQuantity: line.orderQuantity,
          outstandingQuantity: line.outstandingQuantity,
          shippedQuantity: line.shippedQuantity,
          locationId: plantId,
          unitOfMeasure: "EA",
          unitPrice: line.unitPrice
        });
      }
      ctx.refs.documents[spec.shipment.ref] = shipmentId;
    }

    if (spec.invoice) {
      const invoiceReadableId = await nextSequence(ctx, "salesInvoice");
      const invoiceId = await insertId(ctx, "salesInvoice", {
        invoiceId: invoiceReadableId,
        status: spec.invoice.status,
        customerId,
        currencyCode: "USD",
        locationId: plantId,
        opportunityId,
        paymentTermId,
        subtotal: spec.invoice.subtotal,
        totalAmount: spec.invoice.totalAmount,
        invoiceCustomerId: customerId,
        shipmentId: shipmentId ?? undefined,
        dateIssued: resolveDate(ctx.anchor, spec.invoice.dateIssuedOffset)
      });
      // salesInvoiceShipment — id = invoice.id (INNER JOINed by the salesInvoices view)
      await insertRow(ctx, "salesInvoiceShipment", {
        id: invoiceId,
        shippingMethodId,
        locationId: plantId,
        companyId,
        createdBy: userId
      });
      for (const line of spec.invoice.lines) {
        const item = need(ctx.refs.items, line.item);
        await insertId(ctx, "salesInvoiceLine", {
          invoiceId,
          invoiceLineType: "Part",
          itemId: item.id,
          description: item.name,
          quantity: line.quantity,
          unitOfMeasureCode: "EA",
          unitPrice: line.unitPrice,
          opportunityId,
          salesOrderId: orderId ?? undefined,
          salesOrderLineId: need(orderLineIdByItem, line.item)
        });
      }
      ctx.refs.documents[spec.invoice.ref] = invoiceId;
    }
  }

  for (const spec of data.opportunities) {
    await insertOpportunity(spec);
  }

  // ── One order per remaining job status ────────────────────────────────────
  for (const spec of data.statusOrders) {
    ctx.log(`sales order — ${spec.status} (job ${spec.key})`);
    const customerId = need(ctx.refs.customers, spec.customer);
    const customerLocationId = ctx.refs.misc[`cloc:${spec.customer}`] ?? null;
    const item = need(ctx.refs.items, spec.item);
    const oppId = await insertId(ctx, "opportunity", { customerId });
    const readableId = await nextSequence(ctx, "salesOrder");
    const soId = await insertId(ctx, "salesOrder", {
      salesOrderId: readableId,
      status: spec.status,
      customerId,
      customerLocationId,
      locationId: plantId,
      currencyCode: "USD",
      opportunityId: oppId,
      orderDate: resolveDate(ctx.anchor, spec.orderDateOffset)
    });
    await insertRow(ctx, "salesOrderPayment", {
      id: soId,
      paymentTermId,
      companyId
    });
    await insertRow(ctx, "salesOrderShipment", {
      id: soId,
      locationId: plantId,
      shippingMethodId,
      customerId,
      customerLocationId,
      companyId
    });
    const lineId = await insertId(ctx, "salesOrderLine", {
      salesOrderId: soId,
      salesOrderLineType: "Part",
      itemId: item.id,
      description: item.name,
      saleQuantity: 1,
      unitPrice: spec.unitPrice,
      unitOfMeasureCode: "EA",
      locationId: plantId,
      methodType: "Make to Order",
      status: spec.lineStatus
    });
    ctx.refs.documents[`so:${spec.key}`] = soId;
    ctx.refs.documents[`soline:${spec.key}`] = lineId;
    ctx.refs.documents[`opp:${spec.key}`] = oppId;
  }

  // ── Released orders — written after the status orders ─────────────────────
  for (const spec of data.releasedOrders) {
    await insertOpportunity(spec);
  }
}
