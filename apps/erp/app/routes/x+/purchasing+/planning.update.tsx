import { requirePermissions } from "@carbon/auth/auth.server";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { z } from "zod";
import { getCurrencyByCode } from "~/modules/accounting/accounting.service";
import {
  plannedOrderValidator,
  updatePurchaseOrder,
  upsertPurchaseOrder,
  upsertPurchaseOrderLine,
} from "~/modules/purchasing";
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
    create: "purchasing",
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
            message: "No items were provided to create purchase orders",
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

        for (const item of itemsToOrder) {
          itemIds.add(item.id);
          for (const order of item.orders) {
            if (order.supplierId) {
              supplierIds.add(order.supplierId);
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
            .single(),
        ]);

        if (suppliers.error) {
          console.error("Failed to fetch suppliers:", suppliers.error);
          return json(
            {
              success: false,
              message: "Failed to retrieve supplier information from database",
            },
            { status: 500 }
          );
        }

        if (supplierParts.error) {
          console.error("Failed to fetch supplier parts:", supplierParts.error);
          return json(
            {
              success: false,
              message:
                "Failed to retrieve supplier part information from database",
            },
            { status: 500 }
          );
        }

        if (periods.error) {
          console.error("Failed to fetch periods:", periods.error);
          return json(
            {
              success: false,
              message: "Failed to retrieve period information from database",
            },
            { status: 500 }
          );
        }

        if (company.error) {
          console.error("Failed to fetch company:", company.error);
          return json(
            {
              success: false,
              message: "Failed to retrieve company information from database",
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

        for (const item of itemsToOrder) {
          const orders = item.orders;
          const supplier = suppliersById.get(orders[0]?.supplierId ?? "");
          const supplierPart =
            supplierParts?.data?.find(
              (sp) => sp.itemId === item.id && sp.supplierId === supplier?.id
            ) ?? undefined;

          const supplyForecastByPeriod: Record<string, number> = {};

          const purchasing = await client
            .from("itemReplenishment")
            .select("purchasingBlocked")
            .eq("itemId", item.id)
            .single();

          if (purchasing.error) {
            const errorMsg = `Failed to retrieve purchasing data for item ${item.id}: ${purchasing.error.message}`;
            console.error(errorMsg);
            errors.push(errorMsg);
            continue;
          }

          if (purchasing.data?.purchasingBlocked) {
            const errorMsg = `Purchasing is blocked for item ${item.id}`;
            console.warn(errorMsg);
            errors.push(errorMsg);
            continue;
          }

          // Get existing purchase orders for this supplier
          const { data: existingPurchaseOrders, error: poError } = await client
            .from("purchaseOrder")
            .select(
              "id, purchaseOrderId, orderDate, status, purchaseOrderDelivery(receiptRequestedDate, receiptPromisedDate)"
            )
            .eq("supplierId", supplier?.id ?? "")
            .in("status", ["Draft", "Planned"]);

          if (poError) {
            const errorMsg = `Failed to retrieve existing purchase orders for supplier ${supplier?.id}: ${poError.message}`;
            console.error(errorMsg);
            errors.push(errorMsg);
            continue;
          }

          const existingPOs =
            existingPurchaseOrders?.map((order) => {
              const dueDate =
                order?.purchaseOrderDelivery?.receiptPromisedDate ??
                order?.purchaseOrderDelivery?.receiptRequestedDate;
              return {
                id: order.id,
                readableId: order.purchaseOrderId,
                status: order.status,
                dueDate,
              };
            }) ?? [];

          // Map orders to existing POs in the same period
          const ordersMappedToExistingPOs = orders.map((order) => {
            const period = periods?.data?.find((p) => p.id === order.periodId);
            if (period) {
              const firstPOInPeriod = existingPOs.find((po) => {
                const dueDate = po?.dueDate ? new Date(po.dueDate) : null;
                return (
                  dueDate !== null &&
                  new Date(period.startDate) <= dueDate &&
                  new Date(period.endDate) >= dueDate
                );
              });

              if (firstPOInPeriod) {
                return {
                  ...order,
                  existingId: firstPOInPeriod.id,
                  existingLineId: undefined,
                  existingReadableId: firstPOInPeriod.readableId,
                  existingStatus: firstPOInPeriod.status,
                };
              }
            }

            return order;
          });

          let itemProcessed = false;

          for (const order of ordersMappedToExistingPOs) {
            if (!order.supplierId) {
              const errorMsg = `Supplier ID is missing for item ${item.id}`;
              console.error(errorMsg);
              errors.push(errorMsg);
              continue;
            }

            if (!order.existingId) {
              const nextSequence = await getNextSequence(
                client,
                "purchaseOrder",
                companyId
              );
              if (nextSequence.error) {
                const errorMsg = `Failed to generate purchase order sequence for item ${item.id}: ${nextSequence.error.message}`;
                console.error(errorMsg);
                errors.push(errorMsg);
                continue;
              }

              const purchaseOrderId = nextSequence.data;
              if (!purchaseOrderId) {
                const errorMsg = `Failed to generate purchase order ID for item ${item.id}`;
                console.error(errorMsg);
                errors.push(errorMsg);
                continue;
              }

              let exchangeRate = 1;
              if (supplier?.currencyCode !== baseCurrencyCode) {
                const currency = await getCurrencyByCode(
                  client,
                  companyId,
                  supplier?.currencyCode ?? baseCurrencyCode
                );

                if (currency.error) {
                  const errorMsg = `Failed to retrieve exchange rate for currency ${supplier?.currencyCode}: ${currency.error.message}`;
                  console.error(errorMsg);
                  errors.push(errorMsg);
                  continue;
                }

                if (currency.data) {
                  exchangeRate = currency.data.exchangeRate ?? 1;
                }
              }

              const createPurchaseOrder = await upsertPurchaseOrder(
                client,
                {
                  purchaseOrderId,
                  status: "Planned" as const,
                  supplierId: order.supplierId,
                  purchaseOrderType: "Purchase",
                  currencyCode: supplier?.currencyCode ?? baseCurrencyCode,
                  exchangeRate: exchangeRate,
                  companyId,
                  createdBy: userId,
                },
                order.dueDate ?? undefined
              );

              if (createPurchaseOrder.error) {
                const errorMsg = `Failed to create purchase order for item ${item.id}: ${createPurchaseOrder.error.message}`;
                console.error(errorMsg);
                errors.push(errorMsg);
                continue;
              }

              const purchaseOrder = createPurchaseOrder.data?.[0];
              if (!purchaseOrder) {
                const errorMsg = `Purchase order was not returned after creation for item ${item.id}`;
                console.error(errorMsg);
                errors.push(errorMsg);
                continue;
              }

              const createPurchaseOrderLine = await upsertPurchaseOrderLine(
                client,
                {
                  purchaseOrderId: purchaseOrder.id,
                  itemId: item.id,
                  itemReadableId: order.itemReadableId,
                  description: order.description,
                  purchaseOrderLineType: "Part",
                  purchaseQuantity: order.quantity,
                  purchaseUnitOfMeasureCode:
                    supplierPart?.supplierUnitOfMeasureCode ??
                    order.unitOfMeasureCode,
                  inventoryUnitOfMeasureCode: order.unitOfMeasureCode,
                  conversionFactor: supplierPart?.conversionFactor ?? 1,
                  supplierUnitPrice: supplierPart?.unitPrice ?? 0,
                  supplierTaxAmount:
                    ((order.unitPrice ?? 0) * (supplier?.taxPercent ?? 0)) /
                    100,
                  supplierShippingCost: 0,
                  promisedDate: order.dueDate ?? undefined,
                  locationId,
                  companyId,
                  createdBy: userId,
                }
              );

              if (createPurchaseOrderLine.error) {
                const errorMsg = `Failed to create purchase order line for item ${item.id}: ${createPurchaseOrderLine.error.message}`;
                console.error(errorMsg);
                errors.push(errorMsg);
                continue;
              }

              itemProcessed = true;
            } else {
              if (order.existingLineId) {
                const updatePurchaseOrderLine = await upsertPurchaseOrderLine(
                  client,
                  {
                    id: order.existingLineId,
                    purchaseOrderId: order.existingId,
                    itemId: item.id,
                    itemReadableId: order.itemReadableId,
                    description: order.description,
                    purchaseOrderLineType: "Part",
                    purchaseQuantity: order.quantity,
                    purchaseUnitOfMeasureCode:
                      supplierPart?.supplierUnitOfMeasureCode ??
                      order.unitOfMeasureCode,
                    inventoryUnitOfMeasureCode: order.unitOfMeasureCode,
                    conversionFactor: supplierPart?.conversionFactor ?? 1,
                    supplierUnitPrice: supplierPart?.unitPrice ?? 0,
                    supplierTaxAmount:
                      ((order.unitPrice ?? 0) * (supplier?.taxPercent ?? 0)) /
                      100,
                    supplierShippingCost: 0,
                    promisedDate: order.dueDate ?? undefined,
                    locationId,
                    companyId,
                    createdBy: userId,
                  }
                );

                if (updatePurchaseOrderLine.error) {
                  const errorMsg = `Failed to update purchase order line ${order.existingLineId} for item ${item.id}: ${updatePurchaseOrderLine.error.message}`;
                  console.error(errorMsg);
                  errors.push(errorMsg);
                  continue;
                }
              } else {
                const insertPurchaseOrderLine = await upsertPurchaseOrderLine(
                  client,
                  {
                    purchaseOrderId: order.existingId,
                    itemId: item.id,
                    itemReadableId: order.itemReadableId,
                    description: order.description,
                    purchaseOrderLineType: "Part",
                    purchaseQuantity: order.quantity,
                    purchaseUnitOfMeasureCode:
                      supplierPart?.supplierUnitOfMeasureCode ??
                      order.unitOfMeasureCode,
                    inventoryUnitOfMeasureCode: order.unitOfMeasureCode,
                    conversionFactor: supplierPart?.conversionFactor ?? 1,
                    supplierUnitPrice: supplierPart?.unitPrice ?? 0,
                    supplierTaxAmount:
                      ((order.unitPrice ?? 0) * (supplier?.taxPercent ?? 0)) /
                      100,
                    supplierShippingCost: 0,
                    promisedDate: order.dueDate ?? undefined,
                    locationId,
                    companyId,
                    createdBy: userId,
                  }
                );

                if (insertPurchaseOrderLine.error) {
                  const errorMsg = `Failed to add purchase order line for item ${item.id}: ${insertPurchaseOrderLine.error.message}`;
                  console.error(errorMsg);
                  errors.push(errorMsg);
                  continue;
                }
              }

              const updateResult = await updatePurchaseOrder(client, {
                id: order.existingId,
                status: "Planned" as const,
                updatedBy: userId,
              });

              if (updateResult.error) {
                const errorMsg = `Failed to update purchase order status for item ${item.id}: ${updateResult.error.message}`;
                console.error(errorMsg);
                errors.push(errorMsg);
                continue;
              }

              itemProcessed = true;
            }

            const periodId = order.periodId;
            supplyForecastByPeriod[periodId] =
              (supplyForecastByPeriod[periodId] || 0) +
              (order.quantity - (order.existingQuantity ?? 0));
          }

          if (itemProcessed) {
            processedItems++;
            Object.entries(supplyForecastByPeriod).forEach(
              ([periodId, quantity]) => {
                allSupplyForecasts.push({
                  itemId: item.id,
                  locationId,
                  sourceType: "Purchase Order" as const,
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
            ? `Successfully processed all ${processedItems} items`
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
        console.error("Unexpected error processing purchase orders:", error);
        return json(
          {
            success: false,
            message: `Unexpected error occurred while processing purchase orders: ${
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
