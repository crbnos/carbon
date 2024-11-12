import { getCarbonServiceRole, NOVU_SECRET_KEY } from "@carbon/auth";
import type { TriggerPayload } from "@carbon/notifications";
import {
  getSubscriberId,
  NotificationEvent,
  NotificationWorkflow,
  triggerBulk,
} from "@carbon/notifications";
import { Novu } from "@novu/node";
import { schedules } from "@trigger.dev/sdk/v3";

const serviceRole = getCarbonServiceRole();
const novu = new Novu(NOVU_SECRET_KEY!);

export const expireQuotes = schedules.task({
  id: "expire-quotes",
  // Run at 9am, 2pm, and 7pm every day
  cron: "0 9,14,19 * * *",
  run: async () => {
    console.log(
      `🕒 Quote Expiration Check Started: ${new Date().toISOString()}`
    );

    try {
      // Fetch expired quotes that are in sent status and have a sales person assigned
      const { data: expiredQuotes, error } = await serviceRole
        .from("quote")
        .select("*")
        .eq("status", "Sent")
        .not("expirationDate", "is", null)
        .lt("expirationDate", new Date().toISOString());

      if (error) {
        console.error(
          `Error fetching expired quotes: ${JSON.stringify(error)}`
        );
        return;
      }

      if (!expiredQuotes?.length) {
        console.log("No expired quotes found requiring notification");
        return;
      } else {
        console.log(`Found ${expiredQuotes.length} expired quotes`);
        const { error } = await serviceRole
          .from("quote")
          .update({ status: "Expired" })
          .in(
            "id",
            expiredQuotes.map((quote) => quote.id)
          );

        if (error) {
          console.error(
            `Error updating expired quotes: ${JSON.stringify(error)}`
          );
          return;
        }
      }

      const notificationPayloads: TriggerPayload[] = expiredQuotes
        .filter((quote) => Boolean(quote.salesPersonId))
        .map((quote) => {
          return {
            workflow: NotificationWorkflow.Expiration,
            payload: {
              documentId: quote.id,
              event: NotificationEvent.QuoteExpired,
              recordId: quote.id,
              description: `Quote ${quote.quoteId} has expired`,
            },
            user: {
              subscriberId: getSubscriberId({
                companyId: quote.companyId,
                userId: quote.salesPersonId!,
              }),
            },
          };
        });

      if (notificationPayloads.length > 0) {
        console.log(`Triggering ${notificationPayloads.length} notifications`);
        try {
          await triggerBulk(novu, notificationPayloads.flat());
        } catch (error) {
          console.error("Error triggering notifications");
          console.error(error);
        }
      } else {
        console.log("No notifications to trigger");
      }
      console.log(
        `🕒 Quote Expiration Check Completed: ${new Date().toISOString()}`
      );
    } catch (error) {
      console.error(
        `Unexpected error in quote expiration task: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  },
});
