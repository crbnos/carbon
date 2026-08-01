import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { NotificationEvent } from "@carbon/notifications";
import { inngest } from "../../client";

// Raw CAD in `temp-staging` is transient — the optimise/assembly jobs read it,
// and the compact pipeline COPIES what must survive into `private` (never an
// instant move/delete: that races concurrent jobs holding a temp-staging
// source pointer). This sweep is the ONLY thing that deletes from staging:
// stale objects that were copied to durable, or that no modelUpload references.
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
  { cron: "0 7 * * *" },
  async ({ step, logger }) => {
    // Jitter: spread the daily run across the hour so every environment
    // sharing infrastructure doesn't hammer storage/DB at exactly 07:00 UTC.
    // The random offset is computed once when the step first executes and
    // memoized in the run state — replays reuse the recorded wake time.
    await step.sleep("jitter", `${Math.floor(Math.random() * 3600)}s`);

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
      logger.info("Pruning stale staged raw models...");
      const cutoff = new Date(
        Date.now() - STAGED_RAW_TTL_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();

      const stale = await serviceRole
        .schema("storage")
        .from("objects")
        .select("name")
        .eq("bucket_id", "temp-staging")
        .lt("created_at", cutoff)
        .limit(1000);

      if (stale.error) {
        logger.error("Error listing stale staged raws", { error: stale.error });
        return;
      }
      const staleNames = (stale.data ?? [])
        .map((o) => o.name)
        .filter((n): n is string => Boolean(n));
      if (staleNames.length === 0) {
        logger.info("No stale staged raws");
        return;
      }

      // Rule 1 — RELOCATED: the compact pipeline copies survivors to `private`
      // under the same key (copy, not move — a move races concurrent jobs
      // holding a temp-staging source pointer). Once the durable copy exists,
      // the staged one is redundant regardless of size or references: every
      // reader probes/falls back to `private`.
      const relocated = new Set<string>();
      const CHUNK = 20;
      for (let i = 0; i < staleNames.length; i += CHUNK) {
        const chunk = staleNames.slice(i, i + CHUNK);
        const probes = await Promise.all(
          chunk.map((name) =>
            serviceRole.storage
              .from("private")
              .info(name)
              .then((r) => (!r.error && r.data ? name : null))
              .catch(() => null)
          )
        );
        for (const name of probes) {
          if (name) relocated.add(name);
        }
      }

      // Rule 2 — ORPHANED: no modelUpload points at it via EITHER column
      // (`modelPath`: a referenced staging-only raw means compaction hasn't
      // succeeded yet or the object is the only copy of an oversized source;
      // `originalPath`: the retained original behind an xbf compaction). A
      // referenced object with no durable copy is NEVER deleted — it may be
      // the only copy of the customer's file.
      const candidates = staleNames.filter((n) => !relocated.has(n));
      const referencedPaths = new Set<string>();
      if (candidates.length > 0) {
        const [referenced, referencedOriginals] = await Promise.all([
          serviceRole
            .from("modelUpload")
            .select("modelPath")
            .in("modelPath", candidates),
          serviceRole
            .from("modelUpload")
            .select("originalPath")
            .in("originalPath", candidates)
        ]);
        if (referenced.error || referencedOriginals.error) {
          logger.error(
            "Error resolving referenced staged raws — skipping orphan prune",
            { error: referenced.error ?? referencedOriginals.error }
          );
          return;
        }
        for (const r of referenced.data ?? []) {
          if (r.modelPath) referencedPaths.add(r.modelPath);
        }
        for (const r of referencedOriginals.data ?? []) {
          if (r.originalPath) referencedPaths.add(r.originalPath);
        }
      }
      const orphans = candidates.filter((n) => !referencedPaths.has(n));

      const toRemove = [...relocated, ...orphans];
      if (toRemove.length === 0) {
        logger.info("No prunable staged raws", {
          stale: staleNames.length,
          referenced: referencedPaths.size
        });
        return;
      }

      const removed = await serviceRole.storage
        .from("temp-staging")
        .remove(toRemove);
      if (removed.error) {
        logger.error("Error pruning staged raws", { error: removed.error });
      } else {
        logger.info("Pruned stale staged raws", {
          relocated: relocated.size,
          orphaned: orphans.length
        });
      }
    });
  }
);
