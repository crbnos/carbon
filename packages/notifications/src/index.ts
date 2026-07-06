// Notification event taxonomy. Kept as a standalone package because the
// enums are referenced from app routes, scheduled jobs, and the inngest
// notify function. Callers dispatch a `carbon/notify` event via
// @carbon/lib's `trigger()` and the notify function handles fan-out
// (in-app / email / slack).

export enum NotificationEvent {
  ApprovalApproved = "approval-approved",
  ApprovalRejected = "approval-rejected",
  ApprovalRequested = "approval-requested",
  DigitalQuoteResponse = "digital-quote-response",
  GaugeCalibrationExpired = "gauge-calibration-expired",
  JobAssignment = "job-assignment",
  JobCompleted = "job-completed",
  JobOperationAssignment = "job-operation-assignment",
  JobOperationMessage = "job-operation-message",
  MaintenanceDispatchAssignment = "maintenance-dispatch-assignment",
  MaintenanceDispatchCreated = "maintenance-dispatch-created",
  NonConformanceAssignment = "issue-assignment",
  PickingListAssignment = "picking-list-assignment",
  ProcedureAssignment = "procedure-assignment",
  PurchaseInvoiceAssignment = "purchase-invoice-assignment",
  PurchaseOrderAssignment = "purchase-order-assignment",
  QuoteAssignment = "quote-assignment",
  QuoteExpired = "quote-expired",
  RiskAssignment = "risk-assignment",
  SalesOrderAssignment = "sales-order-assignment",
  SalesRfqAssignment = "sales-rfq-assignment",
  SalesRfqReady = "sales-rfq-ready",
  StockTransferAssignment = "stock-transfer-assignment",
  SuggestionResponse = "suggestion-response",
  SupplierQuoteAssignment = "supplier-quote-assignment",
  SupplierQuoteResponse = "supplier-quote-response",
  TrainingAssignment = "training-assignment",
  ResourceTrainingAssignment = "resource-training-assignment",
  Digest = "digest"
}

// Coarse topic buckets. Each event maps to exactly one topic via
// getNotificationTopic. The string values are persisted in the
// `notification.topic` column, so renaming any of these is a migration.
export enum NotificationTopic {
  Approval = "approval",
  General = "general",
  Inventory = "inventory",
  Job = "job",
  Maintenance = "maintenance",
  Purchasing = "purchasing",
  Quality = "quality",
  Quote = "quote",
  Sales = "sales",
  Suggestion = "suggestion",
  Training = "training"
}

// Fan-out targets understood by the notify Inngest function. inApp is
// always included regardless of what the caller passes — the topbar reflects
// every notification. email and slack are opt-in extras.
export enum NotificationDestination {
  InApp = "inApp",
  Email = "email",
  Slack = "slack"
}

export function getNotificationTopic(
  event: NotificationEvent
): NotificationTopic {
  switch (event) {
    case NotificationEvent.JobAssignment:
    case NotificationEvent.JobOperationAssignment:
    case NotificationEvent.JobOperationMessage:
    case NotificationEvent.JobCompleted:
      return NotificationTopic.Job;
    case NotificationEvent.PurchaseInvoiceAssignment:
    case NotificationEvent.PurchaseOrderAssignment:
      return NotificationTopic.Purchasing;
    case NotificationEvent.QuoteAssignment:
    case NotificationEvent.QuoteExpired:
    case NotificationEvent.DigitalQuoteResponse:
    case NotificationEvent.SupplierQuoteAssignment:
    case NotificationEvent.SupplierQuoteResponse:
      return NotificationTopic.Quote;
    case NotificationEvent.SalesOrderAssignment:
    case NotificationEvent.SalesRfqAssignment:
    case NotificationEvent.SalesRfqReady:
      return NotificationTopic.Sales;
    case NotificationEvent.MaintenanceDispatchAssignment:
    case NotificationEvent.MaintenanceDispatchCreated:
    case NotificationEvent.GaugeCalibrationExpired:
      return NotificationTopic.Maintenance;
    case NotificationEvent.NonConformanceAssignment:
    case NotificationEvent.RiskAssignment:
      return NotificationTopic.Quality;
    case NotificationEvent.ProcedureAssignment:
    case NotificationEvent.TrainingAssignment:
    case NotificationEvent.ResourceTrainingAssignment:
      return NotificationTopic.Training;
    case NotificationEvent.PickingListAssignment:
    case NotificationEvent.StockTransferAssignment:
      return NotificationTopic.Inventory;
    case NotificationEvent.SuggestionResponse:
      return NotificationTopic.Suggestion;
    case NotificationEvent.ApprovalApproved:
    case NotificationEvent.ApprovalRejected:
    case NotificationEvent.ApprovalRequested:
      return NotificationTopic.Approval;
    default:
      return NotificationTopic.General;
  }
}

// Generic category label rendered as the in-email heading (sits under the
// "New notification" eyebrow). The inbox subject is the per-event description
// so users can scan their inbox; this gives the email body a stable category
// title regardless of the record specifics in the description.
export function getNotificationEmailHeading(event: NotificationEvent): string {
  switch (event) {
    case NotificationEvent.JobAssignment:
      return "Job assigned to you";
    case NotificationEvent.JobCompleted:
      return "Job completed";
    case NotificationEvent.JobOperationAssignment:
      return "Job operation assigned to you";
    case NotificationEvent.JobOperationMessage:
      return "New job operation message";
    case NotificationEvent.PurchaseInvoiceAssignment:
      return "Purchase invoice assigned to you";
    case NotificationEvent.PurchaseOrderAssignment:
      return "Purchase order assigned to you";
    case NotificationEvent.QuoteAssignment:
      return "Quote assigned to you";
    case NotificationEvent.QuoteExpired:
      return "Quote expired";
    case NotificationEvent.DigitalQuoteResponse:
      return "Digital quote response";
    case NotificationEvent.SupplierQuoteAssignment:
      return "Supplier quote assigned to you";
    case NotificationEvent.SupplierQuoteResponse:
      return "Supplier quote response";
    case NotificationEvent.SalesOrderAssignment:
      return "Sales order assigned to you";
    case NotificationEvent.SalesRfqAssignment:
      return "RFQ assigned to you";
    case NotificationEvent.SalesRfqReady:
      return "RFQ ready for quote";
    case NotificationEvent.MaintenanceDispatchAssignment:
      return "Maintenance dispatch assigned to you";
    case NotificationEvent.MaintenanceDispatchCreated:
      return "New maintenance dispatch";
    case NotificationEvent.GaugeCalibrationExpired:
      return "Gauge calibration expired";
    case NotificationEvent.NonConformanceAssignment:
      return "Issue assigned to you";
    case NotificationEvent.RiskAssignment:
      return "Risk assigned to you";
    case NotificationEvent.ProcedureAssignment:
      return "Procedure assigned to you";
    case NotificationEvent.TrainingAssignment:
      return "Training assigned to you";
    case NotificationEvent.ResourceTrainingAssignment:
      return "New training available";
    case NotificationEvent.PickingListAssignment:
      return "Picking list assigned to you";
    case NotificationEvent.StockTransferAssignment:
      return "Stock transfer assigned to you";
    case NotificationEvent.SuggestionResponse:
      return "New suggestion submitted";
    case NotificationEvent.ApprovalRequested:
      return "Approval requested";
    case NotificationEvent.ApprovalApproved:
      return "Your request was approved";
    case NotificationEvent.ApprovalRejected:
      return "Your request was rejected";
    default:
      return "You have a new notification";
  }
}

// Action label shown on the email's CTA button. Falls back to "View" when no
// link is available. Tone matches the heading — short, imperative.
export function getNotificationEmailCtaLabel(event: NotificationEvent): string {
  switch (event) {
    case NotificationEvent.ApprovalRequested:
      return "Review approval";
    case NotificationEvent.ApprovalApproved:
    case NotificationEvent.ApprovalRejected:
      return "View decision";
    case NotificationEvent.JobCompleted:
      return "View job";
    case NotificationEvent.SuggestionResponse:
      return "View suggestion";
    case NotificationEvent.GaugeCalibrationExpired:
      return "View gauge";
    case NotificationEvent.QuoteExpired:
      return "View quote";
    case NotificationEvent.DigitalQuoteResponse:
    case NotificationEvent.SupplierQuoteResponse:
      return "View response";
    default:
      return "View details";
  }
}

export function getNotificationTopicPhrase(
  topic: NotificationTopic,
  count: number
): string {
  const plural = count === 1 ? "notification" : "notifications";
  switch (topic) {
    case NotificationTopic.Job:
      return `${count} job ${plural}`;
    case NotificationTopic.Purchasing:
      return `${count} purchasing ${plural}`;
    case NotificationTopic.Quote:
      return `${count} quote ${plural}`;
    case NotificationTopic.Sales:
      return `${count} sales ${plural}`;
    case NotificationTopic.Maintenance:
      return `${count} maintenance ${plural}`;
    case NotificationTopic.Quality:
      return `${count} quality ${plural}`;
    case NotificationTopic.Training:
      return `${count} training ${plural}`;
    case NotificationTopic.Inventory:
      return `${count} inventory ${plural}`;
    case NotificationTopic.Suggestion:
      return `${count} suggestion ${plural}`;
    case NotificationTopic.Approval:
      return `${count} approval ${plural}`;
    case NotificationTopic.General:
    default:
      return `${count} unread ${plural}`;
  }
}
