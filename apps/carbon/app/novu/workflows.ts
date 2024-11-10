import { NotificationEvent, NotificationType } from "@carbon/notifications";
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

export const salesRfqAssignmentWorkflow = workflow(
  NotificationEvent.SalesRfqAssignment,
  async ({ payload, step }) => {
    await step.inApp(NotificationType.SalesRfqAssignmentInApp, () => ({
      body: "New Sales RFQ Assignment",
      payload,
    }));
  },
  {
    payloadSchema,
  }
);

export const quoteAssignmentWorkflow = workflow(
  NotificationEvent.QuoteAssignment,
  async ({ payload, step }) => {
    await step.inApp(NotificationType.QuoteAssignmentInApp, () => ({
      body: "New Quote Assignment",
      payload,
    }));
  },
  {
    payloadSchema,
  }
);

export const salesOrderAssignmentWorkflow = workflow(
  NotificationEvent.SalesOrderAssignment,
  async ({ payload, step }) => {
    await step.inApp(NotificationType.SalesOrderAssignmentInApp, () => ({
      body: "New Sales Order Assignment",
      payload,
    }));
  },
  {
    payloadSchema,
  }
);

export const jobAssignmentWorkflow = workflow(
  NotificationEvent.JobAssignment,
  async ({ payload, step }) => {
    await step.inApp(NotificationType.JobAssignmentInApp, () => ({
      body: "New Job Assignment",
      payload,
    }));
  },
  {
    payloadSchema,
  }
);

export const digitalQuoteResponseWorkflow = workflow(
  NotificationEvent.DigitalQuoteResponse,
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
