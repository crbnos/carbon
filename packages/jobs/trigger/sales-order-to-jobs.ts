import { getCarbonServiceRole } from "@carbon/auth";
import { parseDate } from "@internationalized/date";
import { task } from "@trigger.dev/sdk/v3";
import { z } from "zod";

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

    // Implement getSalesOrder
    const salesOrder = await serviceRole
      .from("salesOrder")
      .select("*")
      .eq("id", orderId)
      .single();

    // Implement getSalesOrderLines
    const salesOrderLines = await serviceRole
      .from("salesOrderLines")
      .select("*")
      .eq("salesOrderId", orderId)
      .order("itemReadableId", { ascending: true });

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

    const opportunity = await serviceRole
      .from("opportunity")
      .select("*, quotes(*), salesOrders(*)")
      .eq("id", salesOrder.data?.opportunityId ?? "")
      .single();

    const quoteId = opportunity.data?.quotes[0]?.id;
    const salesOrderId = opportunity.data?.salesOrders[0]?.id;

    for await (const line of lines) {
      if (line.methodType === "Make" && line.itemId) {
        const itemManufacturing = await serviceRole
          .from("itemReplenishment")
          .select("*")
          .eq("itemId", line.itemId)
          .eq("companyId", companyId)
          .single();

        const lotSize = itemManufacturing.data?.lotSize ?? 0;
        const totalQuantity = line.saleQuantity ?? 0;
        // If lotSize is 0, create a single job with the total quantity
        const totalJobs = lotSize > 0 ? Math.ceil(totalQuantity / lotSize) : 1;

        // Ensure totalJobs is at least 1 to avoid invalid array length
        const jobsToCreate = Math.max(1, totalJobs);

        const manufacturing = await serviceRole
          .from("itemReplenishment")
          .select("*")
          .eq("itemId", line.itemId)
          .eq("companyId", companyId)
          .single();

        for await (const index of Array.from({ length: jobsToCreate }).keys()) {
          const nextSequence = await serviceRole.rpc("get_next_sequence", {
            sequence_name: "job",
            company_id: companyId,
          });

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

          const createJob = await serviceRole
            .from("job")
            .insert({
              ...data,
              jobId: nextSequence.data,
              companyId,
              createdBy: userId,
            })
            .select("id")
            .single();

          if (createJob.error) {
            console.error("Failed to create job");
            console.error(createJob.error);
            continue;
          }

          if (quoteId) {
            const upsertMethod = await serviceRole.functions.invoke(
              "get-method",
              {
                body: {
                  type: "quoteLineToJob",
                  sourceId: `${quoteId}:${line.id}`,
                  targetId: createJob.data.id,
                  companyId,
                  createdBy: userId,
                },
              }
            );

            if (upsertMethod.error) {
              console.error("Failed to create job method");
              console.error(upsertMethod.error);
              continue;
            }
          } else {
            const upsertMethod = await serviceRole.functions.invoke(
              "get-method",
              {
                body: {
                  type: "itemToJob",
                  sourceId: data.itemId,
                  targetId: createJob.data.id,
                  companyId,
                  createdBy: userId,
                },
              }
            );

            if (upsertMethod.error) {
              console.error("Failed to create job method");
              console.error(upsertMethod.error);
              continue;
            }
          }

          await serviceRole.functions.invoke("recalculate", {
            body: {
              type: "jobRequirements",
              id: createJob.data.id,
              companyId,
              userId,
            },
          });

          await serviceRole.functions.invoke("scheduler", {
            body: {
              type: "requirements",
              id: createJob.data.id,
              companyId,
              userId,
            },
          });
        }
      }
    }
  },
});
