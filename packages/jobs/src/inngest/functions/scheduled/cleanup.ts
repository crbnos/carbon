import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { NotificationEvent } from "@carbon/notifications";
import { MODEL_RAW_KEEP_MAX_BYTES } from "@carbon/utils";
import { inngest } from "../../client";

// Raw CAD in `temp-staging` is transient — the optimise/assembly jobs read it,
// then only the gated GLB is kept in `private`. Prune raws over the served cap
// older than this so huge sources never linger; small raws stay (downloadable).
const STAGED_RAW_TTL_DAYS = 7;

// Agent chat threads are transient — purge after 30 days of inactivity.
const AGENT_THREAD_TTL_DAYS = 30;

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

    await step.run("purge-old-agent-threads", async () => {
      logger.info("Purging agent chat threads older than 30 days...");
      const cutoff = new Date(
        Date.now() - AGENT_THREAD_TTL_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();

      // Small batches: the ids ride in PostgREST query strings below, and the
      // job runs 3×/day, so any backlog drains within a few runs.
      const old = await serviceRole
        .from("agentThread")
        .select("id")
        .lt("createdAt", cutoff)
        .limit(200);
      if (old.error) {
        logger.error("Error fetching old agent threads", { error: old.error });
        return;
      }
      const ids = old.data.map((t) => t.id);
      if (ids.length === 0) {
        logger.info("No old agent threads to purge");
        return;
      }

      // Age by last activity, not creation — a thread the user is still
      // talking in stays, even if it was started over 30 days ago.
      const active = await serviceRole
        .from("agentMessage")
        .select("threadId")
        .in("threadId", ids)
        .gte("createdAt", cutoff);
      if (active.error) {
        logger.error("Error checking agent thread activity", {
          error: active.error
        });
        return;
      }
      const activeIds = new Set(active.data.map((m) => m.threadId));
      const purgeIds = ids.filter((id) => !activeIds.has(id));
      if (purgeIds.length === 0) {
        logger.info("No stale agent threads to purge", {
          stillActive: activeIds.size
        });
        return;
      }

      // Messages and parts cascade with the thread.
      const purged = await serviceRole
        .from("agentThread")
        .delete()
        .in("id", purgeIds);
      if (purged.error) {
        logger.error("Error purging agent threads", { error: purged.error });
      } else {
        logger.info("Purged stale agent threads", { count: purgeIds.length });
      }
    });

    await step.run("prune-staged-raw-models", async () => {
      logger.info("Pruning stale large staged raw models...");
      const cutoff = new Date(
        Date.now() - STAGED_RAW_TTL_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();

      const stale = await serviceRole
        .schema("storage")
        .from("objects")
        .select("name, metadata")
        .eq("bucket_id", "temp-staging")
        .lt("created_at", cutoff)
        .limit(1000);

      if (stale.error) {
        logger.error("Error listing stale staged raws", { error: stale.error });
        return;
      }

      // Prune only UNCOMPACTED fat raws — the compact pipeline replaces a raw
      // with `raw.<ext>.zst` / `raw.xbf.zst` (the permanent lazy-plan source,
      // never pruned even when its compressed size still exceeds the cap).
      const big = (stale.data ?? [])
        .filter(
          (o) =>
            !o.name?.toLowerCase().endsWith(".zst") &&
            Number((o.metadata as { size?: number } | null)?.size ?? 0) >
              MODEL_RAW_KEEP_MAX_BYTES
        )
        .map((o) => o.name)
        .filter((n): n is string => Boolean(n));

      if (big.length === 0) {
        logger.info("No large staged raws to prune");
        return;
      }

      // Orphans only — never delete an object a modelUpload still points at.
      // A referenced fat raw means compaction hasn't succeeded yet (compact
      // retries independently of optimise); deleting it would destroy the only
      // copy of the model and break assemblies. True strays (upload recorded
      // no row, or the row was repointed/deleted) are the actual dead weight.
      const referenced = await serviceRole
        .from("modelUpload")
        .select("modelPath")
        .in("modelPath", big);
      if (referenced.error) {
        logger.error(
          "Error resolving referenced staged raws — skipping prune",
          {
            error: referenced.error
          }
        );
        return;
      }
      const referencedPaths = new Set(
        (referenced.data ?? []).map((r) => r.modelPath)
      );
      const orphans = big.filter((n) => !referencedPaths.has(n));
      if (orphans.length === 0) {
        logger.info("No orphaned large staged raws to prune", {
          referenced: big.length
        });
        return;
      }

      const removed = await serviceRole.storage
        .from("temp-staging")
        .remove(orphans);
      if (removed.error) {
        logger.error("Error pruning staged raws", { error: removed.error });
      } else {
        logger.info("Pruned orphaned staged raw models", {
          count: orphans.length
        });
      }
    });
  }
);
