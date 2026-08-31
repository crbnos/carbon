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

export const SAT_PRICE_BREAKS: readonly PriceBreak[] = [
  { quantity: 1, unitPrice: 1950000, leadTime: 240 },
  { quantity: 5, unitPrice: 1840000, leadTime: 270, discountPercent: 0.03 },
  { quantity: 10, unitPrice: 1725000, leadTime: 300, discountPercent: 0.06 },
  { quantity: 25, unitPrice: 1580000, leadTime: 360, discountPercent: 0.1 }
];

export const EPS_PRICE_BREAKS: readonly PriceBreak[] = [
  { quantity: 2, unitPrice: 128000, leadTime: 120 },
  {
    quantity: 10,
    unitPrice: 118000,
    leadTime: 150,
    discountPercent: 0.05,
    shippingCost: 2400
  }
];

// The Sent quote is the one the docs screenshot at /share/quote/:externalLinkId.
// The expiration offset must stay positive or the public page renders its
// Expired state instead of the quote.
export const NOVASAT_QUOTE_EXPIRATION_OFFSET = 321;

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
    log: "opportunity 1 — full chain (ORBSEC)",
    ref: "opp:orbsec",
    customer: "ORBSEC Defense",
    rfq: {
      ref: "rfq:orbsec",
      status: "Quoted",
      rfqDateOffset: -377,
      expirationOffset: -316,
      externalNotes: "GEO surveillance constellation — 3 buses required.",
      lines: [
        {
          item: "SAT-1000",
          customerPartId: "ORBSEC-SAT-001",
          quantity: [3],
          order: 1
        }
      ]
    },
    quote: {
      ref: "quote:orbsec",
      status: "Ordered",
      externalNotes: "Quote for 3× ESPA-class satellite buses.",
      lines: [
        {
          ref: "quoteline:orbsec:sat",
          item: "SAT-1000",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 3, unitPrice: 1800000, leadTime: 260 }]
        }
      ]
    },
    order: {
      ref: "so:orbsec",
      status: "In Progress",
      orderDateOffset: -302,
      lines: [
        {
          ref: "soline:orbsec:sat",
          item: "SAT-1000",
          saleQuantity: 3,
          unitPrice: 1800000,
          status: "In Progress"
        }
      ]
    },
    shipment: {
      ref: "shp:orbsec",
      status: "Draft",
      lines: [
        {
          item: "SAT-1000",
          orderQuantity: 3,
          outstandingQuantity: 3,
          shippedQuantity: 0,
          unitPrice: 1800000
        }
      ]
    },
    invoice: {
      ref: "inv:orbsec",
      status: "Draft",
      subtotal: 5400000,
      totalAmount: 5400000,
      dateIssuedOffset: -285,
      lines: [{ item: "SAT-1000", quantity: 3, unitPrice: 1800000 }]
    }
  },
  {
    log: "opportunity 2 — quote sent (NovaSat)",
    ref: "opp:novasat",
    customer: "NovaSat Networks",
    quote: {
      ref: "quote:novasat",
      status: "Sent",
      expirationOffset: NOVASAT_QUOTE_EXPIRATION_OFFSET,
      lines: [
        {
          ref: "quoteline:novasat:sat",
          item: "SAT-1000",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: SAT_PRICE_BREAKS
        },
        {
          ref: "quoteline:novasat:eps",
          item: "EPS-001",
          status: "Complete",
          sortOrder: 2,
          priceBreaks: EPS_PRICE_BREAKS
        }
      ],
      externalLink: {
        ref: "quotelink:novasat",
        expiresOffset: NOVASAT_QUOTE_EXPIRATION_OFFSET
      }
    }
  },
  {
    log: "opportunity 3 — RFQ only (Apex)",
    ref: "opp:apex",
    customer: "Apex Space Research",
    rfq: {
      ref: "rfq:apex",
      status: "Ready for Quote",
      rfqDateOffset: -285,
      externalNotes:
        "University research program — 1 structural frame for test campaign.",
      lines: [
        {
          item: "BUS-STR-001",
          customerPartId: "APX-STR-001",
          quantity: [1],
          order: 1
        }
      ]
    }
  },
  {
    log: "opportunity 4 — confirmed SO (PolarView)",
    ref: "opp:polar",
    customer: "PolarView Earth",
    quote: {
      ref: "quote:polar",
      status: "Ordered",
      lines: [
        {
          ref: "quoteline:polar:sat",
          item: "SAT-1000",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 1, unitPrice: 1800000, leadTime: 240 }]
        }
      ]
    },
    order: {
      ref: "so:polar",
      status: "Confirmed",
      orderDateOffset: -255,
      lines: [
        {
          ref: "soline:polar:sat",
          item: "SAT-1000",
          saleQuantity: 1,
          unitPrice: 1800000,
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
    customer: "NovaSat Networks",
    item: "BUS-STR-001",
    status: "Confirmed",
    lineStatus: "Ordered",
    orderDateOffset: -220,
    unitPrice: 240000
  },
  {
    key: "draft",
    customer: "Apex Space Research",
    item: "EPS-001",
    status: "Draft",
    lineStatus: "Ordered",
    orderDateOffset: -213,
    unitPrice: 95000
  },
  {
    key: "paused",
    customer: "ORBSEC Defense",
    item: "ADCS-001",
    status: "In Progress",
    lineStatus: "In Progress",
    orderDateOffset: -268,
    unitPrice: 130000
  },
  {
    key: "completed",
    customer: "PolarView Earth",
    item: "COMMS-001",
    status: "Completed",
    lineStatus: "Completed",
    orderDateOffset: -437,
    unitPrice: 110000
  },
  {
    key: "closed",
    customer: "NovaSat Networks",
    item: "PROP-001",
    status: "Closed",
    lineStatus: "Completed",
    orderDateOffset: -456,
    unitPrice: 175000
  },
  {
    key: "cancelled",
    customer: "Apex Space Research",
    item: "HARNESS-001",
    status: "Cancelled",
    lineStatus: "Ordered",
    orderDateOffset: -339,
    unitPrice: 42000
  }
];

// Released order — "To Ship and Invoice". The status is written by the app
// (releaseSalesOrder), not derived by a trigger, but it must still agree with
// what getSalesOrderStatus would compute: nothing sent and nothing invoiced.
export const RELEASED_ORDERS: SalesOpportunitySpec[] = [
  {
    log: "sales order — To Ship and Invoice (NovaSat, staggered deliveries)",
    ref: "opp:toshipinvoice",
    customer: "NovaSat Networks",
    order: {
      ref: "so:toshipinvoice",
      status: "To Ship and Invoice",
      orderDateOffset: -10,
      lines: STAGGERED_DELIVERIES.map((delivery) => ({
        ref: `soline:toshipinvoice:${delivery.key}`,
        // The tier appends the resolved promised date — it only exists at apply time.
        log: `  delivery ${delivery.key}`,
        item: "SAW-001",
        saleQuantity: 30,
        unitPrice: 35000,
        status: "Ordered",
        promisedDateOffset: delivery.promisedDateOffset,
        sortOrder: delivery.sortOrder
      }))
    }
  }
];

export const satelliteSales: SalesData = {
  opportunities: OPPORTUNITIES,
  statusOrders: STATUS_ORDERS,
  releasedOrders: RELEASED_ORDERS
};
