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

/**
 * The permission each posting checks a caller's client against. Pinned by
 * `apps/erp/test/posting-permissions.test.ts`.
 */
export const postingPermissions = {
  "post-sales-invoice": invoicing.postSalesInvoicePermission,
  "post-purchase-invoice": invoicing.postPurchaseInvoicePermission,
  "post-receipt": inventory.postReceiptPermission,
  "post-shipment": inventory.postShipmentPermission,
  "post-payment": invoicing.postPaymentPermission,
  "post-charge": accounting.postChargePermission,
  "update-purchased-prices": purchasing.updatePurchasedPricesPermission,
  "kanban-replenish": inventory.replenishKanbanPermission,
  "create-rental-invoices": sales.createRentalInvoicesPermission,
  "create-contract-invoices": sales.createContractInvoicesPermission,
  "create-lease-invoices": purchasing.createLeaseInvoicesPermission,
  "propose-revenue-recognition-run":
    accounting.proposeRevenueRecognitionRunPermission
};

export const postings: Postings = {
  "post-sales-invoice": (handles, input) =>
    invokePosting(
      handles,
      "post-sales-invoice",
      input,
      invoicing.postSalesInvoice,
      {
        as: postingPermissions["post-sales-invoice"]
      }
    ),
  "post-purchase-invoice": (handles, input) =>
    invokePosting(
      handles,
      "post-purchase-invoice",
      input,
      invoicing.postPurchaseInvoice,
      {
        as: postingPermissions["post-purchase-invoice"]
      }
    ),
  "post-receipt": (handles, input) =>
    invokePosting(handles, "post-receipt", input, inventory.postReceipt, {
      as: postingPermissions["post-receipt"]
    }),
  "post-shipment": (handles, input) =>
    invokePosting(handles, "post-shipment", input, inventory.postShipment, {
      as: postingPermissions["post-shipment"]
    }),
  "post-payment": (handles, input) =>
    invokePosting(handles, "post-payment", input, invoicing.postPayment, {
      as: postingPermissions["post-payment"]
    }),
  "post-charge": (handles, input) =>
    invokePosting(handles, "post-charge", input, accounting.postCharge, {
      as: postingPermissions["post-charge"]
    }),
  "update-purchased-prices": (handles, input) =>
    invokePosting(
      handles,
      "update-purchased-prices",
      input,
      purchasing.updatePurchasedPrices,
      {
        as: postingPermissions["update-purchased-prices"]
      }
    ),
  "kanban-replenish": (handles, input) =>
    invokePosting(
      handles,
      "kanban-replenish",
      input,
      inventory.replenishKanban,
      {
        as: postingPermissions["kanban-replenish"]
      }
    ),
  "create-rental-invoices": (handles, input) =>
    invokePosting(
      handles,
      "create-rental-invoices",
      input,
      sales.createRentalInvoices,
      {
        as: postingPermissions["create-rental-invoices"]
      }
    ),
  "create-contract-invoices": (handles, input) =>
    invokePosting(
      handles,
      "create-contract-invoices",
      input,
      sales.createContractInvoices,
      {
        as: postingPermissions["create-contract-invoices"]
      }
    ),
  "create-lease-invoices": (handles, input) =>
    invokePosting(
      handles,
      "create-lease-invoices",
      input,
      purchasing.createLeaseInvoices,
      {
        as: postingPermissions["create-lease-invoices"]
      }
    ),
  "propose-revenue-recognition-run": (handles, input) =>
    invokePosting(
      handles,
      "propose-revenue-recognition-run",
      input,
      accounting.proposeRevenueRecognitionRun,
      {
        as: postingPermissions["propose-revenue-recognition-run"]
      }
    )
};
