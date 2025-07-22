import { nanoid } from "nanoid";

const API_ENDPOINT = "https://api.novu.co/v1";

export enum NotificationWorkflow {
  Assignment = "assignment",
  DigitalQuoteResponse = "digital-quote-response",
  Expiration = "expiration",
  JobCompleted = "job-completed",
  Message = "message",
}

export enum NotificationEvent {
  DigitalQuoteResponse = "digital-quote-response",
  JobAssignment = "job-assignment",
  JobCompleted = "job-completed",
  JobOperationAssignment = "job-operation-assignment",
  JobOperationMessage = "job-operation-message",
  NonConformanceAssignment = "issue-assignment",
  ProcedureAssignment = "procedure-assignment",
  PurchaseInvoiceAssignment = "purchase-invoice-assignment",
  PurchaseOrderAssignment = "purchase-order-assignment",
  QuoteAssignment = "quote-assignment",
  QuoteExpired = "quote-expired",
  SalesOrderAssignment = "sales-order-assignment",
  SalesRfqAssignment = "sales-rfq-assignment",
  SalesRfqReady = "sales-rfq-ready",
  SupplierQuoteAssignment = "supplier-quote-assignment",
}

export enum NotificationType {
  AssignmentInApp = "assignment-in-app",
  DigitalQuoteResponseInApp = "digital-quote-response-in-app",
  JobCompletedInApp = "job-completed-in-app",
  ExpirationInApp = "expiration-in-app",
  MessageInApp = "message-in-app",
}

export type TriggerUser = {
  subscriberId: string;
};

export type NotificationPayload = {
  recordId: string;
  description: string;
  event: NotificationEvent;
  from?: string;
};

export type TriggerPayload = {
  workflow: NotificationWorkflow;
  payload: NotificationPayload;
  user: TriggerUser;
  replyTo?: string;
  tenant?: string; // NOTE: Currently no way to listen for messages with tenant, we use user id + company id for unique
};

export function getSubscriberId({
  companyId,
  userId,
}: {
  companyId: string;
  userId: string;
}) {
  return `${companyId}:${userId}`;
}

export async function trigger(novu, data: TriggerPayload) {
  try {
    await novu.trigger(data.workflow, {
      to: data.user,
      payload: data.payload,
      tenant: data.tenant,
      overrides: {
        email: {
          replyTo: data.replyTo,
          // @ts-ignore
          headers: {
            "X-Entity-Ref-ID": nanoid(),
          },
        },
      },
    });
  } catch (error) {
    console.log(error);
  }
}

export async function triggerBulk(novu, events: TriggerPayload[]) {
  try {
    await novu.bulkTrigger(
      events.map((data) => ({
        name: data.workflow,
        to: data.user,
        payload: data.payload,
        tenant: data.tenant,
        overrides: {
          email: {
            replyTo: data.replyTo,
            headers: {
              "X-Entity-Ref-ID": nanoid(),
            },
          },
        },
      }))
    );
  } catch (error) {
    console.log(error);
  }
}

type GetSubscriberPreferencesParams = {
  teamId: string;
  subscriberId: string;
};

export async function getSubscriberPreferences({
  subscriberId,
  teamId,
}: GetSubscriberPreferencesParams) {
  const response = await fetch(
    `${API_ENDPOINT}/subscribers/${teamId}_${subscriberId}/preferences`,
    {
      method: "GET",
      headers: {
        Authorization: `ApiKey ${process.env.NOVU_SECRET_KEY!}`,
      },
    }
  );

  return response.json();
}

type UpdateSubscriberPreferenceParams = {
  subscriberId: string;
  teamId: string;
  templateId: string;
  type: string;
  enabled: boolean;
};

export async function updateSubscriberPreference({
  subscriberId,
  teamId,
  templateId,
  type,
  enabled,
}: UpdateSubscriberPreferenceParams) {
  const response = await fetch(
    `${API_ENDPOINT}/subscribers/${teamId}_${subscriberId}/preferences/${templateId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `ApiKey ${process.env.NOVU_SECRET_KEY!}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: {
          type,
          enabled,
        },
      }),
    }
  );

  return response.json();
}
