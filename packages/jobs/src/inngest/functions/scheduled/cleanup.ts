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
  async ({ step, logger }) => {
    const serviceRole = getCarbonServiceRole();

    await step.run("expire-quotes-and-rfqs", async () => {
      logger.info(`Starting cleanup tasks: ${new Date().toISOString()}`);

      // Clean up expired quotes
      logger.info("Checking for expired quotes...");
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
        logger.error("Error fetching expired quotes", {
          error: expiredQuotes.error
        });
        return;
      }

      if (expiredSupplierQuotes.error) {
        logger.error("Error fetching expired supplier quotes", {
          error: expiredSupplierQuotes.error
        });
        return;
      }

      if (expiredSupplierQuotes.data.length > 0) {
        logger.info("Found expired supplier quotes", {
          count: expiredSupplierQuotes.data.length
        });
        const expireSupplierQuotes = await serviceRole
          .from("supplierQuote")
          .update({ status: "Expired" })
          .in(
            "id",
            expiredSupplierQuotes.data.map((quote) => quote.id)
          );

        if (expireSupplierQuotes.error) {
          logger.error("Error updating expired supplier quotes", {
            error: expireSupplierQuotes.error
          });
          return;
        }
      } else {
        logger.info("No expired supplier quotes found");
      }

      // Auto-expire purchasing RFQs past due date
      logger.info("Checking for expired purchasing RFQs...");
      const expiredRfqs = await serviceRole
        .from("purchasingRfq")
        .select("*")
        .in("status", ["Draft", "Requested"])
        .not("expirationDate", "is", null)
        .lt("expirationDate", new Date().toISOString());

      if (expiredRfqs.error) {
        logger.error("Error fetching expired RFQs", {
          error: expiredRfqs.error
        });
      } else if (expiredRfqs.data.length > 0) {
        logger.info("Found expired RFQs", { count: expiredRfqs.data.length });
        const closeRfqs = await serviceRole
          .from("purchasingRfq")
          .update({ status: "Closed" })
          .in(
            "id",
            expiredRfqs.data.map((rfq) => rfq.id)
          );

        if (closeRfqs.error) {
          logger.error("Error closing expired RFQs", {
            error: closeRfqs.error
          });
        }
      } else {
        logger.info("No expired RFQs found");
      }

      if (!expiredQuotes?.data?.length) {
        logger.info("No expired quotes found requiring notification");
      } else {
        logger.info("Found expired quotes", {
          count: expiredQuotes.data.length
        });
        const expireQuotes = await serviceRole
          .from("quote")
          .update({ status: "Expired" })
          .in(
            "id",
            expiredQuotes.data.map((quote) => quote.id)
          );

        if (expireQuotes.error) {
          logger.error("Error updating expired quotes", {
            error: expireQuotes.error
          });
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
          logger.info("Triggering notifications", {
            count: notificationEvents.length
          });
          try {
            await inngest.send(notificationEvents);
          } catch (error) {
            logger.error("Error triggering notifications", { error });
          }
        } else {
          logger.info("No notifications to trigger");
        }
      }
    });

    await step.run("check-gauge-calibration", async () => {
      // Check for gauges going out of calibration
      logger.info("Checking for gauges going out of calibration...");
      const outOfCalibrationGauges = await serviceRole
        .from("gauges")
        .select("*")
        .eq("gaugeCalibrationStatusWithDueDate", "Out-of-Calibration")
        .neq("lastCalibrationStatus", "Out-of-Calibration");

      if (outOfCalibrationGauges.error) {
        logger.error("Error fetching out of calibration gauges", {
          error: outOfCalibrationGauges.error
        });
      } else if (outOfCalibrationGauges.data.length > 0) {
        logger.info("Found gauges going out of calibration", {
          count: outOfCalibrationGauges.data.length
        });

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
          logger.error("Error fetching company settings", {
            error: companySettingsResult.error
          });
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
              logger.info("No notification group configured, skipping gauge", {
                companyId: gauge.companyId,
                gaugeId: gauge.gaugeId
              });
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
            logger.info("Triggering gauge calibration notifications", {
              count: gaugeNotificationEvents.length
            });
            try {
              await inngest.send(gaugeNotificationEvents);

              const gaugeIdsToUpdate = [...notifiedGaugeIds];

              const updateGauges = await serviceRole
                .from("gauge")
                .update({ lastCalibrationStatus: "Out-of-Calibration" })
                .in("id", gaugeIdsToUpdate);

              if (updateGauges.error) {
                logger.error("Error updating gauge lastCalibrationStatus", {
                  error: updateGauges.error
                });
              } else {
                logger.info("Updated gauge lastCalibrationStatus", {
                  count: gaugeIdsToUpdate.length
                });
              }
            } catch (error) {
              logger.error("Error triggering gauge calibration notifications", {
                error
              });
            }
          } else {
            logger.info("No gauge calibration notifications to trigger");
          }
        }
      } else {
        logger.info("No gauges going out of calibration found");
      }

      // Clean up old print jobs:
      // - Completed jobs older than 30 days (served their purpose)
      // - Failed jobs older than 90 days (retained longer for diagnostics)
      // - Jobs in generating, queued, or printing status are never cleaned up
      logger.info("Cleaning up old print jobs...");
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
        logger.error("Error cleaning up completed print jobs", {
          error: completedCleanup.error
        });
      }
      if (failedCleanup.error) {
        logger.error("Error cleaning up failed print jobs", {
          error: failedCleanup.error
        });
      }
      logger.info("Print job cleanup completed");

      logger.info(`Cleanup tasks completed: ${new Date().toISOString()}`);
    });
  }
);
