// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Page } from "../registry";

export const PURCHASING_PAGES = [
  {
    id: "purchasing.suppliers",
    label: "Suppliers",
    maxLevel: "Full",
    tables: [
      "supplier",
      "supplierAccount",
      "supplierContact",
      "supplierLocation",
      "supplierPayment",
      "supplierShipping",
      "supplierTax",
      "contact"
    ],
    where: { table: "contact", column: "isCustomer", value: "false" },
    readers: ["address", "paymentTerm", "supplierPart", "supplierProcess"],
    paths: ["/x/purchasing/suppliers", "/x/supplier/"]
  },
  {
    id: "purchasing.purchaseOrders",
    label: "Purchase Orders",
    maxLevel: "Full",
    tables: [
      "purchaseOrder",
      "purchaseOrderLine",
      "purchaseOrderDelivery",
      "purchaseOrderPayment",
      "purchaseOrderStatusHistory",
      "purchaseOrderTransaction",
      "supplierInteraction"
    ],
    readers: [
      "paymentTerm",
      "supplier",
      "supplierPart",
      "supplierPartPrice",
      "terms"
    ],
    paths: ["/x/purchasing/orders", "/x/purchase-order/"]
  },
  {
    id: "purchasing.returns",
    label: "Returns",
    maxLevel: "Full",
    tables: [
      "purchaseReturnOrder",
      "purchaseReturnOrderLine",
      "purchaseReturnOrderLineTrackedEntity"
    ],
    paths: ["/x/purchasing/supplier-returns", "/x/purchase-return-order/"]
  },
  {
    id: "purchasing.leases",
    label: "Leases",
    maxLevel: "Full",
    tables: [
      "lease",
      "leaseLine",
      "leasePayment",
      "leaseEvent",
      "leaseScheduleLine"
    ],
    paths: ["/x/purchasing/leases", "/x/lease/"]
  },
  {
    id: "purchasing.materialPlanning",
    label: "Material Planning",
    maxLevel: "Full",
    tables: [],
    readers: [
      "planningAction",
      "demandForecast",
      "demandForecastSource",
      "supplyForecast",
      "demandActual",
      "supplyActual"
    ],
    paths: ["/x/purchasing/planning"]
  },
  {
    id: "purchasing.rfqs",
    label: "RFQs",
    maxLevel: "Full",
    tables: [
      "purchasingRfq",
      "purchasingRfqLine",
      "purchasingRfqSupplier",
      "purchasingRfqToPurchaseOrder",
      "purchasingRfqToSupplierQuote"
    ],
    paths: ["/x/purchasing/rfqs", "/x/purchasing-rfq/"]
  },
  {
    id: "purchasing.supplierQuotes",
    label: "Supplier Quotes",
    maxLevel: "Full",
    tables: ["supplierQuote", "supplierQuoteLine", "supplierQuoteLinePrice"],
    paths: ["/x/purchasing/quotes", "/x/supplier-quote/"]
  },
  {
    id: "purchasing.types",
    label: "Types",
    maxLevel: "Full",
    tables: ["supplierType"],
    paths: ["/x/purchasing/supplier-types"]
  }
] as const satisfies readonly Page[];
