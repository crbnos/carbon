import { getCarbonServiceRole, NOVU_SECRET_KEY } from "@carbon/auth";
import type { TriggerPayload } from "@carbon/notifications";
import {
  getSubscriberId,
  NotificationEvent,
  NotificationWorkflow,
  triggerBulk,
} from "@carbon/notifications";
import { Novu } from "@novu/node";
import { schedules } from "@trigger.dev/sdk";

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

      // Auto-expire purchasing RFQs past due date
      console.log("Checking for expired purchasing RFQs...");
      const expiredRfqs = await serviceRole
        .from("purchasingRfq")
        .select("*")
        .in("status", ["Draft", "Requested"])
        .not("dueDate", "is", null)
        .lt("dueDate", new Date().toISOString());

      if (expiredRfqs.error) {
        console.error(
          `Error fetching expired RFQs: ${JSON.stringify(expiredRfqs.error)}`
        );
      } else if (expiredRfqs.data.length > 0) {
        console.log(`Found ${expiredRfqs.data.length} expired RFQs`);
        const closeRfqs = await serviceRole
          .from("purchasingRfq")
          .update({ status: "Closed" })
          .in(
            "id",
            expiredRfqs.data.map((rfq) => rfq.id)
          );

        if (closeRfqs.error) {
          console.error(
            `Error closing expired RFQs: ${JSON.stringify(closeRfqs.error)}`
          );
        }
      } else {
        console.log("No expired RFQs found");
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

      // Check for gauges going out of calibration
      console.log("Checking for gauges going out of calibration...");
      const outOfCalibrationGauges = await serviceRole
        .from("gauges")
        .select("*")
        .eq("gaugeCalibrationStatusWithDueDate", "Out-of-Calibration")
        .neq("lastCalibrationStatus", "Out-of-Calibration");

      if (outOfCalibrationGauges.error) {
        console.error(
          `Error fetching out of calibration gauges: ${JSON.stringify(
            outOfCalibrationGauges.error
          )}`
        );
      } else if (outOfCalibrationGauges.data.length > 0) {
        console.log(
          `Found ${outOfCalibrationGauges.data.length} gauges going out of calibration`
        );

        // Get unique company IDs
        const companyIds = [
          ...new Set(outOfCalibrationGauges.data.map((g) => g.companyId)),
        ];

        // Fetch all company settings at once
        const companySettingsResult = await serviceRole
          .from("companySettings")
          .select("id, gaugeCalibrationExpiredNotificationGroup")
          .in("id", companyIds);

        if (companySettingsResult.error) {
          console.error(
            `Error fetching company settings: ${JSON.stringify(
              companySettingsResult.error
            )}`
          );
        } else {
          // Create a map of companyId -> notification group
          const notificationGroupsByCompany = new Map(
            companySettingsResult.data.map((settings) => [
              settings.id,
              settings.gaugeCalibrationExpiredNotificationGroup ?? [],
            ])
          );

          const gaugeNotificationPayloads: TriggerPayload[] = [];

          // Create notification payloads for each gauge
          for (const gauge of outOfCalibrationGauges.data) {
            const notificationGroup =
              notificationGroupsByCompany.get(gauge.companyId) ?? [];

            if (notificationGroup.length === 0) {
              console.log(
                `No notification group configured for company ${gauge.companyId}, skipping gauge ${gauge.gaugeId}`
              );
              continue;
            }

            // Create notification payloads for each user in the notification group
            for (const userId of notificationGroup) {
              gaugeNotificationPayloads.push({
                workflow: NotificationWorkflow.GaugeCalibration,
                payload: {
                  event: NotificationEvent.GaugeCalibrationExpired,
                  recordId: gauge.id,
                  description: `Gauge ${gauge.gaugeId} is out of calibration`,
                },
                user: {
                  subscriberId: getSubscriberId({
                    companyId: gauge.companyId,
                    userId,
                  }),
                },
              });
            }
          }

          if (gaugeNotificationPayloads.length > 0) {
            console.log(
              `Triggering ${gaugeNotificationPayloads.length} gauge calibration notifications`
            );
            try {
              await triggerBulk(novu, gaugeNotificationPayloads);

              // Update lastCalibrationStatus for gauges that had notifications sent
              // Extract unique gauge IDs from the notification payloads
              const gaugeIdsToUpdate = [
                ...new Set(
                  gaugeNotificationPayloads.map(
                    (payload) => payload.payload.recordId
                  )
                ),
              ];

              const updateGauges = await serviceRole
                .from("gauge")
                .update({ lastCalibrationStatus: "Out-of-Calibration" })
                .in("id", gaugeIdsToUpdate);

              if (updateGauges.error) {
                console.error(
                  `Error updating gauge lastCalibrationStatus: ${JSON.stringify(
                    updateGauges.error
                  )}`
                );
              } else {
                console.log(
                  `Updated lastCalibrationStatus for ${gaugeIdsToUpdate.length} gauges`
                );
              }
            } catch (error) {
              console.error("Error triggering gauge calibration notifications");
              console.error(error);
            }
          } else {
            console.log("No gauge calibration notifications to trigger");
          }
        }
      } else {
        console.log("No gauges going out of calibration found");
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
