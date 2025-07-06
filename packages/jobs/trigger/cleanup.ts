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

export const cleanup = schedules.task({
  id: "cleanup",
  // Run at 7am, 12pm, and 5pm every day
  cron: "0 7,12,17 * * *",
  run: async () => {
    console.log(`🧹 Starting cleanup tasks: ${new Date().toISOString()}`);

    try {
      // Clean up expired quotes
      console.log("Checking for expired quotes...");
      const [expiredQuotes, expiredSupplierQuotes] = await Promise.all([
        serviceRole
          .from("quote")
          .select("*")
          .eq("status", "Sent")
          .not("expirationDate", "is", null)
          .lt("expirationDate", new Date().toISOString()),
        serviceRole
          .from("supplierQuote")
          .select("*")
          .eq("status", "Active")
          .not("expirationDate", "is", null)
          .lt("expirationDate", new Date().toISOString()),
      ]);

      if (expiredQuotes.error) {
        console.error(
          `Error fetching expired quotes: ${JSON.stringify(
            expiredQuotes.error
          )}`
        );
        return;
      }

      if (expiredSupplierQuotes.error) {
        console.error(
          `Error fetching expired supplier quotes: ${JSON.stringify(
            expiredSupplierQuotes.error
          )}`
        );
        return;
      }

      if (expiredSupplierQuotes.data.length > 0) {
        console.log(
          `Found ${expiredSupplierQuotes.data.length} expired supplier quotes`
        );
        const expireSupplierQuotes = await serviceRole
          .from("supplierQuote")
          .update({ status: "Expired" })
          .in(
            "id",
            expiredSupplierQuotes.data.map((quote) => quote.id)
          );

        if (expireSupplierQuotes.error) {
          console.error(
            `Error updating expired supplier quotes: ${JSON.stringify(
              expireSupplierQuotes.error
            )}`
          );
          return;
        }
      } else {
        console.log("No expired supplier quotes found");
      }

      if (!expiredQuotes?.data?.length) {
        console.log("No expired quotes found requiring notification");
      } else {
        console.log(`Found ${expiredQuotes.data.length} expired quotes`);
        const expireQuotes = await serviceRole
          .from("quote")
          .update({ status: "Expired" })
          .in(
            "id",
            expiredQuotes.data.map((quote) => quote.id)
          );

        if (expireQuotes.error) {
          console.error(
            `Error updating expired quotes: ${JSON.stringify(
              expireQuotes.error
            )}`
          );
          return;
        }

        const notificationPayloads: TriggerPayload[] = expiredQuotes.data
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
          console.log(
            `Triggering ${notificationPayloads.length} notifications`
          );
          try {
            await triggerBulk(novu, notificationPayloads.flat());
          } catch (error) {
            console.error("Error triggering notifications");
            console.error(error);
          }
        } else {
          console.log("No notifications to trigger");
        }
      }

      console.log(`🧹 Cleanup tasks completed: ${new Date().toISOString()}`);
    } catch (error) {
      console.error(
        `Unexpected error in cleanup tasks: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  },
});
