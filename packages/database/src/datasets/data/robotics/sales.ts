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

export const ROB_PRICE_BREAKS: readonly PriceBreak[] = [
  { quantity: 1, unitPrice: 58000, leadTime: 120 },
  { quantity: 5, unitPrice: 55500, leadTime: 140, discountPercent: 0.03 },
  { quantity: 10, unitPrice: 52200, leadTime: 160, discountPercent: 0.06 },
  { quantity: 25, unitPrice: 48800, leadTime: 200, discountPercent: 0.1 }
];

export const CTRL_PRICE_BREAKS: readonly PriceBreak[] = [
  { quantity: 2, unitPrice: 11500, leadTime: 60 },
  {
    quantity: 10,
    unitPrice: 10600,
    leadTime: 75,
    discountPercent: 0.05,
    shippingCost: 850
  }
];

// The Sent quote is the one the docs screenshot at /share/quote/:externalLinkId.
// The expiration offset must stay positive or the public page renders its
// Expired state instead of the quote.
export const CASCADE_QUOTE_EXPIRATION_OFFSET = 321;

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
    log: "opportunity 1 — full chain (Lakeshore)",
    ref: "opp:lakeshore",
    customer: "Lakeshore Automotive",
    rfq: {
      ref: "rfq:lakeshore",
      status: "Quoted",
      rfqDateOffset: -377,
      expirationOffset: -316,
      externalNotes: "Body-in-white weld cell retrofit — 3 six-axis arms.",
      lines: [
        {
          item: "ROB-2000",
          customerPartId: "LKS-ROB-001",
          quantity: [3],
          order: 1
        }
      ]
    },
    quote: {
      ref: "quote:lakeshore",
      status: "Ordered",
      externalNotes:
        "Quote for 3× Vertex 10 six-axis arms with two-finger grippers.",
      lines: [
        {
          ref: "quoteline:lakeshore:rob",
          item: "ROB-2000",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 3, unitPrice: 54000, leadTime: 130 }]
        }
      ]
    },
    order: {
      ref: "so:lakeshore",
      status: "In Progress",
      orderDateOffset: -302,
      lines: [
        {
          ref: "soline:lakeshore:rob",
          item: "ROB-2000",
          saleQuantity: 3,
          unitPrice: 54000,
          status: "In Progress"
        }
      ]
    },
    shipment: {
      ref: "shp:lakeshore",
      status: "Draft",
      lines: [
        {
          item: "ROB-2000",
          orderQuantity: 3,
          outstandingQuantity: 3,
          shippedQuantity: 0,
          unitPrice: 54000
        }
      ]
    },
    invoice: {
      ref: "inv:lakeshore",
      status: "Draft",
      subtotal: 162000,
      totalAmount: 162000,
      dateIssuedOffset: -285,
      lines: [{ item: "ROB-2000", quantity: 3, unitPrice: 54000 }]
    }
  },
  {
    log: "opportunity 2 — quote sent (Cascade)",
    ref: "opp:cascade",
    customer: "Cascade Integration Group",
    quote: {
      ref: "quote:cascade",
      status: "Sent",
      expirationOffset: CASCADE_QUOTE_EXPIRATION_OFFSET,
      lines: [
        {
          ref: "quoteline:cascade:rob",
          item: "ROB-2000",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: ROB_PRICE_BREAKS
        },
        {
          ref: "quoteline:cascade:ctrl",
          item: "CTRL-100",
          status: "Complete",
          sortOrder: 2,
          priceBreaks: CTRL_PRICE_BREAKS
        }
      ],
      externalLink: {
        ref: "quotelink:cascade",
        expiresOffset: CASCADE_QUOTE_EXPIRATION_OFFSET
      }
    }
  },
  {
    log: "opportunity 3 — RFQ only (Alpine)",
    ref: "opp:alpine",
    customer: "Alpine Research Institute",
    rfq: {
      ref: "rfq:alpine",
      status: "Ready for Quote",
      rfqDateOffset: -285,
      externalNotes:
        "University robotics lab — 1 base assembly for a manipulation test rig.",
      lines: [
        {
          item: "ARM-BASE-001",
          customerPartId: "ALP-BASE-001",
          quantity: [1],
          order: 1
        }
      ]
    }
  },
  {
    log: "opportunity 4 — confirmed SO (Northwind)",
    ref: "opp:northwind",
    customer: "Northwind Electronics",
    quote: {
      ref: "quote:northwind",
      status: "Ordered",
      lines: [
        {
          ref: "quoteline:northwind:rob",
          item: "ROB-2000",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 1, unitPrice: 56000, leadTime: 120 }]
        }
      ]
    },
    order: {
      ref: "so:northwind",
      status: "Confirmed",
      orderDateOffset: -255,
      lines: [
        {
          ref: "soline:northwind:rob",
          item: "ROB-2000",
          saleQuantity: 1,
          unitPrice: 56000,
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
    customer: "Cascade Integration Group",
    item: "ARM-BASE-001",
    status: "Confirmed",
    lineStatus: "Ordered",
    orderDateOffset: -220,
    unitPrice: 6800
  },
  {
    key: "draft",
    customer: "Alpine Research Institute",
    item: "CTRL-100",
    status: "Draft",
    lineStatus: "Ordered",
    orderDateOffset: -213,
    unitPrice: 11500
  },
  {
    key: "paused",
    customer: "Lakeshore Automotive",
    item: "ARM-WRIST-001",
    status: "In Progress",
    lineStatus: "In Progress",
    orderDateOffset: -268,
    unitPrice: 9600
  },
  {
    key: "completed",
    customer: "Northwind Electronics",
    item: "GRP-2F-80",
    status: "Completed",
    lineStatus: "Completed",
    orderDateOffset: -437,
    unitPrice: 6900
  },
  {
    key: "closed",
    customer: "Cascade Integration Group",
    item: "ARM-LINK-001",
    status: "Closed",
    lineStatus: "Completed",
    orderDateOffset: -456,
    unitPrice: 12400
  },
  {
    key: "cancelled",
    customer: "Alpine Research Institute",
    item: "HRN-ARM-001",
    status: "Cancelled",
    lineStatus: "Ordered",
    orderDateOffset: -339,
    unitPrice: 1400
  }
];

// Released order — "To Ship and Invoice". The status is written by the app
// (releaseSalesOrder), not derived by a trigger, but it must still agree with
// what getSalesOrderStatus would compute: nothing sent and nothing invoiced.
export const RELEASED_ORDERS: SalesOpportunitySpec[] = [
  {
    log: "sales order — To Ship and Invoice (Cascade, staggered deliveries)",
    ref: "opp:toshipinvoice",
    customer: "Cascade Integration Group",
    order: {
      ref: "so:toshipinvoice",
      status: "To Ship and Invoice",
      orderDateOffset: -10,
      lines: STAGGERED_DELIVERIES.map((delivery) => ({
        ref: `soline:toshipinvoice:${delivery.key}`,
        // The tier appends the resolved promised date — it only exists at apply time.
        log: `  delivery ${delivery.key}`,
        item: "GRP-JAW-80",
        saleQuantity: 30,
        unitPrice: 350,
        status: "Ordered",
        promisedDateOffset: delivery.promisedDateOffset,
        sortOrder: delivery.sortOrder
      }))
    }
  }
];

export const roboticsSales: SalesData = {
  opportunities: OPPORTUNITIES,
  statusOrders: STATUS_ORDERS,
  releasedOrders: RELEASED_ORDERS
};
