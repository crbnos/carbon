import { requirePermissions } from "@carbon/auth/auth.server";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { z } from "zod";
import {
  recalculateJobRequirements,
  upsertJob,
  upsertJobMethod,
} from "~/modules/production";
import { plannedOrderValidator } from "~/modules/purchasing/purchasing.models";
import { getNextSequence } from "~/modules/settings/settings.service";

export const config = {
  maxDuration: 300,
};

const itemsValidator = z
  .object({
    id: z.string(),
    orders: z.array(plannedOrderValidator),
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
    return json({ success: false, message: "Location is required" });
  }

  if (typeof action !== "string") {
    return json({ success: false, message: "Invalid form data" });
  }

  switch (action) {
    case "order":
      const parsedItems = itemsValidator.safeParse(items);

      if (!parsedItems.success) {
        return json({ success: false, message: "Invalid form data" });
      }

      const itemsToOrder = parsedItems.data;
      if (itemsToOrder.length === 0) {
        return json({ success: false, message: "No items to order" });
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
            console.error(
              `Failed to get manufacturing data for item ${item.id}:`,
              manufacturing.error
            );
            continue;
          }

          if (manufacturing.data?.manufacturingBlocked) {
            console.warn(`Manufacturing is blocked for item ${item.id}`);
            continue;
          }

          if (manufacturing.data?.requiresConfiguration) {
            console.warn(
              `Manufacturing requires configuration for item ${item.id}`
            );
            continue;
          }

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
                console.error(
                  `Failed to get next sequence for item ${item.id}:`,
                  nextSequence.error
                );
                continue;
              }

              const jobId = nextSequence.data;
              if (!jobId) {
                console.error(`Failed to get job ID for item ${item.id}`);
                continue;
              }

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
                  companyId,
                  createdBy: userId,
                  unitOfMeasureCode: "EA",
                },
                "Planned"
              );

              if (createJob.error) {
                console.error(
                  `Failed to create job for item ${item.id}:`,
                  createJob.error
                );
                continue;
              }

              const id = createJob.data?.id;
              if (!id) {
                console.error(
                  `Failed to get created job ID for item ${item.id}`
                );
                continue;
              }

              const upsertMethod = await upsertJobMethod(client, "itemToJob", {
                sourceId: item.id,
                targetId: id,
                companyId,
                userId,
              });

              if (upsertMethod.error) {
                console.error(
                  `Failed to create job method for item ${item.id}:`,
                  upsertMethod.error
                );
                continue;
              }

              jobIds.push(id);
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
                console.error(
                  `Failed to update job ${order.existingId}:`,
                  updateJob.error
                );
                continue;
              }
            }

            // Track supply forecast by period
            const periodId = order.periodId;
            supplyForecastByPeriod[periodId] =
              (supplyForecastByPeriod[periodId] || 0) +
              (order.quantity - (order.existingQuantity ?? 0));
          }

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

        // Insert all supply forecasts
        if (allSupplyForecasts.length > 0) {
          const insertForecasts = await client
            .from("supplyForecast")
            .insert(allSupplyForecasts);

          if (insertForecasts.error) {
            console.error(
              "Failed to insert supply forecasts:",
              insertForecasts.error
            );
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

        return json({
          success: true,
          message: `Successfully processed ${itemsToOrder.length} items with ${allJobIds.length} jobs`,
        });
      } catch (error) {
        console.error("Error processing production orders:", error);
        return json({
          success: false,
          message: `Error processing production orders: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        });
      }

    default:
      return json({ success: false, message: "Invalid field" });
  }
}
