import type {
  PurchaseOrderSpec,
  PurchasingData,
  RfqHeaderSpec,
  RfqLineSpec,
  RfqQuoteSpec
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
  }
];

export const precisionPurchasing: PurchasingData = {
  rfqQuantityBreaks: RFQ_QUANTITY_BREAKS,
  rfqLines: RFQ_LINES,
  rfqQuotes: RFQ_QUOTES,
  rfqWinningQuote: RFQ_WINNING_QUOTE,
  rfqOrderQuantity: RFQ_ORDER_QUANTITY,
  rfqHeader: RFQ_HEADER,
  purchaseOrders: PURCHASE_ORDERS
};
