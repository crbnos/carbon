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
  markPlanningActionsActioned,
  notifyScheduleInputsChanged,
  productionOrderValidator,
  recalculateJobRequirements,
  updateJob,
  updateJobStatus,
  upsertJobMethod
} from "~/modules/production";

const logger = getLogger("erp", "production", "planning");

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

  const { items, action, locationId, planningActionIds, assignee } =
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

              const upsertMethod = await upsertJobMethod(client, "itemToJob", {
                sourceId: item.id,
                targetId: id,
                companyId,
                userId
              });

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
                .eq("id", order.existingId);

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
            await recalculateJobRequirements(client, {
              id: jobId,
              companyId,
              userId
            });
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
          processedItems === itemsToOrder.length
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

    // ── Apply a persisted planning action to its target job (spec §P1.5).
    // IDOR guard: the request carries ONLY planningActionIds — the type, target
    // and proposal values come from the persisted row, loaded by id+companyId
    // and required to be Open. The commitment gate re-reads the job status; a
    // released job (Ready or later) is never silently edited. Job dates flow
    // through updateJob (recomputes priority) + notifyScheduleInputsChanged —
    // never jobOperation date writes.
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

      const COMMITTED_JOB_STATUSES = ["Ready", "In Progress", "Paused"];

      const applied: string[] = [];
      const requiresManualAction: { id: string; jobId: string | null }[] = [];
      const errors: string[] = [];

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
        if (wireToType[action] !== row.type) {
          errors.push(
            `Planning action ${planningActionId} is a ${row.type}, not ${wireToType[action]}`
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

        if (
          !job.data.status ||
          COMMITTED_JOB_STATUSES.includes(job.data.status)
        ) {
          // released to the floor — surface "Review on Job" instead of editing
          requiresManualAction.push({
            id: planningActionId,
            jobId: job.data.id
          });
          continue;
        }

        if (action === "cancel") {
          const cancel = await updateJobStatus(client, {
            id: job.data.id,
            companyId,
            status: "Cancelled",
            updatedBy: userId
          });
          if (cancel.error) {
            errors.push(
              `Failed to cancel job for planning action ${planningActionId}: ${cancel.error.message}`
            );
            continue;
          }
        } else if (action === "expedite" || action === "defer") {
          const update = await updateJob(client, {
            id: job.data.id,
            updatedBy: userId,
            dueDate: row.suggestedDate
          });
          if (update.error) {
            errors.push(
              `Failed to reschedule job for planning action ${planningActionId}: ${update.error.message}`
            );
            continue;
          }
          await notifyScheduleInputsChanged(
            companyId,
            "reorder",
            "Planning action rescheduled a job",
            job.data.id
          );
        } else {
          const update = await updateJob(client, {
            id: job.data.id,
            updatedBy: userId,
            quantity: Number(row.suggestedQuantity)
          });
          if (update.error) {
            errors.push(
              `Failed to update job quantity for planning action ${planningActionId}: ${update.error.message}`
            );
            continue;
          }
          await recalculateJobRequirements(client, {
            id: job.data.id,
            companyId,
            userId
          });
        }

        const mark = await markPlanningActionsActioned(client, {
          ids: [planningActionId],
          companyId,
          userId
        });
        if (mark.error) {
          errors.push(
            `Applied but failed to mark planning action ${planningActionId} actioned: ${mark.error.message}`
          );
          continue;
        }
        applied.push(planningActionId);
      }

      return {
        success: errors.length === 0,
        message:
          errors.length === 0
            ? `Applied ${applied.length} planning action${applied.length === 1 ? "" : "s"}`
            : `Applied ${applied.length}; ${errors.length} failed`,
        applied,
        requiresManualAction,
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
