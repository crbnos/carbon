import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import {
  getLocalTimeZone,
  parseDate,
  startOfWeek,
  today
} from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { insertStockTransfer } from "~/modules/inventory";
import { getJob } from "~/modules/production";
import { getOrCreatePeriods } from "~/modules/shared/shared.server";
import { path } from "~/utils/path";

const jobMaterialsSessionValidator = z.object({
  jobId: z.string(),
  items: z.string().transform((str, ctx) => {
    try {
      const parsed = JSON.parse(str);
      const itemsSchema = z.array(
        z.object({
          id: z.string(), // Job material ID
          itemId: z.string(), // Actual item ID
          itemReadableId: z.string(),
          description: z.string(),
          action: z.enum(["order", "transfer"]),
          quantity: z.number().optional(),
          requiresSerialTracking: z.boolean(),
          requiresBatchTracking: z.boolean(),
          storageUnitId: z.string().nullable().optional()
        })
      );
      return itemsSchema.parse(parsed);
      // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid JSON format for items"
      });
      return z.NEVER;
    }
  })
});

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Job ID is required");

  const formData = await request.formData();

  const validation = await validator(jobMaterialsSessionValidator).validate(
    formData
  );

  if (validation.error) {
    return data(
      { success: false, message: "Invalid session data" },
      await flash(request, error(validation.error, "Invalid session data"))
    );
  }

  const { items: sessionItems } = validation.data;
  const startDate = startOfWeek(today(getLocalTimeZone()), "en-US");

  // Get job information to determine location
  const [jobResult, itemReplenishments] = await Promise.all([
    getJob(client, jobId),
    client
      .from("itemReplenishment")
      .select(
        "itemId, leadTime, lotSize, manufacturingBlocked, purchasingBlocked, preferredSupplierId, requiresConfiguration, scrapPercentage, ...item(replenishmentSystem)"
      )
      .in(
        "itemId",
        sessionItems.map((item) => item.itemId)
      )
      .eq("companyId", companyId)
  ]);
  if (jobResult.error || !jobResult.data) {
    return data(
      { success: false, message: "Failed to get job information" },
      await flash(
        request,
        error(jobResult.error, "Failed to get job information")
      )
    );
  }

  const itemReplenishmentsMap = new Map(
    itemReplenishments.data?.map((item) => [item.itemId, item]) ?? []
  );

  const job = jobResult.data;
  const locationId = job.locationId;
  const jobStartDate = job.startDate;

  if (!locationId) {
    return data(
      { success: false, message: "Job location is required" },
      await flash(
        request,
        error("Job location is required", "Invalid job configuration")
      )
    );
  }

  const endDate = jobStartDate
    ? new Date(String(jobStartDate))
    : new Date(startDate.add({ weeks: 8 }).toString());
  const weeksToProject = Math.max(
    1,
    Math.ceil(
      (endDate.getTime() - new Date(startDate.toString()).getTime()) /
        (7 * 24 * 60 * 60 * 1000)
    )
  );
  const periods = await getOrCreatePeriods(
    today(getLocalTimeZone()),
    weeksToProject
  );

  const transferItems = sessionItems.filter(
    (item) => item.action === "transfer"
  );

  const orderItems = sessionItems.filter((item) => item.action === "order");

  let hasTransfer = false;
  let hasPurchaseOrder = false;
  let hasJobs = false;

  if (transferItems.length > 0) {
    // Process transfer items and build transfer lines first
    // Only create stock transfer after validating we have valid lines
    const transferLines = [];

    for await (const item of transferItems) {
      if (!item.storageUnitId || !item.quantity || !item.id) {
        continue;
      }

      // Find available sources for this item (excluding the target storage unit)
      const { data: availableSources, error: sourcesError } = await client.rpc(
        "get_item_storage_unit_requirements_by_location_and_item",
        {
          company_id: companyId,
          location_id: locationId,
          item_id: item.itemId
        }
      );

      if (sourcesError) {
        continue;
      }

      // Filter out the target storage unit and only include storage units with available quantity
      const validSources =
        availableSources?.filter(
          (source) =>
            source.storageUnitId !== item.storageUnitId &&
            source.quantityOnHandInStorageUnit >
              source.quantityRequiredByStorageUnit
        ) || [];

      if (validSources.length === 0) {
        continue;
      }

      // Sort sources by available quantity (descending) to prioritize storage units with more stock
      validSources.sort((a, b) => {
        const aAvailable =
          a.quantityOnHandInStorageUnit - a.quantityRequiredByStorageUnit;
        const bAvailable =
          b.quantityOnHandInStorageUnit - b.quantityRequiredByStorageUnit;
        return bAvailable - aAvailable;
      });

      // Distribute the required quantity across available sources
      let remainingQuantity = item.quantity;

      for (const source of validSources) {
        if (remainingQuantity <= 0) break;

        const availableQuantity =
          source.quantityOnHandInStorageUnit -
          source.quantityRequiredByStorageUnit;
        const transferQuantity = Math.min(remainingQuantity, availableQuantity);

        if (transferQuantity > 0) {
          const transferLine = {
            itemId: item.itemId, // Use the actual item ID, not the job material ID
            fromStorageUnitId: source.storageUnitId,
            toStorageUnitId: item.storageUnitId,
            quantity: transferQuantity,
            requiresSerialTracking: item.requiresSerialTracking,
            requiresBatchTracking: item.requiresBatchTracking
          };

          transferLines.push(transferLine);
          remainingQuantity -= transferQuantity;
        }
      }
    }

    // Expand lines with serial tracking (similar to stock transfer new.tsx)
    const linesWithExpandedSerialTracking = transferLines.reduce<
      typeof transferLines
    >((acc, line) => {
      // If quantity contains a decimal, ignore the line (as per requirements)
      if (line.quantity && !Number.isInteger(line.quantity)) {
        return acc;
      }

      // If item requires serial tracking and quantity is a whole number > 1
      if (line.requiresSerialTracking && line.quantity && line.quantity > 1) {
        // Break out into multiple lines with quantity 1
        acc.push(
          ...Array.from({ length: line.quantity }, () => ({
            ...line,
            quantity: 1
          }))
        );
      } else {
        acc.push(line);
      }
      return acc;
    }, []);

    if (linesWithExpandedSerialTracking.length > 0) {
      const createStockTransfer = await insertStockTransfer(client, {
        locationId,
        lines: linesWithExpandedSerialTracking,
        companyId,
        createdBy: userId
      });

      if (createStockTransfer.error || !createStockTransfer.data) {
        return data(
          { success: false, message: "Failed to create stock transfer" },
          await flash(
            request,
            error(createStockTransfer.error, "Failed to create stock transfer")
          )
        );
      }

      hasTransfer = true;
    }
  }

  if (orderItems.length > 0) {
    // Separate items into make vs buy based on replenishment system
    // If replenishment system is "Buy and Make", treat as "Buy" (purchase order)
    const buyItems = orderItems.filter(
      (item) =>
        itemReplenishmentsMap.get(item.itemId)?.replenishmentSystem === "Buy" ||
        itemReplenishmentsMap.get(item.itemId)?.replenishmentSystem ===
          "Buy and Make"
    );

    const makeItems = orderItems.filter(
      (item) =>
        itemReplenishmentsMap.get(item.itemId)?.replenishmentSystem === "Make"
    );

    // Create purchase orders for buy items
    if (buyItems.length > 0) {
      // Get supplier information for buy items
      const supplierParts = await client
        .from("supplierPart")
        .select("*")
        .in(
          "itemId",
          buyItems.map((item) => item.itemId)
        )
        .eq("companyId", companyId);

      if (supplierParts.error) {
        console.error(supplierParts.error);
      } else {
        // Group items by supplier to create one purchase order per supplier
        const itemsBySupplier = new Map<
          string,
          Array<{
            item: (typeof buyItems)[0];
            supplier: any;
            replenishment: any;
          }>
        >();

        // First pass: assign suppliers to each item
        for (const item of buyItems) {
          const replenishment = itemReplenishmentsMap.get(item.itemId);

          // Find preferred supplier or first available supplier
          const itemSupplierParts =
            supplierParts.data?.filter((sp) => sp.itemId === item.itemId) || [];

          let selectedSupplier = null;

          // First try to find preferred supplier
          if (replenishment?.preferredSupplierId) {
            selectedSupplier = itemSupplierParts.find(
              (sp) => sp.supplierId === replenishment.preferredSupplierId
            );
          }

          // If no preferred supplier found, take the first one
          if (!selectedSupplier && itemSupplierParts.length > 0) {
            selectedSupplier = itemSupplierParts[0];
          }

          if (!selectedSupplier) {
            console.error(
              `[Purchase Orders] No supplier found for item ${item.itemId}`
            );
            continue;
          }

          // Group by supplier
          if (!itemsBySupplier.has(selectedSupplier.supplierId)) {
            itemsBySupplier.set(selectedSupplier.supplierId, []);
          }
          itemsBySupplier.get(selectedSupplier.supplierId)!.push({
            item,
            supplier: selectedSupplier,
            replenishment
          });
        }

        // Build purchase planning payload - one planning item per actual item
        const purchasePlanningItems = [];

        // Helper function to find period ID
        const findPeriodId = (dueDate: string) => {
          const dueDateParsed = parseDate(dueDate);
          const period = periods?.find((p) => {
            const startDate = parseDate(p.startDate);
            const endDate = parseDate(p.endDate);
            return dueDateParsed >= startDate && dueDateParsed <= endDate;
          });

          if (!period) {
            if (periods && periods.length > 0) {
              const firstPeriod = periods[0];
              const lastPeriod = periods[periods.length - 1];
              const firstStartDate = parseDate(firstPeriod.startDate);
              const lastEndDate = parseDate(lastPeriod.endDate);

              if (dueDateParsed < firstStartDate) {
                return firstPeriod.id;
              } else if (dueDateParsed > lastEndDate) {
                return lastPeriod.id;
              }
            }
            return periods?.[0]?.id || "";
          }

          return period.id;
        };

        for (const [supplierId, supplierItems] of itemsBySupplier.entries()) {
          // Create one planning item per actual item
          for (const { item, supplier, replenishment } of supplierItems) {
            // Calculate dates: due date = job start date, start date = due date - lead time
            const jobStartDateParsed = jobStartDate
              ? parseDate(jobStartDate)
              : today(getLocalTimeZone());
            const leadTime = replenishment?.leadTime || 0;
            const purchaseOrderDueDate = jobStartDateParsed.toString();
            const purchaseOrderStartDate = jobStartDateParsed
              .subtract({ days: leadTime })
              .toString();

            const periodId = findPeriodId(purchaseOrderDueDate);

            const orders = [
              {
                quantity: Math.max(item.quantity || 0, 1),
                dueDate: purchaseOrderDueDate,
                startDate: purchaseOrderStartDate,
                periodId: periodId,
                supplierId: supplierId,
                unitPrice: supplier.unitPrice || 0,
                unitOfMeasureCode: supplier.supplierUnitOfMeasureCode || "EA",
                description: item.description
              }
            ];

            purchasePlanningItems.push({
              id: item.itemId,
              orders
            });
          }
        }

        if (purchasePlanningItems.length > 0) {
          const purchasePlanningPayload = {
            action: "order" as const,
            items: purchasePlanningItems,
            locationId
          };

          const purchasePlanningUrl = `${new URL(request.url).origin}${
            path.to.bulkUpdatePurchasingPlanning
          }`;

          const result = await fetch(purchasePlanningUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: request.headers.get("Authorization") || "",
              Cookie: request.headers.get("Cookie") || ""
            },
            body: JSON.stringify(purchasePlanningPayload)
          });

          if (result.ok) {
            const responseData = await result.json();

            if (responseData?.success) {
              hasPurchaseOrder = true;
            } else {
              console.error(
                `[Purchase Orders] API returned success: false`,
                responseData
              );
            }
          } else {
            const errorText = await result.text();
            console.error(`[Purchase Orders] API call failed:`, {
              status: result.status,
              statusText: result.statusText,
              error: errorText
            });
          }
        }
      }
    }

    // Create jobs for make items
    if (makeItems.length > 0) {
      const productionPlanningUrl = `${new URL(request.url).origin}${
        path.to.bulkUpdateProductionPlanning
      }`;

      // Build production planning payload with lot size chunking
      const productionPlanningItems = makeItems.map((item) => {
        const replenishment = itemReplenishmentsMap.get(item.itemId);
        const lotSize = replenishment?.lotSize ?? 0;
        const requiredQuantity = item.quantity || 0;

        // Calculate orders based on lot size chunking
        const orders = [];

        // Calculate dates: due date = job start date, start date = due date - lead time
        const jobStartDateParsed = jobStartDate
          ? parseDate(jobStartDate)
          : today(getLocalTimeZone());
        const leadTime = replenishment?.leadTime || 0;
        const productionOrderDueDate = jobStartDateParsed.toString();
        const productionOrderStartDate = jobStartDateParsed
          .subtract({ days: leadTime })
          .toString();

        // Find the correct period based on the production order due date
        const findPeriodId = (dueDate: string) => {
          const dueDateParsed = parseDate(dueDate);
          const period = periods?.find((p) => {
            const startDate = parseDate(p.startDate);
            const endDate = parseDate(p.endDate);
            return dueDateParsed >= startDate && dueDateParsed <= endDate;
          });

          // If no matching period found, use the first period if due date is before it,
          // or the last period if due date is after all periods
          if (!period) {
            if (periods && periods.length > 0) {
              const firstPeriod = periods[0];
              const lastPeriod = periods[periods.length - 1];
              const firstStartDate = parseDate(firstPeriod.startDate);
              const lastEndDate = parseDate(lastPeriod.endDate);

              if (dueDateParsed < firstStartDate) {
                return firstPeriod.id;
              } else if (dueDateParsed > lastEndDate) {
                return lastPeriod.id;
              }
            }
            return periods?.[0]?.id || "";
          }

          return period.id;
        };

        const periodId = findPeriodId(productionOrderDueDate);

        if (lotSize === 0) {
          // If lot size is 0, order the exact required quantity
          const orderQuantity = Math.max(requiredQuantity, 1); // At least 1 if no quantity specified
          orders.push({
            quantity: orderQuantity,
            dueDate: productionOrderDueDate,
            startDate: productionOrderStartDate,
            isASAP: startDate.compare(today(getLocalTimeZone())) < 0,
            periodId: periodId
          });
        } else {
          // If lot size > 0, use lot size chunking
          if (requiredQuantity <= 0) {
            // If no quantity required, create one order with lot size
            orders.push({
              quantity: lotSize,
              dueDate: productionOrderDueDate,
              startDate: productionOrderStartDate,
              isASAP: false,
              periodId: periodId
            });
          } else if (requiredQuantity <= lotSize) {
            // If required quantity is less than or equal to lot size, order the lot size
            orders.push({
              quantity: lotSize,
              dueDate: productionOrderDueDate,
              startDate: productionOrderStartDate,
              isASAP: false,
              periodId: periodId
            });
          } else {
            // If required quantity is greater than lot size, create multiple orders
            const numberOfOrders = Math.ceil(requiredQuantity / lotSize);
            for (let i = 0; i < numberOfOrders; i++) {
              orders.push({
                quantity: lotSize,
                dueDate: productionOrderDueDate,
                startDate: productionOrderStartDate,
                isASAP: false,
                periodId: periodId
              });
            }
          }
        }

        return {
          id: item.itemId,
          orders
        };
      });

      const productionPlanningPayload = {
        action: "order" as const,
        items: productionPlanningItems,
        locationId
      };

      const result = await fetch(productionPlanningUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: request.headers.get("Authorization") || "",
          Cookie: request.headers.get("Cookie") || ""
        },
        body: JSON.stringify(productionPlanningPayload)
      });

      const data = await result.json();
      if (data?.success) {
        hasJobs = true;
      }
    }
  }

  const createdItems = [];
  if (hasTransfer) createdItems.push("stock transfer");
  if (hasPurchaseOrder) createdItems.push("purchase order(s)");
  if (hasJobs) createdItems.push("job(s)");

  const successMessage =
    createdItems.length > 0
      ? `Successfully created ${createdItems.join(", ")}`
      : "Session processed successfully, but without any transfers or orders";

  return data(
    { success: true, message: successMessage },
    await flash(request, success(successMessage))
  );
}
