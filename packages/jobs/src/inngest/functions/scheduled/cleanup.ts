import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { NotificationEvent } from "@carbon/notifications";
import { inngest } from "../../client";

type NotifyEvent = {
  name: "carbon/notify";
  data: {
    event: NotificationEvent;
    companyId: string;
    documentId: string;
    recipient: { type: "user"; userId: string };
  };
};

export const cleanupFunction = inngest.createFunction(
  { id: "cleanup", retries: 2 },
  { cron: "0 7,12,17 * * *" },
  async ({ step }) => {
    const serviceRole = getCarbonServiceRole();

    await step.run("expire-quotes-and-rfqs", async () => {
      console.log(`Starting cleanup tasks: ${new Date().toISOString()}`);

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
          .lt("expirationDate", new Date().toISOString())
      ]);

      if (expiredQuotes.error) {
        console.error(
          `Error fetching expired quotes: ${JSON.stringify(expiredQuotes.error)}`
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
        .not("expirationDate", "is", null)
        .lt("expirationDate", new Date().toISOString());

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

        const notificationEvents: NotifyEvent[] = expiredQuotes.data
          .filter((quote) => Boolean(quote.salesPersonId))
          .map((quote) => ({
            data: {
              companyId: quote.companyId,
              documentId: quote.id,
              event: NotificationEvent.QuoteExpired,
              recipient: {
                type: "user" as const,
                userId: quote.salesPersonId!
              }
            },
            name: "carbon/notify" as const
          }));

        if (notificationEvents.length > 0) {
          console.log(`Triggering ${notificationEvents.length} notifications`);
          try {
            await inngest.send(notificationEvents);
          } catch (error) {
            console.error("Error triggering notifications");
            console.error(error);
          }
        } else {
          console.log("No notifications to trigger");
        }
      }
    });

    await step.run("check-gauge-calibration", async () => {
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
          ...new Set(
            outOfCalibrationGauges.data
              .map((g) => g.companyId)
              .filter((id): id is string => id !== null)
          )
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
              settings.gaugeCalibrationExpiredNotificationGroup ?? []
            ])
          );

          const gaugeNotificationEvents: NotifyEvent[] = [];
          const notifiedGaugeIds = new Set<string>();

          // Create notify events for each gauge × recipient pair.
          for (const gauge of outOfCalibrationGauges.data) {
            if (!gauge.companyId || !gauge.id) continue;

            const notificationGroup =
              notificationGroupsByCompany.get(gauge.companyId) ?? [];

            if (notificationGroup.length === 0) {
              console.log(
                `No notification group configured for company ${gauge.companyId}, skipping gauge ${gauge.gaugeId}`
              );
              continue;
            }

            for (const userId of notificationGroup) {
              gaugeNotificationEvents.push({
                data: {
                  companyId: gauge.companyId,
                  documentId: gauge.id,
                  event: NotificationEvent.GaugeCalibrationExpired,
                  recipient: { type: "user" as const, userId }
                },
                name: "carbon/notify" as const
              });
              notifiedGaugeIds.add(gauge.id);
            }
          }

          if (gaugeNotificationEvents.length > 0) {
            console.log(
              `Triggering ${gaugeNotificationEvents.length} gauge calibration notifications`
            );
            try {
              await inngest.send(gaugeNotificationEvents);

              const gaugeIdsToUpdate = [...notifiedGaugeIds];

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

      // Clean up old print jobs:
      // - Completed jobs older than 30 days (served their purpose)
      // - Failed jobs older than 90 days (retained longer for diagnostics)
      // - Jobs in generating, queued, or printing status are never cleaned up
      console.log("Cleaning up old print jobs...");
      const thirtyDaysAgo = new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000
      ).toISOString();
      const ninetyDaysAgo = new Date(
        Date.now() - 90 * 24 * 60 * 60 * 1000
      ).toISOString();

      const [completedCleanup, failedCleanup] = await Promise.all([
        serviceRole
          .from("printJob")
          .delete()
          .eq("status", "completed")
          .lt("completedAt", thirtyDaysAgo),
        serviceRole
          .from("printJob")
          .delete()
          .eq("status", "failed")
          .lt("createdAt", ninetyDaysAgo)
      ]);

      if (completedCleanup.error) {
        console.error(
          `Error cleaning up completed print jobs: ${JSON.stringify(completedCleanup.error)}`
        );
      }
      if (failedCleanup.error) {
        console.error(
          `Error cleaning up failed print jobs: ${JSON.stringify(failedCleanup.error)}`
        );
      }
      console.log("Print job cleanup completed");

      console.log(`🧹 Cleanup tasks completed: ${new Date().toISOString()}`);
    });
  }
);
