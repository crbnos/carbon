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
    NotificationEvent.SalesRfqAssignment,
    NotificationEvent.QuoteAssignment,
    NotificationEvent.SalesOrderAssignment,
    NotificationEvent.JobAssignment,
    NotificationEvent.DigitalQuoteResponse,
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
