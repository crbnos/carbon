import { requirePermissions } from "@carbon/auth/auth.server";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { z } from "zod";
import { getDefaultShelfForJob } from "~/modules/inventory";
import {
  productionOrderValidator,
  recalculateJobRequirements,
  upsertJob,
  upsertJobMethod,
} from "~/modules/production";
import { getNextSequence } from "~/modules/settings/settings.service";

export const config = {
  maxDuration: 300,
};

const itemsValidator = z
  .object({
    id: z.string(),
    orders: z.array(productionOrderValidator),
  })
  .array();

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production",
    role: "employee",
    bypassRls: true,
  });

  const { items, action, locationId } = await request.json();

  if (typeof locationId !== "string") {
    return json(
      {
        success: false,
        message: "Location ID is required and must be a valid string",
      },
      { status: 500 }
    );
  }

  if (typeof action !== "string") {
    return json(
      {
        success: false,
        message: "Action parameter is required and must be a valid string",
      },
      { status: 500 }
    );
  }

  switch (action) {
    case "order":
      const parsedItems = itemsValidator.safeParse(items);

      if (!parsedItems.success) {
        const errorMessages = parsedItems.error.errors.map((error) => {
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

        console.error("Validation errors:", parsedItems.error.errors);
        return json(
          {
            success: false,
            message: `Validation failed: ${errorMessages.join(", ")}`,
            errors: errorMessages,
          },
          { status: 500 }
        );
      }

      const itemsToOrder = parsedItems.data;
      if (itemsToOrder.length === 0) {
        return json(
          {
            success: false,
            message: "No items were provided to create production orders",
          },
          { status: 500 }
        );
      }

      try {
        const allJobIds: string[] = [];
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
            console.error(errorMsg);
            errors.push(errorMsg);
            continue;
          }

          if (manufacturing.data?.manufacturingBlocked) {
            const errorMsg = `Manufacturing is blocked for item ${item.id}`;
            console.warn(errorMsg);
            errors.push(errorMsg);
            continue;
          }

          if (manufacturing.data?.requiresConfiguration) {
            const errorMsg = `Manufacturing requires configuration for item ${item.id}`;
            console.warn(errorMsg);
            errors.push(errorMsg);
            continue;
          }

          let itemProcessed = false;

          // Process each order for this item
          for (const order of orders) {
            if (!order.existingId) {
              // Create new job
              const nextSequence = await getNextSequence(
                client,
                "job",
                companyId
              );
              if (nextSequence.error) {
                const errorMsg = `Failed to generate job sequence for item ${item.id}: ${nextSequence.error.message}`;
                console.error(errorMsg);
                errors.push(errorMsg);
                continue;
              }

              const jobId = nextSequence.data;
              if (!jobId) {
                const errorMsg = `Failed to generate job ID for item ${item.id}`;
                console.error(errorMsg);
                errors.push(errorMsg);
                continue;
              }

              const shelfId = await getDefaultShelfForJob(
                client,
                item.id,
                locationId,
                companyId
              );

              const createJob = await upsertJob(
                client,
                {
                  itemId: item.id,
                  jobId,
                  quantity: order.quantity,
                  scrapQuantity: Math.ceil(
                    order.quantity * (manufacturing.data?.scrapPercentage ?? 0)
                  ),
                  startDate: order.startDate ?? undefined,
                  dueDate: order.dueDate ?? undefined,
                  deadlineType: order.isASAP ? "ASAP" : "Soft Deadline",
                  locationId,
                  shelfId: shelfId ?? undefined,
                  companyId,
                  createdBy: userId,
                  unitOfMeasureCode: "EA",
                },
                "Planned"
              );

              if (createJob.error) {
                const errorMsg = `Failed to create job for item ${item.id}: ${createJob.error.message}`;
                console.error(errorMsg);
                errors.push(errorMsg);
                continue;
              }

              const id = createJob.data?.id;
              if (!id) {
                const errorMsg = `Job was not returned after creation for item ${item.id}`;
                console.error(errorMsg);
                errors.push(errorMsg);
                continue;
              }

              const upsertMethod = await upsertJobMethod(client, "itemToJob", {
                sourceId: item.id,
                targetId: id,
                companyId,
                userId,
              });

              if (upsertMethod.error) {
                const errorMsg = `Failed to create job method for item ${item.id}: ${upsertMethod.error.message}`;
                console.error(errorMsg);
                errors.push(errorMsg);
                continue;
              }

              jobIds.push(id);
              itemProcessed = true;
            } else {
              // Update existing job
              jobIds.push(order.existingId);
              const updateJob = await client
                .from("job")
                .update({
                  dueDate: order.dueDate ?? undefined,
                  deadlineType: order.isASAP ? "ASAP" : "Soft Deadline",
                  quantity: order.quantity,
                  scrapQuantity: Math.ceil(
                    order.quantity * (manufacturing.data?.scrapPercentage ?? 0)
                  ),
                  startDate: order.startDate ?? undefined,
                  status: "Planned",
                  updatedAt: new Date().toISOString(),
                  updatedBy: userId,
                })
                .eq("id", order.existingId);

              if (updateJob.error) {
                const errorMsg = `Failed to update job ${order.existingId} for item ${item.id}: ${updateJob.error.message}`;
                console.error(errorMsg);
                errors.push(errorMsg);
                continue;
              }

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
                  updatedBy: userId,
                });
              }
            );
          }
        }

        // Insert all supply forecasts
        if (allSupplyForecasts.length > 0) {
          const insertForecasts = await client
            .from("supplyForecast")
            .insert(allSupplyForecasts);

          if (insertForecasts.error) {
            const errorMsg = `Failed to insert supply forecasts: ${insertForecasts.error.message}`;
            console.error(errorMsg);
            errors.push(errorMsg);
          }
        }

        // Trigger recalculation for all jobs
        if (allJobIds.length > 0) {
          for (const jobId of allJobIds) {
            await recalculateJobRequirements(client, {
              id: jobId,
              companyId,
              userId,
            });
          }
        }

        if (errors.length > 0 && processedItems === 0) {
          return json(
            {
              success: false,
              message: `Failed to process any items. Errors: ${errors
                .slice(0, 3)
                .join("; ")}${
                errors.length > 3 ? ` and ${errors.length - 3} more...` : ""
              }`,
              errors: errors,
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

        return json({
          success: processedItems > 0,
          message,
          processedItems,
          totalItems: itemsToOrder.length,
          errors: errors.length > 0 ? errors : undefined,
        });
      } catch (error) {
        console.error("Unexpected error processing production orders:", error);
        return json(
          {
            success: false,
            message: `Unexpected error occurred while processing production orders: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          },
          { status: 500 }
        );
      }

    default:
      return json(
        {
          success: false,
          message: `Unknown action '${action}'. Expected action: 'order'`,
        },
        { status: 500 }
      );
  }
}
