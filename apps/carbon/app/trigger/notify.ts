import { getCarbonServiceRole, NOVU_SECRET_KEY } from "@carbon/auth";
import {
  getSubscriberId,
  NotificationEvent,
  trigger,
  triggerBulk,
  type TriggerPayload,
} from "@carbon/notifications";
import { Novu } from "@novu/node";
import { task } from "@trigger.dev/sdk/v3";

const novu = new Novu(NOVU_SECRET_KEY!);

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
        };
    from?: string;
  }) => {
    const client = getCarbonServiceRole();

    async function getDescription(type: NotificationEvent, documentId: string) {
      switch (type) {
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

          return `RFQ ${salesRfq?.data?.rfqId} assigned to you`;

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

          return `Digital Quote ${digitalQuote?.data?.quoteId} was accepted`;
        default:
          return null;
      }
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

    if (payload.recipient.type === "user") {
      const user = await client
        .from("user")
        .select("*")
        .eq("id", payload.recipient.userId)
        .single();

      if (user.error) {
        console.error("Failed to get user", user.error);
        throw user.error;
      }

      try {
        await trigger(novu, {
          workflow: payload.event,
          payload: {
            recordId: payload.documentId,
            description,
            event: payload.event,
            from: payload.from,
          },
          user: {
            subscriberId: getSubscriberId({
              companyId: payload.companyId,
              userId: user.data.id,
            }),
            email: user.data.email,
            fullName: user.data.fullName ?? "",
            avatarUrl: user.data.avatarUrl ?? undefined,
            companyId: payload.companyId,
          },
        });
      } catch (error) {
        console.error("Error triggering notifications");
        console.error(error);
      }
    } else if (payload.recipient.type === "group") {
      console.log(
        `triggering notification for group ${payload.recipient.groupIds}`
      );
      const userIds = await client.rpc("users_for_groups", {
        groups: payload.recipient.groupIds,
      });

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
          `No userIds found for group ${payload.recipient.groupIds}`
        );
        return;
      }

      const users = await client
        .from("user")
        .select("*")
        .in("id", [...new Set(userIds.data as string[])]);

      const notificationPayloads: TriggerPayload[] =
        users.data?.map((user) => ({
          workflow: payload.event,
          payload: {
            recordId: payload.documentId,
            description,
            event: payload.event,
            link: "#",
            from: payload.from,
          },
          user: {
            subscriberId: getSubscriberId({
              companyId: payload.companyId,
              userId: user.id,
            }),
            email: user.email,
            fullName: user.fullName ?? "",
            avatarUrl: user.avatarUrl ?? undefined,
            companyId: payload.companyId,
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
