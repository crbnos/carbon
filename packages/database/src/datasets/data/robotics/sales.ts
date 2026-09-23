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

export const ROB_PRICE_BREAKS: readonly PriceBreak[] = [
  { quantity: 1, unitPrice: 58000, leadTime: 120 },
  { quantity: 5, unitPrice: 55500, leadTime: 140, discountPercent: 0.03 },
  { quantity: 10, unitPrice: 52200, leadTime: 160, discountPercent: 0.06 },
  { quantity: 25, unitPrice: 48800, leadTime: 200, discountPercent: 0.1 }
];

export const CTRL_PRICE_BREAKS: readonly PriceBreak[] = [
  { quantity: 2, unitPrice: 11500, leadTime: 60 },
  {
    quantity: 10,
    unitPrice: 10600,
    leadTime: 75,
    discountPercent: 0.05,
    shippingCost: 850
  }
];

// The Sent quote is the one the docs screenshot at /share/quote/:externalLinkId.
// The expiration offset must stay positive or the public page renders its
// Expired state instead of the quote.
export const CASCADE_QUOTE_EXPIRATION_OFFSET = 321;

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
    log: "opportunity 1 — full chain (Lakeshore)",
    ref: "opp:lakeshore",
    customer: "Lakeshore Automotive",
    rfq: {
      ref: "rfq:lakeshore",
      status: "Quoted",
      rfqDateOffset: -377,
      expirationOffset: -316,
      externalNotes: "Body-in-white weld cell retrofit — 3 six-axis arms.",
      lines: [
        {
          item: "ROB-2000",
          customerPartId: "LKS-ROB-001",
          quantity: [3],
          order: 1
        }
      ]
    },
    quote: {
      ref: "quote:lakeshore",
      createdOffset: -330,
      status: "Ordered",
      externalNotes:
        "Quote for 3× Vertex 10 six-axis arms with two-finger grippers.",
      lines: [
        {
          ref: "quoteline:lakeshore:rob",
          item: "ROB-2000",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 3, unitPrice: 54000, leadTime: 130 }]
        }
      ]
    },
    order: {
      ref: "so:lakeshore",
      status: "In Progress",
      orderDateOffset: -302,
      lines: [
        {
          ref: "soline:lakeshore:rob",
          item: "ROB-2000",
          saleQuantity: 3,
          unitPrice: 54000,
          status: "In Progress"
        }
      ]
    },
    shipment: {
      ref: "shp:lakeshore",
      status: "Draft",
      lines: [
        {
          item: "ROB-2000",
          orderQuantity: 3,
          outstandingQuantity: 3,
          shippedQuantity: 0,
          unitPrice: 54000
        }
      ]
    },
    invoice: {
      ref: "inv:lakeshore",
      status: "Draft",
      subtotal: 162000,
      totalAmount: 162000,
      dateIssuedOffset: -285,
      lines: [{ item: "ROB-2000", quantity: 3, unitPrice: 54000 }]
    }
  },
  {
    log: "opportunity 2 — quote sent (Cascade)",
    ref: "opp:cascade",
    customer: "Cascade Integration Group",
    quote: {
      ref: "quote:cascade",
      createdOffset: -22,
      assignee: "self",
      status: "Sent",
      expirationOffset: CASCADE_QUOTE_EXPIRATION_OFFSET,
      lines: [
        {
          ref: "quoteline:cascade:rob",
          item: "ROB-2000",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: ROB_PRICE_BREAKS
        },
        {
          ref: "quoteline:cascade:ctrl",
          item: "CTRL-100",
          status: "Complete",
          sortOrder: 2,
          priceBreaks: CTRL_PRICE_BREAKS
        }
      ],
      externalLink: {
        ref: "quotelink:cascade",
        expiresOffset: CASCADE_QUOTE_EXPIRATION_OFFSET
      }
    }
  },
  {
    log: "opportunity 3 — RFQ only (Alpine)",
    ref: "opp:alpine",
    customer: "Alpine Research Institute",
    rfq: {
      ref: "rfq:alpine",
      assignee: "self",
      status: "Ready for Quote",
      rfqDateOffset: -285,
      externalNotes:
        "University robotics lab — 1 base assembly for a manipulation test rig.",
      lines: [
        {
          item: "ARM-BASE-001",
          customerPartId: "ALP-BASE-001",
          quantity: [1],
          order: 1
        }
      ]
    }
  },
  {
    log: "opportunity 4 — confirmed SO (Northwind)",
    ref: "opp:northwind",
    customer: "Northwind Electronics",
    quote: {
      ref: "quote:northwind",
      createdOffset: -270,
      status: "Ordered",
      lines: [
        {
          ref: "quoteline:northwind:rob",
          item: "ROB-2000",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 1, unitPrice: 56000, leadTime: 120 }]
        }
      ]
    },
    order: {
      ref: "so:northwind",
      status: "Confirmed",
      orderDateOffset: -255,
      lines: [
        {
          ref: "soline:northwind:rob",
          item: "ROB-2000",
          saleQuantity: 1,
          unitPrice: 56000,
          status: "Ordered"
        }
      ]
    }
  },

  // ── Status showcase — one lightweight opportunity per remaining state ──────
  {
    log: "opportunity 5 — RFQ draft (Alpine, second test-rig base)",
    ref: "opp:alpine-rig",
    customer: "Alpine Research Institute",
    rfq: {
      ref: "rfq:alpine-rig",
      assignee: "self",
      status: "Draft",
      rfqDateOffset: -3,
      externalNotes:
        "Inquiry being logged — second base assembly for a mobile manipulation rig.",
      lines: [
        {
          item: "ARM-BASE-001",
          customerPartId: "ALP-BASE-002",
          quantity: [1],
          order: 1
        }
      ]
    }
  },
  {
    log: "opportunity 6 — no-quoted RFQ, lost quote (Lakeshore washdown wrist)",
    ref: "opp:lakeshore-washdown",
    customer: "Lakeshore Automotive",
    rfq: {
      ref: "rfq:lakeshore-washdown",
      status: "Closed",
      rfqDateOffset: -95,
      expirationOffset: -50,
      noQuoteReason: "Out of Scope",
      externalNotes:
        "IP69K washdown-rated wrist variant — outside our sealing qualification.",
      lines: [
        {
          item: "ARM-WRIST-001",
          customerPartId: "LKS-WRIST-WD1",
          quantity: [2],
          order: 1
        }
      ]
    },
    quote: {
      ref: "quote:lakeshore-washdown",
      createdOffset: -80,
      status: "Lost",
      externalNotes: "Declined to bid the washdown-rated line.",
      lines: [
        {
          ref: "quoteline:lakeshore-washdown:wrist",
          item: "ARM-WRIST-001",
          status: "No Quote",
          sortOrder: 1,
          priceBreaks: []
        }
      ]
    }
  },
  {
    log: "opportunity 7 — quote draft (Northwind pick-and-place arm)",
    ref: "opp:northwind-pnp",
    customer: "Northwind Electronics",
    quote: {
      ref: "quote:northwind-pnp",
      createdOffset: -4,
      assignee: "self",
      status: "Draft",
      externalNotes:
        "Working draft — pick-and-place-optimized arm pricing in progress.",
      lines: [
        {
          ref: "quoteline:northwind-pnp:rob",
          configuration: {
            payload_kg: 35,
            controller_voltage: "480V 3-Phase",
            force_torque_sensor: false
          },
          item: "ROB-2000",
          status: "Not Started",
          sortOrder: 1,
          priceBreaks: [{ quantity: 1, unitPrice: 58500, leadTime: 125 }]
        }
      ]
    }
  },
  {
    log: "opportunity 8 — partial quote (Cascade cell retrofit)",
    ref: "opp:cascade-retrofit",
    customer: "Cascade Integration Group",
    quote: {
      ref: "quote:cascade-retrofit",
      createdOffset: -8,
      status: "Partial",
      expirationOffset: 45,
      externalNotes:
        "Controller line released to the customer; gripper line still in engineering review.",
      lines: [
        {
          ref: "quoteline:cascade-retrofit:ctrl",
          item: "CTRL-100",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 2, unitPrice: 11200, leadTime: 70 }]
        },
        {
          ref: "quoteline:cascade-retrofit:grp",
          item: "GRP-2F-80",
          status: "In Progress",
          sortOrder: 2,
          priceBreaks: [{ quantity: 2, unitPrice: 6700, leadTime: 85 }]
        }
      ]
    }
  },
  {
    log: "opportunity 9 — cancelled quote (Alpine teaching cell)",
    ref: "opp:alpine-teaching",
    customer: "Alpine Research Institute",
    quote: {
      ref: "quote:alpine-teaching",
      createdOffset: -150,
      status: "Cancelled",
      externalNotes: "Program defunded before pricing was issued.",
      lines: [
        {
          ref: "quoteline:alpine-teaching:ctrl",
          item: "CTRL-100",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 1, unitPrice: 11300, leadTime: 65 }]
        }
      ]
    }
  },
  {
    log: "opportunity 10 — expired quote (Northwind spare jaw set)",
    ref: "opp:northwind-jaws",
    customer: "Northwind Electronics",
    quote: {
      ref: "quote:northwind-jaws",
      createdOffset: -44,
      status: "Expired",
      expirationOffset: -14,
      externalNotes: "30-day pricing lapsed without a PO.",
      lines: [
        {
          ref: "quoteline:northwind-jaws:jaw",
          item: "GRP-JAW-80",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 1, unitPrice: 330, leadTime: 45 }]
        }
      ]
    }
  },
  {
    log: "sales order — Needs Approval (Lakeshore gearbox spares)",
    ref: "opp:lakeshore-gbx",
    customer: "Lakeshore Automotive",
    order: {
      ref: "so:lakeshore-gbx",
      assignee: "self",
      status: "Needs Approval",
      orderDateOffset: -2,
      lines: [
        {
          ref: "soline:lakeshore-gbx:gbx",
          item: "GBX-HD-80",
          saleQuantity: 2,
          unitPrice: 1725,
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
    customer: "Cascade Integration Group",
    item: "ARM-BASE-001",
    status: "Confirmed",
    lineStatus: "Ordered",
    orderDateOffset: -220,
    unitPrice: 6800
  },
  {
    key: "draft",
    customer: "Alpine Research Institute",
    item: "CTRL-100",
    status: "Draft",
    lineStatus: "Ordered",
    orderDateOffset: -213,
    unitPrice: 11500
  },
  {
    key: "paused",
    customer: "Lakeshore Automotive",
    item: "ARM-WRIST-001",
    status: "In Progress",
    lineStatus: "In Progress",
    orderDateOffset: -268,
    unitPrice: 9600
  },
  {
    key: "completed",
    customer: "Northwind Electronics",
    item: "GRP-2F-80",
    status: "Completed",
    lineStatus: "Completed",
    orderDateOffset: -437,
    unitPrice: 6900
  },
  {
    key: "closed",
    customer: "Cascade Integration Group",
    item: "ARM-LINK-001",
    status: "Closed",
    lineStatus: "Completed",
    orderDateOffset: -456,
    unitPrice: 12400
  },
  {
    key: "cancelled",
    customer: "Alpine Research Institute",
    item: "HRN-ARM-001",
    status: "Cancelled",
    lineStatus: "Ordered",
    orderDateOffset: -339,
    unitPrice: 1400
  }
];

// Released order — "To Ship and Invoice". The status is written by the app
// (releaseSalesOrder), not derived by a trigger, but it must still agree with
// what getSalesOrderStatus would compute: nothing sent and nothing invoiced.
export const RELEASED_ORDERS: SalesOpportunitySpec[] = [
  {
    log: "sales order — To Ship and Invoice (Cascade, staggered deliveries)",
    ref: "opp:toshipinvoice",
    customer: "Cascade Integration Group",
    order: {
      ref: "so:toshipinvoice",
      assignee: "self",
      status: "To Ship and Invoice",
      orderDateOffset: -10,
      lines: STAGGERED_DELIVERIES.map((delivery) => ({
        ref: `soline:toshipinvoice:${delivery.key}`,
        // The tier appends the resolved promised date — it only exists at apply time.
        log: `  delivery ${delivery.key}`,
        item: "GRP-JAW-80",
        saleQuantity: 30,
        unitPrice: 350,
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
    log: "sales order — To Invoice (Cascade, posted spare-drive shipment)",
    ref: "opp:cascade-drives",
    customer: "Cascade Integration Group",
    order: {
      ref: "so:cascade-drives",
      status: "To Invoice",
      orderDateOffset: -30,
      lines: [
        {
          ref: "soline:cascade-drives:drv",
          item: "DRV-SRV-400",
          saleQuantity: 2,
          unitPrice: 630,
          status: "Completed"
        }
      ]
    },
    shipment: {
      ref: "shp:cascade-drives",
      status: "Posted",
      postedOffset: -18,
      lines: [
        {
          item: "DRV-SRV-400",
          orderQuantity: 2,
          outstandingQuantity: 0,
          shippedQuantity: 2,
          unitPrice: 630,
          fromShelf: "ESD-Cage"
        }
      ]
    }
  },
  {
    log: "sales order — To Ship and Invoice (Lakeshore, partial gear-set shipment)",
    ref: "opp:lakeshore-gearsets",
    customer: "Lakeshore Automotive",
    order: {
      ref: "so:lakeshore-gearsets",
      status: "To Ship and Invoice",
      orderDateOffset: -21,
      lines: [
        {
          ref: "soline:lakeshore-gearsets:gbx",
          item: "GBX-HD-50",
          saleQuantity: 4,
          unitPrice: 1170,
          status: "In Progress"
        }
      ]
    },
    shipment: {
      ref: "shp:lakeshore-gearsets",
      status: "Posted",
      postedOffset: -9,
      lines: [
        {
          item: "GBX-HD-50",
          orderQuantity: 4,
          outstandingQuantity: 2,
          shippedQuantity: 2,
          unitPrice: 1170,
          fromShelf: "A2-L1"
        }
      ]
    }
  },
  {
    log: "sales order — To Ship (Alpine, voided connector shipment)",
    ref: "opp:alpine-connectors",
    customer: "Alpine Research Institute",
    order: {
      ref: "so:alpine-connectors",
      status: "To Ship",
      orderDateOffset: -14,
      lines: [
        {
          ref: "soline:alpine-connectors:conn",
          item: "MAT-CONN-M23",
          saleQuantity: 8,
          unitPrice: 45,
          status: "Ordered"
        }
      ]
    },
    // Wrong carrier account keyed in — voided before anything left the dock.
    shipment: {
      ref: "shp:alpine-connectors",
      status: "Voided",
      lines: [
        {
          item: "MAT-CONN-M23",
          orderQuantity: 8,
          outstandingQuantity: 8,
          shippedQuantity: 0,
          unitPrice: 45
        }
      ]
    }
  },

  // ── Invoice lifecycle — one order+invoice per remaining status ────────────
  // Modest spares invoices; accounting.ts settles "paid" and "partial" by their
  // sinv keys.
  {
    log: "sales invoice — Submitted (Northwind bearing spares)",
    ref: "opp:northwind-bearings",
    customer: "Northwind Electronics",
    order: {
      ref: "so:northwind-bearings",
      status: "Invoiced",
      orderDateOffset: -35,
      lines: [
        {
          ref: "soline:northwind-bearings:brg",
          item: "BRG-CRB-100",
          saleQuantity: 20,
          unitPrice: 278,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:northwind-bearings",
      key: "submitted",
      status: "Submitted",
      subtotal: 5560,
      totalAmount: 5560,
      dateIssuedOffset: -20,
      dueDateOffset: 10,
      lines: [{ item: "BRG-CRB-100", quantity: 20, unitPrice: 278 }]
    }
  },
  {
    log: "sales invoice — Overdue (Cascade spare axis motor)",
    ref: "opp:cascade-motor",
    customer: "Cascade Integration Group",
    order: {
      ref: "so:cascade-motor",
      status: "Invoiced",
      orderDateOffset: -60,
      lines: [
        {
          ref: "soline:cascade-motor:mot",
          item: "MOT-AC-200W",
          saleQuantity: 1,
          unitPrice: 465,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:cascade-motor",
      key: "overdue",
      status: "Overdue",
      subtotal: 465,
      totalAmount: 465,
      dateIssuedOffset: -45,
      dueDateOffset: -15,
      lines: [{ item: "MOT-AC-200W", quantity: 1, unitPrice: 465 }]
    }
  },
  {
    log: "sales invoice — Paid (Lakeshore stainless fastener lot)",
    ref: "opp:lakeshore-fasteners",
    customer: "Lakeshore Automotive",
    order: {
      ref: "so:lakeshore-fasteners",
      status: "Closed",
      orderDateOffset: -90,
      lines: [
        {
          ref: "soline:lakeshore-fasteners:fst",
          item: "FST-M8-SS",
          saleQuantity: 500,
          unitPrice: 1.4,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:lakeshore-fasteners",
      key: "paid",
      status: "Paid",
      subtotal: 700,
      totalAmount: 700,
      dateIssuedOffset: -75,
      dueDateOffset: -45,
      lines: [{ item: "FST-M8-SS", quantity: 500, unitPrice: 1.4 }]
    }
  },
  {
    log: "sales invoice — Partially Paid (Alpine force/torque sensor)",
    ref: "opp:alpine-sensor",
    customer: "Alpine Research Institute",
    order: {
      ref: "so:alpine-sensor",
      status: "Invoiced",
      orderDateOffset: -50,
      lines: [
        {
          ref: "soline:alpine-sensor:sns",
          item: "SNS-FT-6AX",
          saleQuantity: 1,
          unitPrice: 5100,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:alpine-sensor",
      key: "partial",
      status: "Partially Paid",
      subtotal: 5100,
      totalAmount: 5100,
      dateIssuedOffset: -38,
      dueDateOffset: -8,
      lines: [{ item: "SNS-FT-6AX", quantity: 1, unitPrice: 5100 }]
    }
  },
  {
    log: "sales invoice — Voided (Northwind M5 fasteners, wrong bill-to)",
    ref: "opp:northwind-fasteners",
    customer: "Northwind Electronics",
    order: {
      ref: "so:northwind-fasteners",
      status: "To Invoice",
      orderDateOffset: -28,
      lines: [
        {
          ref: "soline:northwind-fasteners:fst",
          item: "FST-M5-SS",
          saleQuantity: 100,
          unitPrice: 0.9,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:northwind-fasteners",
      key: "voided",
      status: "Voided",
      subtotal: 90,
      totalAmount: 90,
      dateIssuedOffset: -25,
      lines: [{ item: "FST-M5-SS", quantity: 100, unitPrice: 0.9 }]
    }
  },
  {
    log: "sales invoice — Credit Note Issued (Cascade gripper jaw sets)",
    ref: "opp:cascade-jaws",
    customer: "Cascade Integration Group",
    order: {
      ref: "so:cascade-jaws",
      status: "Closed",
      orderDateOffset: -70,
      lines: [
        {
          ref: "soline:cascade-jaws:jaw",
          item: "GRP-JAW-80",
          saleQuantity: 2,
          unitPrice: 300,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:cascade-jaws",
      key: "credit",
      status: "Credit Note Issued",
      subtotal: 600,
      totalAmount: 600,
      dateIssuedOffset: -55,
      dueDateOffset: -25,
      lines: [{ item: "GRP-JAW-80", quantity: 2, unitPrice: 300 }]
    }
  },

  // Older overdue invoices, so receivables aging fills every bucket to 61–90.
  {
    log: "sales invoice — Overdue 31–60 days (Alpine servo motors)",
    ref: "opp:alpine-motors",
    customer: "Alpine Research Institute",
    order: {
      ref: "so:alpine-motors",
      status: "Invoiced",
      orderDateOffset: -90,
      lines: [
        {
          ref: "soline:alpine-motors:mot",
          item: "MOT-AC-200W",
          saleQuantity: 4,
          unitPrice: 465,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:alpine-motors",
      status: "Overdue",
      subtotal: 1860,
      totalAmount: 1860,
      dateIssuedOffset: -75,
      dueDateOffset: -45,
      lines: [{ item: "MOT-AC-200W", quantity: 4, unitPrice: 465 }]
    }
  },
  {
    log: "sales invoice — Overdue 61–90 days (Northwind crossed-roller bearings)",
    ref: "opp:northwind-crb",
    customer: "Northwind Electronics",
    order: {
      ref: "so:northwind-crb",
      status: "Invoiced",
      orderDateOffset: -120,
      lines: [
        {
          ref: "soline:northwind-crb:brg",
          item: "BRG-CRB-100",
          saleQuantity: 10,
          unitPrice: 278,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:northwind-crb",
      status: "Overdue",
      subtotal: 2780,
      totalAmount: 2780,
      dateIssuedOffset: -105,
      dueDateOffset: -75,
      lines: [{ item: "BRG-CRB-100", quantity: 10, unitPrice: 278 }]
    }
  },

  // ── Floor load — the subassembly spares the production floor is building ──
  // Each line has a job of its own in production.ts (open or just completed).
  {
    log: "sales order — In Progress (Lakeshore controller and harness spares, floor load)",
    ref: "opp:floor-lakeshore",
    customer: "Lakeshore Automotive",
    order: {
      ref: "so:floor-lakeshore",
      status: "In Progress",
      orderDateOffset: -30,
      lines: [
        {
          ref: "soline:floor-lakeshore:ctrl-pcb",
          item: "PCB-CTRL-R1",
          saleQuantity: 6,
          unitPrice: 980,
          status: "In Progress",
          promisedDateOffset: 5
        },
        {
          ref: "soline:floor-lakeshore:io-pcb",
          item: "PCB-IO-R1",
          saleQuantity: 4,
          unitPrice: 620,
          status: "In Progress",
          promisedDateOffset: 3
        },
        {
          ref: "soline:floor-lakeshore:jaw",
          item: "GRP-JAW-80",
          saleQuantity: 2,
          unitPrice: 320,
          status: "In Progress",
          promisedDateOffset: 3
        },
        {
          ref: "soline:floor-lakeshore:base",
          item: "ARM-BASE-001",
          saleQuantity: 1,
          unitPrice: 6800,
          status: "In Progress",
          promisedDateOffset: 4
        },
        {
          ref: "soline:floor-lakeshore:harness",
          item: "HRN-ARM-001",
          saleQuantity: 3,
          unitPrice: 1400,
          status: "In Progress",
          promisedDateOffset: 2
        }
      ]
    }
  },
  {
    log: "sales order — In Progress (Northwind cell retrofit kit, floor load)",
    ref: "opp:floor-northwind",
    customer: "Northwind Electronics",
    order: {
      ref: "so:floor-northwind",
      assignee: "self",
      status: "In Progress",
      orderDateOffset: -15,
      lines: [
        {
          ref: "soline:floor-northwind:io-pcb",
          item: "PCB-IO-R1",
          saleQuantity: 6,
          unitPrice: 620,
          status: "In Progress",
          promisedDateOffset: 8
        },
        {
          ref: "soline:floor-northwind:drive",
          item: "DRV-J2-MOD",
          saleQuantity: 4,
          unitPrice: 3900,
          status: "In Progress",
          promisedDateOffset: 15
        },
        {
          ref: "soline:floor-northwind:jaw",
          item: "GRP-JAW-80",
          saleQuantity: 4,
          unitPrice: 320,
          status: "In Progress",
          promisedDateOffset: 10
        },
        {
          ref: "soline:floor-northwind:wrist",
          item: "ARM-WRIST-001",
          saleQuantity: 2,
          unitPrice: 9600,
          status: "In Progress",
          promisedDateOffset: 24
        },
        {
          ref: "soline:floor-northwind:ctrl",
          item: "CTRL-100",
          saleQuantity: 1,
          unitPrice: 11500,
          status: "In Progress",
          promisedDateOffset: 19
        },
        {
          ref: "soline:floor-northwind:gripper",
          item: "GRP-2F-80",
          saleQuantity: 2,
          unitPrice: 6900,
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
    key: "servodrive",
    credit: {
      status: "Posted",
      dateOffset: -8,
      lines: [{ line: 1, quantity: 1 }]
    },
    status: "Completed",
    customer: "Cascade Integration Group",
    returnReason: "Defective",
    dateOffset: -12,
    salesOrder: "so:cascade-drives",
    lines: [
      { item: "DRV-SRV-400", quantity: 1, unitPrice: 630, toShelf: "ESD-Cage" }
    ]
  },
  {
    key: "gearset",
    status: "To Receive",
    customer: "Lakeshore Automotive",
    returnReason: "Damaged in Transit",
    dateOffset: -5,
    salesOrder: "so:lakeshore-gearsets",
    lines: [{ item: "GBX-HD-50", quantity: 1, unitPrice: 1170 }]
  },
  {
    key: "bearings",
    status: "Draft",
    customer: "Northwind Electronics",
    returnReason: "No Longer Needed",
    dateOffset: -1,
    salesOrder: "so:northwind-bearings",
    lines: [{ item: "BRG-CRB-100", quantity: 4, unitPrice: 278 }]
  }
];

export const roboticsSales: SalesData = {
  opportunities: OPPORTUNITIES,
  statusOrders: STATUS_ORDERS,
  releasedOrders: RELEASED_ORDERS,
  salesReturns: SALES_RETURNS,
  customerPortals: ["Cascade Integration Group", "Lakeshore Automotive"],
  customerBankAccounts: [
    {
      customer: "Lakeshore Automotive",
      name: "Lakeshore remittance",
      bankName: "Great Lakes Commerce Bank (demo)",
      accountHolderName: "Lakeshore Automotive Inc.",
      countryCode: "US",
      currencyCode: "USD",
      accountNumber: "DEMO-4102-7781",
      bankCode: "DEMO-072000",
      isPrimary: true
    },
    {
      customer: "Cascade Integration Group",
      name: "Cascade operating account",
      bankName: "Cascade Valley Bank (demo)",
      accountHolderName: "Cascade Integration Group LLC",
      countryCode: "US",
      currencyCode: "USD",
      accountNumber: "DEMO-3390-1142",
      bankCode: "DEMO-125000",
      isPrimary: true
    },
    {
      customer: "Northwind Electronics",
      name: "Northwind payables",
      bankName: "Northwind Savings (demo)",
      accountHolderName: "Northwind Electronics Corp.",
      countryCode: "US",
      currencyCode: "USD",
      accountNumber: "DEMO-8813-0496",
      isPrimary: true
    },
    {
      customer: "Alpine Research Institute",
      name: "Alpine grants account",
      bankName: "Alpine Scholars Bank (demo)",
      accountHolderName: "Alpine Research Institute",
      countryCode: "US",
      currencyCode: "USD",
      accountNumber: "DEMO-2257-6630",
      isPrimary: true
    }
  ]
};
