// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { scrapAllowance } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import {
  assignPlanningActions,
  dismissPlanningActions,
  getPlanningAction,
  insertJob,
  isJobEditableFromPlanning,
  markPlanningActionsActioned,
  notifyScheduleInputsChanged,
  productionOrderValidator,
  recalculateJobRequirements,
  reopenDismissedPlanningActions,
  reopenPlanningActions,
  updateJob,
  upsertJobMethod
} from "~/modules/production";
import { cancelJob } from "~/modules/production/production.server";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "production", "planning");

// Telling the scheduler is a follow-up to a write that already landed, so its
// failure is logged and reported, never thrown: a throw here used to end an
// Apply loop with a 500 after earlier actions were already applied.
async function notifyScheduleChange(
  companyId: string,
  reason: string,
  jobId: string
): Promise<boolean> {
  try {
    await notifyScheduleInputsChanged(companyId, "reorder", reason, jobId);
    return true;
  } catch (error) {
    logger.error("Failed to notify the scheduler from planning", {
      companyId,
      jobId,
      reason,
      error
    });
    return false;
  }
}

const itemsValidator = z
  .object({
    id: z.string(),
    orders: z.array(productionOrderValidator)
  })
  .array();

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production",
    role: "employee",
    bypassRls: true
  });

  const { items, action, locationId, planningActionIds, assignee, job } =
    await request.json();

  if (typeof locationId !== "string") {
    return data(
      {
        success: false,
        message: "Location ID is required and must be a valid string"
      },
      { status: 500 }
    );
  }

  if (typeof action !== "string") {
    return data(
      {
        success: false,
        message: "Action parameter is required and must be a valid string"
      },
      { status: 500 }
    );
  }

  switch (action) {
    case "order":
      const parsedItems = itemsValidator.safeParse(items);

      if (!parsedItems.success) {
        const errorMessages = parsedItems.error.issues.map((error) => {
          const path = error.path;
          const field = path[path.length - 1];

          // Create more readable error messages based on the field and context
          if (field === "orders" && path.length === 2) {
            return "No orders provided for item";
          }
          if (field === "quantity") {
            return "Invalid quantity specified";
          }
          if (field === "periodId") {
            return "No period specified";
          }
          if (field === "startDate") {
            return "Invalid start date";
          }
          if (field === "dueDate") {
            return "Invalid due date";
          }

          // Fallback to original message for unhandled cases
          return error.message;
        });

        logger.error("Validation errors", { errors: parsedItems.error.issues });
        return data(
          {
            success: false,
            message: `Validation failed: ${errorMessages.join(", ")}`,
            errors: errorMessages
          },
          { status: 500 }
        );
      }

      const itemsToOrder = parsedItems.data;
      if (itemsToOrder.length === 0) {
        return data(
          {
            success: false,
            message: "No items were provided to create production orders"
          },
          { status: 500 }
        );
      }

      // `client` is the service role (bypassRls) and every id below comes from
      // the request body: prove the location, items and existing jobs are this
      // company's before any job is created or rewritten. One query per type.
      const itemIds = [...new Set(itemsToOrder.map((item) => item.id))];
      const existingJobIds = [
        ...new Set(
          itemsToOrder.flatMap((item) =>
            item.orders.flatMap((order) =>
              order.existingId ? [order.existingId] : []
            )
          )
        )
      ];
      const [ownedLocation, ownedItems, ownedJobs] = await Promise.all([
        client
          .from("location")
          .select("id")
          .eq("id", locationId)
          .eq("companyId", companyId)
          .maybeSingle(),
        client
          .from("item")
          .select("id")
          .in("id", itemIds)
          .eq("companyId", companyId),
        existingJobIds.length > 0
          ? client
              .from("job")
              .select("id")
              .in("id", existingJobIds)
              .eq("companyId", companyId)
          : Promise.resolve({ data: [] as { id: string }[], error: null })
      ]);
      if (
        ownedLocation.error ||
        !ownedLocation.data ||
        ownedItems.error ||
        (ownedItems.data ?? []).length !== itemIds.length ||
        ownedJobs.error ||
        (ownedJobs.data ?? []).length !== existingJobIds.length
      ) {
        logger.error("Planning order references records outside the company", {
          companyId,
          locationId,
          itemIds,
          existingJobIds,
          error: ownedLocation.error ?? ownedItems.error ?? ownedJobs.error
        });
        return data({ success: false, message: "Not found" }, { status: 404 });
      }

      try {
        const allJobIds: string[] = [];
        const createdJobs: { id: string; readableId: string }[] = [];
        const itemsWithoutOrders: string[] = [];
        let updatedJobCount = 0;
        const allSupplyForecasts: Array<{
          itemId: string;
          locationId: string;
          sourceType: "Production Order";
          forecastQuantity: number;
          periodId: string;
          companyId: string;
          createdBy: string;
          updatedBy: string;
        }> = [];

        let processedItems = 0;
        let errors: string[] = [];

        for (const item of itemsToOrder) {
          const orders = item.orders;

          // Nothing to make for this item — existing supply already covers demand
          if (orders.length === 0) {
            itemsWithoutOrders.push(item.id);
            continue;
          }

          const jobIds: string[] = [];
          const supplyForecastByPeriod: Record<string, number> = {};

          // Get manufacturing data for this item
          const manufacturing = await client
            .from("itemReplenishment")
            .select(
              "manufacturingBlocked, scrapPercentage, requiresConfiguration"
            )
            .eq("itemId", item.id)
            .eq("companyId", companyId)
            .single();

          if (manufacturing.error) {
            const errorMsg = `Failed to retrieve manufacturing data for item ${item.id}: ${manufacturing.error.message}`;
            logger.error(errorMsg);
            errors.push(errorMsg);
            continue;
          }

          if (manufacturing.data?.manufacturingBlocked) {
            const errorMsg = `Manufacturing is blocked for item ${item.id}`;
            logger.warning(errorMsg);
            errors.push(errorMsg);
            continue;
          }

          if (manufacturing.data?.requiresConfiguration) {
            const errorMsg = `Manufacturing requires configuration for item ${item.id}`;
            logger.warning(errorMsg);
            errors.push(errorMsg);
            continue;
          }

          let itemProcessed = false;

          // Process each order for this item
          for (const order of orders) {
            if (!order.existingId) {
              // Create new job
              const createJob = await insertJob(
                client,
                getDatabaseClient(),
                {
                  itemId: item.id,
                  quantity: order.quantity,
                  startDate: order.startDate ?? undefined,
                  dueDate: order.dueDate ?? undefined,
                  deadlineType: order.isASAP ? "ASAP" : "Soft Deadline",
                  status: "Planned",
                  locationId,
                  companyId,
                  createdBy: userId,
                  unitOfMeasureCode: "EA"
                },
                { skipMethod: true, skipRecalculate: true, source: "mrp" }
              );

              if (createJob.error) {
                const errorMsg = `Failed to create job for item ${item.id}: ${createJob.error.message}`;
                logger.error(errorMsg);
                errors.push(errorMsg);
                continue;
              }

              const id = createJob.data?.id;
              const readableId = createJob.data?.jobId ?? "";
              if (!id) {
                const errorMsg = `Job was not returned after creation for item ${item.id}`;
                logger.error(errorMsg);
                errors.push(errorMsg);
                continue;
              }

              const upsertMethod = await upsertJobMethod(
                client,
                getDatabaseClient(),
                "itemToJob",
                {
                  sourceId: item.id,
                  targetId: id,
                  companyId,
                  userId
                }
              );

              if (upsertMethod.error) {
                const errorMsg = `Failed to create job method for item ${item.id}: ${upsertMethod.error.message}`;
                logger.error(errorMsg);
                errors.push(errorMsg);
                continue;
              }

              jobIds.push(id);
              createdJobs.push({ id, readableId });
              itemProcessed = true;
            } else {
              // Update existing job
              jobIds.push(order.existingId);

              // Calculate scrap quantity based on scrap percentage
              const updateScrapPercentage =
                manufacturing.data?.scrapPercentage ?? 0;
              const updateScrapQuantity = scrapAllowance(
                order.quantity,
                updateScrapPercentage
              );

              const updateJob = await client
                .from("job")
                .update({
                  dueDate: order.dueDate ?? undefined,
                  deadlineType: order.isASAP ? "ASAP" : "Soft Deadline",
                  quantity: order.quantity,
                  scrapQuantity: updateScrapQuantity,
                  startDate: order.startDate ?? undefined,
                  status: "Planned",
                  updatedAt: new Date().toISOString(),
                  updatedBy: userId
                })
                .eq("id", order.existingId)
                .eq("companyId", companyId);

              if (updateJob.error) {
                const errorMsg = `Failed to update job ${order.existingId} for item ${item.id}: ${updateJob.error.message}`;
                logger.error(errorMsg);
                errors.push(errorMsg);
                continue;
              }

              updatedJobCount++;
              itemProcessed = true;
            }

            // Track supply forecast by period
            const periodId = order.periodId;
            supplyForecastByPeriod[periodId] =
              (supplyForecastByPeriod[periodId] || 0) +
              (order.quantity - (order.existingQuantity ?? 0));
          }

          if (itemProcessed) {
            processedItems++;
            // Add job IDs to the overall list
            allJobIds.push(...jobIds);

            // Add supply forecasts for this item
            Object.entries(supplyForecastByPeriod).forEach(
              ([periodId, quantity]) => {
                allSupplyForecasts.push({
                  itemId: item.id,
                  locationId,
                  sourceType: "Production Order" as const,
                  forecastQuantity: quantity,
                  periodId,
                  companyId,
                  createdBy: userId,
                  updatedBy: userId
                });
              }
            );
          }
        }

        // Insert all supply forecasts using upsert to handle duplicates
        if (allSupplyForecasts.length > 0) {
          // Group supply forecasts by unique key to avoid duplicate conflicts
          const forecastMap = new Map<string, (typeof allSupplyForecasts)[0]>();

          for (const forecast of allSupplyForecasts) {
            const key = `${forecast.itemId}-${forecast.locationId}-${forecast.periodId}`;
            const existing = forecastMap.get(key);

            if (existing) {
              // Combine quantities for the same key
              existing.forecastQuantity += forecast.forecastQuantity;
            } else {
              forecastMap.set(key, { ...forecast });
            }
          }

          const uniqueSupplyForecasts = Array.from(forecastMap.values());

          const insertForecasts = await client
            .from("supplyForecast")
            .upsert(uniqueSupplyForecasts, {
              onConflict: "itemId,locationId,periodId",
              ignoreDuplicates: false
            });

          if (insertForecasts.error) {
            const errorMsg = `Failed to insert supply forecasts: ${insertForecasts.error.message}`;
            logger.error(errorMsg);
            errors.push(errorMsg);
          }
        }

        // Trigger recalculation for all jobs
        if (allJobIds.length > 0) {
          for (const jobId of allJobIds) {
            const recalc = await recalculateJobRequirements(
              client,
              getDatabaseClient(),
              { id: jobId, companyId, userId }
            );
            if (recalc.error) {
              const errorMsg = `Created job ${jobId}, but its requirements could not be recalculated`;
              logger.error(errorMsg, { companyId, jobId, error: recalc.error });
              errors.push(errorMsg);
            }
          }
        }

        // Split the skipped items into "a job already covers it" vs "nothing to make"
        // so the client can say which, instead of reporting them as failures
        const alreadyPlannedItemIds = new Set<string>();
        if (itemsWithoutOrders.length > 0) {
          const openJobs = await client
            .from("job")
            .select("itemId")
            .eq("companyId", companyId)
            .eq("locationId", locationId)
            .in("itemId", itemsWithoutOrders)
            .in("status", [
              "Draft",
              "Planned",
              "Ready",
              "In Progress",
              "Paused"
            ]);

          openJobs.data?.forEach((job) => {
            if (job.itemId) alreadyPlannedItemIds.add(job.itemId);
          });
        }

        if (errors.length > 0 && processedItems === 0) {
          return data(
            {
              success: false,
              message: `Failed to process any items. Errors: ${errors
                .slice(0, 3)
                .join("; ")}${
                errors.length > 3 ? ` and ${errors.length - 3} more...` : ""
              }`,
              errors: errors
            },
            { status: 500 }
          );
        }

        const message =
          processedItems === itemsToOrder.length && errors.length === 0
            ? `Successfully processed all ${processedItems} items with ${allJobIds.length} jobs`
            : `Processed ${processedItems} of ${itemsToOrder.length} items. ${
                errors.length
              } errors occurred: ${errors.slice(0, 2).join("; ")}${
                errors.length > 2 ? "..." : ""
              }`;

        return {
          success: processedItems > 0 || errors.length === 0,
          message,
          jobs: createdJobs,
          updatedJobCount,
          alreadyPlannedItemCount: alreadyPlannedItemIds.size,
          noDemandItemCount:
            itemsWithoutOrders.length - alreadyPlannedItemIds.size,
          processedItems,
          totalItems: itemsToOrder.length,
          errors: errors.length > 0 ? errors : undefined
        };
      } catch (error) {
        logger.error("Unexpected error processing production orders", {
          error
        });
        return data(
          {
            success: false,
            message: `Unexpected error occurred while processing production orders: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          },
          { status: 500 }
        );
      }

    // ── Save ONE field of ONE existing job: the planning drawer's Open Jobs
    // table autosaves a quantity or due date cell here. The job is re-read
    // under companyId (the client is the service role and the id comes from
    // the body), and the same commitment gate as Apply holds: a job released
    // to the floor is never edited from planning. The writes mirror Apply's —
    // a new date re-queues the schedule, a new quantity re-derives the job's
    // requirements.
    case "updateJob": {
      const parsedJob = z
        .discriminatedUnion("field", [
          z.object({
            id: z.string().min(1),
            field: z.literal("quantity"),
            value: z.number().positive()
          }),
          z.object({
            id: z.string().min(1),
            field: z.literal("dueDate"),
            value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
          })
        ])
        .safeParse(job);
      if (!parsedJob.success) {
        return data(
          {
            success: false,
            message: "A job needs a quantity above zero or a valid date"
          },
          { status: 400 }
        );
      }

      const target = await client
        .from("job")
        .select("id, status, locationId")
        .eq("id", parsedJob.data.id)
        .eq("companyId", companyId)
        .maybeSingle();
      if (target.error || !target.data) {
        return data(
          { success: false, message: "Job not found" },
          { status: 404 }
        );
      }
      // The drawer lists one location's jobs; a request for another
      // location's job did not come from it.
      if (target.data.locationId !== locationId) {
        return data(
          { success: false, message: "This job is for another location." },
          { status: 409 }
        );
      }
      if (!isJobEditableFromPlanning(target.data.status)) {
        return data(
          {
            success: false,
            message:
              "This job is no longer Draft or Planned. Change it on the job."
          },
          { status: 409 }
        );
      }

      const saved = await updateJob(client, {
        id: target.data.id,
        updatedBy: userId,
        ...(parsedJob.data.field === "quantity"
          ? { quantity: parsedJob.data.value }
          : { dueDate: parsedJob.data.value })
      });
      if (saved.error) {
        logger.error("Failed to save job from planning", {
          companyId,
          userId,
          jobId: target.data.id,
          field: parsedJob.data.field,
          error: saved.error
        });
        return data(
          { success: false, message: "Failed to update job" },
          { status: 500 }
        );
      }

      // The field is saved from here on, so a failure below is a warning on a
      // saved edit, never a failure — the drawer keeps the new value.
      if (parsedJob.data.field === "quantity") {
        const recalc = await recalculateJobRequirements(
          client,
          getDatabaseClient(),
          { id: target.data.id, companyId, userId }
        );
        if (recalc.error) {
          logger.error("Failed to recalculate job requirements from planning", {
            companyId,
            userId,
            jobId: target.data.id,
            error: recalc.error
          });
          return {
            success: true,
            message: "Updated job",
            warning:
              "The quantity is saved, but the job's materials and operations were not recalculated. Recalculate the job."
          };
        }
      } else {
        const notified = await notifyScheduleChange(
          companyId,
          "Planning changed a job's due date",
          target.data.id
        );
        if (!notified) {
          return {
            success: true,
            message: "Updated job",
            warning:
              "The due date is saved, but the schedule was not refreshed. Reschedule the location."
          };
        }
      }

      return { success: true, message: "Updated job" };
    }

    // ── Apply a persisted planning action to its target job (spec §P1.5).
    // IDOR guard: the request carries ONLY planningActionIds — the type, target
    // and proposal values come from the persisted row, loaded by id+companyId
    // and required to be Open. The commitment gate re-reads the job status; a
    // released job (Ready or later) is never silently edited. Job dates flow
    // through updateJob (recomputes priority) + notifyScheduleInputsChanged —
    // never jobOperation date writes.
    // "apply" batches a mixed selection in ONE request (the client has a
    // single fetcher, so per-type requests would supersede each other) — each
    // row's own persisted type decides what happens to it.
    case "apply":
    case "expedite":
    case "defer":
    case "increase":
    case "decrease":
    case "cancel": {
      const parsedIds = z
        .array(z.string().min(1))
        .min(1)
        .safeParse(planningActionIds);
      if (!parsedIds.success) {
        return data(
          { success: false, message: "planningActionIds is required" },
          { status: 500 }
        );
      }

      const wireToType: Record<string, string> = {
        expedite: "Expedite",
        defer: "Defer",
        increase: "Increase",
        decrease: "Decrease",
        cancel: "Cancel"
      };
      const changeActionTypes = new Set(Object.values(wireToType));

      const applied: string[] = [];
      const requiresManualAction: { id: string; jobId: string | null }[] = [];
      const errors: string[] = [];
      // Applied, but a follow-up step failed: reported, never rolled back.
      const warnings: string[] = [];

      for (const planningActionId of parsedIds.data) {
        const actionRow = await getPlanningAction(client, {
          id: planningActionId,
          companyId
        });
        if (actionRow.error || !actionRow.data) {
          errors.push(`Planning action ${planningActionId} not found`);
          continue;
        }
        const row = actionRow.data;
        if (row.status !== "Open") {
          errors.push(`Planning action ${planningActionId} is not open`);
          continue;
        }
        if (
          action === "apply"
            ? !changeActionTypes.has(row.type)
            : wireToType[action] !== row.type
        ) {
          errors.push(
            action === "apply"
              ? `Planning action ${planningActionId} is a ${row.type}, which Apply cannot batch`
              : `Planning action ${planningActionId} is a ${row.type}, not ${wireToType[action]}`
          );
          continue;
        }
        if (!row.jobId) {
          errors.push(
            `Planning action ${planningActionId} does not target a job`
          );
          continue;
        }

        const job = await client
          .from("job")
          .select("id, status")
          .eq("id", row.jobId)
          .eq("companyId", companyId)
          .single();
        if (job.error || !job.data) {
          errors.push(`Job for planning action ${planningActionId} not found`);
          continue;
        }

        if (!isJobEditableFromPlanning(job.data.status)) {
          // Past Planned (on the floor, finished, closed or cancelled since
          // MRP ran) — surface "Review on Job" instead of editing it
          requiresManualAction.push({
            id: planningActionId,
            jobId: job.data.id
          });
          continue;
        }

        // Atomic claim BEFORE mutating: the conditional Open→Actioned update
        // is the lock — of two concurrent applies only one sees an affected
        // row, so the target is never double-mutated. A failed mutation
        // reopens the claim; a crash in between leaves an Actioned row whose
        // unmet need the next MRP run re-emits as a fresh Open action (the
        // natural-key index ignores Actioned rows).
        const claim = await markPlanningActionsActioned(client, {
          ids: [planningActionId],
          companyId,
          userId
        });
        if (claim.error) {
          errors.push(
            `Failed to claim planning action ${planningActionId}: ${claim.error.message}`
          );
          continue;
        }
        if ((claim.data ?? []).length === 0) {
          errors.push(
            `Planning action ${planningActionId} was already applied`
          );
          continue;
        }

        if (row.type === "Cancel") {
          // The job status route's cancel: picked material goes back and the
          // job's picking lists close before the status changes.
          const failed = await cancelJob({
            client,
            db: getDatabaseClient(),
            jobId: job.data.id,
            companyId,
            userId
          });
          if (failed) {
            await reopenPlanningActions(client, {
              ids: [planningActionId],
              companyId,
              userId
            });
            errors.push(
              `Failed to cancel job for planning action ${planningActionId}: ${failed.message}`
            );
            continue;
          }
        } else if (row.type === "Expedite" || row.type === "Defer") {
          const update = await updateJob(client, {
            id: job.data.id,
            updatedBy: userId,
            dueDate: row.suggestedDate
          });
          if (update.error) {
            await reopenPlanningActions(client, {
              ids: [planningActionId],
              companyId,
              userId
            });
            errors.push(
              `Failed to reschedule job for planning action ${planningActionId}: ${update.error.message}`
            );
            continue;
          }
          const notified = await notifyScheduleChange(
            companyId,
            "Planning action rescheduled a job",
            job.data.id
          );
          if (!notified) {
            warnings.push(
              `Planning action ${planningActionId}: the due date is saved, but the schedule was not refreshed`
            );
          }
        } else {
          const update = await updateJob(client, {
            id: job.data.id,
            updatedBy: userId,
            quantity: Number(row.suggestedQuantity)
          });
          if (update.error) {
            await reopenPlanningActions(client, {
              ids: [planningActionId],
              companyId,
              userId
            });
            errors.push(
              `Failed to update job quantity for planning action ${planningActionId}: ${update.error.message}`
            );
            continue;
          }
          const recalc = await recalculateJobRequirements(
            client,
            getDatabaseClient(),
            { id: job.data.id, companyId, userId }
          );
          if (recalc.error) {
            // The quantity change stands (and the action stays Actioned):
            // undoing it would be a second write that can fail the same way.
            logger.error(
              "Failed to recalculate job requirements after a planning action",
              {
                companyId,
                userId,
                jobId: job.data.id,
                planningActionId,
                error: recalc.error
              }
            );
            warnings.push(
              `Planning action ${planningActionId}: the quantity is saved, but the job's materials and operations were not recalculated`
            );
          }
        }

        applied.push(planningActionId);
      }

      // Committed targets are not failures, but "Applied 0" with a success
      // toast is a lie — surface the manual-review count, and only report
      // success when something was actually applied (or nothing needed review).
      const manualCount = requiresManualAction.length;
      const messageParts = [
        `Applied ${applied.length} planning action${applied.length === 1 ? "" : "s"}`
      ];
      if (manualCount > 0) {
        messageParts.push(
          `${manualCount} target${manualCount === 1 ? " is" : "s are"} committed — review on the order`
        );
      }
      if (warnings.length > 0) {
        messageParts.push(`${warnings.length} need a follow-up`);
      }
      if (errors.length > 0) {
        messageParts.push(`${errors.length} failed`);
      }
      return {
        success:
          errors.length === 0 &&
          warnings.length === 0 &&
          !(applied.length === 0 && manualCount > 0),
        message: messageParts.join("; "),
        applied,
        requiresManualAction,
        warnings: warnings.length > 0 ? warnings : undefined,
        errors: errors.length > 0 ? errors : undefined
      };
    }

    // ── Worklist mutations: dismiss suppresses a persisting need until it
    // changes materially; assign sets assigneeOverridden so the next MRP
    // diff-write never re-resolves the owner from the ladder.
    case "dismiss": {
      const parsedIds = z
        .array(z.string().min(1))
        .min(1)
        .safeParse(planningActionIds);
      if (!parsedIds.success) {
        return data(
          { success: false, message: "planningActionIds is required" },
          { status: 500 }
        );
      }
      const result = await dismissPlanningActions(client, {
        ids: parsedIds.data,
        companyId,
        userId
      });
      if (result.error) {
        return data(
          { success: false, message: "Failed to dismiss planning actions" },
          { status: 500 }
        );
      }
      return {
        success: true,
        message: `Dismissed ${parsedIds.data.length} planning action${parsedIds.data.length === 1 ? "" : "s"}`
      };
    }
    case "reopen": {
      const parsedIds = z
        .array(z.string().min(1))
        .min(1)
        .safeParse(planningActionIds);
      if (!parsedIds.success) {
        return data(
          { success: false, message: "planningActionIds is required" },
          { status: 500 }
        );
      }
      const result = await reopenDismissedPlanningActions(client, {
        ids: parsedIds.data,
        companyId,
        userId
      });
      if (result.error) {
        return data(
          { success: false, message: "Failed to reopen planning actions" },
          { status: 500 }
        );
      }
      return {
        success: true,
        message: `Reopened ${parsedIds.data.length} planning action${parsedIds.data.length === 1 ? "" : "s"}`
      };
    }
    case "assign": {
      const parsedIds = z
        .array(z.string().min(1))
        .min(1)
        .safeParse(planningActionIds);
      if (!parsedIds.success) {
        return data(
          { success: false, message: "planningActionIds is required" },
          { status: 500 }
        );
      }
      const parsedAssignee = z
        .string()
        .optional()
        .safeParse(assignee ?? undefined);
      if (!parsedAssignee.success) {
        return data(
          { success: false, message: "Invalid assignee" },
          { status: 500 }
        );
      }
      const result = await assignPlanningActions(client, {
        ids: parsedIds.data,
        companyId,
        assignee: parsedAssignee.data || null,
        userId
      });
      if (result.error) {
        return data(
          { success: false, message: "Failed to assign planning actions" },
          { status: 500 }
        );
      }
      return {
        success: true,
        message: `Assigned ${parsedIds.data.length} planning action${parsedIds.data.length === 1 ? "" : "s"}`
      };
    }

    default:
      return data(
        {
          success: false,
          message: `Unknown action '${action}'. Expected one of: 'order', 'expedite', 'defer', 'increase', 'decrease', 'cancel'`
        },
        { status: 500 }
      );
  }
}
