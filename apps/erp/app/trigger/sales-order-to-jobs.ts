import { getCarbonServiceRole } from "@carbon/auth";
import { parseDate } from "@internationalized/date";
import { task, tasks } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { getItemManufacturing, getItemReplenishment } from "~/modules/items";
import {
  getOpportunity,
  getSalesOrder,
  getSalesOrderLines,
} from "~/modules/sales";
import { getNextSequence } from "~/modules/settings";
import {
  upsertJob,
  upsertJobMethod,
} from "../modules/production/production.service";
import type { recalculateTask } from "./recalculate";

const salesOrderToJobsSchema = z.object({
  orderId: z.string(),
  companyId: z.string(),
  userId: z.string(),
});

export const salesOrderToJobsTask = task({
  id: "sales-order-to-jobs",
  run: async (payload: z.infer<typeof salesOrderToJobsSchema>) => {
    console.info(`🔰 Order: ${payload.orderId}`);
    const { orderId, companyId, userId } = payload;

    const serviceRole = getCarbonServiceRole();
    const [salesOrder, salesOrderLines] = await Promise.all([
      getSalesOrder(serviceRole, orderId),
      getSalesOrderLines(serviceRole, orderId),
    ]);

    if (companyId !== salesOrder.data?.companyId) {
      console.error("Company ID mismatch");
      return;
    }

    if (salesOrder.error) {
      console.error("Failed to get sales order");
      console.error(salesOrder.error);
      return;
    }

    if (salesOrderLines.error) {
      console.log("Failed to get sales order lines");
      console.error(salesOrderLines.error);
      return;
    }

    const lines = salesOrderLines.data;
    if (!lines) {
      console.error("No lines found");
      return;
    }

    const opportunity = await getOpportunity(
      serviceRole,
      salesOrder.data?.opportunityId ?? null
    );
    const quoteId = opportunity.data?.quotes[0]?.id;
    const salesOrderId = opportunity.data?.salesOrders[0]?.id;

    for await (const line of lines) {
      if (line.methodType === "Make" && line.itemId) {
        const itemManufacturing = await getItemManufacturing(
          serviceRole,
          line.itemId,
          companyId
        );

        const lotSize = itemManufacturing.data?.lotSize ?? 0;
        const totalQuantity = line.saleQuantity ?? 0;
        // If lotSize is 0, create a single job with the total quantity
        const totalJobs = lotSize > 0 ? Math.ceil(totalQuantity / lotSize) : 1;

        // Ensure totalJobs is at least 1 to avoid invalid array length
        const jobsToCreate = Math.max(1, totalJobs);

        for await (const index of Array.from({ length: jobsToCreate }).keys()) {
          const [nextSequence, manufacturing] = await Promise.all([
            getNextSequence(serviceRole, "job", companyId),
            getItemReplenishment(serviceRole, line.itemId, companyId),
          ]);
          if (!nextSequence.data) {
            console.error("Failed to get next job id");
            continue;
          }

          // Calculate quantity for this job
          const isLastJob = index === jobsToCreate - 1;
          const jobQuantity =
            lotSize > 0
              ? isLastJob
                ? totalQuantity - lotSize * (jobsToCreate - 1) // Remainder for last job
                : lotSize
              : totalQuantity; // If no lotSize, use total quantity

          const dueDate = line.promisedDate ?? undefined;

          const data = {
            customerId: salesOrder.data?.customerId ?? undefined,
            deadlineType: "Hard Deadline" as const,
            dueDate,
            startDate: dueDate
              ? parseDate(dueDate)
                  .subtract({ days: manufacturing.data?.leadTime ?? 7 })
                  .toString()
              : undefined,
            itemId: line.itemId,
            locationId: line.locationId ?? "",
            modelUploadId: line.modelUploadId ?? undefined,
            quantity: jobQuantity,
            quoteId: quoteId ?? undefined,
            quoteLineId: quoteId ? line.id : undefined,
            salesOrderId: salesOrderId ?? undefined,
            salesOrderLineId: line.id,
            scrapQuantity: 0,
            unitOfMeasureCode: line.unitOfMeasureCode ?? "EA",
          };

          const createJob = await upsertJob(serviceRole, {
            ...data,
            jobId: nextSequence.data,
            companyId,
            createdBy: userId,
          });

          if (createJob.error) {
            console.error("Failed to create job");
            console.error(createJob.error);
            continue;
          }

          if (quoteId) {
            const upsertMethod = await upsertJobMethod(
              serviceRole,
              "quoteLineToJob",
              {
                sourceId: `${quoteId}:${line.id}`,
                targetId: createJob.data.id,
                companyId,
                userId,
              }
            );

            if (upsertMethod.error) {
              console.error("Failed to create job method");
              console.error(upsertMethod.error);
              continue;
            }
          } else {
            const upsertMethod = await upsertJobMethod(
              serviceRole,
              "itemToJob",
              {
                sourceId: data.itemId,
                targetId: createJob.data.id,
                companyId,
                userId,
              }
            );

            if (upsertMethod.error) {
              console.error("Failed to create job method");
              console.error(upsertMethod.error);
              continue;
            }
          }

          await tasks.trigger<typeof recalculateTask>("recalculate", {
            type: "jobRequirements",
            id: createJob.data.id,
            companyId,
            userId,
          });
        }
      }
    }
  },
});
