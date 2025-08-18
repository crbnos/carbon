import {
  getCarbonServiceRole,
  NOVU_SECRET_KEY,
  VERCEL_URL,
} from "@carbon/auth";

import { notifyTaskAssigned } from "@carbon/integrations/notifications";
import {
  getSubscriberId,
  NotificationEvent,
  NotificationWorkflow,
  trigger,
  triggerBulk,
  type TriggerPayload,
} from "@carbon/notifications";
import { Novu } from "@novu/node";
import { task } from "@trigger.dev/sdk/v3";

const novu = new Novu(NOVU_SECRET_KEY!);
const isLocal = VERCEL_URL === undefined || VERCEL_URL.includes("localhost");

// Helper function to get company integrations
async function getCompanyIntegrations(client: any, companyId: string) {
  return client
    .from("companyIntegration")
    .select("*")
    .eq("companyId", companyId);
}

export const notifyTask = task({
  id: "notify",
  run: async (payload: {
    event: NotificationEvent;
    companyId: string;
    documentId: string;
    recipient:
      | {
          type: "user";
          userId: string;
        }
      | {
          type: "group";
          groupIds: string[];
        }
      | {
          type: "users";
          userIds: string[];
        };
    from?: string;
  }) => {
    if (isLocal) {
      console.log("Skipping notify task on local", { payload });
      return;
    }

    const client = getCarbonServiceRole();

    function getWorkflow(type: NotificationEvent) {
      switch (type) {
        case NotificationEvent.JobAssignment:
        case NotificationEvent.JobOperationAssignment:
        case NotificationEvent.NonConformanceAssignment:
        case NotificationEvent.ProcedureAssignment:
        case NotificationEvent.PurchaseInvoiceAssignment:
        case NotificationEvent.PurchaseOrderAssignment:
        case NotificationEvent.QuoteAssignment:
        case NotificationEvent.SalesOrderAssignment:
        case NotificationEvent.SalesRfqAssignment:
        case NotificationEvent.SalesRfqReady:
        case NotificationEvent.SupplierQuoteAssignment:
          return NotificationWorkflow.Assignment;
        case NotificationEvent.JobCompleted:
          return NotificationWorkflow.JobCompleted;
        case NotificationEvent.DigitalQuoteResponse:
          return NotificationWorkflow.DigitalQuoteResponse;
        case NotificationEvent.JobOperationMessage:
          return NotificationWorkflow.Message;
        default:
          return null;
      }
    }

    async function getDescription(type: NotificationEvent, documentId: string) {
      switch (type) {
        case NotificationEvent.SalesRfqReady:
        case NotificationEvent.SalesRfqAssignment:
          const salesRfq = await client
            .from("salesRfq")
            .select("*")
            .eq("id", documentId)
            .single();

          if (salesRfq.error) {
            console.error("Failed to get salesRfq", salesRfq.error);
            throw salesRfq.error;
          }

          if (type === NotificationEvent.SalesRfqReady) {
            return `RFQ ${salesRfq?.data?.rfqId} is ready for quote`;
          } else if (type === NotificationEvent.SalesRfqAssignment) {
            return `RFQ ${salesRfq?.data?.rfqId} assigned to you`;
          }

        case NotificationEvent.QuoteAssignment:
          const quote = await client
            .from("quote")
            .select("*")
            .eq("id", documentId)
            .single();
          if (quote.error) {
            console.error("Failed to get quote", quote.error);
            throw quote.error;
          }
          return `Quote ${quote?.data?.quoteId} assigned to you`;

        case NotificationEvent.SalesOrderAssignment:
          const salesOrder = await client
            .from("salesOrder")
            .select("*")
            .eq("id", documentId)
            .single();

          if (salesOrder.error) {
            console.error("Failed to get salesOrder", salesOrder.error);
            throw salesOrder.error;
          }

          return `Sales Order ${salesOrder?.data?.salesOrderId} assigned to you`;

        case NotificationEvent.NonConformanceAssignment:
          const nonConformance = await client
            .from("nonConformance")
            .select("*")
            .eq("id", documentId)
            .single();

          if (nonConformance.error) {
            console.error("Failed to get nonConformance", nonConformance.error);
            throw nonConformance.error;
          }

          return `Issue ${nonConformance?.data?.nonConformanceId} assigned to you`;
        case NotificationEvent.JobAssignment:
          const job = await client
            .from("job")
            .select("*")
            .eq("id", documentId)
            .single();

          if (job.error) {
            console.error("Failed to get job", job.error);
            throw job.error;
          }

          return `Job ${job?.data?.jobId} assigned to you`;
        case NotificationEvent.JobCompleted:
          const completedJob = await client
            .from("job")
            .select("*")
            .eq("id", documentId)
            .single();

          if (completedJob.error) {
            console.error("Failed to get job", completedJob.error);
            throw completedJob.error;
          }

          return `Job ${completedJob?.data?.jobId} is complete!`;
        case NotificationEvent.JobOperationAssignment:
        case NotificationEvent.JobOperationMessage:
          const [, operationId] = documentId.split(":");
          const jobOperation = await client
            .from("jobOperation")
            .select("*, job(id, jobId)")
            .eq("id", operationId)
            .single();

          if (jobOperation.error) {
            console.error("Failed to get jobOperation", jobOperation.error);
            throw jobOperation.error;
          }

          if (type === NotificationEvent.JobOperationAssignment) {
            return `New job operation assigned to you on ${jobOperation?.data?.job?.jobId}`;
          } else if (type === NotificationEvent.JobOperationMessage) {
            return `New message on ${jobOperation?.data?.job?.jobId} operation: ${jobOperation?.data?.description}`;
          }

        case NotificationEvent.ProcedureAssignment:
          const procedure = await client
            .from("procedure")
            .select("*")
            .eq("id", documentId)
            .single();

          if (procedure.error) {
            console.error("Failed to get procedure", procedure.error);
            throw procedure.error;
          }

          return `Procedure ${procedure?.data?.name} version ${procedure?.data?.version} assigned to you`;

        case NotificationEvent.DigitalQuoteResponse:
          const digitalQuote = await client
            .from("quote")
            .select("*")
            .eq("id", documentId)
            .single();

          if (digitalQuote.error) {
            console.error("Failed to get digital quote", digitalQuote.error);
            throw digitalQuote.error;
          }

          if (digitalQuote.data.digitalQuoteAcceptedBy) {
            return `Digital Quote ${digitalQuote?.data?.quoteId} was completed by ${digitalQuote.data.digitalQuoteAcceptedBy}`;
          }

          if (digitalQuote.data.digitalQuoteRejectedBy) {
            return `Digital Quote ${digitalQuote?.data?.quoteId} was rejected by ${digitalQuote.data.digitalQuoteRejectedBy}`;
          }

          return `Digital Quote ${digitalQuote?.data?.quoteId} was accepted`;
        default:
          return null;
      }
    }

    const workflow = getWorkflow(payload.event);

    if (!workflow) {
      console.error(`No workflow found for notification type ${payload.event}`);
      throw new Error(
        `No workflow found for notification type ${payload.event}`
      );
    }

    const description = await getDescription(payload.event, payload.documentId);

    if (!description) {
      console.error(
        `No description found for notification type ${payload.event} with documentId ${payload.documentId}`
      );
      throw new Error(
        `No description found for notification type ${payload.event} with documentId ${payload.documentId}`
      );
    }

    // Send integration notifications for non-conformance assignment events (e.g., Slack)
    if (
      payload.event === NotificationEvent.NonConformanceAssignment &&
      payload.recipient.type === "user"
    ) {
      console.log(
        "Processing non-conformance assignment notification for integrations",
        {
          event: payload.event,
          companyId: payload.companyId,
          documentId: payload.documentId,
          recipientUserId: payload.recipient.userId,
          from: payload.from,
        }
      );

      try {
        const integrationsResult = await getCompanyIntegrations(
          client,
          payload.companyId
        );

        if (integrationsResult.data && integrationsResult.data.length > 0) {
          await notifyTaskAssigned({ client }, integrationsResult.data, {
            companyId: payload.companyId,
            userId: payload.from || "system",
            carbonUrl: `https://${VERCEL_URL}/x/issue/${payload.documentId}`,
            task: {
              id: payload.documentId,
              table: "nonConformance",
              assignee: payload.recipient.userId,
              title: description,
            },
          });
        }
      } catch (error) {
        console.error(
          "Failed to send integration assignment notification:",
          error
        );
        // Continue without blocking the main operation
      }
    }

    if (payload.recipient.type === "user") {
      try {
        await trigger(novu, {
          workflow,
          payload: {
            recordId: payload.documentId,
            description,
            event: payload.event,
            from: payload.from,
          },
          user: {
            subscriberId: getSubscriberId({
              companyId: payload.companyId,
              userId: payload.recipient.userId,
            }),
          },
        });
      } catch (error) {
        console.error("Error triggering notifications");
        console.error(error);
      }
    } else if (["group", "users"].includes(payload.recipient.type)) {
      console.log(
        `triggering notification for group ${payload.recipient.type}`
      );

      const userIds =
        payload.recipient.type === "group"
          ? await client.rpc("users_for_groups", {
              groups: payload.recipient.groupIds,
            })
          : {
              data: payload.recipient.userIds,
              error: null,
            };

      if (userIds.error) {
        console.error("Failed to get userIds", userIds.error);
        throw userIds.error;
      }

      if (
        userIds.data === null ||
        !Array.isArray(userIds.data) ||
        userIds.data.length === 0
      ) {
        console.error(
          `No userIds found for payload ${JSON.stringify(payload.recipient)}`
        );
        return;
      }

      // Filter out the sender from recipients if they exist in the userIds
      const filteredUserIds = payload.from
        ? (userIds.data as string[]).filter((id) => id !== payload.from)
        : (userIds.data as string[]);

      const notificationPayloads: TriggerPayload[] =
        [...new Set(filteredUserIds)].map((userId) => ({
          workflow,
          payload: {
            recordId: payload.documentId,
            description,
            event: payload.event,
            from: payload.from,
          },
          user: {
            subscriberId: getSubscriberId({
              companyId: payload.companyId,
              userId: userId,
            }),
          },
        })) ?? [];

      if (notificationPayloads.length > 0) {
        try {
          await triggerBulk(novu, notificationPayloads.flat());
        } catch (error) {
          console.error("Error triggering notifications");
          console.error(error);
        }
      }
    }
  },
});
