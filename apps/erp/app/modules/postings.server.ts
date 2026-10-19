// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The postings `@carbon/jobs`, `@carbon/ee` and MES call, which cannot import
// the ERP (`@carbon/api/postings.server`; MES through
// `api+/internal.postings.$name.ts`). Registered by `carbon.server.ts`. A
// posting with a client checks the caller behind it against the posting's
// permission first, on the input as its schema parses it; without a client it
// runs as the system.

import {
  batchOperationsInput,
  createInput,
  issueInput,
  postInventoryAdjustmentInput,
  postMaintenanceEventInput,
  postPickingInput,
  postProductionEventInput,
  recalculateInput,
  triggerReworkInput
} from "@carbon/api/postings";
import type { Postings } from "@carbon/api/postings.server";
import * as accounting from "./accounting/accounting.service";
import * as inventory from "./inventory/inventory.service";
import * as invoicing from "./invoicing/invoicing.service";
import * as production from "./production/production.service";
import * as purchasing from "./purchasing/purchasing.service";
import * as resources from "./resources/resources.service";
import * as sales from "./sales/sales.service";
import * as shared from "./shared/shared.service";
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
    accounting.proposeRevenueRecognitionRunPermission,
  issue: inventory.issueMaterialPermission,
  "post-picking": inventory.postPickingPermission,
  "post-production-event": production.postProductionEventPermission,
  "post-maintenance-event": resources.postMaintenanceEventPermission,
  "post-inventory-adjustment": inventory.postInventoryAdjustmentPermission,
  create: shared.createDocumentPermission,
  "batch-operations": production.batchOperationPermission,
  recalculate: production.recalculateRequirementsPermission,
  "trigger-rework": production.triggerReworkPermission
};

export const postings: Postings = {
  "post-sales-invoice": (handles, input) =>
    invokePosting(
      handles,
      "post-sales-invoice",
      input,
      invoicing.postSalesInvoice,
      {
        as: postingPermissions["post-sales-invoice"],
        schema: invoicing.postSalesInvoiceInput
      }
    ),
  "post-purchase-invoice": (handles, input) =>
    invokePosting(
      handles,
      "post-purchase-invoice",
      input,
      invoicing.postPurchaseInvoice,
      {
        as: postingPermissions["post-purchase-invoice"],
        schema: invoicing.postPurchaseInvoiceInput
      }
    ),
  "post-receipt": (handles, input) =>
    invokePosting(handles, "post-receipt", input, inventory.postReceipt, {
      as: postingPermissions["post-receipt"],
      schema: inventory.postReceiptInput
    }),
  "post-shipment": (handles, input) =>
    invokePosting(handles, "post-shipment", input, inventory.postShipment, {
      as: postingPermissions["post-shipment"],
      schema: inventory.postShipmentInput
    }),
  "post-payment": (handles, input) =>
    invokePosting(handles, "post-payment", input, invoicing.postPayment, {
      as: postingPermissions["post-payment"],
      schema: invoicing.postPaymentInput
    }),
  "post-charge": (handles, input) =>
    invokePosting(handles, "post-charge", input, accounting.postCharge, {
      as: postingPermissions["post-charge"],
      schema: accounting.postChargeInput
    }),
  "update-purchased-prices": (handles, input) =>
    invokePosting(
      handles,
      "update-purchased-prices",
      input,
      purchasing.updatePurchasedPrices,
      {
        as: postingPermissions["update-purchased-prices"],
        schema: purchasing.updatePurchasedPricesInput
      }
    ),
  "kanban-replenish": (handles, input) =>
    invokePosting(
      handles,
      "kanban-replenish",
      input,
      inventory.replenishKanban,
      {
        as: postingPermissions["kanban-replenish"],
        schema: inventory.kanbanReplenishInput
      }
    ),
  "create-rental-invoices": (handles, input) =>
    invokePosting(
      handles,
      "create-rental-invoices",
      input,
      sales.createRentalInvoices,
      {
        as: postingPermissions["create-rental-invoices"],
        schema: sales.createRentalInvoicesInput
      }
    ),
  "create-contract-invoices": (handles, input) =>
    invokePosting(
      handles,
      "create-contract-invoices",
      input,
      sales.createContractInvoices,
      {
        as: postingPermissions["create-contract-invoices"],
        schema: sales.createContractInvoicesInput
      }
    ),
  "create-lease-invoices": (handles, input) =>
    invokePosting(
      handles,
      "create-lease-invoices",
      input,
      purchasing.createLeaseInvoices,
      {
        as: postingPermissions["create-lease-invoices"],
        schema: purchasing.createLeaseInvoicesInput
      }
    ),
  "propose-revenue-recognition-run": (handles, input) =>
    invokePosting(
      handles,
      "propose-revenue-recognition-run",
      input,
      accounting.proposeRevenueRecognitionRun,
      {
        as: postingPermissions["propose-revenue-recognition-run"],
        schema: accounting.proposeRevenueRecognitionRunInput
      }
    ),
  issue: (handles, input) =>
    invokePosting(handles, "issue", input, inventory.issueMaterial, {
      as: postingPermissions.issue,
      schema: issueInput
    }),
  "post-picking": (handles, input) =>
    invokePosting(handles, "post-picking", input, inventory.postPicking, {
      as: postingPermissions["post-picking"],
      schema: postPickingInput
    }),
  "post-production-event": (handles, input) =>
    invokePosting(
      handles,
      "post-production-event",
      input,
      production.postProductionEvent,
      {
        as: postingPermissions["post-production-event"],
        schema: postProductionEventInput
      }
    ),
  "post-maintenance-event": (handles, input) =>
    invokePosting(
      handles,
      "post-maintenance-event",
      input,
      resources.postMaintenanceEvent,
      {
        as: postingPermissions["post-maintenance-event"],
        schema: postMaintenanceEventInput
      }
    ),
  "post-inventory-adjustment": (handles, input) =>
    invokePosting(
      handles,
      "post-inventory-adjustment",
      input,
      inventory.postInventoryAdjustment,
      {
        as: postingPermissions["post-inventory-adjustment"],
        schema: postInventoryAdjustmentInput
      }
    ),
  create: (handles, input) =>
    invokePosting(handles, "create", input, shared.createDocument, {
      as: postingPermissions.create,
      schema: createInput
    }),
  "batch-operations": (handles, input) =>
    invokePosting(
      handles,
      "batch-operations",
      input,
      production.batchOperation,
      {
        as: postingPermissions["batch-operations"],
        schema: batchOperationsInput
      }
    ),
  recalculate: (handles, input) =>
    invokePosting(
      handles,
      "recalculate",
      input,
      production.recalculateRequirements,
      { as: postingPermissions.recalculate, schema: recalculateInput }
    ),
  "trigger-rework": (handles, input) =>
    invokePosting(handles, "trigger-rework", input, production.triggerRework, {
      as: postingPermissions["trigger-rework"],
      schema: triggerReworkInput
    })
};
