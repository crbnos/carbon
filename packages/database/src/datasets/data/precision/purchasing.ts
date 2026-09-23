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
export const RFQ_QUANTITY_BREAKS = [500, 1000, 2500];

export const RFQ_LINES: RfqLineSpec[] = [
  {
    item: "MAT-4140-BAR",
    description: "4140 pre-hard round bar, 2.500 in — cut to 12 ft lengths"
  },
  {
    item: "MAT-SS316-PLT",
    description: "316L stainless plate, 0.250 in — mill certs required"
  }
];

// Cheapest (Bluestem) vs fastest (Fastline) vs the incumbent in the middle —
// the comparison has a winner without being a one-horse race.
export const RFQ_QUOTES: RfqQuoteSpec[] = [
  {
    key: "bluestem",
    supplier: "Bluestem Alloys",
    supplierReference: "BSA-Q-8812",
    shippingCost: 320,
    lines: [
      {
        item: "MAT-4140-BAR",
        supplierPartId: "BSA-4140-250",
        breaks: [
          [2.72, 14],
          [2.65, 14],
          [2.58, 18]
        ]
      },
      {
        item: "MAT-SS316-PLT",
        supplierPartId: "BSA-316L-250",
        breaks: [
          [6.05, 18],
          [5.9, 18],
          [5.78, 21]
        ]
      }
    ]
  },
  {
    key: "rockriver",
    supplier: "Rock River Metals",
    supplierReference: "RRM-2026-0442",
    shippingCost: 180,
    lines: [
      {
        item: "MAT-4140-BAR",
        supplierPartId: "RRM-4140-B250",
        breaks: [
          [2.8, 10],
          [2.74, 10],
          [2.7, 12]
        ]
      },
      {
        item: "MAT-SS316-PLT",
        supplierPartId: "RRM-316-P250",
        breaks: [
          [6.3, 12],
          [6.18, 12],
          [6.05, 14]
        ]
      }
    ]
  },
  {
    key: "fastline",
    supplier: "Fastline Industrial Supply",
    supplierReference: "FL-RFQ-5507",
    shippingCost: 95,
    lines: [
      {
        item: "MAT-4140-BAR",
        supplierPartId: "FL-BAR-4140",
        breaks: [
          [3.05, 7],
          [2.98, 7],
          [2.92, 9]
        ]
      },
      {
        item: "MAT-SS316-PLT",
        supplierPartId: "FL-PLT-316L",
        breaks: [
          [6.85, 9],
          [6.7, 9],
          [6.6, 10]
        ]
      }
    ]
  }
];

export const RFQ_WINNING_QUOTE = "bluestem";
export const RFQ_ORDER_QUANTITY = 1000;

// 2 lines, finalized (Requested), fanned out to 3 suppliers.
export const RFQ_HEADER: RfqHeaderSpec = {
  ref: "prfq:barstock",
  status: "Requested",
  rfqDateOffset: -21,
  expirationOffset: 45,
  notes: "Re-source 4140 bar and 316L plate for the Q4 manifold releases.",
  internalNotes:
    "Award on landed cost at 1,000 lb unless the mill lead time pushes past three weeks."
};

// Beside the Requested RFQ: a Draft for fixture hardware, and a hydraulic
// cylinder RFQ cancelled before it went out when the customer dropped the
// press-tooling job.
export const LIFECYCLE_RFQS: LifecycleRfqSpec[] = [
  {
    ref: "prfq:fixture-hardware",
    status: "Draft",
    rfqDateOffset: -2,
    expirationOffset: 28,
    notes: "Dowels and die springs for the new fixture-plate program.",
    internalNotes: "Add a second distributor before sending.",
    quantities: [100, 250],
    lines: [
      {
        item: "HW-DOWEL-8",
        description: "8mm x 24 hardened dowel pin, m6 fit"
      },
      { item: "SPR-DIE-25", description: "25mm die spring, medium load" }
    ],
    suppliers: ["Fastline Industrial Supply", "Midway Bearing & Seal"]
  },
  {
    ref: "prfq:hyd-cylinder",
    status: "Closed",
    rfqDateOffset: -58,
    expirationOffset: -28,
    notes: "Hydraulic cylinders for the press-tooling build.",
    internalNotes: "Cancelled — customer dropped the press-tooling job.",
    quantities: [4, 10],
    lines: [
      {
        item: "CYL-HYD-40",
        description: "40mm bore x 200 stroke hydraulic cylinder"
      }
    ],
    suppliers: ["Midway Bearing & Seal", "Fastline Industrial Supply"]
  }
];

export const PURCHASE_ORDERS: PurchaseOrderSpec[] = [
  {
    source: "direct",
    log: "purchase order 1 — To Receive (Midway Bearing & Seal)",
    supplier: "Midway Bearing & Seal",
    purchaseOrderType: "Purchase",
    status: "To Receive",
    orderDateOffset: -196,
    lines: [
      { item: "BRG-DBL-6205", purchaseQuantity: 24, supplierUnitPrice: 12.4 },
      { item: "BRG-NDL-HK1512", purchaseQuantity: 30, supplierUnitPrice: 6.8 }
    ],
    receipt: {
      ref: "receipt:bearings",
      status: "Draft",
      lines: [
        {
          item: "BRG-DBL-6205",
          orderQuantity: 24,
          outstandingQuantity: 24,
          receivedQuantity: 0,
          unitPrice: 12.4,
          // The bearing is a Batch item, so the receipt line has to ask for a lot —
          // that inline lot field is the whole point of the receiving screenshot.
          requiresBatchTracking: true
        }
      ]
    }
  },
  {
    source: "direct",
    log: "purchase order 2 — To Invoice (Fastline Industrial Supply)",
    supplier: "Fastline Industrial Supply",
    purchaseOrderType: "Purchase",
    status: "To Invoice",
    orderDateOffset: -203,
    lines: [
      { item: "HW-SHCS-M6", purchaseQuantity: 1000, supplierUnitPrice: 0.42 }
    ],
    invoice: {
      ref: "pinvoice:fastline",
      status: "Draft",
      currencyCode: "USD",
      subtotal: 420,
      totalAmount: 420,
      dateIssuedOffset: -180,
      lines: [{ item: "HW-SHCS-M6", quantity: 1000, supplierUnitPrice: 0.42 }]
    }
  },
  {
    source: "direct",
    log: "purchase order 3 — Draft (Rock River Metals)",
    ref: "po:rockriver",
    supplier: "Rock River Metals",
    purchaseOrderType: "Purchase",
    status: "Draft",
    orderDateOffset: -168,
    lines: [
      { item: "MAT-AL6061-BAR", purchaseQuantity: 600, supplierUnitPrice: 3.85 }
    ]
  },
  {
    source: "winningQuote",
    log: "purchase order 4 — To Receive and Invoice (from winning quote)",
    purchaseOrderType: "Purchase",
    status: "To Receive and Invoice",
    orderDateOffset: -6,
    currencyCode: "USD",
    exchangeRate: 1
  },

  // ── Status matrix — the remaining purchaseOrderStatus values ──────────────
  {
    source: "direct",
    log: "purchase order — Planned (Rock River frame tube for the base weldment)",
    supplier: "Rock River Metals",
    purchaseOrderType: "Purchase",
    status: "Planned",
    orderDateOffset: -1,
    lines: [
      { item: "MAT-CRS-TUBE", purchaseQuantity: 60, supplierUnitPrice: 2.15 }
    ]
  },
  {
    source: "direct",
    log: "purchase order — To Review (Bluestem 4140 bar, mill certs pending)",
    supplier: "Bluestem Alloys",
    purchaseOrderType: "Purchase",
    status: "To Review",
    orderDateOffset: -3,
    lines: [
      { item: "MAT-4140-BAR", purchaseQuantity: 200, supplierUnitPrice: 2.7 }
    ]
  },
  {
    source: "direct",
    log: "purchase order — Needs Approval (Midway hydraulic cylinders over the buyer's limit)",
    supplier: "Midway Bearing & Seal",
    purchaseOrderType: "Purchase",
    status: "Needs Approval",
    orderDateOffset: -2,
    lines: [{ item: "CYL-HYD-40", purchaseQuantity: 2, supplierUnitPrice: 289 }]
  },
  {
    source: "direct",
    log: "purchase order — Rejected (Precision Gauge CMM programming quote too high)",
    supplier: "Precision Gauge Services",
    purchaseOrderType: "Purchase",
    status: "Rejected",
    orderDateOffset: -13,
    lines: [
      { item: "SVC-CMM-PROG", purchaseQuantity: 1, supplierUnitPrice: 1450 }
    ]
  },

  // ── Receipt + invoice lifecycle — historical orders that closed out ───────
  {
    source: "direct",
    log: "purchase order — Completed, received in full and paid (Midway bearings)",
    ref: "po:midway-paid",
    supplier: "Midway Bearing & Seal",
    purchaseOrderType: "Purchase",
    status: "Completed",
    orderDateOffset: -75,
    lines: [
      { item: "BRG-DBL-6205", purchaseQuantity: 4, supplierUnitPrice: 12.55 },
      { item: "BRG-NDL-HK1512", purchaseQuantity: 10, supplierUnitPrice: 6.8 }
    ],
    receipt: {
      ref: "receipt:midway-paid",
      status: "Posted",
      postedOffset: -68,
      lines: [
        {
          item: "BRG-DBL-6205",
          orderQuantity: 4,
          outstandingQuantity: 0,
          receivedQuantity: 4,
          unitPrice: 12.55,
          requiresBatchTracking: true,
          toShelf: "B1-L3",
          // Received -68 with the 365-day grease-fill shelf life → expires +297.
          lotNumber: "LOT-BRG-2607",
          lotExpiresOffset: 297
        },
        {
          item: "BRG-NDL-HK1512",
          orderQuantity: 10,
          outstandingQuantity: 0,
          receivedQuantity: 10,
          unitPrice: 6.8,
          toShelf: "B1-L3"
        }
      ]
    },
    invoice: {
      ref: "pinvoice:midway-paid",
      key: "paid",
      status: "Paid",
      currencyCode: "USD",
      subtotal: 118.2,
      totalAmount: 118.2,
      dateIssuedOffset: -62,
      dueDateOffset: -32,
      lines: [
        { item: "BRG-DBL-6205", quantity: 4, supplierUnitPrice: 12.55 },
        { item: "BRG-NDL-HK1512", quantity: 10, supplierUnitPrice: 6.8 }
      ]
    }
  },
  {
    source: "direct",
    log: "purchase order — Closed short after a partial receipt (Bluestem 316L plate)",
    ref: "po:bluestem-short",
    supplier: "Bluestem Alloys",
    purchaseOrderType: "Purchase",
    status: "Closed",
    orderDateOffset: -88,
    lines: [
      { item: "MAT-SS316-PLT", purchaseQuantity: 120, supplierUnitPrice: 6.25 }
    ],
    receipt: {
      ref: "receipt:bluestem-short",
      status: "Posted",
      postedOffset: -80,
      lines: [
        {
          item: "MAT-SS316-PLT",
          orderQuantity: 120,
          outstandingQuantity: 40,
          receivedQuantity: 80,
          unitPrice: 6.25,
          toShelf: "Bar-Stock"
        }
      ]
    },
    // 40 lb of the plate failed the mill-cert review at the dock; the order
    // was closed short and a debit note issued against the original billing.
    invoice: {
      ref: "pinvoice:bluestem-debit",
      key: "debit-note",
      status: "Debit Note Issued",
      currencyCode: "USD",
      subtotal: 500,
      totalAmount: 500,
      dateIssuedOffset: -72,
      lines: [{ item: "MAT-SS316-PLT", quantity: 80, supplierUnitPrice: 6.25 }]
    }
  },
  {
    source: "direct",
    log: "purchase order — To Receive with a voided receipt (Fastline inserts)",
    supplier: "Fastline Industrial Supply",
    purchaseOrderType: "Purchase",
    status: "To Receive",
    orderDateOffset: -21,
    lines: [
      { item: "INS-HELI-M6", purchaseQuantity: 200, supplierUnitPrice: 0.68 }
    ],
    // Keyed in against the wrong packing slip and voided before posting.
    receipt: {
      ref: "receipt:voided-inserts",
      status: "Voided",
      lines: [
        {
          item: "INS-HELI-M6",
          orderQuantity: 200,
          outstandingQuantity: 200,
          receivedQuantity: 0,
          unitPrice: 0.68
        }
      ]
    }
  },
  {
    source: "direct",
    log: "purchase order — Completed, invoice open (Fastline cap screws)",
    supplier: "Fastline Industrial Supply",
    purchaseOrderType: "Purchase",
    status: "Completed",
    orderDateOffset: -32,
    lines: [
      { item: "HW-SHCS-M10", purchaseQuantity: 300, supplierUnitPrice: 1.1 }
    ],
    invoice: {
      ref: "pinvoice:fastline-open",
      key: "open",
      status: "Open",
      currencyCode: "USD",
      subtotal: 330,
      totalAmount: 330,
      dateIssuedOffset: -8,
      dueDateOffset: 22,
      lines: [{ item: "HW-SHCS-M10", quantity: 300, supplierUnitPrice: 1.1 }]
    }
  },
  {
    source: "direct",
    log: "purchase order — Completed, invoice overdue (Rock River 5052 sheet)",
    supplier: "Rock River Metals",
    purchaseOrderType: "Purchase",
    status: "Completed",
    orderDateOffset: -60,
    lines: [
      { item: "MAT-AL5052-SHT", purchaseQuantity: 150, supplierUnitPrice: 2.95 }
    ],
    invoice: {
      ref: "pinvoice:rockriver-overdue",
      key: "overdue",
      status: "Overdue",
      currencyCode: "USD",
      subtotal: 442.5,
      totalAmount: 442.5,
      dateIssuedOffset: -45,
      dueDateOffset: -15,
      lines: [
        { item: "MAT-AL5052-SHT", quantity: 150, supplierUnitPrice: 2.95 }
      ]
    }
  },
  {
    source: "direct",
    log: "purchase order — Completed, invoice partially paid (Midway O-rings)",
    supplier: "Midway Bearing & Seal",
    purchaseOrderType: "Purchase",
    status: "Completed",
    orderDateOffset: -55,
    lines: [
      {
        item: "SEAL-ORING-224",
        purchaseQuantity: 1000,
        supplierUnitPrice: 0.35
      }
    ],
    invoice: {
      ref: "pinvoice:midway-partial",
      key: "partial",
      status: "Partially Paid",
      currencyCode: "USD",
      subtotal: 350,
      totalAmount: 350,
      dateIssuedOffset: -40,
      dueDateOffset: -10,
      lines: [
        { item: "SEAL-ORING-224", quantity: 1000, supplierUnitPrice: 0.35 }
      ]
    }
  },
  {
    source: "direct",
    log: "purchase order — Closed, invoice voided over a billing error (Fastline dowels)",
    supplier: "Fastline Industrial Supply",
    purchaseOrderType: "Purchase",
    status: "Closed",
    orderDateOffset: -66,
    lines: [
      { item: "HW-DOWEL-8", purchaseQuantity: 250, supplierUnitPrice: 0.95 }
    ],
    invoice: {
      ref: "pinvoice:fastline-voided",
      key: "voided",
      status: "Voided",
      currencyCode: "USD",
      subtotal: 237.5,
      totalAmount: 237.5,
      dateIssuedOffset: -58,
      lines: [{ item: "HW-DOWEL-8", quantity: 250, supplierUnitPrice: 0.95 }]
    }
  },

  // ── Outside processing — drive shafts out at Forge for induction harden ───
  // Mirrors the OSP orders the create function raises from a job's outside
  // operations: purchaseOrderType "Outside Processing" on the supplier with
  // the supplierProcess, line = the processed part at the operation unit cost.
  {
    source: "direct",
    log: "purchase order — Outside Processing, induction harden at Forge",
    supplier: "Forge Heat Treating",
    purchaseOrderType: "Outside Processing",
    status: "To Receive",
    orderDateOffset: -9,
    lines: [
      { item: "MCH-SHAFT-DR", purchaseQuantity: 12, supplierUnitPrice: 36 }
    ]
  },

  // ── FX — the one EUR order, against the German tool-steel house, unpaid ───
  {
    source: "direct",
    log: "purchase order — EUR order, unpaid (Bavaria Werkzeugstahl 4140 bar)",
    ref: "po:bavaria-eur",
    supplier: "Bavaria Werkzeugstahl GmbH",
    purchaseOrderType: "Purchase",
    status: "To Invoice",
    orderDateOffset: -17,
    currencyCode: "EUR",
    exchangeRate: 0.92,
    lines: [
      { item: "MAT-4140-BAR", purchaseQuantity: 250, supplierUnitPrice: 2.45 }
    ]
  }
];

// One each of Draft / Expired / Declined — the RFQ trio above stays Active.
export const STANDALONE_SUPPLIER_QUOTES: StandaloneSupplierQuoteSpec[] = [
  {
    key: "fastline-hardware-annual",
    supplier: "Fastline Industrial Supply",
    status: "Draft",
    supplierReference: "FL-2026-2210",
    quotedOffset: -4,
    expirationOffset: 55,
    lines: [
      {
        item: "HW-SHCS-M6",
        supplierPartId: "FL-SHCS-M6X20",
        prices: [
          { quantity: 2500, unitPrice: 0.4, leadTime: 10 },
          { quantity: 5000, unitPrice: 0.38, leadTime: 10 }
        ]
      }
    ]
  },
  {
    key: "bluestem-4140-lapsed",
    supplier: "Bluestem Alloys",
    status: "Expired",
    supplierReference: "BSA-Q-7741",
    quotedOffset: -200,
    expirationOffset: -25,
    lines: [
      {
        item: "MAT-4140-BAR",
        supplierPartId: "BSA-4140-250",
        prices: [{ quantity: 1000, unitPrice: 2.62, leadTime: 14 }]
      }
    ]
  },
  {
    key: "gauge-cmm-program",
    supplier: "Precision Gauge Services",
    status: "Declined",
    supplierReference: "PGS-2026-0330",
    quotedOffset: -35,
    expirationOffset: 15,
    lines: [
      {
        item: "SVC-CMM-PROG",
        supplierPartId: "PGS-CMM-DEV",
        prices: [{ quantity: 4, unitPrice: 1180, leadTime: 10 }]
      }
    ]
  }
];

// Returns to vendor, one per modeled status. The completed one ships a batch
// of nicked O-rings back out of the seal bin — dated after the posted cycle
// count so the count's snapshot stays the opening balance.
export const PURCHASE_RETURNS: PurchaseReturnSpec[] = [
  {
    key: "oring-cut-lips",
    status: "Completed",
    supplier: "Midway Bearing & Seal",
    dateOffset: -6,
    lines: [
      {
        item: "SEAL-ORING-224",
        quantity: 30,
        unitPrice: 0.35,
        fromShelf: "B2-L1"
      }
    ]
  },
  {
    key: "insert-wrong-pitch",
    status: "To Ship",
    supplier: "Fastline Industrial Supply",
    dateOffset: -2,
    lines: [{ item: "INS-HELI-M6", quantity: 25, unitPrice: 0.68 }]
  },
  {
    key: "plate-laminations",
    status: "Draft",
    supplier: "Bluestem Alloys",
    dateOffset: 0,
    lines: [{ item: "MAT-SS316-PLT", quantity: 15, unitPrice: 6.2 }]
  }
];

export const precisionPurchasing: PurchasingData = {
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
