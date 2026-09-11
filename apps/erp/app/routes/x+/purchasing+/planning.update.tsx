import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import {
  applyRate,
  RoundingMode,
  round,
  SCALE,
  taxableBase
} from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import {
  assignPlanningActions,
  dismissPlanningActions,
  getPlanningAction,
  markPlanningActionsActioned
} from "~/modules/production";
import {
  insertPurchaseOrder,
  isPurchaseOrderLocked,
  plannedOrderValidator,
  shortClosePurchaseOrderLine,
  updatePurchaseOrderLineSchedule,
  upsertPurchaseOrderLine
} from "~/modules/purchasing";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "purchasing", "planning");

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

        // Separate existing-line updates from new orders, and group new
        // orders by supplier+period so each period gets its own PO.
        type OrderEntry = {
          itemId: string;
          order: (typeof itemsToOrder)[0]["orders"][0];
        };
        const existingLineUpdates: OrderEntry[] = [];
        const ordersBySupplierPeriod = new Map<string, OrderEntry[]>();
        const errors: string[] = [];

        for (const item of itemsToOrder) {
          itemIds.add(item.id);
          let itemHasUsableOrder = false;
          for (const order of item.orders) {
            if (order.supplierId) supplierIds.add(order.supplierId);
            if (order.periodId) periodIds.add(order.periodId);

            if (order.existingLineId) {
              existingLineUpdates.push({ itemId: item.id, order });
              itemHasUsableOrder = true;
            } else if (order.supplierId && order.periodId) {
              const key = `${order.supplierId}::${order.periodId}`;
              if (!ordersBySupplierPeriod.has(key)) {
                ordersBySupplierPeriod.set(key, []);
              }
              ordersBySupplierPeriod.get(key)!.push({
                itemId: item.id,
                order
              });
              itemHasUsableOrder = true;
            }
          }
          if (!itemHasUsableOrder) {
            errors.push(
              `Item ${item.id} skipped: no order had both a supplier and a period (check that the item has a preferred supplier)`
            );
          }
        }

        const [suppliers, supplierParts, periods, company, currencies] =
          await Promise.all([
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
            client
              .from("currencies")
              .select("code, decimalPlaces")
              .eq("companyGroupId", companyGroupId)
          ]);

        if (suppliers.error) {
          logger.error("Failed to fetch suppliers", { error: suppliers.error });
          return data(
            {
              success: false,
              message: "Failed to retrieve supplier information from database"
            },
            { status: 500 }
          );
        }

        if (supplierParts.error) {
          logger.error("Failed to fetch supplier parts", {
            error: supplierParts.error
          });
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
          logger.error("Failed to fetch periods", { error: periods.error });
          return data(
            {
              success: false,
              message: "Failed to retrieve period information from database"
            },
            { status: 500 }
          );
        }

        if (company.error) {
          logger.error("Failed to fetch company", { error: company.error });
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

        // Settlement amounts round at the currency's own decimals, so the
        // planned order carries a real money value rather than a raw product.
        const currencyDecimals = new Map(
          currencies.data?.map((c) => [c.code, c.decimalPlaces]) ?? []
        );

        let processedItems = 0;

        // ── UPDATE existing draft/planned lines ──
        for (const { order } of existingLineUpdates) {
          const updateLine = await client
            .from("purchaseOrderLine")
            .update({
              purchaseQuantity: order.quantity,
              requiredDate: order.dueDate ?? null,
              updatedBy: userId
            })
            .eq("id", order.existingLineId!);
          if (updateLine.error) {
            errors.push(
              `Failed to update existing PO line ${order.existingLineId}: ${updateLine.error.message}`
            );
          }
        }

        // ── CREATE new PO lines, one PO per supplier+period ──
        // Cache created POs so multiple items in the same supplier+period
        // share one PO. Track readable id too so the client can present a
        // clickable toast.
        const poCache = new Map<string, { id: string; readableId: string }>();

        for (const [key, ordersInGroup] of ordersBySupplierPeriod) {
          const [supplierId, periodId] = key.split("::");
          const supplier = suppliersById.get(supplierId);
          if (!supplier) {
            errors.push(`Supplier ${supplierId} not found`);
            continue;
          }

          // Find or create a PO for this supplier+period
          let purchaseOrderId = poCache.get(key)?.id;
          let purchaseOrderReadableId = poCache.get(key)?.readableId;

          if (!purchaseOrderId) {
            const period = periods.data?.find((p) => p.id === periodId);

            if (period) {
              // Find an existing PO line in this period for this supplier,
              // then use its parent PO.
              const { data: matchingLines } = await client
                .from("purchaseOrderLine")
                .select(
                  "purchaseOrderId, purchaseOrder!inner(readableId:purchaseOrderId, supplierId, status)"
                )
                .gte("requiredDate", period.startDate)
                .lte("requiredDate", period.endDate)
                .eq("purchaseOrder.supplierId", supplierId)
                .in("purchaseOrder.status", ["Draft", "Planned"])
                .limit(1);

              if (matchingLines?.[0]) {
                purchaseOrderId = matchingLines[0].purchaseOrderId;
                purchaseOrderReadableId =
                  matchingLines[0].purchaseOrder?.readableId ?? undefined;
              }
            }
          }

          if (!purchaseOrderId) {
            const createPO = await insertPurchaseOrder(client, {
              status: "Planned",
              supplierId,
              purchaseOrderType: "Purchase",
              currencyCode: supplier.currencyCode ?? baseCurrencyCode,
              companyId,
              companyGroupId,
              createdBy: userId
            });

            if (createPO.error || !createPO.data) {
              errors.push(
                `Failed to create PO for supplier ${supplierId}: ${createPO.error?.message ?? "no data returned"}`
              );
              continue;
            }

            purchaseOrderId = createPO.data.id;
            purchaseOrderReadableId = createPO.data.purchaseOrderId;
          }

          poCache.set(key, {
            id: purchaseOrderId,
            readableId: purchaseOrderReadableId ?? purchaseOrderId
          });

          // Create one line per item in this supplier+period group
          for (const { itemId, order } of ordersInGroup) {
            const supplierPart = supplierParts?.data?.find(
              (sp) => sp.itemId === itemId && sp.supplierId === supplierId
            );

            const purchasing = await client
              .from("itemReplenishment")
              .select("purchasingBlocked")
              .eq("itemId", itemId)
              .single();

            if (purchasing.error) {
              errors.push(
                `Failed to retrieve purchasing data for item ${itemId}: ${purchasing.error.message}`
              );
              continue;
            }

            if (purchasing.data?.purchasingBlocked) {
              errors.push(`Purchasing is blocked for item ${itemId}`);
              continue;
            }

            const minimumOrderQuantity =
              supplierPart?.minimumOrderQuantity ?? 0;
            let adjustedQuantity = order.quantity;
            if (
              minimumOrderQuantity > 0 &&
              adjustedQuantity < minimumOrderQuantity
            ) {
              adjustedQuantity = minimumOrderQuantity;
            }

            // Check if this PO already has a line for the same item
            const { data: existingLines } = await client
              .from("purchaseOrderLine")
              .select("id, purchaseQuantity")
              .eq("purchaseOrderId", purchaseOrderId)
              .eq("itemId", itemId)
              .limit(1);

            if (existingLines?.[0]) {
              const existing = existingLines[0];
              const updateLine = await client
                .from("purchaseOrderLine")
                .update({
                  purchaseQuantity:
                    (existing.purchaseQuantity ?? 0) + adjustedQuantity,
                  updatedBy: userId
                })
                .eq("id", existing.id);

              if (updateLine.error) {
                errors.push(
                  `Failed to update PO line for item ${itemId}: ${updateLine.error.message}`
                );
                continue;
              }
            } else {
              const createLine = await upsertPurchaseOrderLine(client, {
                purchaseOrderId,
                itemId,
                description: order.description,
                purchaseOrderLineType: "Part",
                purchaseQuantity: adjustedQuantity,
                purchaseUnitOfMeasureCode:
                  supplierPart?.supplierUnitOfMeasureCode ??
                  order.unitOfMeasureCode,
                inventoryUnitOfMeasureCode: order.unitOfMeasureCode,
                conversionFactor: supplierPart?.conversionFactor ?? 1,
                supplierUnitPrice: supplierPart?.unitPrice ?? 0,
                // supplier.taxPercent is a 0..1 fraction; the amount follows
                // the canonical denominator. Shipping is hardcoded 0 on this
                // path, so it is passed explicitly rather than omitted.
                taxPercent: supplier.taxPercent ?? 0,
                supplierTaxAmount: applyRate(
                  taxableBase(
                    supplierPart?.unitPrice ?? 0,
                    adjustedQuantity,
                    0
                  ),
                  supplier.taxPercent ?? 0,
                  currencyDecimals.get(
                    supplier.currencyCode ?? baseCurrencyCode
                  ) ?? SCALE
                ),
                supplierShippingCost: 0,
                requiredDate: order.dueDate ?? undefined,
                locationId,
                companyId,
                createdBy: userId
              });

              if (createLine.error) {
                errors.push(
                  `Failed to create PO line for item ${itemId}: ${createLine.error.message}`
                );
                continue;
              }
            }

            processedItems++;

            const conversionFactor = supplierPart?.conversionFactor ?? 1;
            allSupplyForecasts.push({
              itemId,
              locationId,
              sourceType: "Purchase Order" as const,
              forecastQuantity: order.quantity * conversionFactor,
              periodId,
              companyId,
              createdBy: userId,
              updatedBy: userId
            });
          }
        }

        if (allSupplyForecasts.length > 0) {
          const uniqueSupplyForecasts =
            deduplicateForecasts(allSupplyForecasts);

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

        // Dedupe by PO id — multiple supplier+period buckets can land on
        // the same PO when an existing Draft/Planned PO covers them.
        const purchaseOrders = Array.from(
          new Map(
            Array.from(poCache.values()).map((po) => [po.id, po])
          ).values()
        );

        return {
          success: processedItems > 0,
          message,
          processedItems,
          totalItems: itemsToOrder.length,
          purchaseOrders,
          errors: errors.length > 0 ? errors : undefined
        };
      } catch (error) {
        logger.error("Unexpected error processing purchase orders", { error });
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

    // ── Apply a persisted planning action to its target PO line (spec §P1.5).
    // IDOR guard: the request carries ONLY planningActionIds — the type, target
    // and proposal values come from the persisted row, loaded by id+companyId
    // and required to be Open. The commitment gate re-reads the parent PO
    // status; a locked (sent) PO is never silently edited.
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

      const db = getDatabaseClient();
      const applied: string[] = [];
      const requiresManualAction: {
        id: string;
        purchaseOrderId: string | null;
      }[] = [];
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
        if (!row.purchaseOrderLineId) {
          errors.push(
            `Planning action ${planningActionId} does not target a purchase order line`
          );
          continue;
        }

        const line = await client
          .from("purchaseOrderLine")
          .select(
            "id, purchaseOrderId, conversionFactor, purchaseOrder!inner(id, status)"
          )
          .eq("id", row.purchaseOrderLineId)
          .eq("companyId", companyId)
          .single();
        if (line.error || !line.data) {
          errors.push(
            `Purchase order line for planning action ${planningActionId} not found`
          );
          continue;
        }

        const poStatus = line.data.purchaseOrder?.status;
        if (!poStatus || isPurchaseOrderLocked(poStatus)) {
          // committed supply — surface "Review on PO" instead of editing
          requiresManualAction.push({
            id: planningActionId,
            purchaseOrderId: line.data.purchaseOrderId
          });
          continue;
        }

        if (action === "cancel") {
          try {
            await shortClosePurchaseOrderLine(db, {
              lineId: line.data.id,
              purchaseOrderId: line.data.purchaseOrderId,
              companyId,
              userId,
              intent: "close"
            });
          } catch (err) {
            errors.push(
              `Failed to close PO line for planning action ${planningActionId}: ${
                err instanceof Error ? err.message : "unknown error"
              }`
            );
            continue;
          }
        } else if (action === "expedite" || action === "defer") {
          const update = await updatePurchaseOrderLineSchedule(client, {
            lineId: line.data.id,
            companyId,
            userId,
            requiredDate: row.suggestedDate
          });
          if (update.error) {
            errors.push(
              `Failed to reschedule PO line for planning action ${planningActionId}: ${update.error.message}`
            );
            continue;
          }
        } else {
          // increase / decrease — suggestedQuantity is in INVENTORY units;
          // the line stores PURCHASE units
          const conversionFactor = line.data.conversionFactor ?? 1;
          const purchaseQuantity =
            conversionFactor > 0
              ? round(
                  Number(row.suggestedQuantity) / conversionFactor,
                  0,
                  RoundingMode.Up
                )
              : Number(row.suggestedQuantity);
          const update = await updatePurchaseOrderLineSchedule(client, {
            lineId: line.data.id,
            companyId,
            userId,
            purchaseQuantity
          });
          if (update.error) {
            errors.push(
              `Failed to update PO line quantity for planning action ${planningActionId}: ${update.error.message}`
            );
            continue;
          }
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

function deduplicateForecasts<
  T extends {
    itemId: string;
    locationId: string;
    periodId: string;
    forecastQuantity: number;
  }
>(forecasts: T[]): T[] {
  const map = new Map<string, T>();
  for (const forecast of forecasts) {
    const key = `${forecast.itemId}-${forecast.locationId}-${forecast.periodId}`;
    const existing = map.get(key);
    if (existing) {
      existing.forecastQuantity += forecast.forecastQuantity;
    } else {
      map.set(key, { ...forecast });
    }
  }
  return Array.from(map.values());
}
