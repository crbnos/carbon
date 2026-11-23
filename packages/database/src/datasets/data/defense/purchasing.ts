// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
  { item: "PCB-BARE-R3", description: "Bare PDB board, rev 3 — ENIG finish" },
  {
    item: "BAT-SMART-11AH",
    description: "12S smart battery pack — NDAA compliant"
  }
];

// Cheapest (Vanguard Electronics Supply) vs fastest (Meshline Tactical Systems) vs slowest and dearest
// (Sentry) — the comparison has a winner without being a one-horse race.
export const RFQ_QUOTES: RfqQuoteSpec[] = [
  {
    key: "celex",
    assignee: "self",
    supplier: "Vanguard Electronics Supply",
    supplierReference: "VES-Q-4471",
    shippingCost: 250,
    lines: [
      {
        item: "PCB-BARE-R3",
        supplierPartId: "VES-PCB-PDB3",
        breaks: [
          [94, 21],
          [88, 21],
          [82, 28]
        ]
      },
      {
        item: "BAT-SMART-11AH",
        supplierPartId: "VES-BAT-12S",
        breaks: [
          [1680, 30],
          [1603, 30],
          [1534, 35]
        ]
      }
    ]
  },
  {
    key: "dsrf",
    supplier: "Meshline Tactical Systems",
    supplierReference: "MTS-2026-0188",
    shippingCost: 180,
    lines: [
      {
        item: "PCB-BARE-R3",
        supplierPartId: "MTS-PCB-3",
        breaks: [
          [99, 14],
          [93, 14],
          [89, 18]
        ]
      },
      {
        item: "BAT-SMART-11AH",
        supplierPartId: "MTS-BAT-12S",
        breaks: [
          [1742, 21],
          [1673, 21],
          [1611, 24]
        ]
      }
    ]
  },
  {
    key: "proptech",
    supplier: "Sentry Propulsion Systems",
    supplierReference: "SPS-RFQ-9931",
    shippingCost: 400,
    lines: [
      {
        item: "PCB-BARE-R3",
        supplierPartId: "SPS-PDB-PCB",
        breaks: [
          [112, 35],
          [104, 35],
          [96, 42]
        ]
      },
      {
        item: "BAT-SMART-11AH",
        supplierPartId: "SPS-12S-PACK",
        breaks: [
          [1765, 45],
          [1704, 45],
          [1650, 45]
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
  assignee: "self",
  status: "Requested",
  rfqDateOffset: -24,
  expirationOffset: 48,
  notes: "Dual-source the PDB board and the 12S pack for the Q4 build.",
  internalNotes: "Award on landed cost at 25 pcs unless lead time slips."
};

export const LIFECYCLE_RFQS: LifecycleRfqSpec[] = [
  {
    ref: "prfq:propulsion",
    status: "Draft",
    rfqDateOffset: -2,
    expirationOffset: 28,
    notes: "Motors and folding arms for the Q1 arm set build.",
    internalNotes: "Add Ironclad once their supplier qualification clears.",
    quantities: [4, 8],
    lines: [
      {
        item: "MTR-4114-G2",
        description: "Gen2 motor 4114 380KV — US-origin magnets"
      },
      {
        item: "ARM-CF-30",
        description: "Folding carbon arm 30 mm, UT-scanned"
      }
    ],
    suppliers: ["Sentry Propulsion Systems", "Ridgeline Composites"]
  },
  {
    ref: "prfq:star-tracker",
    status: "Closed",
    rfqDateOffset: -58,
    expirationOffset: -28,
    notes: "Second-source EO/IR gimbal for the follow-on lot.",
    internalNotes: "Cancelled — the program kept the fielded GMB-EOIR-640.",
    quantities: [2, 6],
    lines: [
      {
        item: "GMB-EOIR-640",
        description: "EO/IR gimbal, 30x EO + 640 LWIR"
      }
    ],
    suppliers: ["Meshline Tactical Systems", "Vanguard Electronics Supply"]
  }
];

export const PURCHASE_ORDERS: PurchaseOrderSpec[] = [
  {
    source: "direct",
    log: "purchase order 1 — To Receive (Sentry)",
    supplier: "Sentry Propulsion Systems",
    purchaseOrderType: "Purchase",
    status: "To Receive",
    orderDateOffset: -346,
    lines: [
      { item: "BAT-SMART-11AH", purchaseQuantity: 6, supplierUnitPrice: 1696 },
      { item: "ESC-80A-NDAA", purchaseQuantity: 4, supplierUnitPrice: 627 }
    ],
    receipt: {
      ref: "receipt:rocket",
      status: "Draft",
      lines: [
        {
          item: "BAT-SMART-11AH",
          orderQuantity: 6,
          outstandingQuantity: 6,
          receivedQuantity: 0,
          unitPrice: 1696,
          // The battery is a Batch item, so the receipt line has to ask for a lot —
          // that inline lot field is the whole point of the receiving screenshot.
          requiresBatchTracking: true
        }
      ]
    }
  },
  {
    source: "direct",
    log: "purchase order 2 — To Invoice (MilSpec)",
    supplier: "MilSpec Fastener Supply",
    purchaseOrderType: "Purchase",
    status: "To Invoice",
    orderDateOffset: -363,
    lines: [
      { item: "FST-M3-TI", purchaseQuantity: 500, supplierUnitPrice: 2.5 }
    ],
    invoice: {
      ref: "pinvoice:fasten",
      status: "Draft",
      currencyCode: "USD",
      subtotal: 1250,
      totalAmount: 1250,
      dateIssuedOffset: -346,
      lines: [{ item: "FST-M3-TI", quantity: 500, supplierUnitPrice: 2.5 }]
    }
  },
  {
    source: "direct",
    log: "purchase order 3 — Draft (Vanguard Electronics Supply)",
    ref: "po:celex",
    assignee: "self",
    supplier: "Vanguard Electronics Supply",
    purchaseOrderType: "Purchase",
    status: "Draft",
    orderDateOffset: -316,
    lines: [
      { item: "PCB-BARE-R3", purchaseQuantity: 20, supplierUnitPrice: 90 }
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

  {
    source: "direct",
    log: "purchase order — Planned (Meshline Tactical Systems motor controllers)",
    supplier: "Meshline Tactical Systems",
    purchaseOrderType: "Purchase",
    status: "Planned",
    orderDateOffset: -1,
    lines: [
      { item: "ESC-80A-NDAA", purchaseQuantity: 2, supplierUnitPrice: 633 }
    ]
  },
  {
    source: "direct",
    log: "purchase order — To Review (Vanguard Electronics Supply PDB boards)",
    assignee: "self",
    supplier: "Vanguard Electronics Supply",
    purchaseOrderType: "Purchase",
    status: "To Review",
    orderDateOffset: -2,
    lines: [
      { item: "PCB-BARE-R3", purchaseQuantity: 15, supplierUnitPrice: 84 }
    ]
  },
  {
    source: "direct",
    log: "purchase order — Needs Approval (Ridgeline Composites prepreg)",
    ref: "po:needs-approval",
    supplier: "Ridgeline Composites",
    purchaseOrderType: "Purchase",
    status: "Needs Approval",
    orderDateOffset: -1,
    // Over the $5,000 approval tier.
    lines: [
      { item: "MAT-CF-PREPREG", purchaseQuantity: 20, supplierUnitPrice: 315 }
    ]
  },
  {
    source: "direct",
    log: "purchase order — Rejected (Sentry propeller quote too high)",
    supplier: "Sentry Propulsion Systems",
    purchaseOrderType: "Purchase",
    status: "Rejected",
    orderDateOffset: -13,
    lines: [
      { item: "PRP-2270-CF", purchaseQuantity: 2, supplierUnitPrice: 355 }
    ]
  },

  {
    source: "direct",
    log: "purchase order — Completed, received in full and paid (Vanguard Electronics Supply)",
    ref: "po:paid",
    supplier: "Vanguard Electronics Supply",
    purchaseOrderType: "Purchase",
    status: "Completed",
    orderDateOffset: -75,
    lines: [
      { item: "BAT-SMART-11AH", purchaseQuantity: 2, supplierUnitPrice: 1835 },
      { item: "PCB-BARE-R3", purchaseQuantity: 10, supplierUnitPrice: 85 }
    ],
    receipt: {
      ref: "receipt:paid",
      status: "Posted",
      postedOffset: -68,
      lines: [
        {
          item: "BAT-SMART-11AH",
          orderQuantity: 2,
          outstandingQuantity: 0,
          receivedQuantity: 2,
          unitPrice: 1835,
          requiresBatchTracking: true,
          toShelf: "A1-L2",
          // Received -68 with a 365-day pack shelf life → expires at +297.
          lotNumber: "LOT-BAT-2610",
          lotExpiresOffset: 297
        },
        {
          item: "PCB-BARE-R3",
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
      subtotal: 4520,
      totalAmount: 4520,
      dateIssuedOffset: -62,
      dueDateOffset: -32,
      lines: [
        { item: "BAT-SMART-11AH", quantity: 2, supplierUnitPrice: 1835 },
        { item: "PCB-BARE-R3", quantity: 10, supplierUnitPrice: 85 }
      ]
    }
  },
  {
    source: "direct",
    log: "purchase order — Closed short after a partial receipt (Sentry carbon arms)",
    ref: "po:closed-short",
    supplier: "Sentry Propulsion Systems",
    purchaseOrderType: "Purchase",
    status: "Closed",
    orderDateOffset: -88,
    lines: [{ item: "ARM-CF-30", purchaseQuantity: 4, supplierUnitPrice: 420 }],
    receipt: {
      ref: "receipt:short",
      status: "Posted",
      postedOffset: -80,
      lines: [
        {
          item: "ARM-CF-30",
          orderQuantity: 4,
          outstandingQuantity: 2,
          receivedQuantity: 2,
          unitPrice: 420,
          toShelf: "A3-L1"
        }
      ]
    },
    invoice: {
      ref: "pinvoice:debit-note",
      key: "debit-note",
      status: "Debit Note Issued",
      currencyCode: "USD",
      subtotal: 840,
      totalAmount: 840,
      dateIssuedOffset: -72,
      lines: [{ item: "ARM-CF-30", quantity: 2, supplierUnitPrice: 420 }]
    }
  },
  {
    source: "direct",
    log: "purchase order — To Receive with a voided receipt (MilSpec)",
    supplier: "MilSpec Fastener Supply",
    purchaseOrderType: "Purchase",
    status: "To Receive",
    orderDateOffset: -21,
    lines: [
      { item: "FST-M3-TI", purchaseQuantity: 250, supplierUnitPrice: 2.5 }
    ],
    receipt: {
      ref: "receipt:voided",
      status: "Voided",
      lines: [
        {
          item: "FST-M3-TI",
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
    log: "purchase order — Completed, invoice open (Meshline Tactical Systems EO/IR gimbal)",
    supplier: "Meshline Tactical Systems",
    purchaseOrderType: "Purchase",
    status: "Completed",
    orderDateOffset: -30,
    lines: [
      { item: "GMB-EOIR-640", purchaseQuantity: 1, supplierUnitPrice: 28000 }
    ],
    invoice: {
      ref: "pinvoice:open",
      key: "open",
      status: "Open",
      currencyCode: "USD",
      subtotal: 28000,
      totalAmount: 28000,
      dateIssuedOffset: -9,
      dueDateOffset: 21,
      lines: [{ item: "GMB-EOIR-640", quantity: 1, supplierUnitPrice: 28000 }]
    }
  },
  {
    source: "direct",
    log: "purchase order — Completed, invoice overdue (Ridgeline Composites)",
    supplier: "Ridgeline Composites",
    purchaseOrderType: "Purchase",
    status: "Completed",
    orderDateOffset: -60,
    lines: [
      { item: "MAT-CF-PREPREG", purchaseQuantity: 2, supplierUnitPrice: 320 }
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
      lines: [{ item: "MAT-CF-PREPREG", quantity: 2, supplierUnitPrice: 320 }]
    }
  },
  {
    source: "direct",
    log: "purchase order — Completed, invoice partially paid (Vanguard Electronics Supply)",
    supplier: "Vanguard Electronics Supply",
    purchaseOrderType: "Purchase",
    status: "Completed",
    orderDateOffset: -55,
    lines: [
      { item: "PCB-BARE-R3", purchaseQuantity: 40, supplierUnitPrice: 82 }
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
      lines: [{ item: "PCB-BARE-R3", quantity: 40, supplierUnitPrice: 82 }]
    }
  },
  {
    source: "direct",
    log: "purchase order — Closed, invoice voided over a billing error (MilSpec)",
    supplier: "MilSpec Fastener Supply",
    purchaseOrderType: "Purchase",
    status: "Closed",
    orderDateOffset: -66,
    lines: [
      { item: "FST-M5-A286", purchaseQuantity: 100, supplierUnitPrice: 5.5 }
    ],
    invoice: {
      ref: "pinvoice:voided",
      key: "voided",
      status: "Voided",
      currencyCode: "USD",
      subtotal: 550,
      totalAmount: 550,
      dateIssuedOffset: -58,
      lines: [{ item: "FST-M5-A286", quantity: 100, supplierUnitPrice: 5.5 }]
    }
  },

  // Mirrors the OSP orders the create function raises from a job's outside operations.
  {
    source: "direct",
    log: "purchase order — Outside Processing, anodize at Redstone",
    assignee: "self",
    supplier: "Redstone Precision Machining",
    purchaseOrderType: "Outside Processing",
    status: "To Receive",
    orderDateOffset: -9,
    lines: [{ item: "AFR-100", purchaseQuantity: 2, supplierUnitPrice: 240 }]
  },

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
    lines: [
      { item: "ISO-DAMP-M3", purchaseQuantity: 60, supplierUnitPrice: 16.4 }
    ]
  },
  {
    source: "direct",
    log: "purchase order — To Invoice, bare boards received yesterday, awaiting incoming inspection (Vanguard Electronics Supply)",
    ref: "po:bare-boards",
    supplier: "Vanguard Electronics Supply",
    purchaseOrderType: "Purchase",
    status: "To Invoice",
    orderDateOffset: -16,
    lines: [
      { item: "PCB-BARE-R3", purchaseQuantity: 10, supplierUnitPrice: 85 }
    ],
    receipt: {
      ref: "receipt:bare-boards",
      status: "Posted",
      postedOffset: -1,
      lines: [
        {
          item: "PCB-BARE-R3",
          orderQuantity: 10,
          outstandingQuantity: 0,
          receivedQuantity: 10,
          unitPrice: 85,
          toShelf: "A1-L1"
        }
      ]
    }
  }
];

export const STANDALONE_SUPPLIER_QUOTES: StandaloneSupplierQuoteSpec[] = [
  {
    key: "sgf-annual-fasteners",
    assignee: "self",
    supplier: "MilSpec Fastener Supply",
    status: "Draft",
    supplierReference: "MFS-2026-1044",
    quotedOffset: -3,
    expirationOffset: 60,
    lines: [
      {
        item: "FST-M3-TI",
        supplierPartId: "MFS-M3-TI-CL3",
        prices: [
          { quantity: 1000, unitPrice: 2.35, leadTime: 14 },
          { quantity: 2500, unitPrice: 2.2, leadTime: 14 }
        ]
      }
    ]
  },
  {
    key: "oc-laminate-2025",
    supplier: "Ridgeline Composites",
    status: "Expired",
    supplierReference: "OC-Q-8812",
    quotedOffset: -210,
    expirationOffset: -30,
    lines: [
      {
        item: "MAT-CF-PREPREG",
        supplierPartId: "RC-T700-PLY",
        prices: [{ quantity: 6, unitPrice: 305, leadTime: 21 }]
      }
    ]
  },
  {
    key: "dsrf-tracker-study",
    supplier: "Meshline Tactical Systems",
    status: "Declined",
    supplierReference: "MTS-2025-0912",
    quotedOffset: -40,
    expirationOffset: 20,
    lines: [
      {
        item: "GMB-EOIR-640",
        supplierPartId: "MTS-EOIR640-B",
        prices: [{ quantity: 2, unitPrice: 29500, leadTime: 100 }]
      }
    ]
  }
];

// The completed return is dated after the posted cycle count so the count's
// snapshot stays the opening balance.
export const PURCHASE_RETURNS: PurchaseReturnSpec[] = [
  {
    key: "fastener-plating",
    credit: {
      status: "Draft",
      dateOffset: -4,
      lines: [{ line: 1, quantity: 40 }]
    },
    status: "Completed",
    supplier: "MilSpec Fastener Supply",
    dateOffset: -6,
    lines: [
      { item: "FST-M3-TI", quantity: 40, unitPrice: 2.5, fromShelf: "A1-L1" }
    ]
  },
  {
    key: "valve-supersession",
    status: "To Ship",
    supplier: "Sentry Propulsion Systems",
    dateOffset: -2,
    lines: [{ item: "MTR-4114-G1", quantity: 2, unitPrice: 950 }]
  },
  {
    key: "laminate-voids",
    status: "Draft",
    supplier: "Ridgeline Composites",
    dateOffset: 0,
    lines: [{ item: "MAT-CF-PREPREG", quantity: 1, unitPrice: 320 }]
  },
  // Stays Draft while MRB decides; quality's ncr:tank-wall links this line.
  {
    key: "tank-wall-rtv",
    status: "Draft",
    supplier: "Sentry Propulsion Systems",
    dateOffset: -3,
    lines: [{ item: "ARM-CF-30", quantity: 1, unitPrice: 420 }]
  }
];

export const defensePurchasing: PurchasingData = {
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
    { supplier: "Ironclad Motor Co", requestedOffset: -4 }
  ],
  supplierBankAccounts: [
    {
      supplier: "Vanguard Electronics Supply",
      name: "Vanguard Electronics Supply remittance",
      bankName: "Silicon Valley Commerce (demo)",
      accountHolderName: "Vanguard Electronics Supply Corp.",
      countryCode: "US",
      currencyCode: "USD",
      accountNumber: "DEMO-3301-8820",
      bankCode: "DEMO-121140",
      isPrimary: true
    },
    {
      supplier: "Sentry Propulsion Systems",
      name: "Sentry operating",
      bankName: "South Bay Savings (demo)",
      accountHolderName: "Sentry Propulsion Systems LLC",
      countryCode: "US",
      currencyCode: "USD",
      accountNumber: "DEMO-6612-0457",
      isPrimary: true
    },
    {
      supplier: "Meshline Tactical Systems",
      name: "Meshline Tactical Systems remittance",
      bankName: "Front Range Bank (demo)",
      accountHolderName: "Meshline Tactical Systems Inc.",
      countryCode: "US",
      currencyCode: "USD",
      accountNumber: "DEMO-5178-2093",
      isPrimary: true
    },
    {
      supplier: "Rheinland Precision Bearings GmbH",
      name: "Rheinland EUR account",
      bankName: "Neckar Handelsbank (demo)",
      accountHolderName: "Rheinland Precision Bearings GmbH",
      countryCode: "DE",
      currencyCode: "EUR",
      accountNumber: "DEMO-DE00-0000-7711",
      swiftBic: "DEMODEXX",
      isPrimary: true
    }
  ]
};
