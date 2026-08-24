import type {
  PurchaseOrderSpec,
  PurchasingData,
  RfqHeaderSpec,
  RfqLineSpec,
  RfqQuoteSpec
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
  status: "Requested",
  rfqDateOffset: -24,
  expirationOffset: 48,
  notes: "Dual-source the control board and the absolute encoder for Q4 arms.",
  internalNotes: "Award on landed cost at 25 pcs unless lead time slips."
};

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
  }
];

export const roboticsPurchasing: PurchasingData = {
  rfqQuantityBreaks: RFQ_QUANTITY_BREAKS,
  rfqLines: RFQ_LINES,
  rfqQuotes: RFQ_QUOTES,
  rfqWinningQuote: RFQ_WINNING_QUOTE,
  rfqOrderQuantity: RFQ_ORDER_QUANTITY,
  rfqHeader: RFQ_HEADER,
  purchaseOrders: PURCHASE_ORDERS
};
