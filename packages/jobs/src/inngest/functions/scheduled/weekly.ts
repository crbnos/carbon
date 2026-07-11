import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { fetchAllFromTable } from "@carbon/database";
import { isReminderItemStatus } from "@carbon/documents/email";
import {
  MAX_NOTIFICATION_DELIVERIES,
  NotificationEvent
} from "@carbon/notifications";
import { Edition } from "@carbon/utils";
import { inngest } from "../../client";

export const weeklyFunction = inngest.createFunction(
  { id: "weekly", retries: 2 },
  { cron: "0 21 * * 0" },
  async ({ step, logger }) => {
    const serviceRole = getCarbonServiceRole();
    await step.run("cloud-cleanup", async () => {
      logger.info("Starting weekly tasks");

      try {
        if (process.env.CARBON_EDITION === Edition.Cloud) {
          const bypassUrl = `${process.env.VERCEL_URL}/api/settings/bypass`;
          const bypassResponse = await fetch(bypassUrl);
          if (!bypassResponse.ok) {
            logger.error("Failed to fetch bypass list", {
              statusText: bypassResponse.statusText
            });
            return;
          }
          const bypassData = (await bypassResponse.json()) as {
            bypassList?: string[];
          };
          const bypassList = bypassData.bypassList ?? [];

          logger.info("Bypass list", { bypassList });

          // Get all companies
          const { data: companies, error: companiesError } = await serviceRole
            .from("company")
            .select("id, name, createdAt");

          if (companiesError) {
            logger.error("Failed to fetch companies", {
              error: companiesError
            });
            return;
          }

          logger.info("Found companies", { count: companies?.length || 0 });

          // Get all company plans
          const { data: companyPlans, error: plansError } = await serviceRole
            .from("companyPlan")
            .select("id, stripeSubscriptionStatus");

          if (plansError) {
            logger.error("Failed to fetch company plans", {
              error: plansError
            });
            return;
          }

          // Create a map of company plans for quick lookup
          const planMap = new Map(
            companyPlans?.map((plan) => [
              plan.id,
              plan.stripeSubscriptionStatus
            ]) || []
          );

          // Filter companies to delete
          const oneWeekAgo = new Date();
          oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

          const companiesToDelete =
            companies?.filter((company) => {
              if (planMap.get(company.id) === "Canceled") {
                return true;
              }

              if (bypassList.includes(company.id)) {
                return false;
              }

              if (planMap.get(company.id)) {
                return false;
              }

              // Keep companies created in the last week
              const createdAt = new Date(company.createdAt);
              if (createdAt > oneWeekAgo) {
                return false;
              }

              // Delete this company
              return true;
            }) || [];

          logger.info("Companies to delete", {
            count: companiesToDelete.length
          });

          const { error: deletedCompaniesError } = await serviceRole
            .from("company")
            .delete()
            .in(
              "id",
              companiesToDelete.map((company) => company.id)
            );

          if (deletedCompaniesError) {
            logger.error("Failed to delete companies", {
              error: deletedCompaniesError
            });
            return;
          } else {
            logger.info("Deleted companies", {
              count: companiesToDelete.length
            });
            for (const company of companiesToDelete) {
              logger.info("Deleted company", { company: company.name });
            }
          }

          // Drop search index tables for companies being deleted
          for (const company of companiesToDelete) {
            const { error: dropSearchError } = await serviceRole.rpc(
              "drop_company_search_index",
              { p_company_id: company.id }
            );
            if (dropSearchError) {
              logger.error("Failed to drop search index for company", {
                company: company.name,
                error: dropSearchError
              });
            } else {
              logger.info("Dropped search index for company", {
                company: company.name
              });
            }
          }
        }
      } catch (error) {
        logger.error("Unexpected error in cloud cleanup", { error });
      }
    });

    // Build inside a memoized step, send via step.sendEvent — sending
    // mid-step would double-deliver on a retry after a partial send.
    const reminders = await step.run("build-training-reminders", async () => {
      // Notify employees with outstanding trainings (Pending or Overdue)
      logger.info("Checking for outstanding training assignments");

      // One digest-shaped TrainingReminder per employee (documentIds); the
      // notify function owns all channel fan-out.
      const notifyEvents: Array<{
        name: "carbon/notify";
        data: {
          companyId: string;
          documentIds: string[];
          event: NotificationEvent;
          recipient: { type: "user"; userId: string };
        };
      }> = [];

      try {
        // fetchAllFromTable pages past PostgREST's 1000-row cap — one big
        // company would otherwise starve the rest out of reminders.
        const { data: companiesWithTrainings, error: companiesError } =
          await fetchAllFromTable<{ companyId: string }>(
            serviceRole,
            "trainingAssignment",
            "companyId"
          );

        if (companiesError) {
          logger.error("Failed to fetch companies with trainings", {
            error: companiesError
          });
          return { notifyEvents };
        }

        const uniqueCompanyIds = [
          ...new Set(companiesWithTrainings?.map((c) => c.companyId) ?? [])
        ];

        logger.info("Found companies with training assignments", {
          count: uniqueCompanyIds.length
        });

        for (const companyId of uniqueCompanyIds) {
          const { data: trainingStatus, error: trainingsError } =
            await serviceRole.rpc("get_training_assignment_status", {
              p_company_id: companyId
            });

          if (trainingsError) {
            logger.error("Failed to fetch trainings for company", {
              companyId,
              error: trainingsError
            });
            continue;
          }

          // Filter to outstanding and dedupe by employee+assignment
          const outstandingTrainings = (trainingStatus ?? []).filter((t) =>
            isReminderItemStatus(t.status)
          );

          // Group by trainingAssignmentId to send one notification per assignment per employee
          const assignmentsByEmployee = new Map<
            string,
            (typeof outstandingTrainings)[number]
          >();

          for (const training of outstandingTrainings) {
            const key = `${training.companyId}:${training.employeeId}:${training.trainingAssignmentId}`;
            if (!assignmentsByEmployee.has(key)) {
              assignmentsByEmployee.set(key, training);
            }
          }

          let assignments = [...assignmentsByEmployee.values()];
          if (assignments.length === 0) continue;

          // Delivery cap: drop (employee, assignment, period) tuples that
          // already received MAX_NOTIFICATION_DELIVERIES successful emails.
          // Counter documentIds carry the recurrence period ("ta_1:2026", set
          // in notify.ts) so the budget resets each period; frequency "Once"
          // has no period and stays capped permanently. fetchAllFromTable so
          // capped rows past the 1000-row page aren't silently missed.
          const { data: cappedDeliveries, error: cappedError } =
            await fetchAllFromTable<{ userId: string; documentId: string }>(
              serviceRole,
              "notificationDelivery",
              "userId, documentId",
              (query) =>
                query
                  .eq("companyId", companyId)
                  .eq("event", NotificationEvent.TrainingReminder)
                  .gte("successCount", MAX_NOTIFICATION_DELIVERIES)
            );

          if (cappedError) {
            // Fail open: a broken cap lookup shouldn't stop reminders.
            logger.error("Failed to fetch delivery caps", {
              companyId,
              error: cappedError
            });
          } else if (cappedDeliveries && cappedDeliveries.length > 0) {
            const capped = new Set(
              cappedDeliveries.map((d) => `${d.userId}:${d.documentId}`)
            );
            const before = assignments.length;
            assignments = assignments.filter((a) => {
              const trackedId = a.currentPeriod
                ? `${a.trainingAssignmentId}:${a.currentPeriod}`
                : a.trainingAssignmentId;
              return !capped.has(`${a.employeeId}:${trackedId}`);
            });
            if (assignments.length < before) {
              logger.info("Acknowledged capped training reminders", {
                companyId,
                count: before - assignments.length,
                cap: MAX_NOTIFICATION_DELIVERIES
              });
            }
            if (assignments.length === 0) continue;
          }

          const byEmployee = new Map<string, typeof assignments>();
          for (const assignment of assignments) {
            const list = byEmployee.get(assignment.employeeId) ?? [];
            list.push(assignment);
            byEmployee.set(assignment.employeeId, list);
          }

          for (const [employeeId, employeeAssignments] of byEmployee) {
            notifyEvents.push({
              name: "carbon/notify" as const,
              data: {
                companyId,
                documentIds: employeeAssignments.map(
                  (assignment) => assignment.trainingAssignmentId
                ),
                event: NotificationEvent.TrainingReminder,
                recipient: {
                  type: "user" as const,
                  userId: employeeId
                }
              }
            });
          }
        }
      } catch (error) {
        logger.error("Unexpected error in training notifications", { error });
      }

      logger.info("Built weekly training reminder digests", {
        count: notifyEvents.length
      });
      return { notifyEvents };
    });

    if (reminders.notifyEvents.length > 0) {
      await step.sendEvent(
        "send-training-reminder-notifications",
        reminders.notifyEvents
      );
    }

    console.log(`Weekly tasks completed: ${new Date().toISOString()}`);
  }
);
