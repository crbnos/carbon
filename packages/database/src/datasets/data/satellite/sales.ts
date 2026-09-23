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

export const SAT_PRICE_BREAKS: readonly PriceBreak[] = [
  { quantity: 1, unitPrice: 1950000, leadTime: 240 },
  { quantity: 5, unitPrice: 1840000, leadTime: 270, discountPercent: 0.03 },
  { quantity: 10, unitPrice: 1725000, leadTime: 300, discountPercent: 0.06 },
  { quantity: 25, unitPrice: 1580000, leadTime: 360, discountPercent: 0.1 }
];

export const EPS_PRICE_BREAKS: readonly PriceBreak[] = [
  { quantity: 2, unitPrice: 128000, leadTime: 120 },
  {
    quantity: 10,
    unitPrice: 118000,
    leadTime: 150,
    discountPercent: 0.05,
    shippingCost: 2400
  }
];

// The Sent quote is the one the docs screenshot at /share/quote/:externalLinkId.
// The expiration offset must stay positive or the public page renders its
// Expired state instead of the quote.
export const NOVASAT_QUOTE_EXPIRATION_OFFSET = 321;

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
    log: "opportunity 1 — full chain (ORBSEC)",
    ref: "opp:orbsec",
    customer: "ORBSEC Defense",
    rfq: {
      ref: "rfq:orbsec",
      status: "Quoted",
      rfqDateOffset: -377,
      expirationOffset: -316,
      externalNotes: "GEO surveillance constellation — 3 buses required.",
      lines: [
        {
          item: "SAT-1000",
          customerPartId: "ORBSEC-SAT-001",
          quantity: [3],
          order: 1
        }
      ]
    },
    quote: {
      ref: "quote:orbsec",
      createdOffset: -330,
      status: "Ordered",
      externalNotes: "Quote for 3× ESPA-class satellite buses.",
      lines: [
        {
          ref: "quoteline:orbsec:sat",
          item: "SAT-1000",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 3, unitPrice: 1800000, leadTime: 260 }]
        }
      ]
    },
    order: {
      ref: "so:orbsec",
      status: "In Progress",
      orderDateOffset: -302,
      lines: [
        {
          ref: "soline:orbsec:sat",
          item: "SAT-1000",
          saleQuantity: 3,
          unitPrice: 1800000,
          status: "In Progress"
        }
      ]
    },
    shipment: {
      ref: "shp:orbsec",
      status: "Draft",
      lines: [
        {
          item: "SAT-1000",
          orderQuantity: 3,
          outstandingQuantity: 3,
          shippedQuantity: 0,
          unitPrice: 1800000
        }
      ]
    },
    invoice: {
      ref: "inv:orbsec",
      status: "Draft",
      subtotal: 5400000,
      totalAmount: 5400000,
      dateIssuedOffset: -285,
      lines: [{ item: "SAT-1000", quantity: 3, unitPrice: 1800000 }]
    }
  },
  {
    log: "opportunity 2 — quote sent (NovaSat)",
    ref: "opp:novasat",
    customer: "NovaSat Networks",
    quote: {
      ref: "quote:novasat",
      createdOffset: -20,
      assignee: "self",
      status: "Sent",
      expirationOffset: NOVASAT_QUOTE_EXPIRATION_OFFSET,
      lines: [
        {
          ref: "quoteline:novasat:sat",
          item: "SAT-1000",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: SAT_PRICE_BREAKS
        },
        {
          ref: "quoteline:novasat:eps",
          item: "EPS-001",
          status: "Complete",
          sortOrder: 2,
          priceBreaks: EPS_PRICE_BREAKS
        }
      ],
      externalLink: {
        ref: "quotelink:novasat",
        expiresOffset: NOVASAT_QUOTE_EXPIRATION_OFFSET
      }
    }
  },
  {
    log: "opportunity 3 — RFQ only (Apex)",
    ref: "opp:apex",
    customer: "Apex Space Research",
    rfq: {
      ref: "rfq:apex",
      assignee: "self",
      status: "Ready for Quote",
      rfqDateOffset: -285,
      externalNotes:
        "University research program — 1 structural frame for test campaign.",
      lines: [
        {
          item: "BUS-STR-001",
          customerPartId: "APX-STR-001",
          quantity: [1],
          order: 1
        }
      ]
    }
  },
  {
    log: "opportunity 4 — confirmed SO (PolarView)",
    ref: "opp:polar",
    customer: "PolarView Earth",
    quote: {
      ref: "quote:polar",
      createdOffset: -270,
      status: "Ordered",
      lines: [
        {
          ref: "quoteline:polar:sat",
          item: "SAT-1000",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 1, unitPrice: 1800000, leadTime: 240 }]
        }
      ]
    },
    order: {
      ref: "so:polar",
      status: "Confirmed",
      orderDateOffset: -255,
      lines: [
        {
          ref: "soline:polar:sat",
          item: "SAT-1000",
          saleQuantity: 1,
          unitPrice: 1800000,
          status: "Ordered"
        }
      ]
    }
  },

  // ── Status showcase — one lightweight opportunity per remaining state ──────
  {
    log: "opportunity 5 — RFQ draft (Apex, radiation test frame)",
    ref: "opp:apex-frame",
    customer: "Apex Space Research",
    rfq: {
      ref: "rfq:apex-frame",
      assignee: "self",
      status: "Draft",
      rfqDateOffset: -3,
      externalNotes:
        "Inquiry being logged — second structural frame for radiation test rig.",
      lines: [
        {
          item: "BUS-STR-001",
          customerPartId: "APX-STR-002",
          quantity: [1],
          order: 1
        }
      ]
    }
  },
  {
    log: "opportunity 6 — no-quoted RFQ, lost quote (ORBSEC crewed-rating)",
    ref: "opp:orbsec-crewed",
    customer: "ORBSEC Defense",
    rfq: {
      ref: "rfq:orbsec-crewed",
      status: "Closed",
      rfqDateOffset: -95,
      expirationOffset: -50,
      noQuoteReason: "Out of Scope",
      externalNotes:
        "Crewed-rated avionics variant — outside our qualification envelope.",
      lines: [
        {
          item: "ADCS-001",
          customerPartId: "ORBSEC-ADCS-CR1",
          quantity: [2],
          order: 1
        }
      ]
    },
    quote: {
      ref: "quote:orbsec-crewed",
      createdOffset: -80,
      status: "Lost",
      externalNotes: "Declined to bid the crewed-rating line.",
      lines: [
        {
          ref: "quoteline:orbsec-crewed:adcs",
          item: "ADCS-001",
          status: "No Quote",
          sortOrder: 1,
          priceBreaks: []
        }
      ]
    }
  },
  {
    log: "opportunity 7 — quote draft (PolarView imager bus)",
    ref: "opp:polar-imager",
    customer: "PolarView Earth",
    quote: {
      ref: "quote:polar-imager",
      createdOffset: -4,
      assignee: "self",
      status: "Draft",
      externalNotes:
        "Working draft — imager-optimized bus pricing in progress.",
      lines: [
        {
          ref: "quoteline:polar-imager:sat",
          configuration: {
            payload_mass_kg: 180,
            orbit_regime: "SSO",
            propulsion_module: true
          },
          item: "SAT-1000",
          status: "Not Started",
          sortOrder: 1,
          priceBreaks: [{ quantity: 1, unitPrice: 1850000, leadTime: 250 }]
        }
      ]
    }
  },
  {
    log: "opportunity 8 — partial quote (NovaSat gateway subsystems)",
    ref: "opp:novasat-gateway",
    customer: "NovaSat Networks",
    quote: {
      ref: "quote:novasat-gateway",
      createdOffset: -9,
      status: "Partial",
      expirationOffset: 45,
      externalNotes:
        "EPS line released to the customer; comms line still in engineering review.",
      lines: [
        {
          ref: "quoteline:novasat-gateway:eps",
          item: "EPS-001",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 2, unitPrice: 122000, leadTime: 140 }]
        },
        {
          ref: "quoteline:novasat-gateway:comms",
          item: "COMMS-001",
          status: "In Progress",
          sortOrder: 2,
          priceBreaks: [{ quantity: 2, unitPrice: 112000, leadTime: 160 }]
        }
      ]
    }
  },
  {
    log: "opportunity 9 — cancelled quote (Apex cubesat pathfinder)",
    ref: "opp:apex-pathfinder",
    customer: "Apex Space Research",
    quote: {
      ref: "quote:apex-pathfinder",
      createdOffset: -150,
      status: "Cancelled",
      externalNotes: "Program defunded before pricing was issued.",
      lines: [
        {
          ref: "quoteline:apex-pathfinder:eps",
          item: "EPS-001",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 1, unitPrice: 126000, leadTime: 130 }]
        }
      ]
    }
  },
  {
    log: "opportunity 10 — expired quote (PolarView spare wing)",
    ref: "opp:polar-wing",
    customer: "PolarView Earth",
    quote: {
      ref: "quote:polar-wing",
      createdOffset: -44,
      status: "Expired",
      expirationOffset: -14,
      externalNotes: "30-day pricing lapsed without a PO.",
      lines: [
        {
          ref: "quoteline:polar-wing:saw",
          item: "SAW-001",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 1, unitPrice: 36500, leadTime: 90 }]
        }
      ]
    }
  },
  {
    log: "sales order — Needs Approval (ORBSEC propulsion spares)",
    ref: "opp:orbsec-prop",
    customer: "ORBSEC Defense",
    order: {
      ref: "so:orbsec-prop",
      assignee: "self",
      status: "Needs Approval",
      orderDateOffset: -2,
      lines: [
        {
          ref: "soline:orbsec-prop:tank",
          item: "TANK-TI-4L",
          saleQuantity: 2,
          unitPrice: 4800,
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
    customer: "NovaSat Networks",
    item: "BUS-STR-001",
    status: "Confirmed",
    lineStatus: "Ordered",
    orderDateOffset: -220,
    unitPrice: 240000
  },
  {
    key: "draft",
    customer: "Apex Space Research",
    item: "EPS-001",
    status: "Draft",
    lineStatus: "Ordered",
    orderDateOffset: -213,
    unitPrice: 95000
  },
  {
    key: "paused",
    customer: "ORBSEC Defense",
    item: "ADCS-001",
    status: "In Progress",
    lineStatus: "In Progress",
    orderDateOffset: -268,
    unitPrice: 130000
  },
  {
    key: "completed",
    customer: "PolarView Earth",
    item: "COMMS-001",
    status: "Completed",
    lineStatus: "Completed",
    orderDateOffset: -437,
    unitPrice: 110000
  },
  {
    key: "closed",
    customer: "NovaSat Networks",
    item: "PROP-001",
    status: "Closed",
    lineStatus: "Completed",
    orderDateOffset: -456,
    unitPrice: 175000
  },
  {
    key: "cancelled",
    customer: "Apex Space Research",
    item: "HARNESS-001",
    status: "Cancelled",
    lineStatus: "Ordered",
    orderDateOffset: -339,
    unitPrice: 42000
  }
];

// Released order — "To Ship and Invoice". The status is written by the app
// (releaseSalesOrder), not derived by a trigger, but it must still agree with
// what getSalesOrderStatus would compute: nothing sent and nothing invoiced.
export const RELEASED_ORDERS: SalesOpportunitySpec[] = [
  {
    log: "sales order — To Ship and Invoice (NovaSat, staggered deliveries)",
    ref: "opp:toshipinvoice",
    customer: "NovaSat Networks",
    order: {
      ref: "so:toshipinvoice",
      assignee: "self",
      status: "To Ship and Invoice",
      orderDateOffset: -10,
      lines: STAGGERED_DELIVERIES.map((delivery) => ({
        ref: `soline:toshipinvoice:${delivery.key}`,
        // The tier appends the resolved promised date — it only exists at apply time.
        log: `  delivery ${delivery.key}`,
        item: "SAW-001",
        saleQuantity: 30,
        unitPrice: 35000,
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
    log: "sales order — To Invoice (NovaSat, posted spare-transponder shipment)",
    ref: "opp:novasat-spares",
    customer: "NovaSat Networks",
    order: {
      ref: "so:novasat-spares",
      status: "To Invoice",
      orderDateOffset: -30,
      lines: [
        {
          ref: "soline:novasat-spares:txrx",
          item: "TXRX-SBAND",
          saleQuantity: 2,
          unitPrice: 15900,
          status: "Completed"
        }
      ]
    },
    shipment: {
      ref: "shp:novasat-spares",
      status: "Posted",
      postedOffset: -18,
      lines: [
        {
          item: "TXRX-SBAND",
          orderQuantity: 2,
          outstandingQuantity: 0,
          shippedQuantity: 2,
          unitPrice: 15900,
          fromShelf: "A2-L2"
        }
      ]
    }
  },
  {
    log: "sales order — To Ship and Invoice (ORBSEC, partial thruster shipment)",
    ref: "opp:orbsec-thrusters",
    customer: "ORBSEC Defense",
    order: {
      ref: "so:orbsec-thrusters",
      status: "To Ship and Invoice",
      orderDateOffset: -21,
      lines: [
        {
          ref: "soline:orbsec-thrusters:thr",
          item: "THR-HYDRA-1N",
          saleQuantity: 4,
          unitPrice: 11400,
          status: "In Progress"
        }
      ]
    },
    shipment: {
      ref: "shp:orbsec-thrusters",
      status: "Posted",
      postedOffset: -9,
      lines: [
        {
          item: "THR-HYDRA-1N",
          orderQuantity: 4,
          outstandingQuantity: 2,
          shippedQuantity: 2,
          unitPrice: 11400,
          fromShelf: "A3-L1"
        }
      ]
    }
  },
  {
    log: "sales order — To Ship (Apex, voided valve shipment)",
    ref: "opp:apex-valves",
    customer: "Apex Space Research",
    order: {
      ref: "so:apex-valves",
      status: "To Ship",
      orderDateOffset: -14,
      lines: [
        {
          ref: "soline:apex-valves:vlv",
          item: "VLV-SOLENOID-LP",
          saleQuantity: 8,
          unitPrice: 1550,
          status: "Ordered"
        }
      ]
    },
    // Wrong carrier account keyed in — voided before anything left the dock.
    shipment: {
      ref: "shp:apex-valves",
      status: "Voided",
      lines: [
        {
          item: "VLV-SOLENOID-LP",
          orderQuantity: 8,
          outstandingQuantity: 8,
          shippedQuantity: 0,
          unitPrice: 1550
        }
      ]
    }
  },

  // ── Invoice lifecycle — one order+invoice per remaining status ────────────
  // Modest spares invoices; accounting.ts settles "paid" and "partial" by their
  // sinv keys.
  {
    log: "sales invoice — Submitted (PolarView bearing spares)",
    ref: "opp:polar-bearings",
    customer: "PolarView Earth",
    order: {
      ref: "so:polar-bearings",
      status: "Invoiced",
      orderDateOffset: -35,
      lines: [
        {
          ref: "soline:polar-bearings:brg",
          item: "BRG-6201",
          saleQuantity: 20,
          unitPrice: 27,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:polar-bearings",
      key: "submitted",
      status: "Submitted",
      subtotal: 540,
      totalAmount: 540,
      dateIssuedOffset: -20,
      dueDateOffset: 10,
      lines: [{ item: "BRG-6201", quantity: 20, unitPrice: 27 }]
    }
  },
  {
    log: "sales invoice — Overdue (NovaSat propellant tank)",
    ref: "opp:novasat-tank",
    customer: "NovaSat Networks",
    order: {
      ref: "so:novasat-tank",
      status: "Invoiced",
      orderDateOffset: -60,
      lines: [
        {
          ref: "soline:novasat-tank:tank",
          item: "TANK-TI-4L",
          saleQuantity: 1,
          unitPrice: 4800,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:novasat-tank",
      key: "overdue",
      status: "Overdue",
      subtotal: 4800,
      totalAmount: 4800,
      dateIssuedOffset: -45,
      dueDateOffset: -15,
      lines: [{ item: "TANK-TI-4L", quantity: 1, unitPrice: 4800 }]
    }
  },
  {
    log: "sales invoice — Paid (ORBSEC titanium fastener lot)",
    ref: "opp:orbsec-fasteners",
    customer: "ORBSEC Defense",
    order: {
      ref: "so:orbsec-fasteners",
      status: "Closed",
      orderDateOffset: -90,
      lines: [
        {
          ref: "soline:orbsec-fasteners:fst",
          item: "FST-M4-TI",
          saleQuantity: 500,
          unitPrice: 4,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:orbsec-fasteners",
      key: "paid",
      status: "Paid",
      subtotal: 2000,
      totalAmount: 2000,
      dateIssuedOffset: -75,
      dueDateOffset: -45,
      lines: [{ item: "FST-M4-TI", quantity: 500, unitPrice: 4 }]
    }
  },
  {
    log: "sales invoice — Partially Paid (Apex star tracker)",
    ref: "opp:apex-tracker",
    customer: "Apex Space Research",
    order: {
      ref: "so:apex-tracker",
      status: "Invoiced",
      orderDateOffset: -50,
      lines: [
        {
          ref: "soline:apex-tracker:st",
          item: "ST-050",
          saleQuantity: 1,
          unitPrice: 42000,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:apex-tracker",
      key: "partial",
      status: "Partially Paid",
      subtotal: 42000,
      totalAmount: 42000,
      dateIssuedOffset: -38,
      dueDateOffset: -8,
      lines: [{ item: "ST-050", quantity: 1, unitPrice: 42000 }]
    }
  },
  {
    log: "sales invoice — Voided (PolarView A286 fasteners, wrong bill-to)",
    ref: "opp:polar-fasteners",
    customer: "PolarView Earth",
    order: {
      ref: "so:polar-fasteners",
      status: "To Invoice",
      orderDateOffset: -28,
      lines: [
        {
          ref: "soline:polar-fasteners:fst",
          item: "FST-M6-A286",
          saleQuantity: 100,
          unitPrice: 8,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:polar-fasteners",
      key: "voided",
      status: "Voided",
      subtotal: 800,
      totalAmount: 800,
      dateIssuedOffset: -25,
      lines: [{ item: "FST-M6-A286", quantity: 100, unitPrice: 8 }]
    }
  },
  {
    log: "sales invoice — Credit Note Issued (NovaSat solenoid valves)",
    ref: "opp:novasat-valves",
    customer: "NovaSat Networks",
    order: {
      ref: "so:novasat-valves",
      status: "Closed",
      orderDateOffset: -70,
      lines: [
        {
          ref: "soline:novasat-valves:vlv",
          item: "VLV-SOLENOID-LP",
          saleQuantity: 2,
          unitPrice: 1425,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:novasat-valves",
      key: "credit",
      status: "Credit Note Issued",
      subtotal: 2850,
      totalAmount: 2850,
      dateIssuedOffset: -55,
      dueDateOffset: -25,
      lines: [{ item: "VLV-SOLENOID-LP", quantity: 2, unitPrice: 1425 }]
    }
  },

  // Older overdue invoices, so receivables aging fills every bucket to 61–90.
  {
    log: "sales invoice — Overdue 31–60 days (Apex solenoid valve spares)",
    ref: "opp:apex-valve-spares",
    customer: "Apex Space Research",
    order: {
      ref: "so:apex-valve-spares",
      status: "Invoiced",
      orderDateOffset: -90,
      lines: [
        {
          ref: "soline:apex-valve-spares:vlv",
          item: "VLV-SOLENOID-LP",
          saleQuantity: 4,
          unitPrice: 1425,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:apex-valve-spares",
      status: "Overdue",
      subtotal: 5700,
      totalAmount: 5700,
      dateIssuedOffset: -75,
      dueDateOffset: -45,
      lines: [{ item: "VLV-SOLENOID-LP", quantity: 4, unitPrice: 1425 }]
    }
  },
  {
    log: "sales invoice — Overdue 61–90 days (PolarView propellant tank)",
    ref: "opp:polar-tank",
    customer: "PolarView Earth",
    order: {
      ref: "so:polar-tank",
      status: "Invoiced",
      orderDateOffset: -120,
      lines: [
        {
          ref: "soline:polar-tank:tank",
          item: "TANK-TI-4L",
          saleQuantity: 1,
          unitPrice: 4800,
          status: "Completed"
        }
      ]
    },
    invoice: {
      ref: "inv:polar-tank",
      status: "Overdue",
      subtotal: 4800,
      totalAmount: 4800,
      dateIssuedOffset: -105,
      dueDateOffset: -75,
      lines: [{ item: "TANK-TI-4L", quantity: 1, unitPrice: 4800 }]
    }
  },

  // ── Floor load — the subassembly spares the production floor is building ──
  // Each line has a job of its own in production.ts (open or just completed).
  {
    log: "sales order — In Progress (NovaSat subsystem spares, floor load)",
    ref: "opp:floor-novasat",
    customer: "NovaSat Networks",
    order: {
      ref: "so:floor-novasat",
      status: "In Progress",
      orderDateOffset: -32,
      lines: [
        {
          ref: "soline:floor-novasat:eps-pcb",
          item: "PCB-EPS-R1",
          saleQuantity: 4,
          unitPrice: 4200,
          status: "In Progress",
          promisedDateOffset: 5
        },
        {
          ref: "soline:floor-novasat:adcs-pcb",
          item: "PCB-ADCS-R1",
          saleQuantity: 2,
          unitPrice: 5800,
          status: "In Progress",
          promisedDateOffset: 3
        },
        {
          ref: "soline:floor-novasat:saw",
          item: "SAW-001",
          saleQuantity: 1,
          unitPrice: 35000,
          status: "In Progress",
          promisedDateOffset: 3
        },
        {
          ref: "soline:floor-novasat:bus",
          item: "BUS-STR-001",
          saleQuantity: 1,
          unitPrice: 45000,
          status: "In Progress",
          promisedDateOffset: 4
        },
        {
          ref: "soline:floor-novasat:antenna",
          item: "ANT-PATCH-01",
          saleQuantity: 4,
          unitPrice: 1800,
          status: "In Progress",
          promisedDateOffset: 2
        }
      ]
    }
  },
  {
    log: "sales order — In Progress (PolarView constellation refit, floor load)",
    ref: "opp:floor-polar",
    customer: "PolarView Earth",
    order: {
      ref: "so:floor-polar",
      assignee: "self",
      status: "In Progress",
      orderDateOffset: -14,
      lines: [
        {
          ref: "soline:floor-polar:adcs-pcb",
          item: "PCB-ADCS-R1",
          saleQuantity: 3,
          unitPrice: 5800,
          status: "In Progress",
          promisedDateOffset: 8
        },
        {
          ref: "soline:floor-polar:bus",
          item: "BUS-STR-001",
          saleQuantity: 1,
          unitPrice: 45000,
          status: "In Progress",
          promisedDateOffset: 15
        },
        {
          ref: "soline:floor-polar:saw",
          item: "SAW-001",
          saleQuantity: 2,
          unitPrice: 35000,
          status: "In Progress",
          promisedDateOffset: 10
        },
        {
          ref: "soline:floor-polar:prop",
          item: "PROP-001",
          saleQuantity: 1,
          unitPrice: 38000,
          status: "In Progress",
          promisedDateOffset: 24
        },
        {
          ref: "soline:floor-polar:comms",
          item: "COMMS-001",
          saleQuantity: 1,
          unitPrice: 28000,
          status: "In Progress",
          promisedDateOffset: 19
        },
        {
          ref: "soline:floor-polar:harness",
          item: "HARNESS-001",
          saleQuantity: 2,
          unitPrice: 12000,
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
    key: "transponder",
    // Credited once the unit was back on the shelf.
    credit: {
      status: "Posted",
      dateOffset: -8,
      lines: [{ line: 1, quantity: 1 }]
    },
    status: "Completed",
    customer: "NovaSat Networks",
    returnReason: "Defective",
    dateOffset: -12,
    salesOrder: "so:novasat-spares",
    lines: [
      { item: "TXRX-SBAND", quantity: 1, unitPrice: 15900, toShelf: "A2-L2" }
    ]
  },
  {
    key: "thruster",
    status: "To Receive",
    customer: "ORBSEC Defense",
    returnReason: "Damaged in Transit",
    dateOffset: -5,
    salesOrder: "so:orbsec-thrusters",
    lines: [{ item: "THR-HYDRA-1N", quantity: 1, unitPrice: 11400 }]
  },
  {
    key: "bearings",
    status: "Draft",
    customer: "PolarView Earth",
    returnReason: "No Longer Needed",
    dateOffset: -1,
    salesOrder: "so:polar-bearings",
    lines: [{ item: "BRG-6201", quantity: 4, unitPrice: 27 }]
  }
];

export const satelliteSales: SalesData = {
  opportunities: OPPORTUNITIES,
  statusOrders: STATUS_ORDERS,
  releasedOrders: RELEASED_ORDERS,
  salesReturns: SALES_RETURNS,
  customerPortals: ["NovaSat Networks", "ORBSEC Defense"],
  customerBankAccounts: [
    {
      customer: "ORBSEC Defense",
      name: "ORBSEC remittance",
      bankName: "Potomac Federal Trust (demo)",
      accountHolderName: "ORBSEC Defense Programs LLC",
      countryCode: "US",
      currencyCode: "USD",
      accountNumber: "DEMO-4410-2291",
      bankCode: "DEMO-054001",
      isPrimary: true
    },
    {
      customer: "NovaSat Networks",
      name: "NovaSat operating account",
      bankName: "Bay Commerce Bank (demo)",
      accountHolderName: "NovaSat Networks Inc.",
      countryCode: "US",
      currencyCode: "USD",
      accountNumber: "DEMO-7730-1184",
      bankCode: "DEMO-121000",
      isPrimary: true
    },
    {
      customer: "Apex Space Research",
      name: "Apex grants account",
      bankName: "Commonwealth Scholars Bank (demo)",
      accountHolderName: "Apex Space Research Foundation",
      countryCode: "US",
      currencyCode: "USD",
      accountNumber: "DEMO-2208-5563",
      isPrimary: true
    },
    {
      customer: "PolarView Earth",
      name: "PolarView payables",
      bankName: "Hill Country Bank (demo)",
      accountHolderName: "PolarView Earth Inc.",
      countryCode: "US",
      currencyCode: "USD",
      accountNumber: "DEMO-9051-3370",
      isPrimary: true
    }
  ]
};
