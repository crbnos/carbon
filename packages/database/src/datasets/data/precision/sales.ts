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

export const HMA_PRICE_BREAKS: readonly PriceBreak[] = [
  { quantity: 1, unitPrice: 4200, leadTime: 45 },
  { quantity: 10, unitPrice: 3980, leadTime: 55, discountPercent: 0.05 },
  { quantity: 25, unitPrice: 3760, leadTime: 65, discountPercent: 0.1 },
  { quantity: 50, unitPrice: 3540, leadTime: 80, discountPercent: 0.16 }
];

export const HSG_PRICE_BREAKS: readonly PriceBreak[] = [
  { quantity: 5, unitPrice: 1150, leadTime: 30 },
  {
    quantity: 25,
    unitPrice: 1050,
    leadTime: 40,
    discountPercent: 0.09,
    shippingCost: 320
  }
];

// The Sent quote is the one the docs screenshot at /share/quote/:externalLinkId.
// The expiration offset must stay positive or the public page renders its
// Expired state instead of the quote.
export const GRANITE_QUOTE_EXPIRATION_OFFSET = 288;

// Three deliveries of the same make part, three weeks apart. Gives the docs a
// real delivery schedule, and three Make to Order lines with no job attached is
// what puts the "Jobs Required" / Create Jobs card on the order.
export const STAGGERED_DELIVERIES: StaggeredDeliverySpec[] = [
  { key: "1", promisedDateOffset: 18, sortOrder: 1 },
  { key: "2", promisedDateOffset: 39, sortOrder: 2 },
  { key: "3", promisedDateOffset: 60, sortOrder: 3 }
];

export const OPPORTUNITIES: SalesOpportunitySpec[] = [
  {
    log: "opportunity 1 — full chain (Cedar Valley)",
    ref: "opp:cedarvalley",
    customer: "Cedar Valley Hydraulics",
    rfq: {
      ref: "rfq:cedarvalley",
      status: "Quoted",
      rfqDateOffset: -210,
      expirationOffset: -180,
      externalNotes:
        "Power unit manifold assemblies to customer print HPU-4000 rev C.",
      lines: [
        {
          item: "HMA-4000",
          customerPartId: "CVH-HPU-4000",
          quantity: [6],
          order: 1
        }
      ]
    },
    quote: {
      ref: "quote:cedarvalley",
      status: "Ordered",
      externalNotes:
        "Quote for 6 hydraulic power unit manifold assemblies, prints supplied by the customer.",
      lines: [
        {
          ref: "quoteline:cedarvalley:hma",
          item: "HMA-4000",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 6, unitPrice: 3980, leadTime: 50 }]
        }
      ]
    },
    order: {
      ref: "so:cedarvalley",
      status: "In Progress",
      orderDateOffset: -168,
      lines: [
        {
          ref: "soline:cedarvalley:hma",
          item: "HMA-4000",
          saleQuantity: 6,
          unitPrice: 3980,
          status: "In Progress"
        }
      ]
    },
    shipment: {
      ref: "shp:cedarvalley",
      status: "Draft",
      lines: [
        {
          item: "HMA-4000",
          orderQuantity: 6,
          outstandingQuantity: 6,
          shippedQuantity: 0,
          unitPrice: 3980
        }
      ]
    },
    invoice: {
      ref: "inv:cedarvalley",
      status: "Draft",
      subtotal: 23880,
      totalAmount: 23880,
      dateIssuedOffset: -150,
      lines: [{ item: "HMA-4000", quantity: 6, unitPrice: 3980 }]
    }
  },
  {
    log: "opportunity 2 — quote sent (Granite State)",
    ref: "opp:granite",
    customer: "Granite State Instruments",
    quote: {
      ref: "quote:granite",
      status: "Sent",
      expirationOffset: GRANITE_QUOTE_EXPIRATION_OFFSET,
      lines: [
        {
          ref: "quoteline:granite:hma",
          item: "HMA-4000",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: HMA_PRICE_BREAKS
        },
        {
          ref: "quoteline:granite:hsg",
          item: "MCH-HSG-PUMP",
          status: "Complete",
          sortOrder: 2,
          priceBreaks: HSG_PRICE_BREAKS
        }
      ],
      externalLink: {
        ref: "quotelink:granite",
        expiresOffset: GRANITE_QUOTE_EXPIRATION_OFFSET
      }
    }
  },
  {
    log: "opportunity 3 — RFQ only (Solstice)",
    ref: "opp:solstice",
    customer: "Solstice Medical Devices",
    rfq: {
      ref: "rfq:solstice",
      status: "Ready for Quote",
      rfqDateOffset: -42,
      externalNotes:
        "New program — 304 stainless mounting flanges, passivation and CoC required.",
      lines: [
        {
          item: "MCH-FLANGE-SS",
          customerPartId: "SMD-FLG-0221",
          quantity: [250],
          order: 1
        }
      ]
    }
  },
  {
    log: "opportunity 4 — confirmed SO (Dominion Ag)",
    ref: "opp:dominion",
    customer: "Dominion Ag Equipment",
    quote: {
      ref: "quote:dominion",
      status: "Ordered",
      lines: [
        {
          ref: "quoteline:dominion:hma",
          item: "HMA-4000",
          status: "Complete",
          sortOrder: 1,
          priceBreaks: [{ quantity: 2, unitPrice: 4100, leadTime: 45 }]
        }
      ]
    },
    order: {
      ref: "so:dominion",
      status: "Confirmed",
      orderDateOffset: -96,
      lines: [
        {
          ref: "soline:dominion:hma",
          item: "HMA-4000",
          saleQuantity: 2,
          unitPrice: 4100,
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
    customer: "Granite State Instruments",
    item: "MCH-HSG-PUMP",
    status: "Confirmed",
    lineStatus: "Ordered",
    orderDateOffset: -84,
    unitPrice: 1150
  },
  {
    key: "draft",
    customer: "Solstice Medical Devices",
    item: "MCH-END-CAP",
    status: "Draft",
    lineStatus: "Ordered",
    orderDateOffset: -77,
    unitPrice: 240
  },
  {
    key: "paused",
    customer: "Cedar Valley Hydraulics",
    item: "FAB-BASE-WLD",
    status: "In Progress",
    lineStatus: "In Progress",
    orderDateOffset: -133,
    unitPrice: 1480
  },
  {
    key: "completed",
    customer: "Dominion Ag Equipment",
    item: "ASM-VALVE-SUB",
    status: "Completed",
    lineStatus: "Completed",
    orderDateOffset: -252,
    unitPrice: 890
  },
  {
    key: "closed",
    customer: "Granite State Instruments",
    item: "MCH-SHAFT-DR",
    status: "Closed",
    lineStatus: "Completed",
    orderDateOffset: -280,
    unitPrice: 320
  },
  {
    key: "cancelled",
    customer: "Solstice Medical Devices",
    item: "FAB-ENCL-PNL",
    status: "Cancelled",
    lineStatus: "Ordered",
    orderDateOffset: -175,
    unitPrice: 640
  }
];

// Released order — "To Ship and Invoice". The status is written by the app
// (releaseSalesOrder), not derived by a trigger, but it must still agree with
// what getSalesOrderStatus would compute: nothing sent and nothing invoiced.
export const RELEASED_ORDERS: SalesOpportunitySpec[] = [
  {
    log: "sales order — To Ship and Invoice (Cedar Valley, staggered deliveries)",
    ref: "opp:toshipinvoice",
    customer: "Cedar Valley Hydraulics",
    order: {
      ref: "so:toshipinvoice",
      status: "To Ship and Invoice",
      orderDateOffset: -8,
      lines: STAGGERED_DELIVERIES.map((delivery) => ({
        ref: `soline:toshipinvoice:${delivery.key}`,
        // The tier appends the resolved promised date — it only exists at apply time.
        log: `  delivery ${delivery.key}`,
        item: "MCH-SPACER-KIT",
        saleQuantity: 60,
        unitPrice: 105,
        status: "Ordered",
        promisedDateOffset: delivery.promisedDateOffset,
        sortOrder: delivery.sortOrder
      }))
    }
  }
];

export const precisionSales: SalesData = {
  opportunities: OPPORTUNITIES,
  statusOrders: STATUS_ORDERS,
  releasedOrders: RELEASED_ORDERS
};
