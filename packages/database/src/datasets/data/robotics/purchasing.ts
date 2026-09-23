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
  {
    item: "PCB-BARE-4L",
    description: "Bare 4-layer control board, 160x100mm — ENIG finish"
  },
  {
    item: "ENC-ABS-19",
    description: "19-bit single-turn absolute encoder — EtherCAT"
  }
];

// Cheapest (Northgate) vs fastest (Kestrel) vs slowest and dearest (Kappa) —
// the comparison has a winner without being a one-horse race.
export const RFQ_QUOTES: RfqQuoteSpec[] = [
  {
    key: "northgate",
    assignee: "self",
    supplier: "Northgate Electronics",
    supplierReference: "NGE-Q-4471",
    shippingCost: 250,
    lines: [
      {
        item: "PCB-BARE-4L",
        supplierPartId: "NGE-PCB-4L160",
        breaks: [
          [21, 21],
          [19, 21],
          [18, 28]
        ]
      },
      {
        item: "ENC-ABS-19",
        supplierPartId: "NGE-ENC-19ST",
        breaks: [
          [232, 30],
          [224, 30],
          [216, 35]
        ]
      }
    ]
  },
  {
    key: "kestrel",
    supplier: "Kestrel Motion",
    supplierReference: "KM-2026-0188",
    shippingCost: 180,
    lines: [
      {
        item: "PCB-BARE-4L",
        supplierPartId: "KM-PCB-4L",
        breaks: [
          [24, 14],
          [22, 14],
          [21, 18]
        ]
      },
      {
        item: "ENC-ABS-19",
        supplierPartId: "KM-ENC19",
        breaks: [
          [244, 21],
          [236, 21],
          [228, 24]
        ]
      }
    ]
  },
  {
    key: "kappa",
    supplier: "Kappa Contract Machining",
    supplierReference: "KAP-RFQ-9931",
    shippingCost: 400,
    lines: [
      {
        item: "PCB-BARE-4L",
        supplierPartId: "KAP-PCB-CTRL",
        breaks: [
          [28, 35],
          [26, 35],
          [24, 42]
        ]
      },
      {
        item: "ENC-ABS-19",
        supplierPartId: "KAP-ENC-ABS",
        breaks: [
          [268, 45],
          [258, 45],
          [248, 45]
        ]
      }
    ]
  }
];

export const RFQ_WINNING_QUOTE = "northgate";
export const RFQ_ORDER_QUANTITY = 25;

// 2 lines, finalized (Requested), fanned out to 3 suppliers.
export const RFQ_HEADER: RfqHeaderSpec = {
  ref: "prfq:controls",
  assignee: "self",
  status: "Requested",
  rfqDateOffset: -24,
  expirationOffset: 48,
  notes: "Dual-source the control board and the absolute encoder for Q4 arms.",
  internalNotes: "Award on landed cost at 25 pcs unless lead time slips."
};

// Beside the Requested RFQ: a Draft for the next arm batch's drive train, and a
// force-sensor RFQ cancelled before it went out when the cobot program slipped.
export const LIFECYCLE_RFQS: LifecycleRfqSpec[] = [
  {
    ref: "prfq:drivetrain",
    status: "Draft",
    rfqDateOffset: -2,
    expirationOffset: 28,
    notes:
      "Harmonic gear sets and crossed-roller bearings for the next arm batch.",
    internalNotes: "Hold until the J2 gear-ratio decision lands.",
    quantities: [10, 25],
    lines: [
      { item: "GBX-HD-50", description: "50mm harmonic gear set, 80:1" },
      {
        item: "BRG-CRB-100",
        description: "100mm-bore crossed roller bearing, P5"
      }
    ],
    suppliers: ["Torqline Gearing", "Kestrel Motion"]
  },
  {
    ref: "prfq:ft-sensor",
    status: "Closed",
    rfqDateOffset: -58,
    expirationOffset: -28,
    notes: "Six-axis force/torque sensors for the collaborative wrist.",
    internalNotes: "Cancelled — cobot wrist program pushed to next year.",
    quantities: [5, 20],
    lines: [
      { item: "SNS-FT-6AX", description: "Six-axis F/T sensor, 200N range" }
    ],
    suppliers: ["Northgate Electronics", "Kestrel Motion"]
  }
];

export const PURCHASE_ORDERS: PurchaseOrderSpec[] = [
  {
    source: "direct",
    log: "purchase order 1 — To Receive (Northgate)",
    supplier: "Northgate Electronics",
    purchaseOrderType: "Purchase",
    status: "To Receive",
    orderDateOffset: -346,
    lines: [
      { item: "ENC-ABS-19", purchaseQuantity: 12, supplierUnitPrice: 240 },
      { item: "SNS-FT-6AX", purchaseQuantity: 2, supplierUnitPrice: 3400 }
    ],
    receipt: {
      ref: "receipt:encoder",
      status: "Draft",
      lines: [
        {
          item: "ENC-ABS-19",
          orderQuantity: 12,
          outstandingQuantity: 12,
          receivedQuantity: 0,
          unitPrice: 240,
          // The encoder is a Batch item, so the receipt line has to ask for a lot —
          // that inline lot field is the whole point of the receiving screenshot.
          requiresBatchTracking: true
        }
      ]
    }
  },
  {
    source: "direct",
    log: "purchase order 2 — To Invoice (Precision Fasteners)",
    supplier: "Precision Fasteners Co",
    purchaseOrderType: "Purchase",
    status: "To Invoice",
    orderDateOffset: -363,
    lines: [
      { item: "FST-M8-SS", purchaseQuantity: 500, supplierUnitPrice: 0.85 }
    ],
    invoice: {
      ref: "pinvoice:fasten",
      status: "Draft",
      currencyCode: "USD",
      subtotal: 425,
      totalAmount: 425,
      dateIssuedOffset: -346,
      lines: [{ item: "FST-M8-SS", quantity: 500, supplierUnitPrice: 0.85 }]
    }
  },
  {
    source: "direct",
    log: "purchase order 3 — Draft (Torqline)",
    ref: "po:torqline",
    assignee: "self",
    supplier: "Torqline Gearing",
    purchaseOrderType: "Purchase",
    status: "Draft",
    orderDateOffset: -316,
    lines: [{ item: "GBX-HD-80", purchaseQuantity: 4, supplierUnitPrice: 1150 }]
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
    log: "purchase order — Planned (Kestrel wrist motors)",
    supplier: "Kestrel Motion",
    purchaseOrderType: "Purchase",
    status: "Planned",
    orderDateOffset: -1,
    lines: [
      { item: "MOT-AC-200W", purchaseQuantity: 3, supplierUnitPrice: 315 }
    ]
  },
  {
    source: "direct",
    log: "purchase order — To Review (Northgate control boards)",
    assignee: "self",
    supplier: "Northgate Electronics",
    purchaseOrderType: "Purchase",
    status: "To Review",
    orderDateOffset: -2,
    lines: [
      { item: "PCB-BARE-4L", purchaseQuantity: 25, supplierUnitPrice: 21 }
    ]
  },
  {
    source: "direct",
    log: "purchase order — Needs Approval (Ironbark billet buy)",
    ref: "po:needs-approval",
    supplier: "Ironbark Metals",
    purchaseOrderType: "Purchase",
    status: "Needs Approval",
    orderDateOffset: -1,
    lines: [
      // A quarter's billet for the arm bases — over the $5,000 approval tier.
      {
        item: "MAT-AL6061-BIL",
        purchaseQuantity: 1200,
        supplierUnitPrice: 4.35
      }
    ]
  },
  {
    source: "direct",
    log: "purchase order — Rejected (Torqline gear set quote too high)",
    supplier: "Torqline Gearing",
    purchaseOrderType: "Purchase",
    status: "Rejected",
    orderDateOffset: -13,
    lines: [{ item: "GBX-HD-50", purchaseQuantity: 2, supplierUnitPrice: 845 }]
  },

  // ── Receipt + invoice lifecycle — historical orders that closed out ───────
  {
    source: "direct",
    log: "purchase order — Completed, received in full and paid (Northgate)",
    ref: "po:paid",
    supplier: "Northgate Electronics",
    purchaseOrderType: "Purchase",
    status: "Completed",
    orderDateOffset: -75,
    lines: [
      { item: "ENC-ABS-19", purchaseQuantity: 6, supplierUnitPrice: 238 },
      { item: "PCB-BARE-4L", purchaseQuantity: 20, supplierUnitPrice: 21.5 }
    ],
    receipt: {
      ref: "receipt:paid",
      status: "Posted",
      postedOffset: -68,
      lines: [
        {
          item: "ENC-ABS-19",
          orderQuantity: 6,
          outstandingQuantity: 0,
          receivedQuantity: 6,
          unitPrice: 238,
          requiresBatchTracking: true,
          toShelf: "ESD-Cage",
          // Received -68 with a 365-day calibration cert → expires at +297.
          lotNumber: "LOT-ENC-2611",
          lotExpiresOffset: 297
        },
        {
          item: "PCB-BARE-4L",
          orderQuantity: 20,
          outstandingQuantity: 0,
          receivedQuantity: 20,
          unitPrice: 21.5,
          toShelf: "ESD-Cage"
        }
      ]
    },
    invoice: {
      ref: "pinvoice:paid",
      key: "paid",
      status: "Paid",
      currencyCode: "USD",
      subtotal: 1858,
      totalAmount: 1858,
      dateIssuedOffset: -62,
      dueDateOffset: -32,
      lines: [
        { item: "ENC-ABS-19", quantity: 6, supplierUnitPrice: 238 },
        { item: "PCB-BARE-4L", quantity: 20, supplierUnitPrice: 21.5 }
      ]
    }
  },
  {
    source: "direct",
    log: "purchase order — Closed short after a partial receipt (Torqline gears)",
    ref: "po:closed-short",
    supplier: "Torqline Gearing",
    purchaseOrderType: "Purchase",
    status: "Closed",
    orderDateOffset: -88,
    lines: [
      { item: "GBX-HD-80", purchaseQuantity: 4, supplierUnitPrice: 1150 }
    ],
    receipt: {
      ref: "receipt:short",
      status: "Posted",
      postedOffset: -80,
      lines: [
        {
          item: "GBX-HD-80",
          orderQuantity: 4,
          outstandingQuantity: 2,
          receivedQuantity: 2,
          unitPrice: 1150,
          toShelf: "A2-L1"
        }
      ]
    },
    // Two of four gear sets failed Torqline's outgoing backlash audit; the
    // order was closed short and a debit note issued against the billing.
    invoice: {
      ref: "pinvoice:debit-note",
      key: "debit-note",
      status: "Debit Note Issued",
      currencyCode: "USD",
      subtotal: 2300,
      totalAmount: 2300,
      dateIssuedOffset: -72,
      lines: [{ item: "GBX-HD-80", quantity: 2, supplierUnitPrice: 1150 }]
    }
  },
  {
    source: "direct",
    log: "purchase order — To Receive with a voided receipt (Precision Fasteners)",
    supplier: "Precision Fasteners Co",
    purchaseOrderType: "Purchase",
    status: "To Receive",
    orderDateOffset: -21,
    lines: [
      { item: "FST-M5-SS", purchaseQuantity: 200, supplierUnitPrice: 0.55 }
    ],
    // Keyed in against the wrong packing slip and voided before posting.
    receipt: {
      ref: "receipt:voided",
      status: "Voided",
      lines: [
        {
          item: "FST-M5-SS",
          orderQuantity: 200,
          outstandingQuantity: 200,
          receivedQuantity: 0,
          unitPrice: 0.55
        }
      ]
    }
  },
  {
    source: "direct",
    log: "purchase order — Completed, invoice open (Northgate force sensor)",
    supplier: "Northgate Electronics",
    purchaseOrderType: "Purchase",
    status: "Completed",
    orderDateOffset: -30,
    lines: [
      { item: "SNS-FT-6AX", purchaseQuantity: 1, supplierUnitPrice: 3400 }
    ],
    invoice: {
      ref: "pinvoice:open",
      key: "open",
      status: "Open",
      currencyCode: "USD",
      subtotal: 3400,
      totalAmount: 3400,
      dateIssuedOffset: -9,
      dueDateOffset: 21,
      lines: [{ item: "SNS-FT-6AX", quantity: 1, supplierUnitPrice: 3400 }]
    }
  },
  {
    source: "direct",
    log: "purchase order — Completed, invoice overdue (Ironbark steel sheet)",
    supplier: "Ironbark Metals",
    purchaseOrderType: "Purchase",
    status: "Completed",
    orderDateOffset: -60,
    lines: [
      { item: "MAT-STEEL-SHT", purchaseQuantity: 100, supplierUnitPrice: 1.95 }
    ],
    invoice: {
      ref: "pinvoice:overdue",
      key: "overdue",
      status: "Overdue",
      currencyCode: "USD",
      subtotal: 195,
      totalAmount: 195,
      dateIssuedOffset: -45,
      dueDateOffset: -15,
      lines: [{ item: "MAT-STEEL-SHT", quantity: 100, supplierUnitPrice: 1.95 }]
    }
  },
  {
    source: "direct",
    log: "purchase order — Completed, invoice partially paid (Kestrel Gen2 drives)",
    supplier: "Kestrel Motion",
    purchaseOrderType: "Purchase",
    status: "Completed",
    orderDateOffset: -55,
    lines: [
      { item: "DRV-SRV-400G2", purchaseQuantity: 10, supplierUnitPrice: 460 }
    ],
    invoice: {
      ref: "pinvoice:partial",
      key: "partial",
      status: "Partially Paid",
      currencyCode: "USD",
      subtotal: 4600,
      totalAmount: 4600,
      dateIssuedOffset: -40,
      dueDateOffset: -10,
      lines: [{ item: "DRV-SRV-400G2", quantity: 10, supplierUnitPrice: 460 }]
    }
  },
  {
    source: "direct",
    log: "purchase order — Closed, invoice voided over a billing error (Precision Fasteners)",
    supplier: "Precision Fasteners Co",
    purchaseOrderType: "Purchase",
    status: "Closed",
    orderDateOffset: -66,
    lines: [
      { item: "FST-M8-SS", purchaseQuantity: 300, supplierUnitPrice: 0.85 }
    ],
    invoice: {
      ref: "pinvoice:voided",
      key: "voided",
      status: "Voided",
      currencyCode: "USD",
      subtotal: 255,
      totalAmount: 255,
      dateIssuedOffset: -58,
      lines: [{ item: "FST-M8-SS", quantity: 300, supplierUnitPrice: 0.85 }]
    }
  },

  // ── Outside processing — arm bases out at Kappa for hard anodize ──────────
  // Mirrors the OSP orders the create function raises from a job's outside
  // operations: purchaseOrderType "Outside Processing" on the supplier with
  // the supplierProcess, line = the processed part at the operation unit cost.
  {
    source: "direct",
    log: "purchase order — Outside Processing, hard anodize at Kappa",
    assignee: "self",
    supplier: "Kappa Contract Machining",
    purchaseOrderType: "Outside Processing",
    status: "To Receive",
    orderDateOffset: -9,
    lines: [
      { item: "ARM-BASE-001", purchaseQuantity: 2, supplierUnitPrice: 180 }
    ]
  },

  // ── FX — the one EUR order, against the German drive house, unpaid ────────
  {
    source: "direct",
    log: "purchase order — EUR order, unpaid (Schwarzwald gear sets)",
    ref: "po:eur",
    supplier: "Schwarzwald Antriebstechnik GmbH",
    purchaseOrderType: "Purchase",
    status: "To Invoice",
    orderDateOffset: -18,
    currencyCode: "EUR",
    exchangeRate: 0.92,
    lines: [{ item: "GBX-HD-50", purchaseQuantity: 3, supplierUnitPrice: 720 }]
  },
  {
    source: "direct",
    log: "purchase order — To Invoice, bare boards received yesterday, awaiting incoming inspection (Northgate)",
    ref: "po:bare-boards",
    supplier: "Northgate Electronics",
    purchaseOrderType: "Purchase",
    status: "To Invoice",
    orderDateOffset: -16,
    lines: [
      { item: "PCB-BARE-4L", purchaseQuantity: 20, supplierUnitPrice: 21.5 }
    ],
    receipt: {
      ref: "receipt:bare-boards",
      status: "Posted",
      postedOffset: -1,
      lines: [
        {
          item: "PCB-BARE-4L",
          orderQuantity: 20,
          outstandingQuantity: 0,
          receivedQuantity: 20,
          unitPrice: 21.5,
          toShelf: "ESD-Cage"
        }
      ]
    }
  }
];

// One each of Draft / Expired / Declined — the RFQ trio above stays Active.
export const STANDALONE_SUPPLIER_QUOTES: StandaloneSupplierQuoteSpec[] = [
  {
    key: "pfc-annual-hardware",
    assignee: "self",
    supplier: "Precision Fasteners Co",
    status: "Draft",
    supplierReference: "PFC-2026-1044",
    quotedOffset: -3,
    expirationOffset: 60,
    lines: [
      {
        item: "FST-M8-SS",
        supplierPartId: "PFC-M8X25-A4",
        prices: [
          { quantity: 1000, unitPrice: 0.78, leadTime: 10 },
          { quantity: 2500, unitPrice: 0.72, leadTime: 10 }
        ]
      }
    ]
  },
  {
    key: "ironbark-billet-2025",
    supplier: "Ironbark Metals",
    status: "Expired",
    supplierReference: "IBM-Q-8812",
    quotedOffset: -210,
    expirationOffset: -30,
    lines: [
      {
        item: "MAT-AL6061-BIL",
        supplierPartId: "IBM-6061-T6-RD",
        prices: [{ quantity: 500, unitPrice: 4.05, leadTime: 10 }]
      }
    ]
  },
  {
    key: "kestrel-motor-study",
    supplier: "Kestrel Motion",
    status: "Declined",
    supplierReference: "KM-2025-0912",
    quotedOffset: -40,
    expirationOffset: 20,
    lines: [
      {
        item: "MOT-AC-750W",
        supplierPartId: "KM-750W-3K-B",
        prices: [{ quantity: 8, unitPrice: 665, leadTime: 40 }]
      }
    ]
  }
];

// Returns to vendor, one per modeled status. The completed one ships warped
// bare boards back out of the ESD cage — dated after the posted cycle count so
// the count's snapshot stays the opening balance.
export const PURCHASE_RETURNS: PurchaseReturnSpec[] = [
  {
    key: "pcb-warpage",
    credit: {
      status: "Draft",
      dateOffset: -4,
      lines: [{ line: 1, quantity: 12 }]
    },
    status: "Completed",
    supplier: "Northgate Electronics",
    dateOffset: -6,
    lines: [
      {
        item: "PCB-BARE-4L",
        quantity: 12,
        unitPrice: 21.5,
        fromShelf: "ESD-Cage"
      }
    ]
  },
  {
    key: "bearing-preload",
    status: "To Ship",
    supplier: "Torqline Gearing",
    dateOffset: -2,
    lines: [{ item: "BRG-CRB-100", quantity: 2, unitPrice: 185 }]
  },
  {
    key: "drive-firmware",
    status: "Draft",
    supplier: "Kestrel Motion",
    dateOffset: 0,
    lines: [{ item: "DRV-SRV-400", quantity: 1, unitPrice: 420 }]
  },
  // Drafted while MRB weighs return-to-vendor for the lost-motion gearbox (quality's ncr:gear-lost-motion links this line).
  {
    key: "gearbox-rtv",
    status: "Draft",
    supplier: "Torqline Gearing",
    dateOffset: -3,
    lines: [{ item: "GBX-HD-80", quantity: 1, unitPrice: 1150 }]
  }
];

export const roboticsPurchasing: PurchasingData = {
  rfqQuantityBreaks: RFQ_QUANTITY_BREAKS,
  rfqLines: RFQ_LINES,
  rfqQuotes: RFQ_QUOTES,
  rfqWinningQuote: RFQ_WINNING_QUOTE,
  rfqOrderQuantity: RFQ_ORDER_QUANTITY,
  rfqHeader: RFQ_HEADER,
  lifecycleRfqs: LIFECYCLE_RFQS,
  purchaseOrders: PURCHASE_ORDERS,
  standaloneSupplierQuotes: STANDALONE_SUPPLIER_QUOTES,
  purchaseReturns: PURCHASE_RETURNS,
  approvalRules: [
    { documentType: "purchaseOrder", lowerBoundAmount: 5000 },
    {
      documentType: "purchaseOrder",
      lowerBoundAmount: 25000,
      escalationDays: 3
    },
    { documentType: "supplier", lowerBoundAmount: 0 }
  ],
  approvalRequests: [
    { purchaseOrder: "po:needs-approval", requestedOffset: -1 },
    { supplier: "Voltaic Drive Systems", requestedOffset: -4 }
  ],
  supplierBankAccounts: [
    {
      supplier: "Kestrel Motion",
      name: "Kestrel remittance",
      bankName: "Allegheny Commerce Bank (demo)",
      accountHolderName: "Kestrel Motion Inc.",
      countryCode: "US",
      currencyCode: "USD",
      accountNumber: "DEMO-1188-4402",
      bankCode: "DEMO-043000",
      isPrimary: true
    },
    {
      supplier: "Torqline Gearing",
      name: "Torqline operating",
      bankName: "Ohio Valley Savings (demo)",
      accountHolderName: "Torqline Gearing LLC",
      countryCode: "US",
      currencyCode: "USD",
      accountNumber: "DEMO-2299-5513",
      isPrimary: true
    },
    {
      supplier: "Northgate Electronics",
      name: "Northgate remittance",
      bankName: "Keystone Trust (demo)",
      accountHolderName: "Northgate Electronics Corp.",
      countryCode: "US",
      currencyCode: "USD",
      accountNumber: "DEMO-3301-6624",
      isPrimary: true
    },
    {
      supplier: "Schwarzwald Antriebstechnik GmbH",
      name: "Schwarzwald EUR account",
      bankName: "Schwarzwald Handelsbank (demo)",
      accountHolderName: "Schwarzwald Antriebstechnik GmbH",
      countryCode: "DE",
      currencyCode: "EUR",
      accountNumber: "DEMO-DE00-0000-4412",
      swiftBic: "DEMODEXX",
      isPrimary: true
    }
  ]
};
