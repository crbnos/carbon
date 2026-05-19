import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { getCurrencyByCode } from "~/modules/accounting/accounting.service";
import {
  plannedOrderValidator,
  updatePurchaseOrder,
  upsertPurchaseOrder,
  upsertPurchaseOrderLine
} from "~/modules/purchasing";
import { getNextSequence } from "~/modules/settings/settings.service";

const itemsValidator = z
  .object({
    id: z.string(),
    orders: z.array(plannedOrderValidator)
  })
  .array();

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "purchasing",
      role: "employee",
      bypassRls: true
    });

  const { items, action, locationId } = await request.json();

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
        const errorMessages = parsedItems.error.errors.map((error) => {
          const path = error.path;
          const field = path[path.length - 1];

          // Create more readable error messages based on the field and context
          if (field === "orders" && path.length === 2) {
            return "No orders provided for item";
          }
          if (field === "supplierId" || field === "suppliers") {
            return "No suppliers provided";
          }
          if (field === "quantity") {
            return "Invalid quantity specified";
          }
          if (field === "unitPrice") {
            return "Invalid unit price specified";
          }
          if (field === "periodId") {
            return "No period specified";
          }
          if (field === "deliveryDate") {
            return "Invalid delivery date";
          }

          // Fallback to original message for unhandled cases
          return error.message;
        });

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
            message: "No items were provided to create purchase orders"
          },
          { status: 500 }
        );
      }

      try {
        const supplierIds: Set<string> = new Set();
        const itemIds: Set<string> = new Set();
        const periodIds: Set<string> = new Set();
        const allSupplyForecasts: Array<{
          itemId: string;
          locationId: string;
          sourceType: "Purchase Order";
          forecastQuantity: number;
          periodId: string;
          companyId: string;
          createdBy: string;
          updatedBy: string;
        }> = [];

        // Group items and orders by supplier
        const ordersBySupplier: Map<
          string,
          Array<{
            itemId: string;
            order: (typeof itemsToOrder)[0]["orders"][0];
          }>
        > = new Map();

        for (const item of itemsToOrder) {
          itemIds.add(item.id);
          for (const order of item.orders) {
            if (order.supplierId) {
              supplierIds.add(order.supplierId);
              if (!ordersBySupplier.has(order.supplierId)) {
                ordersBySupplier.set(order.supplierId, []);
              }
              ordersBySupplier.get(order.supplierId)!.push({
                itemId: item.id,
                order
              });
            }
            if (order.periodId) {
              periodIds.add(order.periodId);
            }
          }
        }

        const [suppliers, supplierParts, periods, company] = await Promise.all([
          client
            .from("supplier")
            .select("id, name, taxPercent, currencyCode")
            .in("id", Array.from(supplierIds)),
          client
            .from("supplierPart")
            .select("*")
            .in("itemId", Array.from(itemIds)),
          client.from("period").select("*").in("id", Array.from(periodIds)),
          client
            .from("company")
            .select("id, baseCurrencyCode")
            .eq("id", companyId)
            .single()
        ]);

        if (suppliers.error) {
          console.error("Failed to fetch suppliers:", suppliers.error);
          return data(
            {
              success: false,
              message: "Failed to retrieve supplier information from database"
            },
            { status: 500 }
          );
        }

        if (supplierParts.error) {
          console.error("Failed to fetch supplier parts:", supplierParts.error);
          return data(
            {
              success: false,
              message:
                "Failed to retrieve supplier part information from database"
            },
            { status: 500 }
          );
        }

        if (periods.error) {
          console.error("Failed to fetch periods:", periods.error);
          return data(
            {
              success: false,
              message: "Failed to retrieve period information from database"
            },
            { status: 500 }
          );
        }

        if (company.error) {
          console.error("Failed to fetch company:", company.error);
          return data(
            {
              success: false,
              message: "Failed to retrieve company information from database"
            },
            { status: 500 }
          );
        }

        const suppliersById = new Map(
          suppliers.data?.map((supplier) => [supplier.id, supplier]) ?? []
        );

        const baseCurrencyCode = company.data?.baseCurrencyCode ?? "USD";

        let processedItems = 0;
        let errors: string[] = [];

        // Process orders grouped by supplier
        for (const [supplierId, ordersForSupplier] of ordersBySupplier) {
          const supplier = suppliersById.get(supplierId);
          if (!supplier) {
            const errorMsg = `Supplier ${supplierId} not found`;
            console.error(errorMsg);
            errors.push(errorMsg);
            continue;
          }

          // Get existing purchase orders for this supplier
          const { data: existingPurchaseOrders, error: poError } = await client
            .from("purchaseOrder")
            .select("id, purchaseOrderId, status")
            .eq("supplierId", supplierId)
            .in("status", ["Draft", "Planned"]);

          if (poError) {
            const errorMsg = `Failed to retrieve existing purchase orders for supplier ${supplierId}: ${poError.message}`;
            console.error(errorMsg);
            errors.push(errorMsg);
            continue;
          }

          // Use the first existing Draft/Planned PO, or create a new one
          let purchaseOrderId = existingPurchaseOrders?.[0]?.id;
          let createdNewPO = false;

          if (!purchaseOrderId) {
            const nextSequence = await getNextSequence("purchaseOrder");
            if (nextSequence.error) {
              const errorMsg = `Failed to generate purchase order sequence for supplier ${supplierId}: ${nextSequence.error.message}`;
              console.error(errorMsg);
              errors.push(errorMsg);
              continue;
            }

            const purchaseOrderIdValue = nextSequence.data;
            if (!purchaseOrderIdValue) {
              const errorMsg = `Failed to generate purchase order ID for supplier ${supplierId}`;
              console.error(errorMsg);
              errors.push(errorMsg);
              continue;
            }

            let exchangeRate = 1;
            if (supplier.currencyCode !== baseCurrencyCode) {
              const currency = await getCurrencyByCode(
                companyGroupId,
                supplier.currencyCode ?? baseCurrencyCode
              );

              if (currency.error) {
                const errorMsg = `Failed to retrieve exchange rate for currency ${supplier.currencyCode}: ${currency.error.message}`;
                console.error(errorMsg);
                errors.push(errorMsg);
                continue;
              }

              if (currency.data) {
                exchangeRate = currency.data.exchangeRate ?? 1;
              }
            }

            const createPurchaseOrder = await upsertPurchaseOrder(
              {
                purchaseOrderId: purchaseOrderIdValue,
                status: "Planned" as const,
                supplierId,
                purchaseOrderType: "Purchase",
                currencyCode: supplier.currencyCode ?? baseCurrencyCode,
                exchangeRate: exchangeRate,
                companyId,
                companyGroupId,
                createdBy: userId
              },
              undefined
            );

            if (createPurchaseOrder.error) {
              const errorMsg = `Failed to create purchase order for supplier ${supplierId}: ${createPurchaseOrder.error.message}`;
              console.error(errorMsg);
              errors.push(errorMsg);
              continue;
            }

            const purchaseOrder = createPurchaseOrder.data?.[0];
            if (!purchaseOrder) {
              const errorMsg = `Purchase order was not returned after creation for supplier ${supplierId}`;
              console.error(errorMsg);
              errors.push(errorMsg);
              continue;
            }

            purchaseOrderId = purchaseOrder.id;
            createdNewPO = true;
          }

          // Group orders by itemId to consolidate into single lines
          const ordersByItem = new Map<
            string,
            Array<{
              order: (typeof ordersForSupplier)[0]["order"];
              periodId: string;
            }>
          >();

          for (const { itemId, order } of ordersForSupplier) {
            if (!ordersByItem.has(itemId)) {
              ordersByItem.set(itemId, []);
            }
            ordersByItem.get(itemId)!.push({
              order,
              periodId: order.periodId
            });
          }

          // Now create one line per item (consolidating all orders for that item)
          for (const [itemId, itemOrders] of ordersByItem) {
            const supplierPart = supplierParts?.data?.find(
              (sp) => sp.itemId === itemId && sp.supplierId === supplierId
            );

            const purchasing = await client
              .from("itemReplenishment")
              .select("purchasingBlocked")
              .eq("itemId", itemId)
              .single();

            if (purchasing.error) {
              const errorMsg = `Failed to retrieve purchasing data for item ${itemId}: ${purchasing.error.message}`;
              console.error(errorMsg);
              errors.push(errorMsg);
              continue;
            }

            if (purchasing.data?.purchasingBlocked) {
              const errorMsg = `Purchasing is blocked for item ${itemId}`;
              console.error(errorMsg);
              errors.push(errorMsg);
              continue;
            }

            // Sum up all quantities for this item
            const totalQuantity = itemOrders.reduce(
              (sum, { order }) => sum + order.quantity,
              0
            );

            // Apply minimum order quantity
            const minimumOrderQuantity =
              supplierPart?.minimumOrderQuantity ?? 0;

            let adjustedQuantity = totalQuantity;

            // Apply minimum order quantity
            if (
              minimumOrderQuantity > 0 &&
              adjustedQuantity < minimumOrderQuantity
            ) {
              adjustedQuantity = minimumOrderQuantity;
            }

            // Use the earliest due date from all orders for this item
            const earliestDueDate = itemOrders.reduce((earliest, { order }) => {
              if (!earliest) return order.dueDate;
              if (!order.dueDate) return earliest;
              return order.dueDate < earliest ? order.dueDate : earliest;
            }, itemOrders[0].order.dueDate);

            // Use the first order's description
            const description = itemOrders[0].order.description;
            const unitOfMeasureCode = itemOrders[0].order.unitOfMeasureCode;

            const createPurchaseOrderLine = await upsertPurchaseOrderLine({
              purchaseOrderId: purchaseOrderId!,
              itemId: itemId,
              description: description,
              purchaseOrderLineType: "Part",
              purchaseQuantity: adjustedQuantity,
              purchaseUnitOfMeasureCode:
                supplierPart?.supplierUnitOfMeasureCode ?? unitOfMeasureCode,
              inventoryUnitOfMeasureCode: unitOfMeasureCode,
              conversionFactor: supplierPart?.conversionFactor ?? 1,
              supplierUnitPrice: supplierPart?.unitPrice ?? 0,
              supplierTaxAmount:
                ((supplierPart?.unitPrice ?? 0) * (supplier.taxPercent ?? 0)) /
                100,
              supplierShippingCost: 0,
              requiredDate: earliestDueDate ?? undefined,
              locationId,
              companyId,
              createdBy: userId
            });

            if (createPurchaseOrderLine.error) {
              const errorMsg = `Failed to create purchase order line for item ${itemId}: ${createPurchaseOrderLine.error.message}`;
              console.error(errorMsg);
              errors.push(errorMsg);
              continue;
            }

            processedItems++;

            // Add supply forecasts for each period this item appears in
            const conversionFactor = supplierPart?.conversionFactor ?? 1;
            const periodQuantities = new Map<string, number>();

            for (const { order, periodId } of itemOrders) {
              const currentPeriodQty = periodQuantities.get(periodId) || 0;
              periodQuantities.set(periodId, currentPeriodQty + order.quantity);
            }

            for (const [periodId, quantity] of periodQuantities) {
              const inventoryQuantityDelta = quantity * conversionFactor;

              allSupplyForecasts.push({
                itemId: itemId,
                locationId,
                sourceType: "Purchase Order" as const,
                forecastQuantity: inventoryQuantityDelta,
                periodId,
                companyId,
                createdBy: userId,
                updatedBy: userId
              });
            }
          }

          // Update PO status if we added to an existing PO
          if (!createdNewPO && purchaseOrderId) {
            const updateResult = await updatePurchaseOrder({
              id: purchaseOrderId,
              status: "Planned" as const
            });

            if (updateResult.error) {
              const errorMsg = `Failed to update purchase order status for supplier ${supplierId}: ${updateResult.error.message}`;
              console.error(errorMsg);
              errors.push(errorMsg);
            }
          }
        }

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
            console.error(errorMsg);
            errors.push(errorMsg);
          }
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
            ? `Successfully processed all ${processedItems} items`
            : `Processed ${processedItems} of ${itemsToOrder.length} items. ${
                errors.length
              } errors occurred: ${errors.slice(0, 2).join("; ")}${
                errors.length > 2 ? "..." : ""
              }`;

        return {
          success: processedItems > 0,
          message,
          processedItems,
          totalItems: itemsToOrder.length,
          errors: errors.length > 0 ? errors : undefined
        };
      } catch (error) {
        console.error("Unexpected error processing purchase orders:", error);
        return data(
          {
            success: false,
            message: `Unexpected error occurred while processing purchase orders: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          },
          { status: 500 }
        );
      }

    default:
      return data(
        {
          success: false,
          message: `Unknown action '${action}'. Expected action: 'order'`
        },
        { status: 500 }
      );
  }
}
