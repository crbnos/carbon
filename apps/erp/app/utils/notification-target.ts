// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import {
  NotificationEvent,
  type RecurringInvoicingDocumentType
} from "@carbon/notifications";
import { getRecordPath } from "./entity";
import { path } from "./path";

type ApprovalDocumentType = Database["public"]["Enums"]["approvalDocumentType"];

/** The approvable document of an Approval* event, the record type of a
 *  Workflow notification, or what a Recurring invoicing notification lists. */
export type NotificationDocumentType =
  | ApprovalDocumentType
  | RecurringInvoicingDocumentType
  | (string & {});

export type NotificationTarget = {
  /** Where the notification leads. */
  path: string;
  /** A file download: a resource route that needs a full page request. */
  download: boolean;
};

const page = (to: string): NotificationTarget => ({
  path: to,
  download: false
});

/**
 * Where a notification leads, for the topbar row and for the email link
 * (`api+/link.ts`), so the two never disagree. Null when the notification
 * names no page (the caller lands on the home page).
 */
export function notificationTarget(
  event: NotificationEvent,
  documentId: string,
  documentType?: NotificationDocumentType | null
): NotificationTarget | null {
  switch (event) {
    case NotificationEvent.ApprovalApproved:
    case NotificationEvent.ApprovalRejected:
    case NotificationEvent.ApprovalRequested:
      // Approvals started with purchase orders, so a notification without a
      // document type is one.
      return page(
        documentType === "qualityDocument"
          ? path.to.qualityDocument(documentId)
          : documentType === "supplier"
            ? path.to.supplier(documentId)
            : documentType === "changeOrder"
              ? path.to.changeNoticeDetails(documentId)
              : path.to.purchaseOrderDetails(documentId)
      );
    case NotificationEvent.ChangeNoticeStarted:
    case NotificationEvent.ChangeNoticeImplementation:
    case NotificationEvent.ChangeNoticeDone:
      return page(path.to.changeNoticeDetails(documentId));
    case NotificationEvent.DigitalQuoteResponse:
    case NotificationEvent.QuoteAssignment:
    case NotificationEvent.QuoteExpired:
      return page(path.to.quoteDetails(documentId));
    case NotificationEvent.GaugeCalibrationExpired:
      return page(path.to.gauge(documentId));
    case NotificationEvent.SalesRuleViolation: {
      // Compound documentId: "<quote|salesOrder|salesInvoice>:<documentId>:<outcome>"
      const [docType, docId] = documentId.split(":");
      if (!docId) return null;
      return page(
        docType === "salesInvoice"
          ? path.to.salesInvoiceDetails(docId)
          : docType === "salesOrder"
            ? path.to.salesOrderDetails(docId)
            : path.to.quoteDetails(docId)
      );
    }
    case NotificationEvent.IntegrationSync:
      // documentId is the provider id ("rillet", "xero", …): its settings
      // page, where the Sync Activity tab lives.
      return page(path.to.integration(documentId));
    case NotificationEvent.TableExport:
      // documentId is the export id; `failed:{exportId}` has no file. The
      // export route serves the file to the user who asked for it only.
      return documentId.startsWith("failed:")
        ? null
        : {
            path: `${path.to.api.tableExport}/${encodeURIComponent(documentId)}`,
            download: true
          };
    case NotificationEvent.TableBulkAction:
      // documentId is the run id, not a record; the title has the counts.
      return null;
    case NotificationEvent.RecurringInvoicing:
      // documentId is only the digest's first invoice: land on the list it is
      // about, the lease drafts waiting for the buyer, else the sales invoices
      // that need review.
      return page(
        documentType === "purchaseInvoice"
          ? `${path.to.invoicingPurchasing}?filter=status:eq:Draft`
          : `${path.to.invoicingSales}?filter=needsReview:eq:true`
      );
    case NotificationEvent.LeaseCriticalDate:
      return page(path.to.leaseDetails(documentId));
    case NotificationEvent.JobAssignment:
    case NotificationEvent.JobCompleted:
    case NotificationEvent.JobsProjectedLate:
      return page(path.to.jobDetails(documentId));
    case NotificationEvent.JobOperationAssignment:
    case NotificationEvent.JobOperationMessage: {
      const [jobId, operationId, makeMethodId, materialId] =
        documentId.split(":");
      if (!jobId || !operationId || !makeMethodId) return null;
      const link = materialId
        ? path.to.jobMakeMethod(jobId, makeMethodId)
        : path.to.jobMethod(jobId, makeMethodId);
      return page(`${link}?selectedOperation=${operationId}`);
    }
    case NotificationEvent.MaintenanceDispatchAssignment:
    case NotificationEvent.MaintenanceDispatchCreated:
      return page(path.to.maintenanceDispatch(documentId));
    case NotificationEvent.NonConformanceAssignment:
      return page(path.to.issue(documentId));
    case NotificationEvent.ProcedureAssignment:
      return page(path.to.procedure(documentId));
    case NotificationEvent.PurchaseInvoiceAssignment:
      return page(path.to.purchaseInvoiceDetails(documentId));
    case NotificationEvent.PurchaseOrderAssignment:
      return page(path.to.purchaseOrderDetails(documentId));
    case NotificationEvent.PurchasingRfqAssignment:
      return page(path.to.purchasingRfq(documentId));
    case NotificationEvent.RiskAssignment:
      return page(path.to.risk(documentId));
    case NotificationEvent.SalesRfqAssignment:
    case NotificationEvent.SalesRfqReady:
      return page(path.to.salesRfq(documentId));
    case NotificationEvent.SalesOrderAssignment:
      return page(path.to.salesOrderDetails(documentId));
    case NotificationEvent.StockTransferAssignment:
      return page(path.to.stockTransfer(documentId));
    case NotificationEvent.PickingListAssignment:
      return page(path.to.pickingList(documentId));
    case NotificationEvent.SuggestionResponse:
      return page(path.to.suggestion(documentId));
    case NotificationEvent.SupplierQuoteAssignment:
    case NotificationEvent.SupplierQuoteResponse:
      return page(path.to.supplierQuoteDetails(documentId));
    case NotificationEvent.TrainingAssignment:
    case NotificationEvent.TrainingReminder:
      // documentId is a trainingAssignment id; the recipient is the trainee.
      return page(path.to.completeTrainingAssignment(documentId));
    case NotificationEvent.ResourceTrainingAssignment:
      // documentId is a training id: the training viewer.
      return page(path.to.training(documentId));
    case NotificationEvent.Workflow: {
      const to = getRecordPath(documentType, documentId);
      return to ? page(to) : null;
    }
    default:
      return null;
  }
}
