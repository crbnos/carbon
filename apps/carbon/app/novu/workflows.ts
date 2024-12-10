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
    NotificationEvent.PurchaseOrderAssignment,
    NotificationEvent.QuoteAssignment,
    NotificationEvent.QuoteExpired,
    NotificationEvent.SalesOrderAssignment,
    NotificationEvent.SalesRfqAssignment,
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
