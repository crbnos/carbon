// Four opportunities at different completeness levels — this is the acceptance
// test for the whole seed. Every detail page (opportunity, rfq, quote,
// salesOrder, shipment, salesInvoice) must open without a 500 or redirect.

import type {
  PriceBreak,
  SalesData,
  SalesOpportunitySpec,
  SalesReturnSpec,
  SalesStatusOrderSpec,
  StaggeredDeliverySpec
} from "../../types.ts";

export const HMA_PRICE_BREAKS: readonly PriceBreak[] = [
  { quantity: 1, unitPrice: 4200, leadTime: 45 },
  { quantity: 10, unitPrice: 3980, leadTime: 55, discountPercent: 0.05 },
  { quantity: 25, unitPrice: 3760, leadTime: 65, discountPercent: 0.1 },
  { quantity: 50, unitPrice: 3540, leadTime: 80, discountPercent: 0.16 }
];

export const HSG_PRICE_BREAKS: readonly PriceBreak[] = [
  { quantity: 5, unitPrice: 1150, leadTime: 30 },
  {
    quantity: 25,
    unitPrice: 1050,
    leadTime: 40,
    discountPercent: 0.09,
    shippingCost: 320
  }
];

// The Sent quote is the one the docs screenshot at /share/quote/:externalLinkId.
// The expiration offset must stay positive or the public page renders its
// Expired state instead of the quote.
export const GRANITE_QUOTE_EXPIRATION_OFFSET = 288;

// Three deliveries of the same make part, three weeks apart. Gives the docs a
// real delivery schedule, and three Make to Order lines with no job attached is
// what puts the "Jobs Required" / Create Jobs card on the order.
export const STAGGERED_DELIVERIES: StaggeredDeliverySpec[] = [
  { key: "1", promisedDateOffset: 18, sortOrder: 1 },
  { key: "2", promisedDateOffset: 39, sortOrder: 2 },
  { key: "3", promisedDateOffset: 60, sortOrder: 3 }
];

export const OPPORTUNITIES: SalesOpportunitySpec[] = [
  {
    log: "opportunity 1 — full chain (Cedar Valley)",
    ref: "opp:cedarvalley",
    customer: "Cedar Valley Hydraulics",
    rfq: {
      ref: "rfq:cedarvalley",
      status: "Quoted",
      rfqDateOffset: -210,
      expirationOffset: -180,
      externalNotes:
        "Power unit manifold assemblies to customer print HPU-4000 rev C.",
      lines: [
        {
          item: "HMA-4000",
          customerPartId: "CVH-HPU-4000",
          quantity: [6],
          order: 1
        }
      ]
    },
    quote: {
      ref: "quote:cedarvalley",
      status: "Ordered",
      externalNotes:
        "Quote for 6 hydraulic power unit manifold assemblies, prints supplied by the customer.",
      lines: [
        {
          ref: "quoteline:cedarvalley:hma",
          item: "HMA-4000",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 6, unitPrice: 3980, leadTime: 50 }]
        }
      ]
    },
    order: {
      ref: "so:cedarvalley",
      status: "In Progress",
      orderDateOffset: -168,
      lines: [
        {
          ref: "soline:cedarvalley:hma",
          item: "HMA-4000",
          saleQuantity: 6,
          unitPrice: 3980,
          status: "In Progress"
        }
      ]
    },
    shipment: {
      ref: "shp:cedarvalley",
      status: "Draft",
      lines: [
        {
          item: "HMA-4000",
          orderQuantity: 6,
          outstandingQuantity: 6,
          shippedQuantity: 0,
          unitPrice: 3980
        }
      ]
    },
    invoice: {
      ref: "inv:cedarvalley",
      status: "Draft",
      subtotal: 23880,
      totalAmount: 23880,
      dateIssuedOffset: -150,
      lines: [{ item: "HMA-4000", quantity: 6, unitPrice: 3980 }]
    }
  },
  {
    log: "opportunity 2 — quote sent (Granite State)",
    ref: "opp:granite",
    customer: "Granite State Instruments",
    quote: {
      ref: "quote:granite",
      status: "Sent",
      expirationOffset: GRANITE_QUOTE_EXPIRATION_OFFSET,
      lines: [
        {
          ref: "quoteline:granite:hma",
          item: "HMA-4000",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: HMA_PRICE_BREAKS
        },
        {
          ref: "quoteline:granite:hsg",
          item: "MCH-HSG-PUMP",
          status: "Complete",
          sortOrder: 2,
          priceBreaks: HSG_PRICE_BREAKS
        }
      ],
      externalLink: {
        ref: "quotelink:granite",
        expiresOffset: GRANITE_QUOTE_EXPIRATION_OFFSET
      }
    }
  },
  {
    log: "opportunity 3 — RFQ only (Solstice)",
    ref: "opp:solstice",
    customer: "Solstice Medical Devices",
    rfq: {
      ref: "rfq:solstice",
      status: "Ready for Quote",
      rfqDateOffset: -42,
      externalNotes:
        "New program — 304 stainless mounting flanges, passivation and CoC required.",
      lines: [
        {
          item: "MCH-FLANGE-SS",
          customerPartId: "SMD-FLG-0221",
          quantity: [250],
          order: 1
        }
      ]
    }
  },
  {
    log: "opportunity 4 — confirmed SO (Dominion Ag)",
    ref: "opp:dominion",
    customer: "Dominion Ag Equipment",
    quote: {
      ref: "quote:dominion",
      status: "Ordered",
      lines: [
        {
          ref: "quoteline:dominion:hma",
          item: "HMA-4000",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 2, unitPrice: 4100, leadTime: 45 }]
        }
      ]
    },
    order: {
      ref: "so:dominion",
      status: "Confirmed",
      orderDateOffset: -96,
      lines: [
        {
          ref: "soline:dominion:hma",
          item: "HMA-4000",
          saleQuantity: 2,
          unitPrice: 4100,
          status: "Ordered"
        }
      ]
    }
  },

  // ── Status showcase — one lightweight opportunity per remaining state ──────
  {
    log: "opportunity 5 — RFQ draft (Solstice, second flange variant)",
    ref: "opp:solstice-flange",
    customer: "Solstice Medical Devices",
    rfq: {
      ref: "rfq:solstice-flange",
      status: "Draft",
      rfqDateOffset: -3,
      externalNotes:
        "Inquiry being logged — thin-profile flange variant for the next device rev.",
      lines: [
        {
          item: "MCH-FLANGE-SS",
          customerPartId: "SMD-FLG-0330",
          quantity: [100],
          order: 1
        }
      ]
    }
  },
  {
    log: "opportunity 6 — no-quoted RFQ, lost quote (Cedar Valley mirror rod)",
    ref: "opp:cedarvalley-rod",
    customer: "Cedar Valley Hydraulics",
    rfq: {
      ref: "rfq:cedarvalley-rod",
      status: "Closed",
      rfqDateOffset: -95,
      expirationOffset: -50,
      noQuoteReason: "Tolerance Beyond Capability",
      externalNotes:
        "Mirror-finish piston rod with sub-micron straightness call-out — beyond our grinding capability.",
      lines: [
        {
          item: "MCH-PISTON-ROD",
          customerPartId: "CVH-ROD-7710",
          quantity: [12],
          order: 1
        }
      ]
    },
    quote: {
      ref: "quote:cedarvalley-rod",
      status: "Lost",
      externalNotes: "Declined to bid the mirror-finish rod line.",
      lines: [
        {
          ref: "quoteline:cedarvalley-rod:rod",
          item: "MCH-PISTON-ROD",
          status: "No Quote",
          sortOrder: 1,
          priceBreaks: []
        }
      ]
    }
  },
  {
    log: "opportunity 7 — quote draft (Dominion drive shaft)",
    ref: "opp:dominion-shaft",
    customer: "Dominion Ag Equipment",
    quote: {
      ref: "quote:dominion-shaft",
      status: "Draft",
      externalNotes:
        "Working draft — drive shaft pricing pending the heat-treat quote.",
      lines: [
        {
          ref: "quoteline:dominion-shaft:shaft",
          item: "MCH-SHAFT-DR",
          status: "Not Started",
          sortOrder: 1,
          priceBreaks: [{ quantity: 25, unitPrice: 305, leadTime: 30 }]
        }
      ]
    }
  },
  {
    log: "opportunity 8 — partial quote (Granite State retrofit kit)",
    ref: "opp:granite-retrofit",
    customer: "Granite State Instruments",
    quote: {
      ref: "quote:granite-retrofit",
      status: "Partial",
      expirationOffset: 45,
      externalNotes:
        "End-cap line released to the customer; base frame still in engineering review.",
      lines: [
        {
          ref: "quoteline:granite-retrofit:cap",
          item: "MCH-END-CAP",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 40, unitPrice: 232, leadTime: 35 }]
        },
        {
          ref: "quoteline:granite-retrofit:base",
          item: "FAB-BASE-WLD",
          status: "In Progress",
          sortOrder: 2,
          priceBreaks: [{ quantity: 4, unitPrice: 1450, leadTime: 40 }]
        }
      ]
    }
  },
  {
    log: "opportunity 9 — cancelled quote (Solstice enclosure panels)",
    ref: "opp:solstice-encl",
    customer: "Solstice Medical Devices",
    quote: {
      ref: "quote:solstice-encl",
      status: "Cancelled",
      externalNotes: "Program defunded before pricing was issued.",
      lines: [
        {
          ref: "quoteline:solstice-encl:pnl",
          item: "FAB-ENCL-PNL",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 4, unitPrice: 660, leadTime: 25 }]
        }
      ]
    }
  },
  {
    log: "opportunity 10 — expired quote (Dominion spacer sets)",
    ref: "opp:dominion-spacers",
    customer: "Dominion Ag Equipment",
    quote: {
      ref: "quote:dominion-spacers",
      status: "Expired",
      expirationOffset: -14,
      externalNotes: "30-day pricing lapsed without a PO.",
      lines: [
        {
          ref: "quoteline:dominion-spacers:kit",
          item: "MCH-SPACER-KIT",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 20, unitPrice: 112, leadTime: 20 }]
        }
      ]
    }
  },
  {
    log: "sales order — Needs Approval (Cedar Valley die-spring spares)",
    ref: "opp:cedarvalley-springs",
    customer: "Cedar Valley Hydraulics",
    order: {
      ref: "so:cedarvalley-springs",
      status: "Needs Approval",
      orderDateOffset: -2,
      lines: [
        {
          ref: "soline:cedarvalley-springs:spr",
          item: "SPR-DIE-25",
          saleQuantity: 40,
          unitPrice: 7,
          status: "Ordered"
        }
      ]
    }
  }
];

// One order per remaining job status. Tier 6 hangs exactly one job on each of
// these, so every jobStatus is reachable from an order of its own. The
// opportunities above already carry the In Progress and Ready jobs.
export const STATUS_ORDERS: SalesStatusOrderSpec[] = [
  {
    key: "planned",
    customer: "Granite State Instruments",
    item: "MCH-HSG-PUMP",
    status: "Confirmed",
    lineStatus: "Ordered",
    orderDateOffset: -84,
    unitPrice: 1150
  },
  {
    key: "draft",
    customer: "Solstice Medical Devices",
    item: "MCH-END-CAP",
    status: "Draft",
    lineStatus: "Ordered",
    orderDateOffset: -77,
    unitPrice: 240
  },
  {
    key: "paused",
    customer: "Cedar Valley Hydraulics",
    item: "FAB-BASE-WLD",
    status: "In Progress",
    lineStatus: "In Progress",
    orderDateOffset: -133,
    unitPrice: 1480
  },
  {
    key: "completed",
    customer: "Dominion Ag Equipment",
    item: "ASM-VALVE-SUB",
    status: "Completed",
    lineStatus: "Completed",
    orderDateOffset: -252,
    unitPrice: 890
  },
  {
    key: "closed",
    customer: "Granite State Instruments",
    item: "MCH-SHAFT-DR",
    status: "Closed",
    lineStatus: "Completed",
    orderDateOffset: -280,
    unitPrice: 320
  },
  {
    key: "cancelled",
    customer: "Solstice Medical Devices",
    item: "FAB-ENCL-PNL",
    status: "Cancelled",
    lineStatus: "Ordered",
    orderDateOffset: -175,
    unitPrice: 640
  }
];

// Released order — "To Ship and Invoice". The status is written by the app
// (releaseSalesOrder), not derived by a trigger, but it must still agree with
// what getSalesOrderStatus would compute: nothing sent and nothing invoiced.
export const RELEASED_ORDERS: SalesOpportunitySpec[] = [
  {
    log: "sales order — To Ship and Invoice (Cedar Valley, staggered deliveries)",
    ref: "opp:toshipinvoice",
    customer: "Cedar Valley Hydraulics",
    order: {
      ref: "so:toshipinvoice",
      status: "To Ship and Invoice",
      orderDateOffset: -8,
      lines: STAGGERED_DELIVERIES.map((delivery) => ({
        ref: `soline:toshipinvoice:${delivery.key}`,
        // The tier appends the resolved promised date — it only exists at apply time.
        log: `  delivery ${delivery.key}`,
        item: "MCH-SPACER-KIT",
        saleQuantity: 60,
        unitPrice: 105,
        status: "Ordered",
        promisedDateOffset: delivery.promisedDateOffset,
        sortOrder: delivery.sortOrder
      }))
    }
  },

  // ── Fulfillment lifecycle — posted, partial and voided shipments ──────────
  // Shipped items are well-stocked untracked buy parts (spares sold from the
  // shelf), so the ledger rows never overdraw a bin.
  {
    log: "sales order — To Invoice (Granite State, posted needle-bearing shipment)",
    ref: "opp:granite-bearings",
    customer: "Granite State Instruments",
    order: {
      ref: "so:granite-bearings",
      status: "To Invoice",
      orderDateOffset: -30,
      lines: [
        {
          ref: "soline:granite-bearings:brg",
          item: "BRG-NDL-HK1512",
          saleQuantity: 6,
          unitPrice: 10.5,
          status: "Completed"
        }
      ]
    },
    shipment: {
      ref: "shp:granite-bearings",
      status: "Posted",
      postedOffset: -18,
      lines: [
        {
          item: "BRG-NDL-HK1512",
          orderQuantity: 6,
          outstandingQuantity: 0,
          shippedQuantity: 6,
          unitPrice: 10.5,
          fromShelf: "B1-L3"
        }
      ]
    }
  },
  {
    log: "sales order — To Ship and Invoice (Cedar Valley, partial clevis-pin shipment)",
    ref: "opp:cedarvalley-pins",
    customer: "Cedar Valley Hydraulics",
    order: {
      ref: "so:cedarvalley-pins",
      status: "To Ship and Invoice",
      orderDateOffset: -21,
      lines: [
        {
          ref: "soline:cedarvalley-pins:pin",
          item: "PIN-CLEVIS-12",
          saleQuantity: 24,
          unitPrice: 4,
          status: "In Progress"
        }
      ]
    },
    shipment: {
      ref: "shp:cedarvalley-pins",
      status: "Posted",
      postedOffset: -9,
      lines: [
        {
          item: "PIN-CLEVIS-12",
          orderQuantity: 24,
          outstandingQuantity: 12,
          shippedQuantity: 12,
          unitPrice: 4,
          fromShelf: "B2-L2"
        }
      ]
    }
  },
  {
    log: "sales order — To Ship (Dominion, voided dowel-pin shipment)",
    ref: "opp:dominion-dowels",
    customer: "Dominion Ag Equipment",
    order: {
      ref: "so:dominion-dowels",
      status: "To Ship",
      orderDateOffset: -14,
      lines: [
        {
          ref: "soline:dominion-dowels:dwl",
          item: "HW-DOWEL-8",
          saleQuantity: 50,
          unitPrice: 1.6,
          status: "Ordered"
        }
      ]
    },
    // Wrong carrier account keyed in — voided before anything left the dock.
    shipment: {
      ref: "shp:dominion-dowels",
      status: "Voided",
      lines: [
        {
          item: "HW-DOWEL-8",
          orderQuantity: 50,
          outstandingQuantity: 50,
          shippedQuantity: 0,
          unitPrice: 1.6
        }
      ]
    }
  },

  // ── Invoice lifecycle — one order+invoice per remaining status ────────────
  // Modest spares invoices; accounting.ts settles "paid" and "partial" by their
  // sinv keys.
  {
    log: "sales invoice — Submitted (Solstice cap-screw spares)",
    ref: "opp:solstice-screws",
    customer: "Solstice Medical Devices",
    order: {
      ref: "so:solstice-screws",
      status: "Invoiced",
      orderDateOffset: -35,
      lines: [
        {
          ref: "soline:solstice-screws:hw",
          item: "HW-SHCS-M6",
          saleQuantity: 200,
          unitPrice: 0.75,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:solstice-screws",
      key: "submitted",
      status: "Submitted",
      subtotal: 150,
      totalAmount: 150,
      dateIssuedOffset: -20,
      dueDateOffset: 10,
      lines: [{ item: "HW-SHCS-M6", quantity: 200, unitPrice: 0.75 }]
    }
  },
  {
    log: "sales invoice — Overdue (Granite State 316L plate remnant)",
    ref: "opp:granite-plate",
    customer: "Granite State Instruments",
    order: {
      ref: "so:granite-plate",
      status: "Invoiced",
      orderDateOffset: -60,
      lines: [
        {
          ref: "soline:granite-plate:plt",
          item: "MAT-SS316-PLT",
          saleQuantity: 40,
          unitPrice: 9,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:granite-plate",
      key: "overdue",
      status: "Overdue",
      subtotal: 360,
      totalAmount: 360,
      dateIssuedOffset: -45,
      dueDateOffset: -15,
      lines: [{ item: "MAT-SS316-PLT", quantity: 40, unitPrice: 9 }]
    }
  },
  {
    log: "sales invoice — Paid (Cedar Valley threaded-insert lot)",
    ref: "opp:cedarvalley-inserts",
    customer: "Cedar Valley Hydraulics",
    order: {
      ref: "so:cedarvalley-inserts",
      status: "Closed",
      orderDateOffset: -90,
      lines: [
        {
          ref: "soline:cedarvalley-inserts:ins",
          item: "INS-HELI-M6",
          saleQuantity: 300,
          unitPrice: 1.15,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:cedarvalley-inserts",
      key: "paid",
      status: "Paid",
      subtotal: 345,
      totalAmount: 345,
      dateIssuedOffset: -75,
      dueDateOffset: -45,
      lines: [{ item: "INS-HELI-M6", quantity: 300, unitPrice: 1.15 }]
    }
  },
  {
    log: "sales invoice — Partially Paid (Dominion bronze bushings)",
    ref: "opp:dominion-bushings",
    customer: "Dominion Ag Equipment",
    order: {
      ref: "so:dominion-bushings",
      status: "Invoiced",
      orderDateOffset: -50,
      lines: [
        {
          ref: "soline:dominion-bushings:bsh",
          item: "BSH-BRZ-2012",
          saleQuantity: 24,
          unitPrice: 6.5,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:dominion-bushings",
      key: "partial",
      status: "Partially Paid",
      subtotal: 156,
      totalAmount: 156,
      dateIssuedOffset: -38,
      dueDateOffset: -8,
      lines: [{ item: "BSH-BRZ-2012", quantity: 24, unitPrice: 6.5 }]
    }
  },
  {
    log: "sales invoice — Voided (Solstice M10 cap screws, wrong bill-to)",
    ref: "opp:solstice-capscrews",
    customer: "Solstice Medical Devices",
    order: {
      ref: "so:solstice-capscrews",
      status: "To Invoice",
      orderDateOffset: -28,
      lines: [
        {
          ref: "soline:solstice-capscrews:hw",
          item: "HW-SHCS-M10",
          saleQuantity: 100,
          unitPrice: 1.85,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:solstice-capscrews",
      key: "voided",
      status: "Voided",
      subtotal: 185,
      totalAmount: 185,
      dateIssuedOffset: -25,
      lines: [{ item: "HW-SHCS-M10", quantity: 100, unitPrice: 1.85 }]
    }
  },
  {
    log: "sales invoice — Credit Note Issued (Granite State 5052 sheet remnant)",
    ref: "opp:granite-sheet",
    customer: "Granite State Instruments",
    order: {
      ref: "so:granite-sheet",
      status: "Closed",
      orderDateOffset: -70,
      lines: [
        {
          ref: "soline:granite-sheet:sht",
          item: "MAT-AL5052-SHT",
          saleQuantity: 50,
          unitPrice: 4.5,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:granite-sheet",
      key: "credit",
      status: "Credit Note Issued",
      subtotal: 225,
      totalAmount: 225,
      dateIssuedOffset: -55,
      dueDateOffset: -25,
      lines: [{ item: "MAT-AL5052-SHT", quantity: 50, unitPrice: 4.5 }]
    }
  }
];

// RMAs — one per modeled status, returning small quantities of the spares the
// posted shipments above actually sent out. The Completed one books stock back
// into the bin it shipped from.
export const SALES_RETURNS: SalesReturnSpec[] = [
  {
    key: "needle-bearing",
    status: "Completed",
    customer: "Granite State Instruments",
    returnReason: "Defective",
    dateOffset: -12,
    salesOrder: "so:granite-bearings",
    lines: [
      { item: "BRG-NDL-HK1512", quantity: 1, unitPrice: 10.5, toShelf: "B1-L3" }
    ]
  },
  {
    key: "clevis-pins",
    status: "To Receive",
    customer: "Cedar Valley Hydraulics",
    returnReason: "Damaged in Transit",
    dateOffset: -5,
    salesOrder: "so:cedarvalley-pins",
    lines: [{ item: "PIN-CLEVIS-12", quantity: 2, unitPrice: 4 }]
  },
  {
    key: "cap-screws",
    status: "Draft",
    customer: "Solstice Medical Devices",
    returnReason: "No Longer Needed",
    dateOffset: -1,
    salesOrder: "so:solstice-screws",
    lines: [{ item: "HW-SHCS-M6", quantity: 40, unitPrice: 0.75 }]
  }
];

export const precisionSales: SalesData = {
  opportunities: OPPORTUNITIES,
  statusOrders: STATUS_ORDERS,
  releasedOrders: RELEASED_ORDERS,
  salesReturns: SALES_RETURNS
};
