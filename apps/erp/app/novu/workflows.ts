import {
  NotificationEvent,
  NotificationType,
  NotificationWorkflow
} from "@carbon/notifications";
import { workflow } from "@novu/framework";
import { z } from "zod/v3";

const payloadSchema = z.object({
  recordId: z.string(),
  description: z.string(),
  event: z.enum([
    NotificationEvent.DigitalQuoteResponse,
    NotificationEvent.GaugeCalibrationExpired,
    NotificationEvent.JobAssignment,
    NotificationEvent.JobCompleted,
    NotificationEvent.JobOperationAssignment,
    NotificationEvent.JobOperationMessage,
    NotificationEvent.MaintenanceDispatchCreated,
    NotificationEvent.MaintenanceDispatchAssignment,
    NotificationEvent.NonConformanceAssignment,
    NotificationEvent.ProcedureAssignment,
    NotificationEvent.PurchaseInvoiceAssignment,
    NotificationEvent.PurchaseOrderAssignment,
    NotificationEvent.QuoteAssignment,
    NotificationEvent.QuoteExpired,
    NotificationEvent.RiskAssignment,
    NotificationEvent.SalesOrderAssignment,
    NotificationEvent.SalesRfqAssignment,
    NotificationEvent.SalesRfqReady,
    NotificationEvent.StockTransferAssignment,
    NotificationEvent.SuggestionResponse,
    NotificationEvent.SupplierQuoteAssignment,
    NotificationEvent.SupplierQuoteResponse,
    NotificationEvent.TrainingAssignment
  ]),
  from: z.string().optional()
});

export const assignmentWorkflow = workflow(
  NotificationWorkflow.Assignment,
  async ({ payload, step }) => {
    await step.inApp(NotificationType.AssignmentInApp, () => ({
      body: "New Assignment",
      payload
    }));
  },
  {
    payloadSchema
  }
);

export const digitalQuoteResponseWorkflow = workflow(
  NotificationWorkflow.DigitalQuoteResponse,
  async ({ payload, step }) => {
    await step.inApp(NotificationType.DigitalQuoteResponseInApp, () => ({
      body: "New Digital Quote Response",
      payload
    }));
  },
  {
    payloadSchema
  }
);

export const expirationWorkflow = workflow(
  NotificationWorkflow.Expiration,
  async ({ payload, step }) => {
    await step.inApp(NotificationType.ExpirationInApp, () => ({
      body: "Expired",
      payload
    }));
  },
  { payloadSchema }
);

export const gaugeCalibrationExpiredWorkflow = workflow(
  NotificationWorkflow.GaugeCalibration,
  async ({ payload, step }) => {
    await step.inApp(NotificationType.ExpirationInApp, () => ({
      body: "Gauge Calibration Expired",
      payload
    }));
  },
  { payloadSchema }
);

export const jobCompletedWorkflow = workflow(
  NotificationWorkflow.JobCompleted,
  async ({ payload, step }) => {
    await step.inApp(NotificationType.JobCompletedInApp, () => ({
      body: "Job Completed",
      payload
    }));
  },
  { payloadSchema }
);

export const messageWorkflow = workflow(
  NotificationWorkflow.Message,
  async ({ payload, step }) => {
    await step.inApp(NotificationType.MessageInApp, () => ({
      body: "New Message",
      payload
    }));
  },
  { payloadSchema }
);

export const suggestionResponseWorkflow = workflow(
  NotificationWorkflow.SuggestionResponse,
  async ({ payload, step }) => {
    await step.inApp(NotificationType.SuggestionResponseInApp, () => ({
      body: "New Suggestion",
      payload
    }));
  },
  { payloadSchema }
);

export const supplierQuoteResponseWorkflow = workflow(
  NotificationWorkflow.SupplierQuoteResponse,
  async ({ payload, step }) => {
    await step.inApp(NotificationType.SupplierQuoteResponseInApp, () => ({
      body: "Supplier Quote Response",
      payload
    }));
  },
  { payloadSchema }
);
