import { resolveDate, resolveTimestamp } from "../dates.ts";
import { seedReturnCredit } from "../helpers/return-credit.ts";
import { insertId, insertRow, need, nextSequence, one, RICH } from "../sql.ts";
import type { Ctx } from "../types.ts";

// Supplier quotes come back shortly before the RFQ closes and stay open well
// past it, so the Compare Quotes drawer is never looking at expired prices.
const SUPPLIER_QUOTE_QUOTED_OFFSET = -16;
const SUPPLIER_QUOTE_EXPIRATION_OFFSET = 140;
const SUPPLIER_QUOTE_EXPIRATION_TIME_OF_DAY = "23:59:59";

export async function runTier5(ctx: Ctx): Promise<void> {
  const data = ctx.dataset.purchasing;
  const { companyId, userId, locationId } = ctx;
  const plantId = ctx.refs.locations.Plant ?? locationId;
  const shippingMethodId = need(
    ctx.refs.shippingMethods,
    ctx.dataset.foundation.defaultShippingMethod
  );
  const paymentTermId = ctx.refs.misc.paymentTermId;

  // The status-history trail hangs off the first direct PO whose receipt
  // posted — the one order per dataset with a full approval-to-dock story.
  let historyPoId: string | null = null;
  let historyPoBase: number | null = null;

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
      // exchangeRateUpdatedAt = the order date, as insertPurchaseOrder stamps it.
      currencyCode: spec.currencyCode,
      exchangeRate: spec.exchangeRate,
      exchangeRateUpdatedAt:
        spec.exchangeRate === undefined
          ? undefined
          : resolveTimestamp(ctx.anchor, spec.orderDateOffset, "08:00:00"),
      orderDate: resolveDate(ctx.anchor, spec.orderDateOffset),
      assignee: spec.assignee === "self" ? userId : undefined
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
        exchangeRate: spec.exchangeRate,
        inventoryUnitOfMeasureCode: "EA",
        purchaseUnitOfMeasureCode: "EA",
        locationId: plantId
      });
    }
    if (spec.ref) {
      ctx.refs.documents[spec.ref] = poId;
      // PO lines by (order, item), so an NCR can name its line (tier 07).
      for (const [item, lineId] of Object.entries(lineIdByItem)) {
        ctx.refs.documents[`poline:${spec.ref}:${item}`] = lineId;
      }
    }

    // Draft/Voided are header+lines only; Posted mirrors post-receipt's
    // PO branch: one Purchase Receipt ledger row per line into its toShelf. A
    // batch-tracked line mints its lot as update_receipt_line_batch_tracking does.
    if (spec.receipt) {
      const posted = spec.receipt.status === "Posted";
      if (posted && spec.receipt.postedOffset === undefined) {
        throw new Error(
          `Seed: receipt "${spec.receipt.ref}" is Posted but has no postedOffset`
        );
      }
      const postingDate = posted
        ? resolveDate(ctx.anchor, spec.receipt.postedOffset ?? 0)
        : undefined;
      const receiptReadableId = await nextSequence(ctx, "receipt");
      const receiptId = await insertId(ctx, "receipt", {
        receiptId: receiptReadableId,
        status: spec.receipt.status,
        locationId: plantId,
        sourceDocument: "Purchase Order",
        sourceDocumentId: poId,
        sourceDocumentReadableId: poReadableId,
        supplierId,
        postingDate,
        postedBy: posted ? userId : undefined
      });
      for (const line of spec.receipt.lines) {
        const item = need(ctx.refs.items, line.item);
        const shelfId =
          line.toShelf === undefined
            ? undefined
            : need(ctx.refs.shelves, line.toShelf);
        if (posted && line.receivedQuantity > 0 && shelfId === undefined) {
          throw new Error(
            `Seed: posted receipt "${spec.receipt.ref}" line "${line.item}" has no toShelf`
          );
        }
        const receiptLineId = await insertId(ctx, "receiptLine", {
          receiptId,
          lineId: need(lineIdByItem, line.item),
          itemId: item.id,
          orderQuantity: line.orderQuantity,
          outstandingQuantity: line.outstandingQuantity,
          receivedQuantity: line.receivedQuantity,
          locationId: plantId,
          storageUnitId: shelfId,
          unitOfMeasure: "EA",
          unitPrice: line.unitPrice,
          requiresBatchTracking: line.requiresBatchTracking
        });
        // Receipt lines by (receipt, item) — quality inspects one (tier 07).
        ctx.refs.documents[`rline:${spec.receipt.ref}:${line.item}`] =
          receiptLineId;
        // Supplier certificate received with the goods (mill cert / CofC).
        if (posted && line.receivedQuantity > 0 && line.certificate) {
          await insertRow(ctx, "certificate", {
            companyId,
            type: line.certificate.type,
            certificateNumber: line.certificate.certificateNumber,
            specification: line.certificate.specification ?? null,
            supplierId,
            receiptLineId,
            createdBy: userId
          });
        }
        if (posted && line.receivedQuantity > 0) {
          let trackedEntityId: string | undefined;
          if (line.requiresBatchTracking) {
            if (line.lotNumber === undefined) {
              throw new Error(
                `Seed: posted batch line "${line.item}" on receipt "${spec.receipt.ref}" has no lotNumber`
              );
            }
            trackedEntityId = await insertId(ctx, "trackedEntity", {
              quantity: line.receivedQuantity,
              status: "Available",
              sourceDocument: "Item",
              sourceDocumentId: item.id,
              sourceDocumentReadableId: item.readableId,
              readableId: line.lotNumber,
              itemId: item.id,
              attributes: JSON.stringify({
                "Receipt Line": receiptLineId,
                Receipt: receiptId,
                Supplier: supplierId
              }),
              expirationDate:
                line.lotExpiresOffset === undefined
                  ? undefined
                  : resolveDate(ctx.anchor, line.lotExpiresOffset),
              updatedBy: userId
            });
            ctx.refs.misc[`te:${line.lotNumber}`] = trackedEntityId;
          }
          await insertRow(ctx, "itemLedger", {
            entryType: "Positive Adjmt.",
            documentType: "Purchase Receipt",
            documentId: receiptId,
            itemId: item.id,
            locationId: plantId,
            storageUnitId: shelfId,
            quantity: line.receivedQuantity,
            trackedEntityId,
            postingDate,
            companyId,
            createdBy: userId
          });
        }
      }
      ctx.refs.documents[spec.receipt.ref] = receiptId;

      if (posted && historyPoId === null) {
        historyPoId = poId;
        historyPoBase = spec.orderDateOffset;
      }
    }

    if (spec.invoice) {
      const invoiceReadableId = await nextSequence(ctx, "purchaseInvoice");
      const dateIssued = resolveDate(ctx.anchor, spec.invoice.dateIssuedOffset);
      const invoiceId = await insertId(ctx, "purchaseInvoice", {
        invoiceId: invoiceReadableId,
        status: spec.invoice.status,
        supplierId,
        supplierInteractionId: interactionId,
        currencyCode: spec.invoice.currencyCode,
        paymentTermId,
        subtotal: spec.invoice.subtotal,
        totalAmount: spec.invoice.totalAmount,
        dateIssued,
        // post-purchase-invoice stamps it; the AP aging and open-balance RPCs filter on it.
        postingDate: spec.invoice.status === "Draft" ? undefined : dateIssued,
        dateDue:
          spec.invoice.dueDateOffset === undefined
            ? undefined
            : resolveDate(ctx.anchor, spec.invoice.dueDateOffset)
      });
      // Payments settle Paid / Partially Paid invoices by this key.
      if (spec.invoice.key !== undefined) {
        ctx.refs.misc[`pinv:${spec.invoice.key}`] = invoiceId;
      }
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
          purchaseOrderLineId: need(lineIdByItem, line.item),
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
    assignee: data.rfqHeader.assignee === "self" ? userId : undefined,
    locationId: plantId,
    rfqDate: resolveDate(ctx.anchor, data.rfqHeader.rfqDateOffset),
    // The KPI chart and list sort on createdAt; a seed-time stamp is one spike.
    createdAt: resolveTimestamp(
      ctx.anchor,
      data.rfqHeader.rfqDateOffset,
      "09:00:00"
    ),
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
    const quoteStatus = spec.status ?? "Active";
    ctx.log(`supplier quote — ${spec.supplier} (${quoteStatus})`);
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
      status: quoteStatus,
      supplierId,
      supplierContactId: need(ctx.refs.contacts, `sc:${spec.supplier}`),
      supplierLocationId: need(ctx.refs.misc, `sloc:${spec.supplier}`),
      supplierReference: spec.supplierReference,
      supplierInteractionId: interactionId,
      assignee: spec.assignee === "self" ? userId : undefined,
      quotedDate: resolveDate(ctx.anchor, SUPPLIER_QUOTE_QUOTED_OFFSET),
      createdAt: resolveTimestamp(
        ctx.anchor,
        SUPPLIER_QUOTE_QUOTED_OFFSET,
        "10:00:00"
      ),
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

  // Same shape as a quote created from the supplier screen. No externalLink —
  // only finalize mints one, and none of these were finalized.
  for (const spec of data.standaloneSupplierQuotes) {
    ctx.log(`supplier quote — ${spec.supplier} (${spec.status}, standalone)`);
    const supplierId = need(ctx.refs.suppliers, spec.supplier);
    const interactionId = await insertId(ctx, "supplierInteraction", {
      supplierId
    });
    const quoteReadableId = await nextSequence(ctx, "supplierQuote");
    const quoteId = await insertId(ctx, "supplierQuote", {
      supplierQuoteId: quoteReadableId,
      supplierQuoteType: "Purchase",
      status: spec.status,
      supplierId,
      supplierContactId: need(ctx.refs.contacts, `sc:${spec.supplier}`),
      supplierLocationId: need(ctx.refs.misc, `sloc:${spec.supplier}`),
      supplierReference: spec.supplierReference,
      supplierInteractionId: interactionId,
      assignee: spec.assignee === "self" ? userId : undefined,
      quotedDate: resolveDate(ctx.anchor, spec.quotedOffset),
      createdAt: resolveTimestamp(ctx.anchor, spec.quotedOffset, "10:00:00"),
      expirationDate: resolveDate(ctx.anchor, spec.expirationOffset),
      currencyCode: "USD",
      exchangeRate: 1
    });

    let quoteLineSort = 1;
    for (const line of spec.lines) {
      const item = need(ctx.refs.items, line.item);
      const quoteLineId = await insertId(ctx, "supplierQuoteLine", {
        supplierQuoteId: quoteId,
        supplierQuoteLineType: "Part",
        itemId: item.id,
        description: item.name,
        supplierPartId: line.supplierPartId,
        quantity: line.prices.map((price) => price.quantity),
        purchaseUnitOfMeasureCode: "EA",
        inventoryUnitOfMeasureCode: "EA",
        conversionFactor: 1,
        sortOrder: quoteLineSort++
      });
      for (const price of line.prices) {
        await insertRow(ctx, "supplierQuoteLinePrice", {
          supplierQuoteId: quoteId,
          supplierQuoteLineId: quoteLineId,
          quantity: price.quantity,
          supplierUnitPrice: price.unitPrice,
          leadTime: price.leadTime,
          exchangeRate: 1,
          supplierShippingCost: 0,
          supplierTaxAmount: 0
        });
      }
    }
    ctx.refs.documents[`sq:${spec.key}`] = quoteId;
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

  // Lines + suppliers only; neither was ever sent. Cancel clears the assignee.
  for (const spec of data.lifecycleRfqs) {
    ctx.log(`purchasing RFQ — ${spec.status}`);
    const lifecycleRfq = await insertId(ctx, "purchasingRfq", {
      rfqId: await nextSequence(ctx, "purchasingRfq"),
      status: spec.status,
      employeeId: ctx.userId,
      assignee: spec.status === "Draft" ? ctx.userId : null,
      locationId: plantId,
      rfqDate: resolveDate(ctx.anchor, spec.rfqDateOffset),
      createdAt: resolveTimestamp(ctx.anchor, spec.rfqDateOffset, "09:00:00"),
      expirationDate: resolveDate(ctx.anchor, spec.expirationOffset),
      notes: RICH(spec.notes),
      internalNotes: RICH(spec.internalNotes)
    });
    ctx.refs.documents[spec.ref] = lifecycleRfq;
    let order = 1;
    for (const line of spec.lines) {
      await insertId(ctx, "purchasingRfqLine", {
        purchasingRfqId: lifecycleRfq,
        itemId: need(ctx.refs.items, line.item).id,
        description: line.description,
        quantity: spec.quantities,
        purchaseUnitOfMeasureCode: "EA",
        inventoryUnitOfMeasureCode: "EA",
        conversionFactor: 1,
        order: order++
      });
    }
    for (const supplier of spec.suppliers) {
      await insertId(ctx, "purchasingRfqSupplier", {
        purchasingRfqId: lifecycleRfq,
        supplierId: need(ctx.refs.suppliers, supplier)
      });
    }
  }

  // Completed mirrors post-shipment's Purchase Return Order branch: a Posted
  // shipment plus one ledger row per line out of its fromShelf.
  if (data.purchaseReturns.length > 0) {
    ctx.log("purchase returns");
    for (const spec of data.purchaseReturns) {
      ctx.log(`  return ${spec.key} — ${spec.status}`);
      const supplierId = need(ctx.refs.suppliers, spec.supplier);
      const completed = spec.status === "Completed";
      const orderDate = resolveDate(ctx.anchor, spec.dateOffset);
      const returnReadableId = await nextSequence(ctx, "purchaseReturnOrder");
      const returnId = await insertId(ctx, "purchaseReturnOrder", {
        purchaseReturnOrderId: returnReadableId,
        status: spec.status,
        supplierId,
        locationId: plantId,
        currencyCode: "USD",
        orderDate
      });

      const lineIds: string[] = [];
      for (const [index, line] of spec.lines.entries()) {
        const item = need(ctx.refs.items, line.item);
        const lineId = await insertId(ctx, "purchaseReturnOrderLine", {
          purchaseReturnOrderId: returnId,
          itemId: item.id,
          lineNumber: index + 1,
          quantity: line.quantity,
          quantityShipped: completed ? line.quantity : 0,
          unitOfMeasureCode: "EA",
          unitPrice: line.unitPrice
        });
        lineIds.push(lineId);
        ctx.refs.documents[`pretline:${spec.key}:${index + 1}`] = lineId;
      }

      if (completed) {
        const shipmentReadableId = await nextSequence(ctx, "shipment");
        const shipmentId = await insertId(ctx, "shipment", {
          shipmentId: shipmentReadableId,
          status: "Posted",
          locationId: plantId,
          sourceDocument: "Purchase Return Order",
          sourceDocumentId: returnId,
          sourceDocumentReadableId: returnReadableId,
          shippingMethodId,
          supplierId,
          postingDate: orderDate,
          postedBy: userId
        });
        for (const [index, line] of spec.lines.entries()) {
          const item = need(ctx.refs.items, line.item);
          if (line.fromShelf === undefined) {
            throw new Error(
              `Seed: completed return "${spec.key}" line "${line.item}" has no fromShelf`
            );
          }
          const shelfId = need(ctx.refs.shelves, line.fromShelf);
          await insertId(ctx, "shipmentLine", {
            shipmentId,
            lineId: lineIds[index],
            itemId: item.id,
            orderQuantity: line.quantity,
            outstandingQuantity: 0,
            shippedQuantity: line.quantity,
            locationId: plantId,
            storageUnitId: shelfId,
            unitOfMeasure: "EA",
            unitPrice: line.unitPrice
          });
          await insertRow(ctx, "itemLedger", {
            entryType: "Negative Adjmt.",
            documentType: "Purchase Return Shipment",
            documentId: shipmentId,
            itemId: item.id,
            locationId: plantId,
            storageUnitId: shelfId,
            quantity: -line.quantity,
            postingDate: orderDate,
            companyId,
            createdBy: userId
          });
        }
        ctx.refs.documents[`pret-shipment:${spec.key}`] = shipmentId;
      }

      if (spec.credit) {
        ctx.log(`  return ${spec.key} — debit memo (${spec.credit.status})`);
        await seedReturnCredit(ctx, {
          spec: spec.credit,
          kind: "purchase",
          partyId: supplierId,
          returnOrderId: returnId
        });
      }

      ctx.refs.documents[`pret:${spec.key}`] = returnId;
    }
  }

  await seedApprovals(ctx);

  for (const spec of data.supplierBankAccounts) {
    await insertRow(ctx, "supplierBankAccount", {
      supplierId: need(ctx.refs.suppliers, spec.supplier, "supplier"),
      name: spec.name,
      accountHolderName: spec.accountHolderName,
      bankName: spec.bankName,
      countryCode: spec.countryCode,
      currencyCode: spec.currencyCode,
      accountNumber: spec.accountNumber,
      bankCode: spec.bankCode,
      swiftBic: spec.swiftBic,
      isPrimary: spec.isPrimary,
      active: true
    });
  }

  // Timestamps are staggered so the timeline reads as a real trail.
  if (historyPoId !== null && historyPoBase !== null) {
    ctx.log("purchase order status history");
    const trail: Array<[string, number, string]> = [
      ["Draft", historyPoBase, "08:52:00"],
      ["To Review", historyPoBase + 1, "14:18:00"],
      ["To Receive", historyPoBase + 3, "09:37:00"]
    ];
    for (const [status, offset, timeOfDay] of trail) {
      await insertRow(ctx, "purchaseOrderStatusHistory", {
        purchaseOrderId: historyPoId,
        status,
        createdAt: resolveTimestamp(ctx.anchor, offset, timeOfDay)
      });
    }
  }
}

// Pending requests in the shape PO finalize and supplier "Request approval" leave;
// "Needs my approval", the PO banner and the supplier Approval tab read them.
async function seedApprovals(ctx: Ctx): Promise<void> {
  const data = ctx.dataset.purchasing;
  ctx.log("approval rules + requests");
  const admin = await one<{ id: string }>(
    ctx.client,
    `SELECT g.id FROM "group" g
     JOIN "employeeType" et ON et.id = g.id AND et."companyId" = g."companyId"
     WHERE g."companyId" = $1 AND g."isEmployeeTypeGroup" AND et."systemType" = 'Admin'
     ORDER BY et."createdAt" LIMIT 1`,
    [ctx.companyId]
  );
  for (const rule of data.approvalRules) {
    await insertRow(ctx, "approvalRule", {
      documentType: rule.documentType,
      enabled: true,
      approverGroupIds: [admin.id],
      defaultApproverId: ctx.userId,
      lowerBoundAmount: rule.lowerBoundAmount,
      escalationDays: rule.escalationDays
    });
  }

  for (const request of data.approvalRequests) {
    const requestedAt = resolveTimestamp(
      ctx.anchor,
      request.requestedOffset,
      "15:00:00"
    );
    if ("purchaseOrder" in request) {
      const purchaseOrderId = need(
        ctx.refs.documents,
        request.purchaseOrder,
        "purchase order"
      );
      const order = await one<{ orderTotal: string }>(
        ctx.client,
        `SELECT "orderTotal" FROM "purchaseOrders" WHERE id = $1 AND "companyId" = $2`,
        [purchaseOrderId, ctx.companyId]
      );
      await insertRow(ctx, "approvalRequest", {
        documentType: "purchaseOrder",
        documentId: purchaseOrderId,
        status: "Pending",
        amount: order.orderTotal,
        requestedBy: ctx.userId,
        requestedAt,
        createdAt: requestedAt
      });
    } else {
      await insertRow(ctx, "approvalRequest", {
        documentType: "supplier",
        documentId: need(ctx.refs.suppliers, request.supplier, "supplier"),
        status: "Pending",
        requestedBy: ctx.userId,
        requestedAt,
        createdAt: requestedAt
      });
    }
  }
}
