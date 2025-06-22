import { requirePermissions } from "@carbon/auth/auth.server";
import { tasks } from "@trigger.dev/sdk/v3";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { z } from "zod";
import { orderValidator } from "~/modules/items/items.models";
import { upsertJob, upsertJobMethod } from "~/modules/production";
import { getNextSequence } from "~/modules/settings/settings.service";

const itemValidator = z
  .object({
    id: z.string(),
    orders: z.array(orderValidator),
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
      const parsedItems = itemValidator.safeParse(items);

      if (!parsedItems.success) {
        return json({ success: false, message: "Invalid form data" });
      }

      const itemsToOrder = parsedItems.data;
      if (itemsToOrder.length === 0) {
        return json({ success: false, message: "No items to order" });
      }

      if (itemsToOrder.length === 1) {
        let jobIds: string[] = [];
        let supplyForecastByPeriod: Record<string, number> = {};
        const item = itemsToOrder[0];
        const orders = item.orders;

        const manufacturing = await client
          .from("itemReplenishment")
          .select(
            "manufacturingBlocked, scrapPercentage, requiresConfiguration"
          )
          .eq("itemId", item.id)
          .single();

        if (manufacturing.error) {
          return json({
            success: false,
            message: "Failed to get manufacturing data",
          });
        }

        if (manufacturing.data?.manufacturingBlocked) {
          return json({
            success: false,
            message: "Manufacturing is blocked for this item",
          });
        }

        if (manufacturing.data?.requiresConfiguration) {
          return json({
            success: false,
            message: "Manufacturing requires configuration",
          });
        }

        for await (const order of orders) {
          if (!order.existingId) {
            const nextSequence = await getNextSequence(
              client,
              "job",
              companyId
            );
            if (nextSequence.error) {
              return json({
                success: false,
                message: "Failed to get next sequence",
              });
            }

            const jobId = nextSequence.data;
            if (!jobId) {
              return json({
                success: false,
                message: "Failed to get job ID",
              });
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
              return json({
                success: false,
                message: "Failed to create job",
              });
            }

            const id = createJob.data?.id;
            if (!id) {
              return json({
                success: false,
                message: "Failed to get created job ID",
              });
            }

            const upsertMethod = await upsertJobMethod(client, "itemToJob", {
              sourceId: item.id,
              targetId: id,
              companyId,
              userId,
            });

            if (upsertMethod.error) {
              return json({
                success: false,
                message: "Failed to create job method",
              });
            }

            jobIds.push(id);
          } else {
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
              console.error("Failed to update job", updateJob.error);
              return json({
                success: false,
                message: "Failed to update job",
              });
            }
          }

          // Track supply forecast by period
          const periodId = order.periodId;
          supplyForecastByPeriod[periodId] =
            (supplyForecastByPeriod[periodId] || 0) +
            (order.quantity - (order.existingQuantity ?? 0));
        }

        await Promise.all([
          tasks.batchTrigger(
            "recalculate",
            jobIds.map((id) => ({
              payload: {
                type: "jobRequirements",
                id,
                companyId,
                userId,
              },
            }))
          ),
          client.from("supplyForecast").insert(
            Object.entries(supplyForecastByPeriod).map(
              ([periodId, quantity]) => ({
                itemId: item.id,
                locationId,
                sourceType: "Production Order" as const,
                forecastQuantity: quantity,
                periodId,
                companyId,
                createdBy: userId,
                updatedBy: userId,
              })
            )
          ),
        ]);
      } else {
        // TODO: Implement multiple item order
      }

      return json({ success: true, message: "Orders submitted" });
    default:
      return json({ success: false, message: "Invalid field" });
  }
}
