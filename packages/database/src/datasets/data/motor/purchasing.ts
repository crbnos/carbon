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
export const RFQ_QUANTITY_BREAKS = [100, 250, 500];

export const RFQ_LINES: RfqLineSpec[] = [
  {
    item: "MAG-NDFB-45",
    description: "N45SH arc segment, 5mm, NiCuNi plated — 150 degC rated"
  },
  {
    item: "ENC-INC-2048",
    description: "2048 PPR incremental encoder, 8mm hollow bore, line driver"
  }
];

// Cheapest (Meridian) vs fastest (Copperline) vs slowest and dearest (Maumee) —
// the comparison has a winner without being a one-horse race.
export const RFQ_QUOTES: RfqQuoteSpec[] = [
  {
    key: "meridian",
    supplier: "Meridian Magnetics",
    supplierReference: "MM-Q-8812",
    shippingCost: 320,
    lines: [
      {
        item: "MAG-NDFB-45",
        supplierPartId: "MM-N45SH-ARC5",
        breaks: [
          [17.9, 60],
          [17.2, 60],
          [16.4, 70]
        ]
      },
      {
        item: "ENC-INC-2048",
        supplierPartId: "MM-ENC-2048H",
        breaks: [
          [93, 35],
          [90, 35],
          [87, 42]
        ]
      }
    ]
  },
  {
    key: "copperline",
    supplier: "Copperline Wire Works",
    supplierReference: "CWW-2026-0344",
    shippingCost: 210,
    lines: [
      {
        item: "MAG-NDFB-45",
        supplierPartId: "CWW-MAG-N45",
        breaks: [
          [19.4, 28],
          [18.8, 28],
          [18.1, 35]
        ]
      },
      {
        item: "ENC-INC-2048",
        supplierPartId: "CWW-ENC-2048",
        breaks: [
          [98, 21],
          [95, 21],
          [92, 24]
        ]
      }
    ]
  },
  {
    key: "maumee",
    supplier: "Maumee Contract Machining",
    supplierReference: "MCM-RFQ-5107",
    shippingCost: 480,
    lines: [
      {
        item: "MAG-NDFB-45",
        supplierPartId: "MCM-MAG-ARC",
        breaks: [
          [21.8, 75],
          [20.9, 75],
          [20.1, 90]
        ]
      },
      {
        item: "ENC-INC-2048",
        supplierPartId: "MCM-ENC-INC",
        breaks: [
          [108, 56],
          [104, 56],
          [101, 63]
        ]
      }
    ]
  }
];

export const RFQ_WINNING_QUOTE = "meridian";
export const RFQ_ORDER_QUANTITY = 250;

// 2 lines, finalized (Requested), fanned out to 3 suppliers.
export const RFQ_HEADER: RfqHeaderSpec = {
  ref: "prfq:magnets",
  status: "Requested",
  rfqDateOffset: -24,
  expirationOffset: 48,
  notes:
    "Dual-source the N45SH magnet segment and the 2048 PPR encoder for Q4.",
  internalNotes: "Award on landed cost at 250 pcs unless the lot certs slip."
};

// Beside the Requested RFQ: a Draft for next quarter's bearings, and a cooling
// fan RFQ cancelled before it went out when the TEFC redesign moved to an
// integral fan.
export const LIFECYCLE_RFQS: LifecycleRfqSpec[] = [
  {
    ref: "prfq:bearings",
    status: "Draft",
    rfqDateOffset: -2,
    expirationOffset: 28,
    notes: "C3-clearance bearings for next quarter's frame builds.",
    internalNotes: "Ask for hybrid-ceramic pricing as an alternate.",
    quantities: [100, 250],
    lines: [
      {
        item: "BRG-6206-C3",
        description: "6206 deep groove ball bearing, C3 clearance"
      },
      {
        item: "BRG-6308-C3",
        description: "6308 deep groove ball bearing, C3 clearance"
      }
    ],
    suppliers: ["Summit Bearing Supply", "Ironwood Fasteners"]
  },
  {
    ref: "prfq:cooling-fan",
    status: "Closed",
    rfqDateOffset: -58,
    expirationOffset: -28,
    notes: "Axial cooling fans for the TEFC frame.",
    internalNotes: "Cancelled — TEFC redesign moved to an integral shaft fan.",
    quantities: [50, 150],
    lines: [
      { item: "FAN-AX-160", description: "160mm axial cooling fan, IP55" }
    ],
    suppliers: ["Summit Bearing Supply", "Maumee Contract Machining"]
  }
];

export const PURCHASE_ORDERS: PurchaseOrderSpec[] = [
  {
    source: "direct",
    log: "purchase order 1 — To Receive (Meridian)",
    supplier: "Meridian Magnetics",
    purchaseOrderType: "Purchase",
    status: "To Receive",
    orderDateOffset: -346,
    lines: [
      { item: "MAG-NDFB-45", purchaseQuantity: 480, supplierUnitPrice: 18.5 },
      { item: "MAG-NDFB-38", purchaseQuantity: 360, supplierUnitPrice: 14.2 }
    ],
    receipt: {
      ref: "receipt:magnets",
      status: "Draft",
      lines: [
        {
          item: "MAG-NDFB-45",
          orderQuantity: 480,
          outstandingQuantity: 480,
          receivedQuantity: 0,
          unitPrice: 18.5,
          // The magnet is a Batch item, so the receipt line has to ask for a lot —
          // that inline lot field is the whole point of the receiving screenshot.
          requiresBatchTracking: true
        }
      ]
    }
  },
  {
    source: "direct",
    log: "purchase order 2 — To Invoice (Ironwood Fasteners)",
    supplier: "Ironwood Fasteners",
    purchaseOrderType: "Purchase",
    status: "To Invoice",
    orderDateOffset: -363,
    lines: [
      { item: "FST-M6-SS", purchaseQuantity: 900, supplierUnitPrice: 0.42 }
    ],
    invoice: {
      ref: "pinvoice:fasten",
      status: "Draft",
      currencyCode: "USD",
      subtotal: 378,
      totalAmount: 378,
      dateIssuedOffset: -346,
      lines: [{ item: "FST-M6-SS", quantity: 900, supplierUnitPrice: 0.42 }]
    }
  },
  {
    source: "direct",
    log: "purchase order 3 — Draft (Summit Bearing)",
    ref: "po:summit",
    supplier: "Summit Bearing Supply",
    purchaseOrderType: "Purchase",
    status: "Draft",
    orderDateOffset: -316,
    lines: [
      { item: "BRG-6308-C3", purchaseQuantity: 40, supplierUnitPrice: 26.8 }
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
    log: "purchase order — Planned (Meridian N45SH restock)",
    supplier: "Meridian Magnetics",
    purchaseOrderType: "Purchase",
    status: "Planned",
    orderDateOffset: -1,
    lines: [
      { item: "MAG-NDFB-45", purchaseQuantity: 120, supplierUnitPrice: 18.5 }
    ]
  },
  {
    source: "direct",
    log: "purchase order — To Review (Copperline magnet wire)",
    supplier: "Copperline Wire Works",
    purchaseOrderType: "Purchase",
    status: "To Review",
    orderDateOffset: -2,
    lines: [
      { item: "MAT-CU-18AWG", purchaseQuantity: 200, supplierUnitPrice: 6.4 }
    ]
  },
  {
    source: "direct",
    log: "purchase order — Needs Approval (Summit hybrid ceramic bearings)",
    supplier: "Summit Bearing Supply",
    purchaseOrderType: "Purchase",
    status: "Needs Approval",
    orderDateOffset: -1,
    lines: [
      { item: "BRG-6206-HYB", purchaseQuantity: 24, supplierUnitPrice: 34 }
    ]
  },
  {
    source: "direct",
    log: "purchase order — Rejected (Lakeland M19 surcharge too steep)",
    supplier: "Lakeland Electrical Steel",
    purchaseOrderType: "Purchase",
    status: "Rejected",
    orderDateOffset: -13,
    lines: [
      { item: "MAT-LAM-M19", purchaseQuantity: 1000, supplierUnitPrice: 2.05 }
    ]
  },

  // ── Receipt + invoice lifecycle — historical orders that closed out ───────
  {
    source: "direct",
    log: "purchase order — Completed, received in full and paid (Copperline)",
    ref: "po:wire-paid",
    supplier: "Copperline Wire Works",
    purchaseOrderType: "Purchase",
    status: "Completed",
    orderDateOffset: -75,
    lines: [
      { item: "MAT-CU-18AWG", purchaseQuantity: 120, supplierUnitPrice: 6.55 },
      { item: "MAT-INS-NOMEX", purchaseQuantity: 20, supplierUnitPrice: 12.5 }
    ],
    receipt: {
      ref: "receipt:wire-paid",
      status: "Posted",
      postedOffset: -68,
      lines: [
        {
          item: "MAT-CU-18AWG",
          orderQuantity: 120,
          outstandingQuantity: 0,
          receivedQuantity: 120,
          unitPrice: 6.55,
          requiresBatchTracking: true,
          toShelf: "Winding-Crib",
          // Received -68 with the 270-day solderability cert → expires at +202.
          lotNumber: "LOT-CU18-2610",
          lotExpiresOffset: 202
        },
        {
          item: "MAT-INS-NOMEX",
          orderQuantity: 20,
          outstandingQuantity: 0,
          receivedQuantity: 20,
          unitPrice: 12.5,
          toShelf: "Winding-Crib"
        }
      ]
    },
    invoice: {
      ref: "pinvoice:paid",
      key: "paid",
      status: "Paid",
      currencyCode: "USD",
      subtotal: 1036,
      totalAmount: 1036,
      dateIssuedOffset: -60,
      dueDateOffset: -30,
      lines: [
        { item: "MAT-CU-18AWG", quantity: 120, supplierUnitPrice: 6.55 },
        { item: "MAT-INS-NOMEX", quantity: 20, supplierUnitPrice: 12.5 }
      ]
    }
  },
  {
    source: "direct",
    log: "purchase order — Closed short after a partial receipt (Lakeland bar)",
    ref: "po:closed-short",
    supplier: "Lakeland Electrical Steel",
    purchaseOrderType: "Purchase",
    status: "Closed",
    orderDateOffset: -88,
    lines: [
      { item: "MAT-AL6061-BAR", purchaseQuantity: 400, supplierUnitPrice: 3.9 }
    ],
    receipt: {
      ref: "receipt:short",
      status: "Posted",
      postedOffset: -80,
      lines: [
        {
          item: "MAT-AL6061-BAR",
          orderQuantity: 400,
          outstandingQuantity: 150,
          receivedQuantity: 250,
          unitPrice: 3.9,
          toShelf: "A3-L2"
        }
      ]
    },
    // The last 150 lb of bar failed the mill cert review at Lakeland; the
    // order was closed short and a debit note issued against the billing.
    invoice: {
      ref: "pinvoice:debit-note",
      key: "debit-note",
      status: "Debit Note Issued",
      currencyCode: "USD",
      subtotal: 975,
      totalAmount: 975,
      dateIssuedOffset: -72,
      lines: [{ item: "MAT-AL6061-BAR", quantity: 250, supplierUnitPrice: 3.9 }]
    }
  },
  {
    source: "direct",
    log: "purchase order — To Receive with a voided receipt (Ironwood)",
    supplier: "Ironwood Fasteners",
    purchaseOrderType: "Purchase",
    status: "To Receive",
    orderDateOffset: -21,
    lines: [
      { item: "FST-M10-SS", purchaseQuantity: 200, supplierUnitPrice: 1.15 }
    ],
    // Keyed in against the wrong packing list and voided before posting.
    receipt: {
      ref: "receipt:voided",
      status: "Voided",
      lines: [
        {
          item: "FST-M10-SS",
          orderQuantity: 200,
          outstandingQuantity: 200,
          receivedQuantity: 0,
          unitPrice: 1.15
        }
      ]
    }
  },
  {
    source: "direct",
    log: "purchase order — Completed, invoice open (Summit 6308 bearings)",
    supplier: "Summit Bearing Supply",
    purchaseOrderType: "Purchase",
    status: "Completed",
    orderDateOffset: -30,
    lines: [
      { item: "BRG-6308-C3", purchaseQuantity: 20, supplierUnitPrice: 26.8 }
    ],
    invoice: {
      ref: "pinvoice:open",
      key: "open",
      status: "Open",
      currencyCode: "USD",
      subtotal: 536,
      totalAmount: 536,
      dateIssuedOffset: -9,
      dueDateOffset: 21,
      lines: [{ item: "BRG-6308-C3", quantity: 20, supplierUnitPrice: 26.8 }]
    }
  },
  {
    source: "direct",
    log: "purchase order — Completed, invoice overdue (Lakeland shaft bar)",
    supplier: "Lakeland Electrical Steel",
    purchaseOrderType: "Purchase",
    status: "Completed",
    orderDateOffset: -60,
    lines: [
      { item: "MAT-STL-4140", purchaseQuantity: 200, supplierUnitPrice: 2.7 }
    ],
    invoice: {
      ref: "pinvoice:overdue",
      key: "overdue",
      status: "Overdue",
      currencyCode: "USD",
      subtotal: 540,
      totalAmount: 540,
      dateIssuedOffset: -45,
      dueDateOffset: -15,
      lines: [{ item: "MAT-STL-4140", quantity: 200, supplierUnitPrice: 2.7 }]
    }
  },
  {
    source: "direct",
    log: "purchase order — Completed, invoice partially paid (Copperline)",
    supplier: "Copperline Wire Works",
    purchaseOrderType: "Purchase",
    status: "Completed",
    orderDateOffset: -55,
    lines: [
      { item: "TRM-BLK-6P", purchaseQuantity: 40, supplierUnitPrice: 8.9 }
    ],
    invoice: {
      ref: "pinvoice:partial",
      key: "partial",
      status: "Partially Paid",
      currencyCode: "USD",
      subtotal: 356,
      totalAmount: 356,
      dateIssuedOffset: -40,
      dueDateOffset: -10,
      lines: [{ item: "TRM-BLK-6P", quantity: 40, supplierUnitPrice: 8.9 }]
    }
  },
  {
    source: "direct",
    log: "purchase order — Closed, invoice voided over a billing error (Ironwood)",
    supplier: "Ironwood Fasteners",
    purchaseOrderType: "Purchase",
    status: "Closed",
    orderDateOffset: -66,
    lines: [
      { item: "FST-M6-SS", purchaseQuantity: 500, supplierUnitPrice: 0.42 }
    ],
    invoice: {
      ref: "pinvoice:voided",
      key: "voided",
      status: "Voided",
      currencyCode: "USD",
      subtotal: 210,
      totalAmount: 210,
      dateIssuedOffset: -58,
      lines: [{ item: "FST-M6-SS", quantity: 500, supplierUnitPrice: 0.42 }]
    }
  },

  // ── Outside processing — shafts out at Maumee for nitride ─────────────────
  // Mirrors the OSP orders the create function raises from a job's outside
  // operations: purchaseOrderType "Outside Processing" on the supplier with
  // the supplierProcess, line = the processed part at the operation unit cost.
  {
    source: "direct",
    log: "purchase order — Outside Processing, shaft nitride at Maumee",
    supplier: "Maumee Contract Machining",
    purchaseOrderType: "Outside Processing",
    status: "To Receive",
    orderDateOffset: -9,
    lines: [{ item: "SHF-9000", purchaseQuantity: 4, supplierUnitPrice: 48 }]
  },

  // ── FX — the one EUR order, against the German ferrite house, unpaid ──────
  {
    source: "direct",
    log: "purchase order — EUR order, unpaid (Euromag ferrite segments)",
    ref: "po:eur",
    supplier: "Euromag Ferrite Werke GmbH",
    purchaseOrderType: "Purchase",
    status: "To Invoice",
    orderDateOffset: -18,
    currencyCode: "EUR",
    exchangeRate: 0.92,
    lines: [
      { item: "MAG-NDFB-38", purchaseQuantity: 60, supplierUnitPrice: 13.2 }
    ]
  }
];

// One each of Draft / Expired / Declined — the RFQ trio above stays Active.
export const STANDALONE_SUPPLIER_QUOTES: StandaloneSupplierQuoteSpec[] = [
  {
    key: "ironwood-hardware-blanket",
    supplier: "Ironwood Fasteners",
    status: "Draft",
    supplierReference: "IWF-2026-0781",
    quotedOffset: -3,
    expirationOffset: 60,
    lines: [
      {
        item: "FST-M10-SS",
        supplierPartId: "IWF-M10X35-A2",
        prices: [
          { quantity: 500, unitPrice: 1.08, leadTime: 10 },
          { quantity: 1500, unitPrice: 1.02, leadTime: 10 }
        ]
      }
    ]
  },
  {
    key: "lakeland-m19-annual",
    supplier: "Lakeland Electrical Steel",
    status: "Expired",
    supplierReference: "LES-Q-5523",
    quotedOffset: -220,
    expirationOffset: -25,
    lines: [
      {
        item: "MAT-LAM-M19",
        supplierPartId: "LES-M19-035C5",
        prices: [{ quantity: 2000, unitPrice: 1.78, leadTime: 28 }]
      }
    ]
  },
  {
    key: "summit-hybrid-study",
    supplier: "Summit Bearing Supply",
    status: "Declined",
    supplierReference: "SBS-2026-0114",
    quotedOffset: -40,
    expirationOffset: 20,
    lines: [
      {
        item: "BRG-6206-HYB",
        supplierPartId: "SBS-6206-HC5",
        prices: [{ quantity: 50, unitPrice: 32.5, leadTime: 28 }]
      }
    ]
  }
];

// Returns to vendor, one per modeled status. The completed one ships a
// wrong-plating bolt lot back out of the hardware bin — dated after the
// posted cycle count so the count's snapshot stays the opening balance.
export const PURCHASE_RETURNS: PurchaseReturnSpec[] = [
  {
    key: "bolt-plating",
    status: "Completed",
    supplier: "Ironwood Fasteners",
    dateOffset: -6,
    lines: [
      { item: "FST-M10-SS", quantity: 40, unitPrice: 1.15, fromShelf: "A1-L1" }
    ]
  },
  {
    key: "bearing-brinelling",
    status: "To Ship",
    supplier: "Summit Bearing Supply",
    dateOffset: -2,
    lines: [{ item: "BRG-6308-C3", quantity: 2, unitPrice: 26.8 }]
  },
  {
    key: "terminal-block-recall",
    status: "Draft",
    supplier: "Copperline Wire Works",
    dateOffset: 0,
    lines: [{ item: "TRM-BLK-6P", quantity: 3, unitPrice: 8.9 }]
  }
];

export const motorPurchasing: PurchasingData = {
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
