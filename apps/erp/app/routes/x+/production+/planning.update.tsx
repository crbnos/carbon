// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import { async } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import {
  applyProductionPlanningDateActions,
  assignPlanningActions,
  dismissPlanningActions,
  getPlanningActionsByIds,
  insertJob,
  isJobEditableFromPlanning,
  markPlanningActionsActioned,
  notifyScheduleInputsChanged,
  PLANNING_EDITABLE_JOB_STATUSES,
  productionOrderValidator,
  recalculateJobRequirements,
  releasePlanningActionClaim,
  reopenDismissedPlanningActions,
  settleNewSupplyPlanningActions,
  updatePlanningJob,
  upsertJobMethod
} from "~/modules/production";
import {
  cancelJob,
  planDraftJob
} from "~/modules/production/production.server";
import { isActiveCompanyEmployee } from "~/modules/shared/shared.server";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "production", "planning");

type PlanningActionRow = NonNullable<
  Awaited<ReturnType<typeof getPlanningActionsByIds>>["data"]
>[number];

// Telling the scheduler is a follow-up to a write that already landed, so its
// failure is logged and reported, never thrown: a throw here used to end an
// Apply loop with a 500 after earlier actions were already applied.
async function notifyScheduleChange(
  companyId: string,
  reason: string,
  jobId?: string
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
  const { items, action, locationId, planningActionIds, assignee, job } =
    await request.json();

  // Creating planned jobs is `create`; everything else here changes jobs and
  // actions that already exist (apply, inline edits, dismiss, reopen, assign),
  // which the job screens gate on `update`. The client is the service role, so
  // this check is the only one.
  const { client, companyId, userId } = await requirePermissions(request, {
    ...(action === "order"
      ? { create: "production" }
      : { update: "production" }),
    role: "employee",
    bypassRls: true
  });

  if (typeof locationId !== "string") {
    return data(
      {
        success: false,
        message: "Location ID is required and must be a valid string"
      },
      { status: 400 }
    );
  }

  if (typeof action !== "string") {
    return data(
      {
        success: false,
        message: "Action parameter is required and must be a valid string"
      },
      { status: 400 }
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
          { status: 400 }
        );
      }

      const itemsToOrder = parsedItems.data;
      if (itemsToOrder.length === 0) {
        return data(
          {
            success: false,
            message: "No items were provided to create production orders"
          },
          { status: 400 }
        );
      }

      // `order` only creates jobs. An existing job is edited through
      // `updateJob` or Apply, which carry the Draft / Planned guard, the
      // location check and the priority recalculation; this path had none.
      if (itemsToOrder.some((item) => item.orders.some((o) => o.existingId))) {
        logger.warn("Planning order named an existing job", {
          companyId,
          userId,
          locationId
        });
        return data(
          {
            success: false,
            message: "Existing jobs are changed from the Open Jobs list"
          },
          { status: 400 }
        );
      }

      // `client` is the service role (bypassRls) and every id below comes from
      // the request body: prove the location and items are this company's
      // before any job is created. One query per type.
      const itemIds = [...new Set(itemsToOrder.map((item) => item.id))];
      const [ownedLocation, ownedItems] = await Promise.all([
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
          .eq("companyId", companyId)
      ]);
      if (
        ownedLocation.error ||
        !ownedLocation.data ||
        ownedItems.error ||
        (ownedItems.data ?? []).length !== itemIds.length
      ) {
        logger.error("Planning order references records outside the company", {
          companyId,
          locationId,
          itemIds,
          error: ownedLocation.error ?? ownedItems.error
        });
        return data({ success: false, message: "Not found" }, { status: 404 });
      }

      try {
        const allJobIds: string[] = [];
        const createdJobs: { id: string; readableId: string }[] = [];
        const itemsWithoutOrders: string[] = [];
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
        // The (item, week) of every order that became a job, so the Make
        // suggestions it answers leave the worklist now, not at the next run.
        const ordered: { itemId: string; periodId: string }[] = [];

        // Manufacturing data for every item being ordered, in one read
        const manufacturingRows = await client
          .from("itemReplenishment")
          .select("itemId, manufacturingBlocked, requiresConfiguration")
          .in(
            "itemId",
            itemsToOrder.flatMap((item) =>
              item.orders.length > 0 ? [item.id] : []
            )
          )
          .eq("companyId", companyId);
        const manufacturingByItem = new Map(
          (manufacturingRows.data ?? []).map((row) => [row.itemId, row])
        );

        for (const item of itemsToOrder) {
          const orders = item.orders;

          // Nothing to make for this item — existing supply already covers demand
          if (orders.length === 0) {
            itemsWithoutOrders.push(item.id);
            continue;
          }

          const jobIds: string[] = [];
          const supplyForecastByPeriod: Record<string, number> = {};

          const manufacturing = {
            data: manufacturingByItem.get(item.id),
            error:
              manufacturingRows.error ??
              (manufacturingByItem.has(item.id)
                ? null
                : { message: "No replenishment record" })
          };

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

            // Track supply forecast by period
            const periodId = order.periodId;
            ordered.push({ itemId: item.id, periodId });
            supplyForecastByPeriod[periodId] =
              (supplyForecastByPeriod[periodId] || 0) + order.quantity;
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

        const settled = await settleNewSupplyPlanningActions(
          getDatabaseClient(),
          { companyId, locationId, userId, type: "Make", ordered }
        );
        if (settled.error) {
          // The jobs stand; the suggestions clear on the next MRP run.
          logger.error("Failed to settle ordered planning actions", {
            companyId,
            userId,
            locationId,
            error: settled.error
          });
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

      const saved = await updatePlanningJob(client, {
        id: target.data.id,
        companyId,
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
      if (!saved.updated) {
        // Released (or finished) after the status check above.
        return data(
          {
            success: false,
            message:
              "This job is no longer Draft or Planned. Change it on the job."
          },
          { status: 409 }
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

    // ── Promote a Draft job to Planned (the drawer's Plan button). MRP does
    // not count a Draft job as supply; once Planned it does, and the run
    // inside planDraftJob shrinks the Make suggestion by it. Only this
    // location's make-to-stock Draft jobs: the drawer lists nothing else, and
    // a job a sales order owns is that order's, not planning's.
    case "planJob": {
      const parsedJob = z.object({ id: z.string().min(1) }).safeParse(job);
      if (!parsedJob.success) {
        return data(
          { success: false, message: "A job id is required" },
          { status: 400 }
        );
      }

      const target = await client
        .from("job")
        .select("id, status, locationId, salesOrderId, salesOrderLineId")
        .eq("id", parsedJob.data.id)
        .eq("companyId", companyId)
        .maybeSingle();
      if (target.error || !target.data) {
        return data(
          { success: false, message: "Job not found" },
          { status: 404 }
        );
      }
      if (target.data.locationId !== locationId) {
        return data(
          { success: false, message: "This job is for another location." },
          { status: 409 }
        );
      }
      if (target.data.salesOrderId || target.data.salesOrderLineId) {
        return data(
          {
            success: false,
            message: "This job is for a sales order. Plan it on the job."
          },
          { status: 409 }
        );
      }
      if (target.data.status !== "Draft") {
        return data(
          { success: false, message: "Only a Draft job can be planned." },
          { status: 409 }
        );
      }

      const planned = await planDraftJob({
        client,
        db: getDatabaseClient(),
        jobId: target.data.id,
        companyId,
        userId
      });
      if (planned.error) {
        return data(
          { success: false, message: planned.error },
          { status: 500 }
        );
      }
      if (!planned.updated) {
        // Changed by someone else after the status check above.
        return data(
          { success: false, message: "Only a Draft job can be planned." },
          { status: 409 }
        );
      }
      return {
        success: true,
        message: "Planned job",
        ...(planned.warning && { warning: planned.warning })
      };
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
      // The same id twice (a row selected in two places) is one action.
      const parsedIds = z
        .array(z.string().min(1))
        .min(1)
        .transform((ids) => [...new Set(ids)])
        .safeParse(planningActionIds);
      if (!parsedIds.success) {
        return data(
          { success: false, message: "planningActionIds is required" },
          { status: 400 }
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

      const db = getDatabaseClient();
      const applied: string[] = [];
      const requiresManualAction: { id: string; jobId: string | null }[] = [];
      const errors: string[] = [];
      // Applied, but a follow-up step failed: reported, never rolled back.
      const warnings: string[] = [];

      // A claim that is not given back leaves the action Actioned with nothing
      // applied, so a failed release is reported, never swallowed.
      const releaseClaim = async (planningActionId: string) => {
        const released = await releasePlanningActionClaim(client, {
          id: planningActionId,
          companyId,
          userId
        });
        if (released.error) {
          logger.error("Failed to release a planning action claim", {
            companyId,
            planningActionId,
            error: released.error
          });
          errors.push(
            `Planning action ${planningActionId} could not be reopened: ${released.error}`
          );
        }
      };

      // Two reads for the whole batch, then one claim and one change per
      // action: each job gets its own value, and a cancel has several steps.
      // The batch used to read the action and read its job one at a time —
      // three round trips per action before anything changed.
      const actionRows = await getPlanningActionsByIds(db, {
        ids: parsedIds.data,
        companyId
      });
      if (actionRows.error) {
        logger.error("Failed to read planning actions", {
          companyId,
          error: actionRows.error
        });
        return data(
          { success: false, message: "Failed to read planning actions" },
          { status: 500 }
        );
      }
      const rowById = new Map(actionRows.data.map((row) => [row.id, row]));

      const eligible: { planningActionId: string; row: PlanningActionRow }[] =
        [];
      for (const planningActionId of parsedIds.data) {
        const row = rowById.get(planningActionId);
        if (!row) {
          errors.push(`Planning action ${planningActionId} not found`);
          continue;
        }
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
        eligible.push({ planningActionId, row });
      }

      // One statement, like the reads above: the id list goes to Postgres as a
      // parameter, never into a PostgREST URL.
      const jobIds = [...new Set(eligible.map(({ row }) => row.jobId!))];
      let jobStatusById: Map<string, Database["public"]["Enums"]["jobStatus"]>;
      try {
        const jobs =
          jobIds.length > 0
            ? await db
                .selectFrom("job")
                .select(["id", "status"])
                .where("id", "in", jobIds)
                .where("companyId", "=", companyId)
                .execute()
            : [];
        jobStatusById = new Map(jobs.map((job) => [job.id, job.status]));
      } catch (err) {
        logger.error("Failed to read jobs for planning actions", {
          companyId,
          error: err
        });
        return data(
          {
            success: false,
            message: "Failed to read the planning actions' jobs"
          },
          { status: 500 }
        );
      }

      const toClaim: { planningActionId: string; row: PlanningActionRow }[] =
        [];
      for (const target of eligible) {
        const jobId = target.row.jobId!;
        const status = jobStatusById.get(jobId);
        if (status === undefined) {
          errors.push(
            `Job for planning action ${target.planningActionId} not found`
          );
          continue;
        }
        if (!isJobEditableFromPlanning(status)) {
          // Past Planned (on the floor, finished, closed or cancelled since
          // MRP ran) — surface "Review on Job" instead of editing it
          requiresManualAction.push({ id: target.planningActionId, jobId });
          continue;
        }
        toClaim.push(target);
      }

      // Dates: ONE transaction for every Expedite / Defer — the claim, two
      // reads and one UPDATE for the whole batch, then ONE scheduler event
      // (a "reorder" event re-stamps the whole company whatever its job id;
      // one per action sent the same company-wide replan N times).
      const dateActions = toClaim.filter(
        ({ row }) =>
          (row.type === "Expedite" || row.type === "Defer") && row.suggestedDate
      );
      if (dateActions.length > 0) {
        let outcome: Awaited<
          ReturnType<typeof applyProductionPlanningDateActions>
        >;
        try {
          outcome = await applyProductionPlanningDateActions(db, {
            companyId,
            userId,
            actions: dateActions.map(({ planningActionId, row }) => ({
              planningActionId,
              jobId: row.jobId!,
              suggestedDate: row.suggestedDate
            }))
          });
        } catch (err) {
          logger.error("Failed to reschedule jobs for planning actions", {
            companyId,
            userId,
            planningActionIds: dateActions.map((t) => t.planningActionId),
            error: err
          });
          return data(
            {
              success: false,
              message: `Failed to reschedule jobs: ${
                err instanceof Error ? err.message : "unknown error"
              }`
            },
            { status: 500 }
          );
        }
        applied.push(...outcome.applied);
        requiresManualAction.push(...outcome.refused);
        for (const id of outcome.alreadyApplied) {
          errors.push(`Planning action ${id} was already applied`);
        }
        if (outcome.applied.length > 0) {
          const notified = await notifyScheduleChange(
            companyId,
            `Planning rescheduled ${outcome.applied.length} job(s)`
          );
          if (!notified) {
            warnings.push(
              `${outcome.applied.length} due date(s) are saved, but the schedule was not refreshed`
            );
          }
        }
      }

      // Quantities and cancels call server functions with their own
      // transactions (recalculate, the cancel sweep), so they stay one job at
      // a time — but a few jobs at once, since each targets a different job.
      // Each action is claimed right before its own change: a request that
      // dies here strands at most the actions in flight, which the next MRP
      // run re-emits as fresh Open actions (the natural-key index ignores
      // Actioned rows).
      // Resolves to the claimed suggestion (see claimPlanningActions), or
      // null when the claim did not land.
      const claim = async (
        planningActionId: string
      ): Promise<{ suggestedQuantity: number | null } | null> => {
        const claimed = await markPlanningActionsActioned(db, {
          ids: [planningActionId],
          companyId,
          userId
        });
        if (claimed.error) {
          logger.error("Failed to claim a planning action", {
            companyId,
            planningActionId,
            error: claimed.error
          });
          errors.push(
            `Planning action ${planningActionId} could not be claimed: ${claimed.error.message}`
          );
          return null;
        }
        const [row] = claimed.data;
        if (!row) {
          errors.push(
            `Planning action ${planningActionId} was already applied`
          );
          return null;
        }
        return {
          suggestedQuantity:
            row.suggestedQuantity === null ||
            row.suggestedQuantity === undefined
              ? null
              : Number(row.suggestedQuantity)
        };
      };

      const perJobActions = toClaim.filter(
        ({ row }) =>
          row.type === "Cancel" ||
          row.type === "Increase" ||
          row.type === "Decrease"
      );
      // Two actions on one job (an Increase and a Cancel) must not run at
      // once: group by job, run the groups 3 at a time, each group in order.
      const byJob = new Map<string, typeof perJobActions>();
      for (const target of perJobActions) {
        const list = byJob.get(target.row.jobId!) ?? [];
        list.push(target);
        byJob.set(target.row.jobId!, list);
      }
      await async.map(
        [...byJob.values()],
        async (group) => {
          for (const { planningActionId, row } of group) {
            const claimedRow = await claim(planningActionId);
            if (!claimedRow) continue;
            const jobId = row.jobId!;

            if (row.type === "Cancel") {
              // The job status route's cancel: picked material goes back and
              // the job's picking lists close before the status changes.
              const failed = await cancelJob({
                client,
                db,
                jobId,
                companyId,
                userId,
                // Read Draft / Planned above; released since, it goes to review
                // instead of losing its picks.
                fromStatuses: [...PLANNING_EDITABLE_JOB_STATUSES]
              });
              if (failed?.refused) {
                await releaseClaim(planningActionId);
                requiresManualAction.push({ id: planningActionId, jobId });
                continue;
              }
              if (failed) {
                await releaseClaim(planningActionId);
                errors.push(
                  `Failed to cancel job for planning action ${planningActionId}: ${failed.message}`
                );
                continue;
              }
            } else {
              const update = await updatePlanningJob(client, {
                id: jobId,
                companyId,
                updatedBy: userId,
                quantity: Number(
                  claimedRow.suggestedQuantity ?? row.suggestedQuantity
                )
              });
              if (update.error) {
                await releaseClaim(planningActionId);
                errors.push(
                  `Failed to update job quantity for planning action ${planningActionId}: ${update.error.message}`
                );
                continue;
              }
              if (!update.updated) {
                // Released (or finished) since it was read.
                await releaseClaim(planningActionId);
                requiresManualAction.push({ id: planningActionId, jobId });
                continue;
              }
              const recalc = await recalculateJobRequirements(client, db, {
                id: jobId,
                companyId,
                userId
              });
              if (recalc.error) {
                // The quantity change stands (and the action stays Actioned):
                // undoing it would be a second write that can fail the same way.
                logger.error(
                  "Failed to recalculate job requirements after a planning action",
                  {
                    companyId,
                    userId,
                    jobId,
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
        },
        { concurrency: 3 }
      );

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
      // The same id twice (a row selected in two places) is one action.
      const parsedIds = z
        .array(z.string().min(1))
        .min(1)
        .transform((ids) => [...new Set(ids)])
        .safeParse(planningActionIds);
      if (!parsedIds.success) {
        return data(
          { success: false, message: "planningActionIds is required" },
          { status: 400 }
        );
      }
      const result = await dismissPlanningActions(getDatabaseClient(), {
        ids: parsedIds.data,
        companyId,
        userId,
        kind: "Make"
      });
      if (result.error) {
        logger.error("Failed to dismiss planning actions", {
          companyId,
          userId,
          planningActionIds: parsedIds.data,
          error: result.error
        });
        return data(
          { success: false, message: "Failed to dismiss planning actions" },
          { status: 500 }
        );
      }
      // The rows actually changed: an action applied or changed since the
      // page loaded is skipped, and the count says so.
      const changed = result.data?.length ?? 0;
      if (changed === 0) {
        return {
          success: false,
          message:
            "Nothing to dismiss — these actions changed since the page loaded"
        };
      }
      return {
        success: true,
        message: `Dismissed ${changed} planning action${changed === 1 ? "" : "s"}${
          changed < parsedIds.data.length
            ? `; ${parsedIds.data.length - changed} changed since the page loaded`
            : ""
        }`
      };
    }
    case "reopen": {
      // The same id twice (a row selected in two places) is one action.
      const parsedIds = z
        .array(z.string().min(1))
        .min(1)
        .transform((ids) => [...new Set(ids)])
        .safeParse(planningActionIds);
      if (!parsedIds.success) {
        return data(
          { success: false, message: "planningActionIds is required" },
          { status: 400 }
        );
      }
      const result = await reopenDismissedPlanningActions(getDatabaseClient(), {
        ids: parsedIds.data,
        companyId,
        userId,
        kind: "Make"
      });
      if (result.error) {
        logger.error("Failed to reopen planning actions", {
          companyId,
          userId,
          planningActionIds: parsedIds.data,
          error: result.error
        });
        return data(
          { success: false, message: "Failed to reopen planning actions" },
          { status: 500 }
        );
      }
      // The rows actually changed: an action applied or changed since the
      // page loaded is skipped, and the count says so.
      const changed = result.data?.length ?? 0;
      if (changed === 0) {
        return {
          success: false,
          message:
            "Nothing to reopen — these actions changed since the page loaded"
        };
      }
      return {
        success: true,
        message: `Reopened ${changed} planning action${changed === 1 ? "" : "s"}${
          changed < parsedIds.data.length
            ? `; ${parsedIds.data.length - changed} changed since the page loaded`
            : ""
        }`
      };
    }
    case "assign": {
      // The same id twice (a row selected in two places) is one action.
      const parsedIds = z
        .array(z.string().min(1))
        .min(1)
        .transform((ids) => [...new Set(ids)])
        .safeParse(planningActionIds);
      if (!parsedIds.success) {
        return data(
          { success: false, message: "planningActionIds is required" },
          { status: 400 }
        );
      }
      const parsedAssignee = z
        .string()
        .optional()
        .safeParse(assignee ?? undefined);
      if (!parsedAssignee.success) {
        return data(
          { success: false, message: "Invalid assignee" },
          { status: 400 }
        );
      }
      if (
        parsedAssignee.data &&
        !(await isActiveCompanyEmployee(client, companyId, parsedAssignee.data))
      ) {
        return data(
          { success: false, message: "Choose an employee of this company" },
          { status: 400 }
        );
      }
      const result = await assignPlanningActions(getDatabaseClient(), {
        ids: parsedIds.data,
        companyId,
        assignee: parsedAssignee.data || null,
        userId,
        kind: "Make"
      });
      if (result.error) {
        logger.error("Failed to assign planning actions", {
          companyId,
          userId,
          planningActionIds: parsedIds.data,
          error: result.error
        });
        return data(
          { success: false, message: "Failed to assign planning actions" },
          { status: 500 }
        );
      }
      // The rows actually changed: an action applied or changed since the
      // page loaded is skipped, and the count says so.
      const changed = result.data?.length ?? 0;
      if (changed === 0) {
        return {
          success: false,
          message:
            "Nothing to assign — these actions changed since the page loaded"
        };
      }
      return {
        success: true,
        message: `Assigned ${changed} planning action${changed === 1 ? "" : "s"}${
          changed < parsedIds.data.length
            ? `; ${parsedIds.data.length - changed} changed since the page loaded`
            : ""
        }`
      };
    }

    default:
      return data(
        {
          success: false,
          message: `Unknown action '${action}'. Expected one of: 'order', 'updateJob', 'planJob', 'apply', 'expedite', 'defer', 'increase', 'decrease', 'cancel', 'dismiss', 'reopen', 'assign'`
        },
        { status: 400 }
      );
  }
}
