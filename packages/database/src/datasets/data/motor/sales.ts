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

export const MTR9000_PRICE_BREAKS: readonly PriceBreak[] = [
  { quantity: 5, unitPrice: 4850, leadTime: 70 },
  { quantity: 25, unitPrice: 4610, leadTime: 84, discountPercent: 0.05 },
  { quantity: 50, unitPrice: 4365, leadTime: 98, discountPercent: 0.1 },
  { quantity: 100, unitPrice: 4120, leadTime: 126, discountPercent: 0.15 }
];

export const MTR4500_PRICE_BREAKS: readonly PriceBreak[] = [
  { quantity: 10, unitPrice: 2950, leadTime: 56 },
  {
    quantity: 50,
    unitPrice: 2760,
    leadTime: 70,
    discountPercent: 0.06,
    shippingCost: 640
  }
];

// The Sent quote is the one the docs screenshot at /share/quote/:externalLinkId.
// The expiration offset must stay positive or the public page renders its
// Expired state instead of the quote.
export const CARDINAL_QUOTE_EXPIRATION_OFFSET = 298;

// Three deliveries of the same make part, three weeks apart. Gives the docs a
// real delivery schedule, and three Make to Order lines with no job attached is
// what puts the "Jobs Required" / Create Jobs card on the order.
export const STAGGERED_DELIVERIES: StaggeredDeliverySpec[] = [
  { key: "1", promisedDateOffset: 22, sortOrder: 1 },
  { key: "2", promisedDateOffset: 43, sortOrder: 2 },
  { key: "3", promisedDateOffset: 64, sortOrder: 3 }
];

export const OPPORTUNITIES: SalesOpportunitySpec[] = [
  {
    log: "opportunity 1 — full chain (Ridgeline)",
    ref: "opp:ridgeline",
    customer: "Ridgeline Drive Systems",
    rfq: {
      ref: "rfq:ridgeline",
      status: "Quoted",
      rfqDateOffset: -377,
      expirationOffset: -316,
      externalNotes:
        "Conveyor drive refresh — 6 servo motors with encoder feedback.",
      lines: [
        {
          item: "MTR-9000",
          customerPartId: "RDS-MTR-9000",
          quantity: [6],
          order: 1
        }
      ]
    },
    quote: {
      ref: "quote:ridgeline",
      createdOffset: -328,
      status: "Ordered",
      externalNotes:
        "Quote for 6x TD-9000 servo motors, 2048 PPR encoder, IP55 terminal box.",
      lines: [
        {
          ref: "quoteline:ridgeline:mtr",
          item: "MTR-9000",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 6, unitPrice: 4700, leadTime: 75 }]
        }
      ]
    },
    order: {
      ref: "so:ridgeline",
      status: "In Progress",
      orderDateOffset: -302,
      lines: [
        {
          ref: "soline:ridgeline:mtr",
          item: "MTR-9000",
          saleQuantity: 6,
          unitPrice: 4700,
          status: "In Progress"
        }
      ]
    },
    shipment: {
      ref: "shp:ridgeline",
      status: "Draft",
      lines: [
        {
          item: "MTR-9000",
          orderQuantity: 6,
          outstandingQuantity: 6,
          shippedQuantity: 0,
          unitPrice: 4700
        }
      ]
    },
    invoice: {
      ref: "inv:ridgeline",
      status: "Draft",
      subtotal: 28200,
      totalAmount: 28200,
      dateIssuedOffset: -285,
      lines: [{ item: "MTR-9000", quantity: 6, unitPrice: 4700 }]
    }
  },
  {
    log: "opportunity 2 — quote sent (Cardinal)",
    ref: "opp:cardinal",
    customer: "Cardinal Motorworks",
    quote: {
      ref: "quote:cardinal",
      createdOffset: -19,
      assignee: "self",
      status: "Sent",
      expirationOffset: CARDINAL_QUOTE_EXPIRATION_OFFSET,
      lines: [
        {
          ref: "quoteline:cardinal:mtr9000",
          configuration: {
            shaft_extension_mm: 60,
            mounting_flange: "NEMA C-Face",
            holding_brake: false
          },
          item: "MTR-9000",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: MTR9000_PRICE_BREAKS
        },
        {
          ref: "quoteline:cardinal:mtr4500",
          item: "MTR-4500",
          status: "Complete",
          sortOrder: 2,
          priceBreaks: MTR4500_PRICE_BREAKS
        }
      ],
      externalLink: {
        ref: "quotelink:cardinal",
        expiresOffset: CARDINAL_QUOTE_EXPIRATION_OFFSET
      }
    }
  },
  {
    log: "opportunity 3 — RFQ only (Wabash)",
    ref: "opp:wabash",
    customer: "Wabash Industrial Supply",
    rfq: {
      ref: "rfq:wabash",
      assignee: "self",
      status: "Ready for Quote",
      rfqDateOffset: -285,
      externalNotes:
        "Distribution stocking request — spare 9000-frame stator assemblies.",
      lines: [
        {
          item: "STA-9000",
          customerPartId: "WIS-STA-9000",
          quantity: [4],
          order: 1
        }
      ]
    }
  },
  {
    log: "opportunity 4 — confirmed SO (Halcyon)",
    ref: "opp:halcyon",
    customer: "Halcyon Aerospace Actuation",
    quote: {
      ref: "quote:halcyon",
      createdOffset: -268,
      status: "Ordered",
      lines: [
        {
          ref: "quoteline:halcyon:mtr",
          item: "MTR-4500",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 4, unitPrice: 3120, leadTime: 63 }]
        }
      ]
    },
    order: {
      ref: "so:halcyon",
      status: "Confirmed",
      orderDateOffset: -255,
      lines: [
        {
          ref: "soline:halcyon:mtr",
          item: "MTR-4500",
          saleQuantity: 4,
          unitPrice: 3120,
          status: "Ordered"
        }
      ]
    }
  },

  // ── Status showcase — one lightweight opportunity per remaining state ──────
  {
    log: "opportunity 5 — RFQ draft (Wabash, spare housing sets)",
    ref: "opp:wabash-housing",
    customer: "Wabash Industrial Supply",
    rfq: {
      ref: "rfq:wabash-housing",
      assignee: "self",
      status: "Draft",
      rfqDateOffset: -3,
      externalNotes:
        "Inquiry being logged — spare housing & end-bell sets for the 9000 frame.",
      lines: [
        {
          item: "HSG-9000",
          customerPartId: "WIS-HSG-9000",
          quantity: [2],
          order: 1
        }
      ]
    }
  },
  {
    log: "opportunity 6 — no-quoted RFQ, lost quote (Ridgeline explosion-proof)",
    ref: "opp:ridgeline-exproof",
    customer: "Ridgeline Drive Systems",
    rfq: {
      ref: "rfq:ridgeline-exproof",
      status: "Closed",
      rfqDateOffset: -95,
      expirationOffset: -50,
      noQuoteReason: "Out of Scope",
      externalNotes:
        "Explosion-proof TD-9000 variant — outside our hazardous-location certification.",
      lines: [
        {
          item: "MTR-9000",
          customerPartId: "RDS-MTR-EXP1",
          quantity: [3],
          order: 1
        }
      ]
    },
    quote: {
      ref: "quote:ridgeline-exproof",
      createdOffset: -78,
      status: "Lost",
      externalNotes: "Declined to bid the explosion-proof line.",
      lines: [
        {
          ref: "quoteline:ridgeline-exproof:mtr",
          item: "MTR-9000",
          status: "No Quote",
          sortOrder: 1,
          priceBreaks: []
        }
      ]
    }
  },
  {
    log: "opportunity 7 — quote draft (Halcyon trainer actuator motor)",
    ref: "opp:halcyon-trainer",
    customer: "Halcyon Aerospace Actuation",
    quote: {
      ref: "quote:halcyon-trainer",
      createdOffset: -6,
      assignee: "self",
      status: "Draft",
      externalNotes:
        "Working draft — trainer-aircraft actuator motor pricing in progress.",
      lines: [
        {
          ref: "quoteline:halcyon-trainer:mtr",
          item: "MTR-4500",
          status: "Not Started",
          sortOrder: 1,
          priceBreaks: [{ quantity: 2, unitPrice: 3050, leadTime: 60 }]
        }
      ]
    }
  },
  {
    log: "opportunity 8 — partial quote (Cardinal driveline subassemblies)",
    ref: "opp:cardinal-driveline",
    customer: "Cardinal Motorworks",
    quote: {
      ref: "quote:cardinal-driveline",
      createdOffset: -10,
      status: "Partial",
      expirationOffset: 45,
      externalNotes:
        "Stator line released to the customer; rotor line still in engineering review.",
      lines: [
        {
          ref: "quoteline:cardinal-driveline:sta",
          item: "STA-9000",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 4, unitPrice: 1150, leadTime: 45 }]
        },
        {
          ref: "quoteline:cardinal-driveline:rot",
          item: "ROT-9000",
          status: "In Progress",
          sortOrder: 2,
          priceBreaks: [{ quantity: 4, unitPrice: 1390, leadTime: 50 }]
        }
      ]
    }
  },
  {
    log: "opportunity 9 — cancelled quote (Wabash shaft stocking program)",
    ref: "opp:wabash-shafts",
    customer: "Wabash Industrial Supply",
    quote: {
      ref: "quote:wabash-shafts",
      createdOffset: -148,
      status: "Cancelled",
      externalNotes: "Stocking program shelved before pricing was issued.",
      lines: [
        {
          ref: "quoteline:wabash-shafts:shf",
          item: "SHF-9000",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 10, unitPrice: 205, leadTime: 30 }]
        }
      ]
    }
  },
  {
    log: "opportunity 10 — expired quote (Ridgeline spare coil sets)",
    ref: "opp:ridgeline-coils",
    customer: "Ridgeline Drive Systems",
    quote: {
      ref: "quote:ridgeline-coils",
      createdOffset: -45,
      status: "Expired",
      expirationOffset: -14,
      externalNotes: "30-day pricing lapsed without a PO.",
      lines: [
        {
          ref: "quoteline:ridgeline-coils:coil",
          item: "COIL-9000",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 6, unitPrice: 470, leadTime: 40 }]
        }
      ]
    }
  },
  {
    log: "sales order — Needs Approval (Halcyon hybrid bearing spares)",
    ref: "opp:halcyon-bearings",
    customer: "Halcyon Aerospace Actuation",
    order: {
      ref: "so:halcyon-bearings",
      assignee: "self",
      status: "Needs Approval",
      orderDateOffset: -2,
      lines: [
        {
          ref: "soline:halcyon-bearings:brg",
          item: "BRG-6206-HYB",
          saleQuantity: 4,
          unitPrice: 52,
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
    customer: "Cardinal Motorworks",
    item: "STA-9000",
    status: "Confirmed",
    lineStatus: "Ordered",
    orderDateOffset: -220,
    unitPrice: 1180
  },
  {
    key: "draft",
    customer: "Wabash Industrial Supply",
    item: "HSG-9000",
    status: "Draft",
    lineStatus: "Ordered",
    orderDateOffset: -213,
    unitPrice: 640
  },
  {
    key: "paused",
    customer: "Ridgeline Drive Systems",
    item: "ROT-9000",
    status: "In Progress",
    lineStatus: "In Progress",
    orderDateOffset: -268,
    unitPrice: 1420
  },
  {
    key: "completed",
    customer: "Halcyon Aerospace Actuation",
    item: "TRM-BOX-9000",
    status: "Completed",
    lineStatus: "Completed",
    orderDateOffset: -437,
    unitPrice: 165
  },
  {
    key: "closed",
    customer: "Cardinal Motorworks",
    item: "COIL-9000",
    status: "Closed",
    lineStatus: "Completed",
    orderDateOffset: -456,
    unitPrice: 480
  },
  {
    key: "cancelled",
    customer: "Wabash Industrial Supply",
    item: "SHF-9000",
    status: "Cancelled",
    lineStatus: "Ordered",
    orderDateOffset: -339,
    unitPrice: 210
  }
];

// Released order — "To Ship and Invoice". The status is written by the app
// (releaseSalesOrder), not derived by a trigger, but it must still agree with
// what getSalesOrderStatus would compute: nothing sent and nothing invoiced.
export const RELEASED_ORDERS: SalesOpportunitySpec[] = [
  {
    log: "sales order — To Ship and Invoice (Cardinal, staggered deliveries)",
    ref: "opp:toshipinvoice",
    customer: "Cardinal Motorworks",
    order: {
      ref: "so:toshipinvoice",
      assignee: "self",
      status: "To Ship and Invoice",
      orderDateOffset: -10,
      lines: STAGGERED_DELIVERIES.map((delivery) => ({
        ref: `soline:toshipinvoice:${delivery.key}`,
        // The tier appends the resolved promised date — it only exists at apply time.
        log: `  delivery ${delivery.key}`,
        item: "MTR-4500",
        saleQuantity: 10,
        unitPrice: 2900,
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
    log: "sales order — To Invoice (Cardinal, posted spare-fan shipment)",
    ref: "opp:cardinal-fans",
    customer: "Cardinal Motorworks",
    order: {
      ref: "so:cardinal-fans",
      status: "To Invoice",
      orderDateOffset: -30,
      lines: [
        {
          ref: "soline:cardinal-fans:fan",
          item: "FAN-AX-160",
          saleQuantity: 2,
          unitPrice: 52,
          status: "Completed"
        }
      ]
    },
    shipment: {
      ref: "shp:cardinal-fans",
      status: "Posted",
      postedOffset: -18,
      lines: [
        {
          item: "FAN-AX-160",
          orderQuantity: 2,
          outstandingQuantity: 0,
          shippedQuantity: 2,
          unitPrice: 52,
          fromShelf: "A2-L3"
        }
      ]
    }
  },
  {
    log: "sales order — To Ship and Invoice (Ridgeline, partial bearing shipment)",
    ref: "opp:ridgeline-bearings",
    customer: "Ridgeline Drive Systems",
    order: {
      ref: "so:ridgeline-bearings",
      status: "To Ship and Invoice",
      orderDateOffset: -21,
      lines: [
        {
          ref: "soline:ridgeline-bearings:brg",
          item: "BRG-6308-C3",
          saleQuantity: 4,
          unitPrice: 41,
          status: "In Progress"
        }
      ]
    },
    shipment: {
      ref: "shp:ridgeline-bearings",
      status: "Posted",
      postedOffset: -9,
      lines: [
        {
          item: "BRG-6308-C3",
          orderQuantity: 4,
          outstandingQuantity: 2,
          shippedQuantity: 2,
          unitPrice: 41,
          fromShelf: "A2-L1"
        }
      ]
    }
  },
  {
    log: "sales order — To Ship (Wabash, voided terminal-block shipment)",
    ref: "opp:wabash-terminals",
    customer: "Wabash Industrial Supply",
    order: {
      ref: "so:wabash-terminals",
      status: "To Ship",
      orderDateOffset: -14,
      lines: [
        {
          ref: "soline:wabash-terminals:trm",
          item: "TRM-BLK-6P",
          saleQuantity: 8,
          unitPrice: 14,
          status: "Ordered"
        }
      ]
    },
    // Wrong carrier account keyed in — voided before anything left the dock.
    shipment: {
      ref: "shp:wabash-terminals",
      status: "Voided",
      lines: [
        {
          item: "TRM-BLK-6P",
          orderQuantity: 8,
          outstandingQuantity: 8,
          shippedQuantity: 0,
          unitPrice: 14
        }
      ]
    }
  },

  // ── Invoice lifecycle — one order+invoice per remaining status ────────────
  // Modest spares invoices; accounting.ts settles "paid" and "partial" by their
  // sinv keys.
  {
    log: "sales invoice — Submitted (Halcyon shaft-seal spares)",
    ref: "opp:halcyon-seals",
    customer: "Halcyon Aerospace Actuation",
    order: {
      ref: "so:halcyon-seals",
      status: "Invoiced",
      orderDateOffset: -35,
      lines: [
        {
          ref: "soline:halcyon-seals:seal",
          item: "SEAL-VR-45",
          saleQuantity: 20,
          unitPrice: 6,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:halcyon-seals",
      key: "submitted",
      status: "Submitted",
      subtotal: 120,
      totalAmount: 120,
      dateIssuedOffset: -20,
      dueDateOffset: 10,
      lines: [{ item: "SEAL-VR-45", quantity: 20, unitPrice: 6 }]
    }
  },
  {
    log: "sales invoice — Overdue (Cardinal spare stator)",
    ref: "opp:cardinal-stator",
    customer: "Cardinal Motorworks",
    order: {
      ref: "so:cardinal-stator",
      status: "Invoiced",
      orderDateOffset: -60,
      lines: [
        {
          ref: "soline:cardinal-stator:sta",
          item: "STA-4500",
          saleQuantity: 1,
          unitPrice: 780,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:cardinal-stator",
      key: "overdue",
      status: "Overdue",
      subtotal: 780,
      totalAmount: 780,
      dateIssuedOffset: -45,
      dueDateOffset: -15,
      lines: [{ item: "STA-4500", quantity: 1, unitPrice: 780 }]
    }
  },
  {
    log: "sales invoice — Paid (Wabash stainless cap-screw lot)",
    ref: "opp:wabash-fasteners",
    customer: "Wabash Industrial Supply",
    order: {
      ref: "so:wabash-fasteners",
      status: "Closed",
      orderDateOffset: -90,
      lines: [
        {
          ref: "soline:wabash-fasteners:fst",
          item: "FST-M6-SS",
          saleQuantity: 400,
          unitPrice: 0.75,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:wabash-fasteners",
      key: "paid",
      status: "Paid",
      subtotal: 300,
      totalAmount: 300,
      dateIssuedOffset: -75,
      dueDateOffset: -45,
      lines: [{ item: "FST-M6-SS", quantity: 400, unitPrice: 0.75 }]
    }
  },
  {
    log: "sales invoice — Partially Paid (Ridgeline spare rotor)",
    ref: "opp:ridgeline-rotor",
    customer: "Ridgeline Drive Systems",
    order: {
      ref: "so:ridgeline-rotor",
      status: "Invoiced",
      orderDateOffset: -50,
      lines: [
        {
          ref: "soline:ridgeline-rotor:rot",
          item: "ROT-9000",
          saleQuantity: 1,
          unitPrice: 1420,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:ridgeline-rotor",
      key: "partial",
      status: "Partially Paid",
      subtotal: 1420,
      totalAmount: 1420,
      dateIssuedOffset: -38,
      dueDateOffset: -8,
      lines: [{ item: "ROT-9000", quantity: 1, unitPrice: 1420 }]
    }
  },
  {
    log: "sales invoice — Voided (Halcyon hex bolts, wrong bill-to)",
    ref: "opp:halcyon-bolts",
    customer: "Halcyon Aerospace Actuation",
    order: {
      ref: "so:halcyon-bolts",
      status: "To Invoice",
      orderDateOffset: -28,
      lines: [
        {
          ref: "soline:halcyon-bolts:fst",
          item: "FST-M10-SS",
          saleQuantity: 100,
          unitPrice: 1.9,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:halcyon-bolts",
      key: "voided",
      status: "Voided",
      subtotal: 190,
      totalAmount: 190,
      dateIssuedOffset: -25,
      lines: [{ item: "FST-M10-SS", quantity: 100, unitPrice: 1.9 }]
    }
  },
  {
    log: "sales invoice — Credit Note Issued (Cardinal precision shafts)",
    ref: "opp:cardinal-shafts",
    customer: "Cardinal Motorworks",
    order: {
      ref: "so:cardinal-shafts",
      status: "Closed",
      orderDateOffset: -70,
      lines: [
        {
          ref: "soline:cardinal-shafts:shf",
          item: "SHF-9000",
          saleQuantity: 2,
          unitPrice: 205,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:cardinal-shafts",
      key: "credit",
      status: "Credit Note Issued",
      subtotal: 410,
      totalAmount: 410,
      dateIssuedOffset: -55,
      dueDateOffset: -25,
      lines: [{ item: "SHF-9000", quantity: 2, unitPrice: 205 }]
    }
  },

  // Older overdue invoices, so receivables aging fills every bucket to 61–90.
  {
    log: "sales invoice — Overdue 31–60 days (Wabash V-ring seals)",
    ref: "opp:wabash-seals",
    customer: "Wabash Industrial Supply",
    order: {
      ref: "so:wabash-seals",
      status: "Invoiced",
      orderDateOffset: -90,
      lines: [
        {
          ref: "soline:wabash-seals:seal",
          item: "SEAL-VR-45",
          saleQuantity: 50,
          unitPrice: 6,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:wabash-seals",
      status: "Overdue",
      subtotal: 300,
      totalAmount: 300,
      dateIssuedOffset: -75,
      dueDateOffset: -45,
      lines: [{ item: "SEAL-VR-45", quantity: 50, unitPrice: 6 }]
    }
  },
  {
    log: "sales invoice — Overdue 61–90 days (Halcyon 4500 stator)",
    ref: "opp:halcyon-stator",
    customer: "Halcyon Aerospace Actuation",
    order: {
      ref: "so:halcyon-stator",
      status: "Invoiced",
      orderDateOffset: -120,
      lines: [
        {
          ref: "soline:halcyon-stator:sta",
          item: "STA-4500",
          saleQuantity: 1,
          unitPrice: 780,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:halcyon-stator",
      status: "Overdue",
      subtotal: 780,
      totalAmount: 780,
      dateIssuedOffset: -105,
      dueDateOffset: -75,
      lines: [{ item: "STA-4500", quantity: 1, unitPrice: 780 }]
    }
  },

  // ── Floor load — the stator, rotor and shaft work the floor is building ──
  // Each line has a job of its own in production.ts (open or just completed).
  {
    log: "sales order — In Progress (Ridgeline stator and rotor spares, floor load)",
    ref: "opp:floor-ridgeline",
    customer: "Ridgeline Drive Systems",
    order: {
      ref: "so:floor-ridgeline",
      status: "In Progress",
      orderDateOffset: -30,
      lines: [
        {
          ref: "soline:floor-ridgeline:coil",
          item: "COIL-9000",
          saleQuantity: 4,
          unitPrice: 480,
          status: "In Progress",
          promisedDateOffset: 3
        },
        {
          ref: "soline:floor-ridgeline:lam-rotor",
          item: "LAM-STK-ROT",
          saleQuantity: 10,
          unitPrice: 190,
          status: "In Progress",
          promisedDateOffset: 3
        },
        {
          ref: "soline:floor-ridgeline:rotor",
          item: "ROT-9000",
          saleQuantity: 1,
          unitPrice: 1420,
          status: "In Progress",
          promisedDateOffset: 4
        },
        {
          ref: "soline:floor-ridgeline:shaft",
          item: "SHF-9000",
          saleQuantity: 8,
          unitPrice: 210,
          status: "In Progress",
          promisedDateOffset: 15
        },
        {
          ref: "soline:floor-ridgeline:termbox",
          item: "TRM-BOX-9000",
          saleQuantity: 10,
          unitPrice: 165,
          status: "In Progress",
          promisedDateOffset: 2
        },
        {
          ref: "soline:floor-ridgeline:stator",
          item: "STA-4500",
          saleQuantity: 4,
          unitPrice: 780,
          status: "In Progress",
          promisedDateOffset: 5
        }
      ]
    }
  },
  {
    log: "sales order — In Progress (Halcyon actuator motor kits, floor load)",
    ref: "opp:floor-halcyon",
    customer: "Halcyon Aerospace Actuation",
    order: {
      ref: "so:floor-halcyon",
      assignee: "self",
      status: "In Progress",
      orderDateOffset: -15,
      lines: [
        {
          ref: "soline:floor-halcyon:lam-rotor",
          item: "LAM-STK-ROT",
          saleQuantity: 12,
          unitPrice: 190,
          status: "In Progress",
          promisedDateOffset: 8
        },
        {
          ref: "soline:floor-halcyon:coil",
          item: "COIL-9000",
          saleQuantity: 6,
          unitPrice: 480,
          status: "In Progress",
          promisedDateOffset: 10
        },
        {
          ref: "soline:floor-halcyon:housing",
          item: "HSG-9000",
          saleQuantity: 4,
          unitPrice: 640,
          status: "In Progress",
          promisedDateOffset: 24
        },
        {
          ref: "soline:floor-halcyon:rotor",
          item: "ROT-9000",
          saleQuantity: 2,
          unitPrice: 1420,
          status: "In Progress",
          promisedDateOffset: 19
        },
        {
          ref: "soline:floor-halcyon:lam-stator",
          item: "LAM-STK-STA",
          saleQuantity: 6,
          unitPrice: 260,
          status: "In Progress",
          promisedDateOffset: 30
        }
      ]
    }
  }
];

// RMAs — one per modeled status, returning small quantities of the spares the
// posted shipments above actually sent out. The Completed one books stock back
// into the shelf it shipped from.
export const SALES_RETURNS: SalesReturnSpec[] = [
  {
    key: "fan",
    credit: {
      status: "Posted",
      dateOffset: -8,
      lines: [{ line: 1, quantity: 1 }]
    },
    status: "Completed",
    customer: "Cardinal Motorworks",
    returnReason: "Defective",
    dateOffset: -12,
    salesOrder: "so:cardinal-fans",
    lines: [
      { item: "FAN-AX-160", quantity: 1, unitPrice: 52, toShelf: "A2-L3" }
    ]
  },
  {
    key: "bearing",
    status: "To Receive",
    customer: "Ridgeline Drive Systems",
    returnReason: "Damaged in Transit",
    dateOffset: -5,
    salesOrder: "so:ridgeline-bearings",
    lines: [{ item: "BRG-6308-C3", quantity: 1, unitPrice: 41 }]
  },
  {
    key: "seals",
    status: "Draft",
    customer: "Halcyon Aerospace Actuation",
    returnReason: "No Longer Needed",
    dateOffset: -1,
    salesOrder: "so:halcyon-seals",
    lines: [{ item: "SEAL-VR-45", quantity: 4, unitPrice: 6 }]
  }
];

export const motorSales: SalesData = {
  opportunities: OPPORTUNITIES,
  statusOrders: STATUS_ORDERS,
  releasedOrders: RELEASED_ORDERS,
  salesReturns: SALES_RETURNS,
  customerPortals: ["Ridgeline Drive Systems", "Cardinal Motorworks"],
  customerBankAccounts: [
    {
      customer: "Ridgeline Drive Systems",
      name: "Ridgeline remittance",
      bankName: "Three Rivers Bank (demo)",
      accountHolderName: "Ridgeline Drive Systems Inc.",
      countryCode: "US",
      currencyCode: "USD",
      accountNumber: "DEMO-2846-5510",
      bankCode: "DEMO-074000",
      isPrimary: true
    },
    {
      customer: "Cardinal Motorworks",
      name: "Cardinal operating",
      bankName: "Motor City Commerce (demo)",
      accountHolderName: "Cardinal Motorworks LLC",
      countryCode: "US",
      currencyCode: "USD",
      accountNumber: "DEMO-3957-6621",
      isPrimary: true
    },
    {
      customer: "Halcyon Aerospace Actuation",
      name: "Halcyon payables",
      bankName: "Front Range Aerospace CU (demo)",
      accountHolderName: "Halcyon Aerospace Actuation Corp.",
      countryCode: "US",
      currencyCode: "USD",
      accountNumber: "DEMO-5068-7732",
      bankCode: "DEMO-102000",
      isPrimary: true
    },
    {
      customer: "Wabash Industrial Supply",
      name: "Wabash operating",
      bankName: "Wabash Valley Bank (demo)",
      accountHolderName: "Wabash Industrial Supply Co.",
      countryCode: "US",
      currencyCode: "USD",
      accountNumber: "DEMO-6179-8843",
      isPrimary: true
    }
  ]
};
