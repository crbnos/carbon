import { insertId, insertRow, nextSequence, RICH } from "../sql.ts";
import type { Ctx } from "../types.ts";

// Four opportunities at different completeness levels — this is the acceptance
// test for the whole seed. Every detail page (opportunity, rfq, quote,
// salesOrder, shipment, salesInvoice) must open without a 500 or redirect.

export async function runTier4(ctx: Ctx): Promise<void> {
  const { companyId, userId, locationId } = ctx;
  const plantId = ctx.refs.locations.Plant ?? locationId;
  const paymentTermId = ctx.refs.misc.paymentTermId;
  const shippingMethodId = ctx.refs.shippingMethods["UPS Ground"];

  // Collect customer ids and their contact/location ids
  const customers = {
    orbsec: ctx.refs.customers["ORBSEC Defense"]!,
    novasat: ctx.refs.customers["NovaSat Networks"]!,
    apex: ctx.refs.customers["Apex Space Research"]!,
    polar: ctx.refs.customers["PolarView Earth"]!
  };
  const cLocs = {
    orbsec: ctx.refs.misc["cloc:ORBSEC Defense"],
    novasat: ctx.refs.misc["cloc:NovaSat Networks"],
    apex: ctx.refs.misc["cloc:Apex Space Research"],
    polar: ctx.refs.misc["cloc:PolarView Earth"]
  };

  // Gather the full SAT-1000 item
  const satItem = ctx.refs.items["SAT-1000"]!;
  const busItem = ctx.refs.items["BUS-STR-001"]!;
  const epsItem = ctx.refs.items["EPS-001"]!;
  const adcsItem = ctx.refs.items["ADCS-001"]!;
  const commsItem = ctx.refs.items["COMMS-001"]!;
  const propItem = ctx.refs.items["PROP-001"]!;
  const harnessItem = ctx.refs.items["HARNESS-001"]!;

  // ── Opportunity 1: ORBSEC — complete chain (rfq → quote → SO → shipment → invoice) ──
  ctx.log("opportunity 1 — full chain (ORBSEC)");
  const opp1Id = await insertId(ctx, "opportunity", {
    customerId: customers.orbsec
  });
  ctx.refs.documents["opp:orbsec"] = opp1Id;

  const rfq1Id = await nextSequence(ctx, "salesRfq");
  const rfq1 = await insertId(ctx, "salesRfq", {
    rfqId: rfq1Id,
    status: "Quoted",
    customerId: customers.orbsec,
    customerLocationId: cLocs.orbsec ?? null,
    locationId: plantId,
    opportunityId: opp1Id,
    rfqDate: "2025-08-01",
    expirationDate: "2025-10-01",
    externalNotes: RICH("GEO surveillance constellation — 3 buses required.")
  });
  await insertId(ctx, "salesRfqLine", {
    salesRfqId: rfq1,
    itemId: satItem.id,
    description: satItem.name,
    unitOfMeasureCode: "EA",
    customerPartId: "ORBSEC-SAT-001",
    quantity: [3],
    order: 1
  });
  ctx.refs.documents["rfq:orbsec"] = rfq1;

  const q1Id = await nextSequence(ctx, "quote");
  const quote1 = await insertId(ctx, "quote", {
    quoteId: q1Id,
    status: "Ordered",
    customerId: customers.orbsec,
    customerLocationId: cLocs.orbsec ?? null,
    locationId: plantId,
    currencyCode: "USD",
    opportunityId: opp1Id,
    externalNotes: RICH("Quote for 3× ESPA-class satellite buses.")
  });
  // quotePayment and quoteShipment — id = quote.id
  await insertRow(ctx, "quotePayment", {
    id: quote1,
    paymentTermId,
    companyId
  });
  await insertRow(ctx, "quoteShipment", {
    id: quote1,
    locationId: plantId,
    shippingMethodId,
    companyId
  });
  await insertId(ctx, "quoteLine", {
    quoteId: quote1,
    itemId: satItem.id,
    itemType: "Part",
    description: satItem.name,
    methodType: "Make to Order",
    unitOfMeasureCode: "EA",
    quantity: [3],
    status: "Complete",
    sortOrder: 1
  });
  ctx.refs.documents["quote:orbsec"] = quote1;

  const so1Id = await nextSequence(ctx, "salesOrder");
  const so1 = await insertId(ctx, "salesOrder", {
    salesOrderId: so1Id,
    status: "In Progress",
    customerId: customers.orbsec,
    customerLocationId: cLocs.orbsec ?? null,
    locationId: plantId,
    currencyCode: "USD",
    opportunityId: opp1Id,
    orderDate: "2025-10-15"
  });
  await insertRow(ctx, "salesOrderPayment", {
    id: so1,
    paymentTermId,
    companyId
  });
  await insertRow(ctx, "salesOrderShipment", {
    id: so1,
    locationId: plantId,
    shippingMethodId,
    customerId: customers.orbsec,
    customerLocationId: cLocs.orbsec ?? null,
    companyId
  });
  const soLine1 = await insertId(ctx, "salesOrderLine", {
    salesOrderId: so1,
    salesOrderLineType: "Part",
    itemId: satItem.id,
    description: satItem.name,
    saleQuantity: 3,
    unitPrice: 1800000,
    unitOfMeasureCode: "EA",
    locationId: plantId,
    methodType: "Make to Order",
    status: "In Progress"
  });
  ctx.refs.documents["so:orbsec"] = so1;
  ctx.refs.documents["soline:orbsec:sat"] = soLine1;

  // Shipment (Draft — Posted shipments need the edge function)
  const shpId = await nextSequence(ctx, "shipment");
  const shp1 = await insertId(ctx, "shipment", {
    shipmentId: shpId,
    status: "Draft",
    locationId: plantId,
    sourceDocument: "Sales Order",
    sourceDocumentId: so1,
    sourceDocumentReadableId: so1Id,
    shippingMethodId,
    customerId: customers.orbsec,
    opportunityId: opp1Id
  });
  await insertId(ctx, "shipmentLine", {
    shipmentId: shp1,
    lineId: soLine1,
    itemId: satItem.id,
    orderQuantity: 3,
    outstandingQuantity: 3,
    shippedQuantity: 0,
    locationId: plantId,
    unitOfMeasure: "EA",
    unitPrice: 1800000
  });
  ctx.refs.documents["shp:orbsec"] = shp1;

  // Invoice (Draft)
  const inv1Id = await nextSequence(ctx, "salesInvoice");
  const inv1 = await insertId(ctx, "salesInvoice", {
    invoiceId: inv1Id,
    status: "Draft",
    customerId: customers.orbsec,
    currencyCode: "USD",
    locationId: plantId,
    opportunityId: opp1Id,
    paymentTermId,
    subtotal: 5400000,
    totalAmount: 5400000,
    invoiceCustomerId: customers.orbsec,
    shipmentId: shp1,
    dateIssued: "2025-11-01"
  });
  // salesInvoiceShipment — id = invoice.id (INNER JOINed by the salesInvoices view)
  await insertRow(ctx, "salesInvoiceShipment", {
    id: inv1,
    shippingMethodId,
    locationId: plantId,
    companyId,
    createdBy: userId
  });
  await insertId(ctx, "salesInvoiceLine", {
    invoiceId: inv1,
    invoiceLineType: "Part",
    itemId: satItem.id,
    description: satItem.name,
    quantity: 3,
    unitOfMeasureCode: "EA",
    unitPrice: 1800000,
    opportunityId: opp1Id,
    salesOrderId: so1,
    salesOrderLineId: soLine1
  });
  ctx.refs.documents["inv:orbsec"] = inv1;

  // ── Opportunity 2: NovaSat — quote sent (no SO yet) ───────────────────────
  ctx.log("opportunity 2 — quote sent (NovaSat)");
  const opp2Id = await insertId(ctx, "opportunity", {
    customerId: customers.novasat
  });
  const q2Id = await nextSequence(ctx, "quote");
  const quote2 = await insertId(ctx, "quote", {
    quoteId: q2Id,
    status: "Sent",
    customerId: customers.novasat,
    customerLocationId: cLocs.novasat ?? null,
    locationId: plantId,
    currencyCode: "USD",
    opportunityId: opp2Id,
    expirationDate: "2025-12-31"
  });
  await insertRow(ctx, "quotePayment", {
    id: quote2,
    paymentTermId,
    companyId
  });
  await insertRow(ctx, "quoteShipment", {
    id: quote2,
    locationId: plantId,
    shippingMethodId,
    companyId
  });
  await insertId(ctx, "quoteLine", {
    quoteId: quote2,
    itemId: satItem.id,
    itemType: "Part",
    description: satItem.name,
    methodType: "Make to Order",
    unitOfMeasureCode: "EA",
    quantity: [2],
    status: "Complete",
    sortOrder: 1
  });
  await insertId(ctx, "quoteLine", {
    quoteId: quote2,
    itemId: epsItem.id,
    itemType: "Part",
    description: epsItem.name,
    methodType: "Make to Order",
    unitOfMeasureCode: "EA",
    quantity: [2],
    status: "In Progress",
    sortOrder: 2
  });
  ctx.refs.documents["quote:novasat"] = quote2;
  ctx.refs.documents["opp:novasat"] = opp2Id;

  // ── Opportunity 3: Apex — RFQ only (no quote yet) ─────────────────────────
  ctx.log("opportunity 3 — RFQ only (Apex)");
  const opp3Id = await insertId(ctx, "opportunity", {
    customerId: customers.apex
  });
  const rfq3Id = await nextSequence(ctx, "salesRfq");
  const rfq3 = await insertId(ctx, "salesRfq", {
    rfqId: rfq3Id,
    status: "Ready for Quote",
    customerId: customers.apex,
    customerLocationId: cLocs.apex ?? null,
    locationId: plantId,
    opportunityId: opp3Id,
    rfqDate: "2025-11-01",
    externalNotes: RICH(
      "University research program — 1 structural frame for test campaign."
    )
  });
  await insertId(ctx, "salesRfqLine", {
    salesRfqId: rfq3,
    itemId: busItem.id,
    description: busItem.name,
    unitOfMeasureCode: "EA",
    customerPartId: "APX-STR-001",
    quantity: [1],
    order: 1
  });
  ctx.refs.documents["rfq:apex"] = rfq3;
  ctx.refs.documents["opp:apex"] = opp3Id;

  // ── Opportunity 4: PolarView — confirmed SO, no shipment ─────────────────
  ctx.log("opportunity 4 — confirmed SO (PolarView)");
  const opp4Id = await insertId(ctx, "opportunity", {
    customerId: customers.polar
  });
  const q4Id = await nextSequence(ctx, "quote");
  const quote4 = await insertId(ctx, "quote", {
    quoteId: q4Id,
    status: "Ordered",
    customerId: customers.polar,
    customerLocationId: cLocs.polar ?? null,
    locationId: plantId,
    currencyCode: "USD",
    opportunityId: opp4Id
  });
  await insertRow(ctx, "quotePayment", {
    id: quote4,
    paymentTermId,
    companyId
  });
  await insertRow(ctx, "quoteShipment", {
    id: quote4,
    locationId: plantId,
    shippingMethodId,
    companyId
  });
  await insertId(ctx, "quoteLine", {
    quoteId: quote4,
    itemId: satItem.id,
    itemType: "Part",
    description: satItem.name,
    methodType: "Make to Order",
    unitOfMeasureCode: "EA",
    quantity: [1],
    status: "Complete",
    sortOrder: 1
  });
  ctx.refs.documents["quote:polar"] = quote4;

  const so4Id = await nextSequence(ctx, "salesOrder");
  const so4 = await insertId(ctx, "salesOrder", {
    salesOrderId: so4Id,
    status: "Confirmed",
    customerId: customers.polar,
    customerLocationId: cLocs.polar ?? null,
    locationId: plantId,
    currencyCode: "USD",
    opportunityId: opp4Id,
    orderDate: "2025-12-01"
  });
  await insertRow(ctx, "salesOrderPayment", {
    id: so4,
    paymentTermId,
    companyId
  });
  await insertRow(ctx, "salesOrderShipment", {
    id: so4,
    locationId: plantId,
    shippingMethodId,
    customerId: customers.polar,
    customerLocationId: cLocs.polar ?? null,
    companyId
  });
  const soLine4 = await insertId(ctx, "salesOrderLine", {
    salesOrderId: so4,
    salesOrderLineType: "Part",
    itemId: satItem.id,
    description: satItem.name,
    saleQuantity: 1,
    unitPrice: 1800000,
    unitOfMeasureCode: "EA",
    locationId: plantId,
    methodType: "Make to Order",
    status: "Ordered"
  });
  ctx.refs.documents["so:polar"] = so4;
  ctx.refs.documents["soline:polar:sat"] = soLine4;
  ctx.refs.documents["opp:polar"] = opp4Id;

  // ── One order per remaining job status ────────────────────────────────────
  // Tier 6 hangs exactly one job on each of these, so every jobStatus is
  // reachable from an order of its own. Opportunities 1 and 4 above already
  // carry the In Progress and Ready jobs.
  const statusOrders = [
    {
      key: "planned",
      customer: "novasat",
      item: busItem,
      status: "Confirmed",
      lineStatus: "Ordered",
      orderDate: "2026-01-05",
      unitPrice: 240000
    },
    {
      key: "draft",
      customer: "apex",
      item: epsItem,
      status: "Draft",
      lineStatus: "Ordered",
      orderDate: "2026-01-12",
      unitPrice: 95000
    },
    {
      key: "paused",
      customer: "orbsec",
      item: adcsItem,
      status: "In Progress",
      lineStatus: "In Progress",
      orderDate: "2025-11-18",
      unitPrice: 130000
    },
    {
      key: "completed",
      customer: "polar",
      item: commsItem,
      status: "Completed",
      lineStatus: "Completed",
      orderDate: "2025-06-02",
      unitPrice: 110000
    },
    {
      key: "closed",
      customer: "novasat",
      item: propItem,
      status: "Closed",
      lineStatus: "Completed",
      orderDate: "2025-05-14",
      unitPrice: 175000
    },
    {
      key: "cancelled",
      customer: "apex",
      item: harnessItem,
      status: "Cancelled",
      lineStatus: "Ordered",
      orderDate: "2025-09-08",
      unitPrice: 42000
    }
  ] as const;

  for (const spec of statusOrders) {
    ctx.log(`sales order — ${spec.status} (job ${spec.key})`);
    const customerId = customers[spec.customer];
    const customerLocationId = cLocs[spec.customer] ?? null;
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
      orderDate: spec.orderDate
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
      itemId: spec.item.id,
      description: spec.item.name,
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
}
