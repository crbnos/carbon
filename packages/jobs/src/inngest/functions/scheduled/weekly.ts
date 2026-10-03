// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { fetchAllFromTable } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import {
  CompanyDeletionWarningEmail,
  isReminderItemStatus
} from "@carbon/documents/email";
import {
  getAppUrl,
  STRIPE_BYPASS_COMPANY_IDS,
  STRIPE_BYPASS_USER_IDS
} from "@carbon/env";
import { sendEmail } from "@carbon/lib/email.server";
import {
  MAX_NOTIFICATION_DELIVERIES,
  NotificationEvent
} from "@carbon/notifications";
import {
  chunkArray,
  datetime,
  Edition,
  formatDate,
  isInternalEmail
} from "@carbon/utils";
import { render } from "@react-email/components";
import type { Kysely } from "kysely";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";
import {
  canSetReplicationRole,
  getCompanyTableCatalog
} from "../tasks/company-backup";
import {
  type CompanyCandidate,
  isDueForDeletion,
  selectInactiveCompanies,
  splitByWarning,
  type Warning
} from "./inactive-companies";
import { purgeCompany, removeCompanyLeftovers } from "./purge-company";

/** Keeps a backlog under Inngest's per-run step limit; later weeks drain the rest. */
const MAX_COMPANY_DELETIONS_PER_RUN = 100;

const splitIds = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

/** Marker per warned company in `externalIntegrationMapping`; the purge clears it. */
const WARNING_INTEGRATION = "inactive-company-warning";

type CleanupTarget = Pick<CompanyCandidate, "id" | "name" | "companyGroupId">;
const NOTHING_TO_DO: {
  plannedAt: number;
  toWarn: CleanupTarget[];
  toDelete: CleanupTarget[];
  staleWarningIds: string[];
} = { plannedAt: 0, toWarn: [], toDelete: [], staleWarningIds: [] };

type GroupOwner = { id: string; email: string; firstName: string | null };

/** The owner of each company group, for protection and for the warning email. */
async function getGroupOwners(
  groupIds: string[]
): Promise<Map<string, GroupOwner>> {
  const serviceRole = getCarbonServiceRole();
  const ownerIds = new Map<string, string>();
  for (const ids of chunkArray([...new Set(groupIds)], 200)) {
    const { data, error } = await serviceRole
      .from("companyGroup")
      .select("id, ownerId")
      .in("id", ids);
    if (error)
      throw new Error(`Failed to load company groups: ${error.message}`);
    for (const group of data) {
      if (group.ownerId) ownerIds.set(group.id, group.ownerId);
    }
  }

  const users = new Map<string, GroupOwner>();
  for (const ids of chunkArray([...new Set(ownerIds.values())], 200)) {
    const { data, error } = await serviceRole
      .from("user")
      .select("id, email, firstName")
      .in("id", ids);
    if (error) throw new Error(`Failed to load group owners: ${error.message}`);
    for (const user of data) users.set(user.id, user);
  }

  const owners = new Map<string, GroupOwner>();
  for (const [groupId, ownerId] of ownerIds) {
    const owner = users.get(ownerId);
    if (owner) owners.set(groupId, owner);
  }
  return owners;
}

/**
 * Whether a planned delete still holds, read in the purge's own transaction: the
 * company exists and is not bypassed, no company in its group has a plan, the
 * group's current owner is the person who was warned (and is not internal or a
 * bypass user), and that warning is due. The plan step ran minutes (or retries)
 * earlier.
 */
async function isStillDueForDeletion(
  trx: Kysely<KyselyDatabase>,
  companyId: string
): Promise<boolean> {
  if (splitIds(STRIPE_BYPASS_COMPANY_IDS).includes(companyId)) return false;
  const company = await trx
    .selectFrom("company")
    .select("companyGroupId")
    .where("id", "=", companyId)
    .executeTakeFirst();
  if (!company) return false;

  const groupId = company.companyGroupId;
  const paying = await trx
    .selectFrom("companyPlan")
    .select("id")
    .where((eb) =>
      groupId === null
        ? eb("id", "=", companyId)
        : eb(
            "id",
            "in",
            eb
              .selectFrom("company")
              .select("company.id")
              .where("company.companyGroupId", "=", groupId)
          )
    )
    .limit(1)
    .executeTakeFirst();
  if (paying) return false;

  // Only an owned group is ever warned. The owner may have changed, or become
  // internal, since the plan step, and a new owner has not been warned.
  if (groupId === null) return false;
  const owner = await trx
    .selectFrom("companyGroup")
    .innerJoin("user", "user.id", "companyGroup.ownerId")
    .select(["user.id", "user.email"])
    .where("companyGroup.id", "=", groupId)
    .executeTakeFirst();
  if (
    !owner ||
    splitIds(STRIPE_BYPASS_USER_IDS).includes(owner.id) ||
    isInternalEmail(owner.email)
  ) {
    return false;
  }

  const marker = await trx
    .selectFrom("externalIntegrationMapping")
    .select("metadata")
    .where("integration", "=", WARNING_INTEGRATION)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  const warning = marker?.metadata as Warning | undefined;
  if (warning?.ownerId !== owner.id) return false;
  return isDueForDeletion(warning, {
    now: Date.now(),
    today: datetime.today("UTC").toString()
  });
}

export const weeklyFunction = inngest.createFunction(
  { id: "weekly", retries: 2 },
  { cron: "0 21 * * 0" },
  async ({ step, logger }) => {
    const serviceRole = getCarbonServiceRole();

    /**
     * Email each company's group owner and record the warning (or the failure).
     * Returns what happened to each company, which is the step's output.
     */
    async function warnInactiveCompanies(
      batch: CleanupTarget[],
      plannedAt: number
    ) {
      const outcome = {
        deleteAfter: "",
        warned: [] as string[],
        failed: [] as { id: string; error: string }[],
        noOwner: [] as string[],
        alreadyWarned: [] as string[]
      };
      const owners = await getGroupOwners(
        batch.flatMap((c) => (c.companyGroupId ? [c.companyGroupId] : []))
      );
      // A retried step skips companies an earlier attempt of this run warned.
      const { data: markers, error: markersError } = await serviceRole
        .from("externalIntegrationMapping")
        .select("companyId, metadata")
        .eq("integration", WARNING_INTEGRATION)
        .in(
          "companyId",
          batch.map((c) => c.id)
        );
      if (markersError) throw new Error(markersError.message);
      const warnedThisRun = new Set(
        markers
          .filter((m) => {
            const warnedAt = (m.metadata as Warning | null)?.warnedAt;
            return warnedAt !== undefined && Date.parse(warnedAt) >= plannedAt;
          })
          .map((m) => m.companyId)
      );

      // The email names this date, and the delete waits for it (isDueForDeletion).
      const deleteAfter = datetime.today("UTC").add({ days: 7 }).toString();
      outcome.deleteAfter = deleteAfter;
      const deletionDate = formatDate(
        deleteAfter,
        { dateStyle: "long" },
        "en-US"
      );
      const billingUrl = `${getAppUrl()}/x/settings/billing`;

      for (const company of batch) {
        if (warnedThisRun.has(company.id)) {
          outcome.alreadyWarned.push(company.id);
          continue;
        }
        const owner = company.companyGroupId
          ? owners.get(company.companyGroupId)
          : undefined;
        if (!owner) {
          // Never warned means never deleted, so a company nobody owns is kept.
          logger.warn("No owner to warn; company kept", company);
          outcome.noOwner.push(company.id);
          continue;
        }

        const { data: sent, error: sendError } = await sendEmail({
          to: owner.email,
          subject: `${company.name} will be deleted on or after ${deletionDate}`,
          html: await render(
            CompanyDeletionWarningEmail({
              recipientName: owner.firstName ?? undefined,
              companyName: company.name,
              deletionDate,
              billingUrl
            })
          )
        });
        // No error and no message id means email is not configured here: nothing
        // was delivered, so it must not count as a warning (or delete later).
        const error =
          sendError ??
          (sent ? null : new Error("Email not configured; nothing was sent"));
        if (error) {
          logger.error("Failed to send company deletion warning", {
            ...company,
            error
          });
          outcome.failed.push({ id: company.id, error: error.message });
        } else {
          outcome.warned.push(company.id);
        }

        // A failed send is recorded too, so next week it queues behind the rest.
        const warning: Warning = error
          ? { failedAt: datetime.timestamp() }
          : { warnedAt: datetime.timestamp(), deleteAfter };
        const { error: markerError } = await serviceRole
          .from("externalIntegrationMapping")
          .upsert(
            {
              entityType: "company",
              entityId: company.id,
              integration: WARNING_INTEGRATION,
              externalId: "",
              metadata: { ...warning, ownerId: owner.id, to: owner.email },
              companyId: company.id
            },
            { onConflict: "entityType,entityId,integration,companyId" }
          );
        if (markerError) {
          logger.error("Failed to record company deletion warning", {
            ...company,
            error: markerError
          });
        }
      }
      return outcome;
    }

    // Cloud only. A canceled subscription keeps its plan row until Stripe ends it
    // (customer.subscription.deleted removes the row), so a company is never
    // deleted inside a period it paid for.
    const plan = await step.run("plan-inactive-company-cleanup", async () => {
      if (process.env.CARBON_EDITION !== Edition.Cloud) return NOTHING_TO_DO;

      // Paged: PostgREST caps a plain select at 1000 rows, and a plan row cut
      // off there would make a paying company look planless.
      const [companies, plans] = await Promise.all([
        fetchAllFromTable<CompanyCandidate>(
          serviceRole,
          "company",
          "id, name, createdAt, companyGroupId"
        ),
        fetchAllFromTable<{ id: string }>(serviceRole, "companyPlan", "id")
      ]);
      if (companies.error || plans.error) {
        logger.error("Failed to load companies for cleanup", {
          error: companies.error ?? plans.error
        });
        return NOTHING_TO_DO;
      }

      const selection = {
        companies: companies.data,
        planCompanyIds: new Set(plans.data.map((plan) => plan.id)),
        protectedCompanyIds: new Set(splitIds(STRIPE_BYPASS_COMPANY_IDS)),
        now: Date.now(),
        limit: Number.POSITIVE_INFINITY
      };
      // Owners are looked up only for the candidates' groups: a group owned by
      // a Carbon or bypass user has plan access without a plan row.
      const candidates = selectInactiveCompanies({
        ...selection,
        protectedGroupIds: new Set()
      });
      let owners: Map<string, GroupOwner>;
      try {
        owners = await getGroupOwners(
          candidates.flatMap((c) =>
            c.companyGroupId ? [c.companyGroupId] : []
          )
        );
      } catch (error) {
        logger.error("Failed to load company group owners", { error });
        return NOTHING_TO_DO;
      }
      // A group owned by a Carbon or bypass user has plan access without a row.
      const bypassUsers = new Set(splitIds(STRIPE_BYPASS_USER_IDS));
      const protectedGroupIds = new Set(
        [...owners]
          .filter(
            ([, owner]) =>
              bypassUsers.has(owner.id) || isInternalEmail(owner.email)
          )
          .map(([groupId]) => groupId)
      );
      const inactive = selectInactiveCompanies({
        ...selection,
        protectedGroupIds
      });
      // Never warned means never deleted, so an ownerless company is kept. It is
      // left out of the capped lists, where it would hold a slot every week.
      const warnable = inactive.filter(
        (c) => c.companyGroupId !== null && owners.has(c.companyGroupId)
      );

      const markers = await fetchAllFromTable<{
        id: string;
        companyId: string;
        metadata: Warning | null;
      }>(
        serviceRole,
        "externalIntegrationMapping",
        "id, companyId, metadata",
        (query) => query.eq("integration", WARNING_INTEGRATION)
      );
      if (markers.error) {
        logger.error("Failed to load company deletion warnings", {
          error: markers.error
        });
        return NOTHING_TO_DO;
      }

      // A warning only counts while the company is still inactive: one that
      // regained a plan is cleared, and is warned afresh if it lapses again.
      const inactiveIds = new Set(inactive.map((c) => c.id));
      const warnings = new Map<string, Warning>();
      const staleWarningIds: string[] = [];
      for (const marker of markers.data) {
        if (!inactiveIds.has(marker.companyId)) staleWarningIds.push(marker.id);
        else if (marker.metadata)
          warnings.set(marker.companyId, marker.metadata);
      }

      const { toWarn, toDelete } = splitByWarning({
        inactive: warnable,
        warnings,
        clock: {
          now: selection.now,
          today: datetime.today("UTC").toString()
        },
        limit: MAX_COMPANY_DELETIONS_PER_RUN
      });
      const slim = (list: CompanyCandidate[]) =>
        list.map(({ id, name, companyGroupId }) => ({
          id,
          name,
          companyGroupId
        }));

      logger.info("Inactive companies", {
        inactive: inactive.length,
        protectedByOwner: candidates.length - inactive.length,
        withoutOwner: inactive.length - warnable.length,
        toWarn: slim(toWarn),
        toDelete: slim(toDelete),
        staleWarnings: staleWarningIds.length
      });
      return {
        plannedAt: selection.now,
        toWarn: slim(toWarn),
        toDelete: slim(toDelete),
        staleWarningIds
      };
    });

    if (plan.staleWarningIds.length > 0) {
      await step.run("clear-stale-deletion-warnings", async () => {
        for (const ids of chunkArray(plan.staleWarningIds, 200)) {
          const { error } = await serviceRole
            .from("externalIntegrationMapping")
            .delete()
            .in("id", ids);
          if (error) {
            logger.error("Failed to clear stale deletion warnings", { error });
          }
        }
      });
    }

    // A batch that still fails after its retries is logged and skipped, so it
    // cannot end the run before the remaining batches and the reminders.
    const warnBatches = chunkArray(plan.toWarn, 10);
    for (let i = 0; i < warnBatches.length; i++) {
      try {
        await step.run(`warn-inactive-companies-${i}`, () =>
          warnInactiveCompanies(warnBatches[i]!, plan.plannedAt)
        );
      } catch (error) {
        logger.error("Failed to warn a batch of inactive companies", {
          batch: i,
          error
        });
      }
    }

    // Ten companies per step: a company that cannot be deleted is logged and
    // skipped, and the table catalog is read once per step, not per company.
    // Only companies warned at least six days ago reach this list.
    const batches = chunkArray(plan.toDelete, 10);
    for (let i = 0; i < batches.length; i++) {
      try {
        await step.run(`delete-inactive-companies-${i}`, async () => {
          const db = getJobDatabaseClient();
          const replica = await canSetReplicationRole(db);
          const catalog = await getCompanyTableCatalog(db);
          const results: { id: string; deleted: boolean }[] = [];

          for (const company of batches[i]!) {
            try {
              // Re-checked in the purge's own transaction: a plan bought, or a
              // warning cleared, since the plan step ran must stop the delete.
              const purged = await db.transaction().execute(async (trx) => {
                if (!(await isStillDueForDeletion(trx, company.id)))
                  return false;
                await purgeCompany(trx, catalog, company.id, { replica });
                // Before the commit: when any of it fails the delete rolls back,
                // and the company, still warned and due, is retried next week.
                const failures = await removeCompanyLeftovers(
                  trx,
                  serviceRole,
                  company.id
                );
                if (failures.length > 0) {
                  for (const failure of failures) {
                    logger.error("Failed to remove company {failurePart}", {
                      failurePart: failure.part,
                      ...company,
                      error: failure.error
                    });
                  }
                  throw new Error(
                    `Company cleanup incomplete: ${failures.map((f) => f.part).join(", ")}`
                  );
                }
                return true;
              });
              if (!purged) {
                logger.info(
                  "Company no longer due for deletion; kept",
                  company
                );
                results.push({ id: company.id, deleted: false });
                continue;
              }
            } catch (error) {
              logger.error("Failed to delete company", {
                ...company,
                replica,
                error
              });
              results.push({ id: company.id, deleted: false });
              continue;
            }

            const { error: searchError } = await serviceRole.rpc(
              "drop_company_search_index",
              { p_company_id: company.id }
            );
            if (searchError) {
              logger.error("Failed to drop search index for company", {
                ...company,
                error: searchError
              });
            }
            logger.info("Deleted company", company);
            results.push({ id: company.id, deleted: true });
          }
          return results;
        });
      } catch (error) {
        logger.error("Failed to delete a batch of inactive companies", {
          batch: i,
          error
        });
      }
    }

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
