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
    return json({ success: false, message: "Location is required" });
  }

  if (typeof action !== "string") {
    return json({ success: false, message: "Invalid form data" });
  }

  switch (action) {
    case "order":
      const parsedItems = itemsValidator.safeParse(items);

      if (!parsedItems.success) {
        parsedItems.error.errors.forEach((error) => {
          console.error(error);
        });
        return json({ success: false, message: "Invalid form data" });
      }

      const itemsToOrder = parsedItems.data;
      if (itemsToOrder.length === 0) {
        return json({ success: false, message: "No items to order" });
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

        const suppliersById = new Map(
          suppliers.data?.map((supplier) => [supplier.id, supplier]) ?? []
        );

        const baseCurrencyCode = company.data?.baseCurrencyCode ?? "USD";

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
            console.error(
              `Failed to get purchasing data for item ${item.id}:`,
              purchasing.error
            );
            continue;
          }

          if (purchasing.data?.purchasingBlocked) {
            console.warn(`Purchasing is blocked for item ${item.id}`);
            continue;
          }

          // Get existing purchase orders for this supplier
          const { data: existingPurchaseOrders } = await client
            .from("purchaseOrder")
            .select(
              "id, purchaseOrderId, orderDate, status, purchaseOrderDelivery(receiptRequestedDate, receiptPromisedDate)"
            )
            .eq("supplierId", supplier?.id ?? "")
            .in("status", ["Draft", "Planned"]);

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

          for (const order of ordersMappedToExistingPOs) {
            if (!order.supplierId) {
              console.error(`Supplier ID is required for item ${item.id}`);
              continue;
            }

            if (!order.existingId) {
              const nextSequence = await getNextSequence(
                client,
                "purchaseOrder",
                companyId
              );
              if (nextSequence.error) {
                console.error(
                  `Failed to get next sequence for item ${item.id}:`,
                  nextSequence.error
                );
                continue;
              }

              const purchaseOrderId = nextSequence.data;
              if (!purchaseOrderId) {
                console.error(
                  `Failed to get purchase order ID for item ${item.id}`
                );
                continue;
              }

              let exchangeRate = 1;
              if (supplier?.currencyCode !== baseCurrencyCode) {
                const currency = await getCurrencyByCode(
                  client,
                  companyId,
                  supplier?.currencyCode ?? baseCurrencyCode
                );

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
                console.error(
                  `Failed to create purchase order for item ${item.id}:`,
                  createPurchaseOrder.error
                );
                continue;
              }

              const purchaseOrder = createPurchaseOrder.data?.[0];
              if (!purchaseOrder) {
                console.error(
                  `Failed to get created purchase order for item ${item.id}`
                );
                continue;
              }

              const createPurchaseOrderLine = await upsertPurchaseOrderLine(
                client,
                {
                  purchaseOrderId: purchaseOrder.id,
                  itemId: item.id,
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
                console.error(
                  `Failed to create purchase order line for item ${item.id}:`,
                  createPurchaseOrderLine.error
                );
                continue;
              }
            } else {
              if (order.existingLineId) {
                const updatePurchaseOrderLine = await upsertPurchaseOrderLine(
                  client,
                  {
                    id: order.existingLineId,
                    purchaseOrderId: order.existingId,
                    itemId: item.id,
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
                  console.error(
                    `Failed to update purchase order line ${order.existingLineId}:`,
                    updatePurchaseOrderLine.error
                  );
                  continue;
                }
              } else {
                const insertPurchaseOrderLine = await upsertPurchaseOrderLine(
                  client,
                  {
                    purchaseOrderId: order.existingId,
                    itemId: item.id,
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
                  console.error(
                    `Failed to insert purchase order line for item ${item.id}:`,
                    insertPurchaseOrderLine.error
                  );
                }
              }

              await updatePurchaseOrder(client, {
                id: order.existingId,
                status: "Planned" as const,
                updatedBy: userId,
              });
            }

            const periodId = order.periodId;
            supplyForecastByPeriod[periodId] =
              (supplyForecastByPeriod[periodId] || 0) +
              (order.quantity - (order.existingQuantity ?? 0));
          }

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

        return json({
          success: true,
          message: `Successfully processed ${itemsToOrder.length} items`,
        });
      } catch (error) {
        console.error("Error processing purchase orders:", error);
        return json({
          success: false,
          message: `Error processing purchase orders: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        });
      }

    default:
      return json({ success: false, message: "Invalid field" });
  }
}
