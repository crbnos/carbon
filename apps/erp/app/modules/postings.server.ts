// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The postings `@carbon/jobs` and `@carbon/ee` call, which cannot import the
// ERP (`@carbon/api/postings.server`). Registered by `carbon.server.ts`. A
// posting with a client checks the caller behind it against the posting's
// permission first, as `serverFns.as` did; without one it runs as the system.

import type { Postings } from "@carbon/api/postings.server";
import * as accounting from "./accounting/accounting.service";
import * as inventory from "./inventory/inventory.service";
import * as invoicing from "./invoicing/invoicing.service";
import * as purchasing from "./purchasing/purchasing.service";
import * as sales from "./sales/sales.service";
import { invokePosting } from "./shared/shared.service";

export const postings: Postings = {
  "post-sales-invoice": (handles, input) =>
    invokePosting(
      handles,
      "post-sales-invoice",
      input,
      invoicing.postSalesInvoice,
      {
        as: invoicing.postSalesInvoicePermission
      }
    ),
  "post-purchase-invoice": (handles, input) =>
    invokePosting(
      handles,
      "post-purchase-invoice",
      input,
      invoicing.postPurchaseInvoice,
      {
        as: invoicing.postPurchaseInvoicePermission
      }
    ),
  "post-receipt": (handles, input) =>
    invokePosting(handles, "post-receipt", input, inventory.postReceipt, {
      as: inventory.postReceiptPermission
    }),
  "post-shipment": (handles, input) =>
    invokePosting(handles, "post-shipment", input, inventory.postShipment, {
      as: inventory.postShipmentPermission
    }),
  "post-payment": (handles, input) =>
    invokePosting(handles, "post-payment", input, invoicing.postPayment, {
      as: invoicing.postPaymentPermission
    }),
  "post-charge": (handles, input) =>
    invokePosting(handles, "post-charge", input, accounting.postCharge, {
      as: accounting.postChargePermission
    }),
  "update-purchased-prices": (handles, input) =>
    invokePosting(
      handles,
      "update-purchased-prices",
      input,
      purchasing.updatePurchasedPrices,
      {
        as: purchasing.updatePurchasedPricesPermission
      }
    ),
  "kanban-replenish": (handles, input) =>
    invokePosting(
      handles,
      "kanban-replenish",
      input,
      inventory.replenishKanban,
      {
        as: inventory.replenishKanbanPermission
      }
    ),
  "create-rental-invoices": (handles, input) =>
    invokePosting(
      handles,
      "create-rental-invoices",
      input,
      sales.createRentalInvoices,
      {
        as: sales.createRentalInvoicesPermission
      }
    ),
  "create-contract-invoices": (handles, input) =>
    invokePosting(
      handles,
      "create-contract-invoices",
      input,
      sales.createContractInvoices,
      {
        as: sales.createContractInvoicesPermission
      }
    ),
  "create-lease-invoices": (handles, input) =>
    invokePosting(
      handles,
      "create-lease-invoices",
      input,
      purchasing.createLeaseInvoices,
      {
        as: purchasing.createLeaseInvoicesPermission
      }
    ),
  "propose-revenue-recognition-run": (handles, input) =>
    invokePosting(
      handles,
      "propose-revenue-recognition-run",
      input,
      accounting.proposeRevenueRecognitionRun,
      {
        as: accounting.proposeRevenueRecognitionRunPermission
      }
    )
};
