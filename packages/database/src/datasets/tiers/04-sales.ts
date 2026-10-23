// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { parseDate } from "@internationalized/date";
import {
  applyContractMovement,
  EMPTY_POSITION
} from "../../contract-position.ts";
import {
  monthStart,
  planRevenueSchedule,
  revenueTotals
} from "../../contract-revenue-schedule.ts";
import {
  type ContractLineTerms,
  type ContractTerms,
  horizon,
  planInvoiceSchedule
} from "../../contract-schedule.ts";
import { round } from "../../precision.ts";
import {
  resolveDate,
  resolveLocalTimestamp,
  resolveTimestamp,
  workdayBefore
} from "../dates.ts";
import { bootstrapIdByName } from "../helpers/bootstrap-lookup.ts";
import { copyMethodToQuoteLine } from "../helpers/method-copy.ts";
import { seedReturnCredit } from "../helpers/return-credit.ts";
import { insertId, insertRow, need, nextSequence, RICH } from "../sql.ts";
import type {
  Ctx,
  PriceBreak,
  SalesOpportunitySpec,
  SalesReturnLineSpec,
  ServiceJobSpec
} from "../types.ts";

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
  // The service labor item is the default every new service job time entry
  // names (tier 02 created it).
  ctx.log("company settings — digital quotes enabled, service labor item");
  await insertRow(
    ctx,
    "companySettings",
    {
      id: companyId,
      digitalQuoteEnabled: true,
      digitalQuoteIncludesPurchaseOrders: true,
      serviceLaborItemId: need(
        ctx.refs.items,
        data.serviceLaborItem,
        "service labor item"
      ).id
    },
    {
      onConflict:
        '("id") DO UPDATE SET "digitalQuoteEnabled" = true, "digitalQuoteIncludesPurchaseOrders" = true, "serviceLaborItemId" = EXCLUDED."serviceLaborItemId"'
    }
  );

  // One opportunity and whichever of rfq → quote → order → shipment → invoice
  // the spec carries, in that order — each document links back to the ones above.
  async function insertOpportunity(spec: SalesOpportunitySpec): Promise<void> {
    ctx.log(spec.log);
    const customerId = need(ctx.refs.customers, spec.customer);
    const customerLocationId = need(
      ctx.refs.misc,
      `cloc:${spec.customer}`,
      "customer location"
    );

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
        // The no-quote reason lives on the RFQ, as updateSalesRFQStatus writes it.
        noQuoteReasonId:
          spec.rfq.noQuoteReason === undefined
            ? undefined
            : need(
                ctx.refs.misc,
                `nqr:${spec.rfq.noQuoteReason}`,
                "no-quote reason"
              ),
        rfqDate: resolveDate(ctx.anchor, spec.rfq.rfqDateOffset),
        // The KPI chart counts RFQs by createdAt; a seed-time stamp is one spike.
        createdAt: resolveTimestamp(
          ctx.anchor,
          spec.rfq.rfqDateOffset,
          "09:00:00"
        ),
        assignee: spec.rfq.assignee === "self" ? ctx.userId : undefined,
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
        createdAt:
          spec.quote.createdOffset === undefined
            ? undefined
            : resolveTimestamp(
                ctx.anchor,
                spec.quote.createdOffset,
                "09:30:00"
              ),
        assignee: spec.quote.assignee === "self" ? ctx.userId : undefined,
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
          sortOrder: line.sortOrder,
          configuration:
            line.configuration === undefined
              ? undefined
              : JSON.stringify(line.configuration)
        });
        await insertPriceBreaks(ctx, quoteId, quoteLineId, line.priceBreaks);
        await copyMethodToQuoteLine(ctx, quoteId, quoteLineId);
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
        orderDate: resolveDate(ctx.anchor, spec.order.orderDateOffset),
        assignee: spec.order.assignee === "self" ? ctx.userId : undefined
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

    // Draft/Voided are header+lines only; Posted mirrors post-shipment's
    // untracked branch: one Sales Shipment ledger row per line out of its fromShelf.
    let shipmentId: string | null = null;
    if (spec.shipment) {
      if (!orderId || !orderReadableId) {
        throw new Error(`Seed: shipment on "${spec.ref}" has no sales order`);
      }
      const posted = spec.shipment.status === "Posted";
      if (posted && spec.shipment.postedOffset === undefined) {
        throw new Error(
          `Seed: shipment "${spec.shipment.ref}" is Posted but has no postedOffset`
        );
      }
      const postingDate = posted
        ? resolveDate(ctx.anchor, spec.shipment.postedOffset ?? 0)
        : undefined;
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
        opportunityId,
        postingDate,
        postedBy: posted ? userId : undefined
      });
      for (const line of spec.shipment.lines) {
        const item = need(ctx.refs.items, line.item);
        const shelfId =
          line.fromShelf === undefined
            ? undefined
            : need(ctx.refs.shelves, line.fromShelf);
        if (posted && line.shippedQuantity > 0 && shelfId === undefined) {
          throw new Error(
            `Seed: posted shipment "${spec.shipment.ref}" line "${line.item}" has no fromShelf`
          );
        }
        await insertId(ctx, "shipmentLine", {
          shipmentId,
          lineId: need(orderLineIdByItem, line.item),
          itemId: item.id,
          orderQuantity: line.orderQuantity,
          outstandingQuantity: line.outstandingQuantity,
          shippedQuantity: line.shippedQuantity,
          locationId: plantId,
          storageUnitId: shelfId,
          unitOfMeasure: "EA",
          unitPrice: line.unitPrice
        });
        if (posted && line.shippedQuantity > 0) {
          await insertRow(ctx, "itemLedger", {
            entryType: "Negative Adjmt.",
            documentType: "Sales Shipment",
            documentId: shipmentId,
            itemId: item.id,
            locationId: plantId,
            storageUnitId: shelfId,
            quantity: -line.shippedQuantity,
            postingDate,
            companyId,
            createdBy: userId
          });
        }
      }
      ctx.refs.documents[spec.shipment.ref] = shipmentId;
    }

    if (spec.invoice) {
      const invoiceReadableId = await nextSequence(ctx, "salesInvoice");
      const dateIssued = resolveDate(ctx.anchor, spec.invoice.dateIssuedOffset);
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
        dateIssued,
        // post-sales-invoice stamps it; the AR aging and open-balance RPCs filter on it.
        postingDate: spec.invoice.status === "Draft" ? undefined : dateIssued,
        dateDue:
          spec.invoice.dueDateOffset === undefined
            ? undefined
            : resolveDate(ctx.anchor, spec.invoice.dueDateOffset)
      });
      // Payments settle Paid / Partially Paid invoices by this key.
      if (spec.invoice.key !== undefined) {
        ctx.refs.misc[`sinv:${spec.invoice.key}`] = invoiceId;
      }
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
    const customerLocationId = need(
      ctx.refs.misc,
      `cloc:${spec.customer}`,
      "customer location"
    );
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

  // Before the returns: a Service or Warranty line names its asset.
  await seedCustomerAssets(ctx);

  // In Progress and Completed mirror post-receipt's Sales Return Order branch:
  // a Posted receipt plus a Sales Return Receipt ledger row per Return to Stock
  // line. A Service or Warranty line enters no stock (receipt-service-return.ts):
  // no ledger row, its asset goes At Depot, and seedServiceJobs creates its job.
  // A `credit` adds Issue Credit's memo (helpers/return-credit.ts); tier 09
  // journals it if Posted.
  if (data.salesReturns.length > 0) {
    ctx.log("sales returns");
    for (const spec of data.salesReturns) {
      ctx.log(`  rma ${spec.key} — ${spec.status}`);
      const customerId = need(ctx.refs.customers, spec.customer);
      const customerLocationId = need(
        ctx.refs.misc,
        `cloc:${spec.customer}`,
        "customer location"
      );
      const returnReasonId = await bootstrapIdByName(
        ctx,
        "returnReason",
        spec.returnReason
      );
      const received =
        spec.status === "Completed" || spec.status === "In Progress";
      const orderDate = resolveDate(ctx.anchor, spec.dateOffset);
      const rmaReadableId = await nextSequence(ctx, "salesReturnOrder");
      const rmaId = await insertId(ctx, "salesReturnOrder", {
        salesReturnOrderId: rmaReadableId,
        status: spec.status,
        customerId,
        customerLocationId,
        locationId: plantId,
        currencyCode: "USD",
        orderDate,
        salesOrderId:
          spec.salesOrder === undefined
            ? undefined
            : need(ctx.refs.documents, spec.salesOrder, "sales order ref")
      });

      const lineIds: string[] = [];
      for (const [index, line] of spec.lines.entries()) {
        const item = need(ctx.refs.items, line.item);
        const lineId = await insertId(ctx, "salesReturnOrderLine", {
          salesReturnOrderId: rmaId,
          itemId: item.id,
          lineNumber: index + 1,
          quantity: line.quantity,
          quantityReceived: received ? line.quantity : 0,
          returnReasonId,
          unitOfMeasureCode: "EA",
          unitPrice: line.unitPrice,
          returnType: line.returnType,
          customerAssetId:
            line.asset === undefined
              ? undefined
              : need(ctx.refs.misc, `asset:${line.asset}`, "customer asset"),
          problem: line.problem
        });
        lineIds.push(lineId);
        ctx.refs.documents[`rmaline:${spec.key}:${index + 1}`] = lineId;
      }

      if (received) {
        const receiptReadableId = await nextSequence(ctx, "receipt");
        const receiptId = await insertId(ctx, "receipt", {
          receiptId: receiptReadableId,
          status: "Posted",
          locationId: plantId,
          sourceDocument: "Sales Return Order",
          sourceDocumentId: rmaId,
          sourceDocumentReadableId: rmaReadableId,
          postingDate: orderDate,
          postedBy: userId
        });
        for (const [index, line] of spec.lines.entries()) {
          const item = need(ctx.refs.items, line.item);
          if (isServiceLine(line)) {
            await insertId(ctx, "receiptLine", {
              receiptId,
              lineId: lineIds[index],
              itemId: item.id,
              orderQuantity: line.quantity,
              outstandingQuantity: 0,
              receivedQuantity: line.quantity,
              locationId: plantId,
              unitOfMeasure: "EA",
              unitPrice: line.unitPrice
            });
            if (line.asset !== undefined) {
              await ctx.client.query(
                `UPDATE "customerAsset" SET status = 'At Depot'
                 WHERE id = $1 AND "companyId" = $2`,
                [need(ctx.refs.misc, `asset:${line.asset}`), companyId]
              );
            }
            continue;
          }
          if (line.toShelf === undefined) {
            throw new Error(
              `Seed: received return "${spec.key}" line "${line.item}" has no toShelf`
            );
          }
          const shelfId = need(ctx.refs.shelves, line.toShelf);
          await insertId(ctx, "receiptLine", {
            receiptId,
            lineId: lineIds[index],
            itemId: item.id,
            orderQuantity: line.quantity,
            outstandingQuantity: 0,
            receivedQuantity: line.quantity,
            locationId: plantId,
            storageUnitId: shelfId,
            unitOfMeasure: "EA",
            unitPrice: line.unitPrice
          });
          await insertRow(ctx, "itemLedger", {
            entryType: "Positive Adjmt.",
            documentType: "Sales Return Receipt",
            documentId: receiptId,
            itemId: item.id,
            locationId: plantId,
            storageUnitId: shelfId,
            quantity: line.quantity,
            postingDate: orderDate,
            companyId,
            createdBy: userId
          });
        }
        ctx.refs.documents[`rma-receipt:${spec.key}`] = receiptId;
        ctx.refs.misc[`rma-receipt-readable:${spec.key}`] = receiptReadableId;
      }

      if (spec.credit) {
        ctx.log(`  rma ${spec.key} — credit memo (${spec.credit.status})`);
        await seedReturnCredit(ctx, {
          spec: spec.credit,
          kind: "sales",
          partyId: customerId,
          returnOrderId: rmaId
        });
      }

      ctx.refs.documents[`rma:${spec.key}`] = rmaId;
    }
  }

  // Contracts: Active and confirmed, as Confirm leaves one. The schedule comes
  // from the shared planner through its horizon; every invoice dated on or
  // before today is Billed Externally and billedThrough is the last such row's
  // period end, so no drafted invoice exists for tier 09 to journal. Like a
  // migrated contract, revenue is recognized externally before this month
  // (recognizeRevenueFrom) and each line opens with the billed-but-unrecognized
  // difference, as Confirm writes it.
  if (data.contracts.length > 0) {
    ctx.log("customer contracts");
    const today = ctx.anchor.toString();
    for (const spec of data.contracts) {
      ctx.log(`  contract ${spec.key}`);
      const customerId = need(ctx.refs.customers, spec.customer);
      const startDate = resolveDate(ctx.anchor, spec.startOffset);
      const endDate =
        spec.termMonths === null
          ? null
          : parseDate(startDate)
              .add({ months: spec.termMonths })
              .subtract({ days: 1 })
              .toString();
      const lines = spec.lines.map((line, index) => ({
        spec: line,
        terms: {
          id: `line-${index}`,
          revenueType: line.revenueType,
          quantity: line.quantity,
          rate: line.rate,
          rateUnit: line.rateUnit ?? null,
          discountPercent: (line.discountPercent ?? 0) / 100,
          startDate: resolveDate(ctx.anchor, line.startOffset),
          endDate:
            line.endOffset === undefined
              ? null
              : resolveDate(ctx.anchor, line.endOffset)
        } satisfies ContractLineTerms
      }));
      const terms: ContractTerms = {
        startDate,
        endDate,
        billingFrequency: spec.billingFrequency,
        billingAlignment: spec.billingAlignment,
        billingTiming: spec.billingTiming,
        firstInvoiceDate: null,
        billedThrough: null
      };
      const invoices = planInvoiceSchedule(
        terms,
        lines.map((line) => line.terms),
        horizon(terms, today)
      );
      let billedThrough: string | null = null;
      for (const invoice of invoices) {
        if (invoice.invoiceDate > today) continue;
        for (const row of invoice.rows) {
          if (billedThrough === null || row.periodEnd > billedThrough) {
            billedThrough = row.periodEnd;
          }
        }
      }

      const contractId = await insertId(ctx, "customerContract", {
        customerContractId: await nextSequence(ctx, "customerContract"),
        name: spec.name,
        status: "Active",
        customerId,
        salesPersonId: userId,
        closeDate: startDate,
        startDate,
        endDate,
        termMonths: spec.termMonths,
        renewal: spec.renewal,
        renewalUplift: spec.renewalUpliftPercent / 100,
        billingFrequency: spec.billingFrequency,
        billingAlignment: spec.billingAlignment,
        billingTiming: spec.billingTiming,
        billedThrough,
        recognizeRevenueFrom: monthStart(today),
        paymentTermId,
        currencyCode: "USD",
        exchangeRate: 1,
        confirmedAt: resolveTimestamp(ctx.anchor, spec.startOffset, "10:00:00"),
        confirmedBy: userId,
        createdAt: resolveTimestamp(ctx.anchor, spec.startOffset, "09:00:00")
      });

      const lineIdByKey: Record<string, string> = {};
      for (const [index, line] of lines.entries()) {
        lineIdByKey[line.terms.id] = await insertId(
          ctx,
          "customerContractLine",
          {
            customerContractId: contractId,
            revenueType: line.spec.revenueType,
            itemId: need(ctx.refs.items, line.spec.item).id,
            description: line.spec.description,
            quantity: line.terms.quantity,
            rate: line.terms.rate,
            rateUnit: line.terms.rateUnit ?? undefined,
            discountPercent: line.terms.discountPercent,
            startDate: line.terms.startDate,
            endDate: line.terms.endDate ?? undefined,
            revenueMethod: line.spec.revenueMethod,
            sortOrder: index + 1
          }
        );
      }

      for (const invoice of invoices) {
        const status =
          invoice.invoiceDate <= today ? "Billed Externally" : "Planned";
        const invoiceId = await insertId(ctx, "customerContractInvoice", {
          customerContractId: contractId,
          invoiceDate: invoice.invoiceDate,
          status
        });
        for (const row of invoice.rows) {
          await insertRow(ctx, "customerContractInvoiceLine", {
            customerContractId: contractId,
            customerContractInvoiceId: invoiceId,
            customerContractLineId: need(lineIdByKey, row.lineId),
            periodStart: row.periodStart,
            periodEnd: row.periodEnd,
            units: row.units,
            unitPrice: row.unitPrice,
            amount: row.amount,
            isAdjustment: row.isAdjustment
          });
        }
      }

      const scheduleRows = invoices.flatMap((invoice) => invoice.rows);
      const lastPeriodEnds = new Map<string, string>();
      for (const row of scheduleRows) {
        const last = lastPeriodEnds.get(row.lineId);
        if (!last || row.periodEnd > last) {
          lastPeriodEnds.set(row.lineId, row.periodEnd);
        }
      }
      const billed = revenueTotals(scheduleRows);
      const revenue = planRevenueSchedule({
        lines: lines.map((line) => ({
          id: line.terms.id,
          revenueType: line.spec.revenueType,
          revenueMethod: line.spec.revenueMethod,
          startDate: line.terms.startDate,
          endDate: line.terms.endDate,
          goLiveDate: null,
          revenueStartDate: null,
          revenueEndDate: null
        })),
        totals: billed,
        fallbackEnds: lastPeriodEnds,
        recognizeRevenueFrom: monthStart(today)
      });
      for (const row of revenue) {
        await insertRow(ctx, "customerContractRevenue", {
          customerContractId: contractId,
          customerContractLineId: need(lineIdByKey, row.lineId),
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          amount: row.amount,
          status: row.status
        });
      }

      const billedExternally = revenueTotals(
        invoices
          .filter((invoice) => invoice.invoiceDate <= today)
          .flatMap((invoice) => invoice.rows)
      );
      const recognizedExternally = revenueTotals(
        revenue.filter((row) => row.status === "Recognized Externally")
      );
      for (const line of lines) {
        const opening = applyContractMovement({
          position: EMPTY_POSITION,
          amount:
            (billedExternally.get(line.terms.id) ?? 0) -
            (recognizedExternally.get(line.terms.id) ?? 0),
          rate: 1,
          counterpart: "receivable"
        });
        if (opening.deferredAmount === 0 && opening.assetAmount === 0) continue;
        await insertRow(ctx, "customerContractLedgerEntry", {
          customerContractId: contractId,
          customerContractLineId: need(lineIdByKey, line.terms.id),
          entryType: "Opening",
          postingDate: startDate,
          deferredAmount: opening.deferredAmount,
          deferredBase: opening.deferredBase,
          assetAmount: opening.assetAmount,
          assetBase: opening.assetBase
        });
      }
      ctx.refs.documents[`con:${spec.key}`] = contractId;
    }
  }

  // The portal form's insert: documentId = customerId. No fixed id —
  // externalLink's PK is global.
  ctx.log("customer portals");
  for (const customer of data.customerPortals) {
    const customerId = need(ctx.refs.customers, customer, "customer");
    await insertId(ctx, "externalLink", {
      documentType: "Customer",
      documentId: customerId,
      customerId
    });
  }

  for (const spec of data.customerBankAccounts) {
    await insertRow(ctx, "customerBankAccount", {
      customerId: need(ctx.refs.customers, spec.customer, "customer"),
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

  // Timestamps are staggered so the timeline reads as a real approval trail.
  const inProgress = [...data.opportunities, ...data.releasedOrders].find(
    (spec) => spec.order?.status === "In Progress"
  );
  if (inProgress?.order) {
    ctx.log(`status history — ${inProgress.order.ref}`);
    const salesOrderId = need(ctx.refs.documents, inProgress.order.ref);
    const base = inProgress.order.orderDateOffset;
    const trail: Array<[string, number, string]> = [
      ["Draft", base, "09:12:00"],
      ["Confirmed", base + 1, "15:41:00"],
      ["In Progress", base + 6, "10:05:00"]
    ];
    for (const [status, offset, timeOfDay] of trail) {
      await insertRow(ctx, "salesOrderStatusHistory", {
        salesOrderId,
        status,
        createdAt: resolveTimestamp(ctx.anchor, offset, timeOfDay)
      });
    }
  }

  // The job favorite is tier 06's — job refs do not exist yet.
  const sentQuote = data.opportunities.find(
    (spec) => spec.quote?.status === "Sent"
  );
  if (!sentQuote?.quote) {
    throw new Error(`Seed: no Sent quote to favorite`);
  }
  await insertRow(ctx, "quoteFavorite", {
    quoteId: need(ctx.refs.documents, sentQuote.quote.ref),
    userId
  });

  const firstReleased = data.releasedOrders[0];
  if (!firstReleased?.order) {
    throw new Error(`Seed: no released order to favorite`);
  }
  await insertRow(ctx, "salesOrderFavorite", {
    salesOrderId: need(ctx.refs.documents, firstReleased.order.ref),
    userId
  });

  await seedServiceJobs(ctx);
}

function isServiceLine(line: SalesReturnLineSpec): boolean {
  return (
    line.returnType === "Return for Service" ||
    line.returnType === "Return for Warranty"
  );
}

/**
 * Units at customers, registered as `registerCustomerAsset` (ERP
 * `service.server.ts`) does it: a Consumed serial sourced from the item, and
 * a `customerAsset` with source Manual at the customer's location. The
 * datasets ship no serials to customers, so none comes from a shipment.
 */
async function seedCustomerAssets(ctx: Ctx): Promise<void> {
  for (const spec of ctx.dataset.sales.customerAssets) {
    ctx.log(`customer asset ${spec.serial}`);
    const item = need(ctx.refs.items, spec.item, "item");
    const trackedEntityId = await insertId(ctx, "trackedEntity", {
      itemId: item.id,
      readableId: spec.serial,
      quantity: 1,
      status: "Consumed",
      sourceDocument: "Item",
      sourceDocumentId: item.id
    });
    ctx.refs.misc[`asset-serial:${spec.key}`] = trackedEntityId;
    ctx.refs.misc[`asset:${spec.key}`] = await insertId(ctx, "customerAsset", {
      trackedEntityId,
      itemId: item.id,
      customerId: need(ctx.refs.customers, spec.customer, "customer"),
      customerLocationId: need(
        ctx.refs.misc,
        `cloc:${spec.customer}`,
        "customer location"
      ),
      shippedDate: resolveDate(ctx.anchor, spec.shippedOffset),
      laborWarrantyEndDate:
        spec.laborWarrantyEndOffset === null
          ? null
          : resolveDate(ctx.anchor, spec.laborWarrantyEndOffset),
      partsWarrantyEndDate:
        spec.partsWarrantyEndOffset === null
          ? null
          : resolveDate(ctx.anchor, spec.partsWarrantyEndOffset),
      source: "Manual"
    });
  }
}

/**
 * Service jobs, as the app leaves them (`service.service.ts`):
 * - a job from an RMA line is created Open at the receipt by
 *   `createServiceJobsForReturn` (receipt-service-return.ts), with its
 *   `Return Receipt` activity on the asset's serial;
 * - time entries are the employee's, on the labor item; a Completed or
 *   Invoiced job stores each entry's cost (`postServiceJob` complete), and
 *   tier 09 writes the completion journal;
 * - an Invoiced job has the Draft invoice `createServiceInvoice` drafts: one
 *   line per labor item (billable hours × its sale price), then each billable
 *   charge, every line with `serviceJobId`, tax 0.
 */
async function seedServiceJobs(ctx: Ctx): Promise<void> {
  const data = ctx.dataset.sales;
  if (data.serviceJobs.length === 0) return;
  const { companyId, userId } = ctx;
  const plantId = ctx.refs.locations.Plant ?? ctx.locationId;
  const labor = need(ctx.refs.items, data.serviceLaborItem, "labor item");
  const laborSalePrice = Number(
    (
      await ctx.client.query<{ unitSalePrice: string | null }>(
        `SELECT "unitSalePrice" FROM "itemUnitSalePrice"
         WHERE "itemId" = $1 AND "companyId" = $2`,
        [labor.id, companyId]
      )
    ).rows[0]?.unitSalePrice ?? 0
  );
  const assetByKey = Object.fromEntries(
    data.customerAssets.map((asset) => [asset.key, asset])
  );
  const returnByKey = Object.fromEntries(
    data.salesReturns.map((rma) => [rma.key, rma])
  );
  const day = (workdaysBack: number) => workdayBefore(ctx.anchor, workdaysBack);
  const at = (date: string, timeOfDay: string) =>
    resolveLocalTimestamp(date, timeOfDay, ctx.timeZone);

  for (const spec of data.serviceJobs) {
    ctx.log(`service job ${spec.key} — ${spec.status}`);
    const asset = need(assetByKey, spec.asset, "customer asset");
    const customerId = need(ctx.refs.customers, asset.customer, "customer");
    const customerLocationId = need(
      ctx.refs.misc,
      `cloc:${asset.customer}`,
      "customer location"
    );
    const rma = spec.salesReturnLine;
    // A job from an RMA line opens at the receipt.
    const openedDate =
      rma === undefined
        ? day(spec.openedWorkdaysBack ?? 0)
        : resolveDate(
            ctx.anchor,
            need(returnByKey, rma.salesReturn, "sales return").dateOffset
          );
    const done = spec.status === "Completed" || spec.status === "Invoiced";
    const completedDate =
      spec.completedWorkdaysBack === undefined
        ? undefined
        : day(spec.completedWorkdaysBack);
    const estimate = spec.estimate;

    const serviceJobId = await nextSequence(ctx, "serviceJob");
    const jobId = await insertId(ctx, "serviceJob", {
      serviceJobId,
      status: spec.status,
      coverage: spec.coverage,
      workSite: spec.workSite,
      billingMethod: "Time and Materials",
      priority: spec.priority,
      customerId,
      customerLocationId,
      customerAssetId: need(ctx.refs.misc, `asset:${spec.asset}`),
      itemId: need(ctx.refs.items, asset.item, "item").id,
      trackedEntityId: need(ctx.refs.misc, `asset-serial:${spec.asset}`),
      locationId: plantId,
      salesReturnOrderLineId:
        rma === undefined
          ? undefined
          : need(
              ctx.refs.documents,
              `rmaline:${rma.salesReturn}:${rma.line}`,
              "sales return line"
            ),
      // The receipt assigns nobody; an office job is the user's.
      assignee: rma === undefined ? userId : undefined,
      dueDate:
        spec.dueOffset === undefined
          ? undefined
          : resolveDate(ctx.anchor, spec.dueOffset),
      problem: spec.problem,
      findings: spec.findings === undefined ? undefined : RICH(spec.findings),
      resolution:
        spec.resolution === undefined ? undefined : RICH(spec.resolution),
      repairable: spec.repairable,
      estimateStatus: estimate?.status,
      estimateSentAt:
        estimate?.sentWorkdaysBack === undefined
          ? undefined
          : at(day(estimate.sentWorkdaysBack), "15:00:00"),
      estimateRespondedAt:
        estimate?.respondedWorkdaysBack === undefined
          ? undefined
          : at(day(estimate.respondedWorkdaysBack), "10:00:00"),
      estimateRespondedBy: estimate?.respondedBy,
      completedAt:
        completedDate === undefined ? undefined : at(completedDate, "16:30:00"),
      createdAt: at(openedDate, "09:00:00")
    });
    ctx.refs.documents[`sj:${spec.key}`] = jobId;
    ctx.refs.misc[`sj-readable:${spec.key}`] = serviceJobId;

    for (const [index, line] of (estimate?.lines ?? []).entries()) {
      const item = need(ctx.refs.items, line.item, "item");
      await insertRow(ctx, "serviceJobEstimateLine", {
        serviceJobId: jobId,
        itemId: item.id,
        description: line.description ?? item.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        sortOrder: index + 1
      });
    }

    for (const entry of spec.time) {
      const entryDate = day(entry.workdaysBack);
      await insertRow(ctx, "serviceJobTime", {
        serviceJobId: jobId,
        employeeId: userId,
        laborItemId: labor.id,
        entryDate,
        startTime:
          entry.clock === undefined
            ? undefined
            : at(entryDate, entry.clock.start),
        endTime:
          entry.clock === undefined
            ? undefined
            : at(entryDate, entry.clock.end),
        hours: entry.hours,
        billable: entry.billable ?? true,
        // Stored by post-service-job complete: the labor item's unit cost.
        unitCost: done ? labor.unitCost : undefined,
        note: entry.note,
        createdAt: at(entryDate, "17:00:00")
      });
    }

    for (const charge of spec.charges) {
      const item = need(ctx.refs.items, charge.item, "item");
      await insertRow(ctx, "serviceJobItem", {
        serviceJobId: jobId,
        lineType: "Charge",
        itemId: item.id,
        description: charge.description ?? item.name,
        quantity: charge.quantity,
        unitOfMeasureCode: item.unitOfMeasureCode,
        unitCost: 0,
        unitPrice: charge.unitPrice,
        billable: charge.billable ?? true
      });
    }

    // createServiceJobsForReturn: the Return Receipt activity on the serial.
    if (rma !== undefined) {
      const activityId = await insertId(ctx, "trackedActivity", {
        type: "Return Receipt",
        sourceDocument: "Receipt",
        sourceDocumentId: need(
          ctx.refs.documents,
          `rma-receipt:${rma.salesReturn}`,
          "return receipt"
        ),
        sourceDocumentReadableId: need(
          ctx.refs.misc,
          `rma-receipt-readable:${rma.salesReturn}`
        ),
        attributes: JSON.stringify({
          "Sales Return Order": need(
            ctx.refs.documents,
            `rma:${rma.salesReturn}`
          ),
          Receipt: need(ctx.refs.documents, `rma-receipt:${rma.salesReturn}`),
          Employee: userId,
          "At Depot": true,
          "Service Job": jobId
        }),
        createdAt: openedDate
      });
      await insertRow(ctx, "trackedActivityOutput", {
        trackedActivityId: activityId,
        trackedEntityId: need(ctx.refs.misc, `asset-serial:${spec.asset}`),
        quantity: 1,
        createdAt: openedDate
      });
    }

    if (spec.status === "Invoiced") {
      await insertServiceInvoice(ctx, spec, {
        jobId,
        serviceJobId,
        customerId,
        customerLocationId,
        plantId,
        labor: {
          id: labor.id,
          name: labor.name,
          unitOfMeasureCode: labor.unitOfMeasureCode,
          salePrice: laborSalePrice
        }
      });
    }
  }
}

/** createServiceInvoice's Draft invoice of one Invoiced job. */
async function insertServiceInvoice(
  ctx: Ctx,
  spec: ServiceJobSpec,
  args: {
    jobId: string;
    serviceJobId: string;
    customerId: string;
    customerLocationId: string;
    plantId: string;
    labor: {
      id: string;
      name: string;
      unitOfMeasureCode: string;
      salePrice: number;
    };
  }
): Promise<void> {
  if (spec.invoiceWorkdaysBack === undefined) {
    throw new Error(
      `Seed: Invoiced service job "${spec.key}" has no invoice day`
    );
  }
  const billableHours = round(
    spec.time
      .filter((entry) => entry.billable ?? true)
      .reduce((sum, entry) => sum + entry.hours, 0)
  );
  const lines = [
    ...(billableHours > 0
      ? [
          {
            itemId: args.labor.id,
            description: args.labor.name,
            quantity: billableHours,
            unitPrice: round(args.labor.salePrice),
            unitOfMeasureCode: args.labor.unitOfMeasureCode
          }
        ]
      : []),
    ...spec.charges
      .filter((charge) => charge.billable ?? true)
      .map((charge) => {
        const item = need(ctx.refs.items, charge.item, "item");
        return {
          itemId: item.id,
          description: charge.description ?? item.name,
          quantity: charge.quantity,
          unitPrice: round(charge.unitPrice),
          unitOfMeasureCode: item.unitOfMeasureCode
        };
      })
  ];
  if (lines.length === 0) {
    throw new Error(`Seed: Invoiced service job "${spec.key}" bills nothing`);
  }
  const subtotal = round(
    lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)
  );
  const dateIssued = workdayBefore(ctx.anchor, spec.invoiceWorkdaysBack);
  const opportunityId = await insertId(ctx, "opportunity", {
    customerId: args.customerId
  });
  const invoiceId = await insertId(ctx, "salesInvoice", {
    invoiceId: await nextSequence(ctx, "salesInvoice"),
    status: "Draft",
    customerId: args.customerId,
    invoiceCustomerId: args.customerId,
    locationId: args.plantId,
    paymentTermId: ctx.refs.misc.paymentTermId,
    currencyCode: "USD",
    exchangeRate: 1,
    customerReference: args.serviceJobId,
    dateIssued,
    subtotal,
    totalDiscount: 0,
    totalTax: 0,
    totalAmount: subtotal,
    opportunityId
  });
  await insertRow(ctx, "salesInvoiceShipment", {
    id: invoiceId,
    locationId: args.plantId,
    customerLocationId: args.customerLocationId,
    shippingCost: 0
  });
  for (const [index, line] of lines.entries()) {
    await insertRow(ctx, "salesInvoiceLine", {
      invoiceId,
      invoiceLineType: "Service",
      itemId: line.itemId,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      unitOfMeasureCode: line.unitOfMeasureCode,
      taxPercent: 0,
      exchangeRate: 1,
      locationId: args.plantId,
      serviceJobId: args.jobId,
      sortOrder: index + 1
    });
  }
  await ctx.client.query(
    `UPDATE "serviceJob" SET "salesInvoiceId" = $1 WHERE id = $2 AND "companyId" = $3`,
    [invoiceId, args.jobId, ctx.companyId]
  );
}
