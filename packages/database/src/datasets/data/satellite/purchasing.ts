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
  }
];

export const satellitePurchasing: PurchasingData = {
  rfqQuantityBreaks: RFQ_QUANTITY_BREAKS,
  rfqLines: RFQ_LINES,
  rfqQuotes: RFQ_QUOTES,
  rfqWinningQuote: RFQ_WINNING_QUOTE,
  rfqOrderQuantity: RFQ_ORDER_QUANTITY,
  rfqHeader: RFQ_HEADER,
  purchaseOrders: PURCHASE_ORDERS
};
