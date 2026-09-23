import type {
  LifecycleRfqSpec,
  PurchaseOrderSpec,
  PurchaseReturnSpec,
  PurchasingData,
  RfqHeaderSpec,
  RfqLineSpec,
  RfqQuoteSpec,
  StandaloneSupplierQuoteSpec
} from "../../types.ts";

// Every RFQ line and every supplier quote prices the same quantity breaks, so
// the Compare Quotes drawer can total all three quotes at any tier it offers.
export const RFQ_QUANTITY_BREAKS = [10, 25, 50];

export const RFQ_LINES: RfqLineSpec[] = [
  { item: "PCB-BARE-REV3", description: "Bare EPS board, rev 3 — ENIG finish" },
  { item: "BAT-LIION-48V", description: "48V Li-ion pack — flight qualified" }
];

// Cheapest (CelestialElex) vs fastest (Deep Space RF) vs slowest and dearest
// (PropTech) — the comparison has a winner without being a one-horse race.
export const RFQ_QUOTES: RfqQuoteSpec[] = [
  {
    key: "celex",
    supplier: "CelestialElex",
    supplierReference: "CEX-Q-4471",
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

export const RFQ_WINNING_QUOTE = "celex";
export const RFQ_ORDER_QUANTITY = 25;

// 2 lines, finalized (Requested), fanned out to 3 suppliers.
export const RFQ_HEADER: RfqHeaderSpec = {
  ref: "prfq:avionics",
  status: "Requested",
  rfqDateOffset: -24,
  expirationOffset: 48,
  notes: "Dual-source the EPS board and the 48V pack for the Q4 build.",
  internalNotes: "Award on landed cost at 25 pcs unless lead time slips."
};

// Beside the Requested RFQ: a Draft still being put together for the next
// propulsion build, and a star-tracker RFQ cancelled before it went out when
// the program kept the flight-proven unit.
export const LIFECYCLE_RFQS: LifecycleRfqSpec[] = [
  {
    ref: "prfq:propulsion",
    status: "Draft",
    rfqDateOffset: -2,
    expirationOffset: 28,
    notes: "Feed-system valves and tanks for the Q1 propulsion module build.",
    internalNotes: "Add Ionix once their supplier approval clears.",
    quantities: [4, 8],
    lines: [
      {
        item: "VLV-SOLENOID-LP2",
        description: "Gen2 low-pressure solenoid valve — xenon feed"
      },
      {
        item: "TANK-TI-4L",
        description: "4L titanium propellant tank, burst-tested"
      }
    ],
    suppliers: ["PropTech Solutions", "Orbital Composites"]
  },
  {
    ref: "prfq:star-tracker",
    status: "Closed",
    rfqDateOffset: -58,
    expirationOffset: -28,
    notes: "Second-source star tracker for the constellation follow-on.",
    internalNotes: "Cancelled — program kept the flight-proven ST-050.",
    quantities: [2, 6],
    lines: [
      {
        item: "ST-050",
        description: "0.5 arcsec star tracker, flight heritage"
      }
    ],
    suppliers: ["Deep Space RF", "CelestialElex"]
  }
];

export const PURCHASE_ORDERS: PurchaseOrderSpec[] = [
  {
    source: "direct",
    log: "purchase order 1 — To Receive (PropTech)",
    supplier: "PropTech Solutions",
    purchaseOrderType: "Purchase",
    status: "To Receive",
    orderDateOffset: -346,
    lines: [
      { item: "BAT-LIION-48V", purchaseQuantity: 6, supplierUnitPrice: 2200 },
      { item: "RW-010", purchaseQuantity: 4, supplierUnitPrice: 14200 }
    ],
    receipt: {
      ref: "receipt:rocket",
      status: "Draft",
      lines: [
        {
          item: "BAT-LIION-48V",
          orderQuantity: 6,
          outstandingQuantity: 6,
          receivedQuantity: 0,
          unitPrice: 2200,
          // The battery is a Batch item, so the receipt line has to ask for a lot —
          // that inline lot field is the whole point of the receiving screenshot.
          requiresBatchTracking: true
        }
      ]
    }
  },
  {
    source: "direct",
    log: "purchase order 2 — To Invoice (SpaceGrade)",
    supplier: "SpaceGrade Fasteners",
    purchaseOrderType: "Purchase",
    status: "To Invoice",
    orderDateOffset: -363,
    lines: [
      { item: "FST-M4-TI", purchaseQuantity: 500, supplierUnitPrice: 2.5 }
    ],
    invoice: {
      ref: "pinvoice:fasten",
      status: "Draft",
      currencyCode: "USD",
      subtotal: 1250,
      totalAmount: 1250,
      dateIssuedOffset: -346,
      lines: [{ item: "FST-M4-TI", quantity: 500, supplierUnitPrice: 2.5 }]
    }
  },
  {
    source: "direct",
    log: "purchase order 3 — Draft (CelestialElex)",
    ref: "po:celex",
    supplier: "CelestialElex",
    purchaseOrderType: "Purchase",
    status: "Draft",
    orderDateOffset: -316,
    lines: [
      { item: "PCB-BARE-REV3", purchaseQuantity: 20, supplierUnitPrice: 90 }
    ]
  },
  {
    source: "winningQuote",
    log: "purchase order 4 — To Receive and Invoice (from winning quote)",
    purchaseOrderType: "Purchase",
    status: "To Receive and Invoice",
    orderDateOffset: -8,
    currencyCode: "USD",
    exchangeRate: 1
  },

  // ── Status matrix — the remaining purchaseOrderStatus values ──────────────
  {
    source: "direct",
    log: "purchase order — Planned (Deep Space RF reaction wheels)",
    supplier: "Deep Space RF",
    purchaseOrderType: "Purchase",
    status: "Planned",
    orderDateOffset: -1,
    lines: [{ item: "RW-010", purchaseQuantity: 2, supplierUnitPrice: 14350 }]
  },
  {
    source: "direct",
    log: "purchase order — To Review (CelestialElex EPS boards)",
    supplier: "CelestialElex",
    purchaseOrderType: "Purchase",
    status: "To Review",
    orderDateOffset: -2,
    lines: [
      { item: "PCB-BARE-REV3", purchaseQuantity: 15, supplierUnitPrice: 84 }
    ]
  },
  {
    source: "direct",
    log: "purchase order — Needs Approval (Orbital Composites laminate)",
    supplier: "Orbital Composites",
    purchaseOrderType: "Purchase",
    status: "Needs Approval",
    orderDateOffset: -1,
    lines: [{ item: "MAT-CF-LAM", purchaseQuantity: 4, supplierUnitPrice: 315 }]
  },
  {
    source: "direct",
    log: "purchase order — Rejected (PropTech thruster quote too high)",
    supplier: "PropTech Solutions",
    purchaseOrderType: "Purchase",
    status: "Rejected",
    orderDateOffset: -13,
    lines: [
      { item: "THR-HYDRA-1N", purchaseQuantity: 2, supplierUnitPrice: 7100 }
    ]
  },

  // ── Receipt + invoice lifecycle — historical orders that closed out ───────
  {
    source: "direct",
    log: "purchase order — Completed, received in full and paid (CelestialElex)",
    ref: "po:paid",
    supplier: "CelestialElex",
    purchaseOrderType: "Purchase",
    status: "Completed",
    orderDateOffset: -75,
    lines: [
      { item: "BAT-LIION-48V", purchaseQuantity: 2, supplierUnitPrice: 2380 },
      { item: "PCB-BARE-REV3", purchaseQuantity: 10, supplierUnitPrice: 85 }
    ],
    receipt: {
      ref: "receipt:paid",
      status: "Posted",
      postedOffset: -68,
      lines: [
        {
          item: "BAT-LIION-48V",
          orderQuantity: 2,
          outstandingQuantity: 0,
          receivedQuantity: 2,
          unitPrice: 2380,
          requiresBatchTracking: true,
          toShelf: "A1-L2",
          // Received -68 with a 365-day pack shelf life → expires at +297.
          lotNumber: "LOT-BAT-2610",
          lotExpiresOffset: 297
        },
        {
          item: "PCB-BARE-REV3",
          orderQuantity: 10,
          outstandingQuantity: 0,
          receivedQuantity: 10,
          unitPrice: 85,
          toShelf: "A1-L1"
        }
      ]
    },
    invoice: {
      ref: "pinvoice:paid",
      key: "paid",
      status: "Paid",
      currencyCode: "USD",
      subtotal: 5610,
      totalAmount: 5610,
      dateIssuedOffset: -62,
      dueDateOffset: -32,
      lines: [
        { item: "BAT-LIION-48V", quantity: 2, supplierUnitPrice: 2380 },
        { item: "PCB-BARE-REV3", quantity: 10, supplierUnitPrice: 85 }
      ]
    }
  },
  {
    source: "direct",
    log: "purchase order — Closed short after a partial receipt (PropTech tanks)",
    ref: "po:closed-short",
    supplier: "PropTech Solutions",
    purchaseOrderType: "Purchase",
    status: "Closed",
    orderDateOffset: -88,
    lines: [
      { item: "TANK-TI-4L", purchaseQuantity: 4, supplierUnitPrice: 3200 }
    ],
    receipt: {
      ref: "receipt:short",
      status: "Posted",
      postedOffset: -80,
      lines: [
        {
          item: "TANK-TI-4L",
          orderQuantity: 4,
          outstandingQuantity: 2,
          receivedQuantity: 2,
          unitPrice: 3200,
          toShelf: "A3-L1"
        }
      ]
    },
    // Two of four tanks failed the weld X-ray at PropTech; the order was
    // closed short and a debit note issued against the original billing.
    invoice: {
      ref: "pinvoice:debit-note",
      key: "debit-note",
      status: "Debit Note Issued",
      currencyCode: "USD",
      subtotal: 6400,
      totalAmount: 6400,
      dateIssuedOffset: -72,
      lines: [{ item: "TANK-TI-4L", quantity: 2, supplierUnitPrice: 3200 }]
    }
  },
  {
    source: "direct",
    log: "purchase order — To Receive with a voided receipt (SpaceGrade)",
    supplier: "SpaceGrade Fasteners",
    purchaseOrderType: "Purchase",
    status: "To Receive",
    orderDateOffset: -21,
    lines: [
      { item: "FST-M4-TI", purchaseQuantity: 250, supplierUnitPrice: 2.5 }
    ],
    // Keyed in against the wrong cert paperwork and voided before posting.
    receipt: {
      ref: "receipt:voided",
      status: "Voided",
      lines: [
        {
          item: "FST-M4-TI",
          orderQuantity: 250,
          outstandingQuantity: 250,
          receivedQuantity: 0,
          unitPrice: 2.5
        }
      ]
    }
  },
  {
    source: "direct",
    log: "purchase order — Completed, invoice open (Deep Space RF star tracker)",
    supplier: "Deep Space RF",
    purchaseOrderType: "Purchase",
    status: "Completed",
    orderDateOffset: -30,
    lines: [{ item: "ST-050", purchaseQuantity: 1, supplierUnitPrice: 28000 }],
    invoice: {
      ref: "pinvoice:open",
      key: "open",
      status: "Open",
      currencyCode: "USD",
      subtotal: 28000,
      totalAmount: 28000,
      dateIssuedOffset: -9,
      dueDateOffset: 21,
      lines: [{ item: "ST-050", quantity: 1, supplierUnitPrice: 28000 }]
    }
  },
  {
    source: "direct",
    log: "purchase order — Completed, invoice overdue (Orbital Composites)",
    supplier: "Orbital Composites",
    purchaseOrderType: "Purchase",
    status: "Completed",
    orderDateOffset: -60,
    lines: [
      { item: "MAT-CF-LAM", purchaseQuantity: 2, supplierUnitPrice: 320 }
    ],
    invoice: {
      ref: "pinvoice:overdue",
      key: "overdue",
      status: "Overdue",
      currencyCode: "USD",
      subtotal: 640,
      totalAmount: 640,
      dateIssuedOffset: -45,
      dueDateOffset: -15,
      lines: [{ item: "MAT-CF-LAM", quantity: 2, supplierUnitPrice: 320 }]
    }
  },
  {
    source: "direct",
    log: "purchase order — Completed, invoice partially paid (CelestialElex)",
    supplier: "CelestialElex",
    purchaseOrderType: "Purchase",
    status: "Completed",
    orderDateOffset: -55,
    lines: [
      { item: "PCB-BARE-REV3", purchaseQuantity: 40, supplierUnitPrice: 82 }
    ],
    invoice: {
      ref: "pinvoice:partial",
      key: "partial",
      status: "Partially Paid",
      currencyCode: "USD",
      subtotal: 3280,
      totalAmount: 3280,
      dateIssuedOffset: -40,
      dueDateOffset: -10,
      lines: [{ item: "PCB-BARE-REV3", quantity: 40, supplierUnitPrice: 82 }]
    }
  },
  {
    source: "direct",
    log: "purchase order — Closed, invoice voided over a billing error (SpaceGrade)",
    supplier: "SpaceGrade Fasteners",
    purchaseOrderType: "Purchase",
    status: "Closed",
    orderDateOffset: -66,
    lines: [
      { item: "FST-M6-A286", purchaseQuantity: 100, supplierUnitPrice: 5.5 }
    ],
    invoice: {
      ref: "pinvoice:voided",
      key: "voided",
      status: "Voided",
      currencyCode: "USD",
      subtotal: 550,
      totalAmount: 550,
      dateIssuedOffset: -58,
      lines: [{ item: "FST-M6-A286", quantity: 100, supplierUnitPrice: 5.5 }]
    }
  },

  // ── Outside processing — frames out at AstroMill for hard anodize ─────────
  // Mirrors the OSP orders the create function raises from a job's outside
  // operations: purchaseOrderType "Outside Processing" on the supplier with
  // the supplierProcess, line = the processed part at the operation unit cost.
  {
    source: "direct",
    log: "purchase order — Outside Processing, anodize at AstroMill",
    supplier: "AstroMill Machining",
    purchaseOrderType: "Outside Processing",
    status: "To Receive",
    orderDateOffset: -9,
    lines: [
      { item: "BUS-STR-001", purchaseQuantity: 2, supplierUnitPrice: 240 }
    ]
  },

  // ── FX — the one EUR order, against the German bearing house, unpaid ──────
  {
    source: "direct",
    log: "purchase order — EUR order, unpaid (Rheinland bearings)",
    ref: "po:eur",
    supplier: "Rheinland Precision Bearings GmbH",
    purchaseOrderType: "Purchase",
    status: "To Invoice",
    orderDateOffset: -18,
    currencyCode: "EUR",
    exchangeRate: 0.92,
    lines: [{ item: "BRG-6201", purchaseQuantity: 60, supplierUnitPrice: 16.4 }]
  }
];

// One each of Draft / Expired / Declined — the RFQ trio above stays Active.
export const STANDALONE_SUPPLIER_QUOTES: StandaloneSupplierQuoteSpec[] = [
  {
    key: "sgf-annual-fasteners",
    supplier: "SpaceGrade Fasteners",
    status: "Draft",
    supplierReference: "SGF-2026-1044",
    quotedOffset: -3,
    expirationOffset: 60,
    lines: [
      {
        item: "FST-M4-TI",
        supplierPartId: "SGF-M4-TI-CL3",
        prices: [
          { quantity: 1000, unitPrice: 2.35, leadTime: 14 },
          { quantity: 2500, unitPrice: 2.2, leadTime: 14 }
        ]
      }
    ]
  },
  {
    key: "oc-laminate-2025",
    supplier: "Orbital Composites",
    status: "Expired",
    supplierReference: "OC-Q-8812",
    quotedOffset: -210,
    expirationOffset: -30,
    lines: [
      {
        item: "MAT-CF-LAM",
        supplierPartId: "OC-CFL-2X2",
        prices: [{ quantity: 6, unitPrice: 305, leadTime: 21 }]
      }
    ]
  },
  {
    key: "dsrf-tracker-study",
    supplier: "Deep Space RF",
    status: "Declined",
    supplierReference: "DSRF-2025-0912",
    quotedOffset: -40,
    expirationOffset: 20,
    lines: [
      {
        item: "ST-050",
        supplierPartId: "DSRF-ST050-B",
        prices: [{ quantity: 2, unitPrice: 29500, leadTime: 100 }]
      }
    ]
  }
];

// Returns to vendor, one per modeled status. The completed one ships plating
// rejects back out of the fastener bin — dated after the posted cycle count so
// the count's snapshot stays the opening balance.
export const PURCHASE_RETURNS: PurchaseReturnSpec[] = [
  {
    key: "fastener-plating",
    status: "Completed",
    supplier: "SpaceGrade Fasteners",
    dateOffset: -6,
    lines: [
      { item: "FST-M4-TI", quantity: 40, unitPrice: 2.5, fromShelf: "A1-L1" }
    ]
  },
  {
    key: "valve-supersession",
    status: "To Ship",
    supplier: "PropTech Solutions",
    dateOffset: -2,
    lines: [{ item: "VLV-SOLENOID-LP", quantity: 2, unitPrice: 950 }]
  },
  {
    key: "laminate-voids",
    status: "Draft",
    supplier: "Orbital Composites",
    dateOffset: 0,
    lines: [{ item: "MAT-CF-LAM", quantity: 1, unitPrice: 320 }]
  }
];

export const satellitePurchasing: PurchasingData = {
  rfqQuantityBreaks: RFQ_QUANTITY_BREAKS,
  rfqLines: RFQ_LINES,
  rfqQuotes: RFQ_QUOTES,
  rfqWinningQuote: RFQ_WINNING_QUOTE,
  rfqOrderQuantity: RFQ_ORDER_QUANTITY,
  rfqHeader: RFQ_HEADER,
  lifecycleRfqs: LIFECYCLE_RFQS,
  purchaseOrders: PURCHASE_ORDERS,
  standaloneSupplierQuotes: STANDALONE_SUPPLIER_QUOTES,
  purchaseReturns: PURCHASE_RETURNS
};
