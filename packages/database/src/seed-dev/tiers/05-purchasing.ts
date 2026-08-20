import { insertId, insertRow, need, nextSequence, RICH } from "../sql.ts";
import type { Ctx } from "../types.ts";

// Every RFQ line and every supplier quote prices the same quantity breaks, so
// the Compare Quotes drawer can total all three quotes at any tier it offers.
const RFQ_QUANTITY_BREAKS = [10, 25, 50];

const RFQ_LINES = [
  { item: "PCB-BARE-REV3", description: "Bare EPS board, rev 3 — ENIG finish" },
  { item: "BAT-LIION-48V", description: "48V Li-ion pack — flight qualified" }
];

type RfqQuoteSpec = {
  key: string;
  supplier: string;
  supplierReference: string;
  // Hard-coded so /share/supplier-quote/<id> is the same URL on every re-run.
  externalLinkId: string;
  shippingCost: number;
  lines: {
    item: string;
    supplierPartId: string;
    // [supplier unit price, lead time in days] per RFQ_QUANTITY_BREAKS entry
    breaks: [number, number][];
  }[];
};

// Cheapest (CelestialElex) vs fastest (Deep Space RF) vs slowest and dearest
// (PropTech) — the comparison has a winner without being a one-horse race.
const RFQ_QUOTES: RfqQuoteSpec[] = [
  {
    key: "celex",
    supplier: "CelestialElex",
    supplierReference: "CEX-Q-4471",
    externalLinkId: "5c0e1a3d-7b41-4c92-9f18-2ad6e0b71c01",
    shippingCost: 250,
    lines: [
      {
        item: "PCB-BARE-REV3",
        supplierPartId: "CEX-PCB-EPS3",
        breaks: [
          [94, 21],
          [88, 21],
          [82, 28]
        ]
      },
      {
        item: "BAT-LIION-48V",
        supplierPartId: "CEX-BAT-48V",
        breaks: [
          [2180, 30],
          [2080, 30],
          [1990, 35]
        ]
      }
    ]
  },
  {
    key: "dsrf",
    supplier: "Deep Space RF",
    supplierReference: "DSRF-2026-0188",
    externalLinkId: "5c0e1a3d-7b41-4c92-9f18-2ad6e0b71c02",
    shippingCost: 180,
    lines: [
      {
        item: "PCB-BARE-REV3",
        supplierPartId: "DSRF-PCB-3",
        breaks: [
          [99, 14],
          [93, 14],
          [89, 18]
        ]
      },
      {
        item: "BAT-LIION-48V",
        supplierPartId: "DSRF-BAT48",
        breaks: [
          [2260, 21],
          [2170, 21],
          [2090, 24]
        ]
      }
    ]
  },
  {
    key: "proptech",
    supplier: "PropTech Solutions",
    supplierReference: "PTS-RFQ-9931",
    externalLinkId: "5c0e1a3d-7b41-4c92-9f18-2ad6e0b71c03",
    shippingCost: 400,
    lines: [
      {
        item: "PCB-BARE-REV3",
        supplierPartId: "PTS-EPS-PCB",
        breaks: [
          [112, 35],
          [104, 35],
          [96, 42]
        ]
      },
      {
        item: "BAT-LIION-48V",
        supplierPartId: "PTS-48V-PACK",
        breaks: [
          [2290, 45],
          [2210, 45],
          [2140, 45]
        ]
      }
    ]
  }
];

const RFQ_WINNING_QUOTE = "celex";
const RFQ_ORDER_QUANTITY = 25;

export async function runTier5(ctx: Ctx): Promise<void> {
  const { companyId, locationId } = ctx;
  const plantId = ctx.refs.locations.Plant ?? locationId;
  const shippingMethodId = ctx.refs.shippingMethods["UPS Ground"];
  const paymentTermId = ctx.refs.misc.paymentTermId;

  const suppProp = ctx.refs.suppliers["PropTech Solutions"];
  const suppFasten = ctx.refs.suppliers["SpaceGrade Fasteners"];
  const suppCelex = ctx.refs.suppliers.CelestialElex;

  const batItem = ctx.refs.items["BAT-LIION-48V"]!;
  const rwItem = ctx.refs.items["RW-010"]!;
  const fstItem = ctx.refs.items["FST-M4-TI"]!;
  const pcbItem = ctx.refs.items["PCB-BARE-REV3"]!;

  // ── PO 1: PropTech — To Receive (batteries + reaction wheels) ──────────────
  ctx.log("purchase order 1 — To Receive (PropTech)");
  const si1 = await insertId(ctx, "supplierInteraction", {
    supplierId: suppProp
  });
  const po1Id = await nextSequence(ctx, "purchaseOrder");
  const po1 = await insertId(ctx, "purchaseOrder", {
    purchaseOrderId: po1Id,
    purchaseOrderType: "Purchase",
    status: "To Receive",
    supplierId: suppProp,
    supplierInteractionId: si1,
    orderDate: "2025-09-01"
  });
  await insertRow(ctx, "purchaseOrderDelivery", {
    id: po1,
    locationId: plantId,
    shippingMethodId,
    companyId
  });
  await insertRow(ctx, "purchaseOrderPayment", {
    id: po1,
    paymentTermId,
    companyId
  });
  const pol1 = await insertId(ctx, "purchaseOrderLine", {
    purchaseOrderId: po1,
    purchaseOrderLineType: "Part",
    itemId: batItem.id,
    description: batItem.name,
    purchaseQuantity: 6,
    supplierUnitPrice: 2200,
    inventoryUnitOfMeasureCode: "EA",
    purchaseUnitOfMeasureCode: "EA",
    locationId: plantId
  });
  await insertId(ctx, "purchaseOrderLine", {
    purchaseOrderId: po1,
    purchaseOrderLineType: "Part",
    itemId: rwItem.id,
    description: rwItem.name,
    purchaseQuantity: 4,
    supplierUnitPrice: 14200,
    inventoryUnitOfMeasureCode: "EA",
    purchaseUnitOfMeasureCode: "EA",
    locationId: plantId
  });

  // Receipt (Draft) for PO 1
  const rec1Id = await nextSequence(ctx, "receipt");
  const rec1 = await insertId(ctx, "receipt", {
    receiptId: rec1Id,
    status: "Draft",
    locationId: plantId,
    sourceDocument: "Purchase Order",
    sourceDocumentId: po1,
    sourceDocumentReadableId: po1Id,
    supplierId: suppProp
  });
  await insertId(ctx, "receiptLine", {
    receiptId: rec1,
    lineId: pol1,
    itemId: batItem.id,
    orderQuantity: 6,
    outstandingQuantity: 6,
    receivedQuantity: 0,
    locationId: plantId,
    unitOfMeasure: "EA",
    unitPrice: 2200,
    // The battery is a Batch item, so the receipt line has to ask for a lot —
    // that inline lot field is the whole point of the receiving screenshot.
    requiresBatchTracking: true
  });
  ctx.refs.documents["receipt:rocket"] = rec1;

  // ── PO 2: SpaceGrade Fasteners — To Invoice (fasteners already received) ─
  ctx.log("purchase order 2 — To Invoice (SpaceGrade)");
  const si2 = await insertId(ctx, "supplierInteraction", {
    supplierId: suppFasten
  });
  const po2Id = await nextSequence(ctx, "purchaseOrder");
  const po2 = await insertId(ctx, "purchaseOrder", {
    purchaseOrderId: po2Id,
    purchaseOrderType: "Purchase",
    status: "To Invoice",
    supplierId: suppFasten,
    supplierInteractionId: si2,
    orderDate: "2025-08-15"
  });
  await insertRow(ctx, "purchaseOrderDelivery", {
    id: po2,
    locationId: plantId,
    shippingMethodId,
    companyId
  });
  await insertRow(ctx, "purchaseOrderPayment", {
    id: po2,
    paymentTermId,
    companyId
  });
  await insertId(ctx, "purchaseOrderLine", {
    purchaseOrderId: po2,
    purchaseOrderLineType: "Part",
    itemId: fstItem.id,
    description: fstItem.name,
    purchaseQuantity: 500,
    supplierUnitPrice: 2.5,
    inventoryUnitOfMeasureCode: "EA",
    purchaseUnitOfMeasureCode: "EA",
    locationId: plantId
  });

  // Purchase invoice (Draft) for PO 2
  const inv2Id = await nextSequence(ctx, "purchaseInvoice");
  const inv2 = await insertId(ctx, "purchaseInvoice", {
    invoiceId: inv2Id,
    status: "Draft",
    supplierId: suppFasten,
    supplierInteractionId: si2,
    currencyCode: "USD",
    paymentTermId,
    subtotal: 1250,
    totalAmount: 1250,
    dateIssued: "2025-09-01"
  });
  await insertRow(ctx, "purchaseInvoiceDelivery", {
    id: inv2,
    locationId: plantId,
    shippingMethodId,
    companyId
  });
  await insertId(ctx, "purchaseInvoiceLine", {
    invoiceId: inv2,
    invoiceLineType: "Part",
    purchaseOrderId: po2,
    itemId: fstItem.id,
    description: fstItem.name,
    quantity: 500,
    supplierUnitPrice: 2.5,
    inventoryUnitOfMeasureCode: "EA",
    purchaseUnitOfMeasureCode: "EA"
  });
  ctx.refs.documents["pinvoice:fasten"] = inv2;

  // ── PO 3: CelestialElex — Draft (PCBs, not yet sent) ────────────────────
  ctx.log("purchase order 3 — Draft (CelestialElex)");
  const si3 = await insertId(ctx, "supplierInteraction", {
    supplierId: suppCelex
  });
  const po3Id = await nextSequence(ctx, "purchaseOrder");
  const po3 = await insertId(ctx, "purchaseOrder", {
    purchaseOrderId: po3Id,
    purchaseOrderType: "Purchase",
    status: "Draft",
    supplierId: suppCelex,
    supplierInteractionId: si3,
    orderDate: "2025-10-01"
  });
  await insertRow(ctx, "purchaseOrderDelivery", {
    id: po3,
    locationId: plantId,
    shippingMethodId,
    companyId
  });
  await insertRow(ctx, "purchaseOrderPayment", {
    id: po3,
    paymentTermId,
    companyId
  });
  await insertId(ctx, "purchaseOrderLine", {
    purchaseOrderId: po3,
    purchaseOrderLineType: "Part",
    itemId: pcbItem.id,
    description: pcbItem.name,
    purchaseQuantity: 20,
    supplierUnitPrice: 90,
    inventoryUnitOfMeasureCode: "EA",
    purchaseUnitOfMeasureCode: "EA",
    locationId: plantId
  });
  ctx.refs.documents["po:celex"] = po3;

  // ── RFQ: 2 lines, finalized (Requested), fanned out to 3 suppliers ────────
  ctx.log("purchasing RFQ — Requested (3 suppliers)");
  const rfqReadableId = await nextSequence(ctx, "purchasingRfq");
  const rfq = await insertId(ctx, "purchasingRfq", {
    rfqId: rfqReadableId,
    status: "Requested",
    employeeId: ctx.userId,
    locationId: plantId,
    rfqDate: "2026-07-20",
    expirationDate: "2026-09-30",
    notes: RICH("Dual-source the EPS board and the 48V pack for the Q4 build."),
    internalNotes: RICH(
      "Award on landed cost at 25 pcs unless lead time slips."
    )
  });
  ctx.refs.documents["prfq:avionics"] = rfq;

  let rfqLineOrder = 1;
  for (const spec of RFQ_LINES) {
    const item = need(ctx.refs.items, spec.item);
    await insertId(ctx, "purchasingRfqLine", {
      purchasingRfqId: rfq,
      itemId: item.id,
      description: spec.description,
      quantity: RFQ_QUANTITY_BREAKS,
      purchaseUnitOfMeasureCode: "EA",
      inventoryUnitOfMeasureCode: "EA",
      conversionFactor: 1,
      order: rfqLineOrder++
    });
  }

  // ── One Active supplier quote per RFQ supplier, linked back to the RFQ ────
  let winningInteractionId = "";
  for (const spec of RFQ_QUOTES) {
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
      quotedDate: "2026-07-28",
      expirationDate: "2026-12-31",
      currencyCode: "USD",
      exchangeRate: 1,
      externalNotes: RICH(`Quote against ${rfqReadableId}. Prices FOB origin.`)
    });

    // Same two steps as supplier-quote finalize: create the external link, then
    // point the quote at it — that id is what /share/supplier-quote/:id reads.
    // Fixed id + a PK of ("id") alone: the company-scoped wipe can leave a row
    // from a run under another company, so clear it before re-creating.
    await ctx.client.query(`DELETE FROM "externalLink" WHERE id = $1`, [
      spec.externalLinkId
    ]);
    await insertRow(ctx, "externalLink", {
      id: spec.externalLinkId,
      documentType: "SupplierQuote",
      documentId: quoteId,
      supplierId,
      expiresAt: "2026-12-31T23:59:59Z"
    });
    await ctx.client.query(
      `UPDATE "supplierQuote" SET "externalLinkId" = $1 WHERE id = $2`,
      [spec.externalLinkId, quoteId]
    );
    ctx.refs.misc[`sqlink:${spec.key}`] = spec.externalLinkId;

    let quoteLineSort = 1;
    for (const line of spec.lines) {
      const item = need(ctx.refs.items, line.item);
      const quoteLineId = await insertId(ctx, "supplierQuoteLine", {
        supplierQuoteId: quoteId,
        supplierQuoteLineType: "Part",
        itemId: item.id,
        description: item.name,
        supplierPartId: line.supplierPartId,
        quantity: RFQ_QUANTITY_BREAKS,
        purchaseUnitOfMeasureCode: "EA",
        inventoryUnitOfMeasureCode: "EA",
        conversionFactor: 1,
        sortOrder: quoteLineSort++
      });

      // A short break list would silently drop a tier from the comparison.
      if (line.breaks.length !== RFQ_QUANTITY_BREAKS.length) {
        throw new Error(
          `Seed: ${spec.key}/${line.item} must price every quantity break`
        );
      }

      for (const [index, [unitPrice, leadTime]] of line.breaks.entries()) {
        await insertRow(ctx, "supplierQuoteLinePrice", {
          supplierQuoteId: quoteId,
          supplierQuoteLineId: quoteLineId,
          quantity: RFQ_QUANTITY_BREAKS[index],
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

    if (spec.key === RFQ_WINNING_QUOTE) winningInteractionId = interactionId;
  }

  // ── PO 4: converted from the winning quote — To Receive and Invoice ───────
  // The convert edge function reuses the quote's supplier interaction, and a PO
  // with nothing received and nothing invoiced is exactly the state post-receipt
  // and post-purchase-invoice call "To Receive and Invoice".
  const winner = RFQ_QUOTES.find((q) => q.key === RFQ_WINNING_QUOTE);
  if (!winner) {
    throw new Error(`Seed: unknown winning quote "${RFQ_WINNING_QUOTE}"`);
  }
  const orderBreak = RFQ_QUANTITY_BREAKS.indexOf(RFQ_ORDER_QUANTITY);
  if (orderBreak === -1) {
    throw new Error(`Seed: no quantity break for ${RFQ_ORDER_QUANTITY}`);
  }

  ctx.log("purchase order 4 — To Receive and Invoice (from winning quote)");
  const po4Id = await nextSequence(ctx, "purchaseOrder");
  const po4 = await insertId(ctx, "purchaseOrder", {
    purchaseOrderId: po4Id,
    purchaseOrderType: "Purchase",
    status: "To Receive and Invoice",
    supplierId: need(ctx.refs.suppliers, winner.supplier),
    supplierContactId: need(ctx.refs.contacts, `sc:${winner.supplier}`),
    supplierReference: winner.supplierReference,
    supplierInteractionId: winningInteractionId,
    currencyCode: "USD",
    exchangeRate: 1,
    orderDate: "2026-08-05"
  });
  await insertRow(ctx, "purchaseOrderDelivery", {
    id: po4,
    locationId: plantId,
    shippingMethodId,
    companyId
  });
  await insertRow(ctx, "purchaseOrderPayment", {
    id: po4,
    paymentTermId,
    companyId
  });

  let po4LineSort = 1;
  for (const line of winner.lines) {
    const item = need(ctx.refs.items, line.item);
    const orderPrice = line.breaks[orderBreak];
    if (!orderPrice) {
      throw new Error(
        `Seed: ${line.item} has no price at ${RFQ_ORDER_QUANTITY}`
      );
    }
    await insertId(ctx, "purchaseOrderLine", {
      purchaseOrderId: po4,
      purchaseOrderLineType: "Part",
      itemId: item.id,
      description: item.name,
      purchaseQuantity: RFQ_ORDER_QUANTITY,
      supplierUnitPrice: orderPrice[0],
      supplierShippingCost: winner.shippingCost,
      exchangeRate: 1,
      inventoryUnitOfMeasureCode: "EA",
      purchaseUnitOfMeasureCode: "EA",
      locationId: plantId,
      sortOrder: po4LineSort++
    });
  }

  await insertRow(ctx, "purchasingRfqToPurchaseOrder", {
    purchasingRfqId: rfq,
    purchaseOrderId: po4
  });
  ctx.refs.documents[`po:sq-${RFQ_WINNING_QUOTE}`] = po4;
}
