// Four opportunities at different completeness levels — this is the acceptance
// test for the whole seed. Every detail page (opportunity, rfq, quote,
// salesOrder, shipment, salesInvoice) must open without a 500 or redirect.

import type {
  PriceBreak,
  SalesData,
  SalesOpportunitySpec,
  SalesStatusOrderSpec,
  StaggeredDeliverySpec
} from "../../types.ts";

export const MTR9000_PRICE_BREAKS: readonly PriceBreak[] = [
  { quantity: 5, unitPrice: 4850, leadTime: 70 },
  { quantity: 25, unitPrice: 4610, leadTime: 84, discountPercent: 0.05 },
  { quantity: 50, unitPrice: 4365, leadTime: 98, discountPercent: 0.1 },
  { quantity: 100, unitPrice: 4120, leadTime: 126, discountPercent: 0.15 }
];

export const MTR4500_PRICE_BREAKS: readonly PriceBreak[] = [
  { quantity: 10, unitPrice: 2950, leadTime: 56 },
  {
    quantity: 50,
    unitPrice: 2760,
    leadTime: 70,
    discountPercent: 0.06,
    shippingCost: 640
  }
];

// The Sent quote is the one the docs screenshot at /share/quote/:externalLinkId.
// The expiration offset must stay positive or the public page renders its
// Expired state instead of the quote.
export const CARDINAL_QUOTE_EXPIRATION_OFFSET = 298;

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
    log: "opportunity 1 — full chain (Ridgeline)",
    ref: "opp:ridgeline",
    customer: "Ridgeline Drive Systems",
    rfq: {
      ref: "rfq:ridgeline",
      status: "Quoted",
      rfqDateOffset: -377,
      expirationOffset: -316,
      externalNotes:
        "Conveyor drive refresh — 6 servo motors with encoder feedback.",
      lines: [
        {
          item: "MTR-9000",
          customerPartId: "RDS-MTR-9000",
          quantity: [6],
          order: 1
        }
      ]
    },
    quote: {
      ref: "quote:ridgeline",
      status: "Ordered",
      externalNotes:
        "Quote for 6x TD-9000 servo motors, 2048 PPR encoder, IP55 terminal box.",
      lines: [
        {
          ref: "quoteline:ridgeline:mtr",
          item: "MTR-9000",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 6, unitPrice: 4700, leadTime: 75 }]
        }
      ]
    },
    order: {
      ref: "so:ridgeline",
      status: "In Progress",
      orderDateOffset: -302,
      lines: [
        {
          ref: "soline:ridgeline:mtr",
          item: "MTR-9000",
          saleQuantity: 6,
          unitPrice: 4700,
          status: "In Progress"
        }
      ]
    },
    shipment: {
      ref: "shp:ridgeline",
      status: "Draft",
      lines: [
        {
          item: "MTR-9000",
          orderQuantity: 6,
          outstandingQuantity: 6,
          shippedQuantity: 0,
          unitPrice: 4700
        }
      ]
    },
    invoice: {
      ref: "inv:ridgeline",
      status: "Draft",
      subtotal: 28200,
      totalAmount: 28200,
      dateIssuedOffset: -285,
      lines: [{ item: "MTR-9000", quantity: 6, unitPrice: 4700 }]
    }
  },
  {
    log: "opportunity 2 — quote sent (Cardinal)",
    ref: "opp:cardinal",
    customer: "Cardinal Motorworks",
    quote: {
      ref: "quote:cardinal",
      status: "Sent",
      expirationOffset: CARDINAL_QUOTE_EXPIRATION_OFFSET,
      lines: [
        {
          ref: "quoteline:cardinal:mtr9000",
          item: "MTR-9000",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: MTR9000_PRICE_BREAKS
        },
        {
          ref: "quoteline:cardinal:mtr4500",
          item: "MTR-4500",
          status: "Complete",
          sortOrder: 2,
          priceBreaks: MTR4500_PRICE_BREAKS
        }
      ],
      externalLink: {
        ref: "quotelink:cardinal",
        expiresOffset: CARDINAL_QUOTE_EXPIRATION_OFFSET
      }
    }
  },
  {
    log: "opportunity 3 — RFQ only (Wabash)",
    ref: "opp:wabash",
    customer: "Wabash Industrial Supply",
    rfq: {
      ref: "rfq:wabash",
      status: "Ready for Quote",
      rfqDateOffset: -285,
      externalNotes:
        "Distribution stocking request — spare 9000-frame stator assemblies.",
      lines: [
        {
          item: "STA-9000",
          customerPartId: "WIS-STA-9000",
          quantity: [4],
          order: 1
        }
      ]
    }
  },
  {
    log: "opportunity 4 — confirmed SO (Halcyon)",
    ref: "opp:halcyon",
    customer: "Halcyon Aerospace Actuation",
    quote: {
      ref: "quote:halcyon",
      status: "Ordered",
      lines: [
        {
          ref: "quoteline:halcyon:mtr",
          item: "MTR-4500",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 4, unitPrice: 3120, leadTime: 63 }]
        }
      ]
    },
    order: {
      ref: "so:halcyon",
      status: "Confirmed",
      orderDateOffset: -255,
      lines: [
        {
          ref: "soline:halcyon:mtr",
          item: "MTR-4500",
          saleQuantity: 4,
          unitPrice: 3120,
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
    customer: "Cardinal Motorworks",
    item: "STA-9000",
    status: "Confirmed",
    lineStatus: "Ordered",
    orderDateOffset: -220,
    unitPrice: 1180
  },
  {
    key: "draft",
    customer: "Wabash Industrial Supply",
    item: "HSG-9000",
    status: "Draft",
    lineStatus: "Ordered",
    orderDateOffset: -213,
    unitPrice: 640
  },
  {
    key: "paused",
    customer: "Ridgeline Drive Systems",
    item: "ROT-9000",
    status: "In Progress",
    lineStatus: "In Progress",
    orderDateOffset: -268,
    unitPrice: 1420
  },
  {
    key: "completed",
    customer: "Halcyon Aerospace Actuation",
    item: "TRM-BOX-9000",
    status: "Completed",
    lineStatus: "Completed",
    orderDateOffset: -437,
    unitPrice: 165
  },
  {
    key: "closed",
    customer: "Cardinal Motorworks",
    item: "COIL-9000",
    status: "Closed",
    lineStatus: "Completed",
    orderDateOffset: -456,
    unitPrice: 480
  },
  {
    key: "cancelled",
    customer: "Wabash Industrial Supply",
    item: "SHF-9000",
    status: "Cancelled",
    lineStatus: "Ordered",
    orderDateOffset: -339,
    unitPrice: 210
  }
];

// Released order — "To Ship and Invoice". The status is written by the app
// (releaseSalesOrder), not derived by a trigger, but it must still agree with
// what getSalesOrderStatus would compute: nothing sent and nothing invoiced.
export const RELEASED_ORDERS: SalesOpportunitySpec[] = [
  {
    log: "sales order — To Ship and Invoice (Cardinal, staggered deliveries)",
    ref: "opp:toshipinvoice",
    customer: "Cardinal Motorworks",
    order: {
      ref: "so:toshipinvoice",
      status: "To Ship and Invoice",
      orderDateOffset: -10,
      lines: STAGGERED_DELIVERIES.map((delivery) => ({
        ref: `soline:toshipinvoice:${delivery.key}`,
        // The tier appends the resolved promised date — it only exists at apply time.
        log: `  delivery ${delivery.key}`,
        item: "MTR-4500",
        saleQuantity: 10,
        unitPrice: 2900,
        status: "Ordered",
        promisedDateOffset: delivery.promisedDateOffset,
        sortOrder: delivery.sortOrder
      }))
    }
  }
];

export const motorSales: SalesData = {
  opportunities: OPPORTUNITIES,
  statusOrders: STATUS_ORDERS,
  releasedOrders: RELEASED_ORDERS
};
