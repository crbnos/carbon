import {
  NotificationEvent,
  NotificationType,
  NotificationWorkflow,
} from "@carbon/notifications";
import { workflow } from "@novu/framework";
import { z } from "zod";

const payloadSchema = z.object({
  recordId: z.string(),
  description: z.string(),
  event: z.enum([
    NotificationEvent.DigitalQuoteResponse,
    NotificationEvent.JobAssignment,
    NotificationEvent.JobOperationAssignment,
    NotificationEvent.JobOperationMessage,
    NotificationEvent.NonConformanceAssignment,
    NotificationEvent.ProcedureAssignment,
    NotificationEvent.PurchaseInvoiceAssignment,
    NotificationEvent.PurchaseOrderAssignment,
    NotificationEvent.QuoteAssignment,
    NotificationEvent.QuoteExpired,
    NotificationEvent.SalesOrderAssignment,
    NotificationEvent.SalesRfqAssignment,
    NotificationEvent.SalesRfqReady,
    NotificationEvent.SupplierQuoteAssignment,
  ]),
  from: z.string().optional(),
});

export const assignmentWorkflow = workflow(
  NotificationWorkflow.Assignment,
  async ({ payload, step }) => {
    await step.inApp(NotificationType.AssignmentInApp, () => ({
      body: "New Assignment",
      payload,
    }));
  },
  {
    payloadSchema,
  }
);

export const digitalQuoteResponseWorkflow = workflow(
  NotificationWorkflow.DigitalQuoteResponse,
  async ({ payload, step }) => {
    await step.inApp(NotificationType.DigitalQuoteResponseInApp, () => ({
      body: "New Digital Quote Response",
      payload,
    }));
  },
  {
    payloadSchema,
  }
);

export const expirationWorkflow = workflow(
  NotificationWorkflow.Expiration,
  async ({ payload, step }) => {
    await step.inApp(NotificationType.ExpirationInApp, () => ({
      body: "Expired",
      payload,
    }));
  },
  { payloadSchema }
);

export const messageWorkflow = workflow(
  NotificationWorkflow.Message,
  async ({ payload, step }) => {
    await step.inApp(NotificationType.MessageInApp, () => ({
      body: "New Message",
      payload,
    }));
  },
  { payloadSchema }
);
