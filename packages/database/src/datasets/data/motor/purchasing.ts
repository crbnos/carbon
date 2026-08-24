import type {
  PurchaseOrderSpec,
  PurchasingData,
  RfqHeaderSpec,
  RfqLineSpec,
  RfqQuoteSpec
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
  }
];

export const motorPurchasing: PurchasingData = {
  rfqQuantityBreaks: RFQ_QUANTITY_BREAKS,
  rfqLines: RFQ_LINES,
  rfqQuotes: RFQ_QUOTES,
  rfqWinningQuote: RFQ_WINNING_QUOTE,
  rfqOrderQuantity: RFQ_ORDER_QUANTITY,
  rfqHeader: RFQ_HEADER,
  purchaseOrders: PURCHASE_ORDERS
};
