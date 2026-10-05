// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { applyRate, SCALE, taxableBase } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import {
  insertPurchaseOrder,
  plannedOrderValidator,
  upsertPurchaseOrderLine
} from "~/modules/purchasing";
import { requireCompanyRecord } from "~/modules/shared/shared.server";

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

  const { items, action, locationId } = await request.json();

  if (typeof locationId !== "string") {
    logger.warn("Planning update rejected: locationId missing", {
      companyId,
      userId,
      action,
      locationIdType: typeof locationId
    });
    return data(
      {
        success: false,
        message: "Location ID is required and must be a valid string"
      },
      { status: 500 }
    );
  }

  if (typeof action !== "string") {
    logger.warn("Planning update rejected: action missing", {
      companyId,
      userId,
      locationId,
      actionType: typeof action
    });
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

        logger.warn("Planning order payload failed validation", {
          companyId,
          userId,
          locationId,
          errors: errorMessages,
          issues: parsedItems.error.issues
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
        logger.warn("Planning order payload had no items", {
          companyId,
          userId,
          locationId
        });
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
        // orders by supplier so every supplier gets exactly one PO per
        // submit. Each line keeps its own requiredDate, so per-period timing
        // lives on the lines rather than on separate headers.
        type OrderEntry = {
          itemId: string;
          order: (typeof itemsToOrder)[0]["orders"][0];
        };
        const existingLineUpdates: OrderEntry[] = [];
        const ordersBySupplier = new Map<string, OrderEntry[]>();
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
              if (!ordersBySupplier.has(order.supplierId)) {
                ordersBySupplier.set(order.supplierId, []);
              }
              ordersBySupplier.get(order.supplierId)!.push({
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

        logger.info("Planning order request grouped by supplier", {
          companyId,
          userId,
          locationId,
          itemCount: itemsToOrder.length,
          existingLineUpdates: existingLineUpdates.length,
          suppliers: Array.from(ordersBySupplier, ([supplierId, orders]) => ({
            supplierId,
            orderCount: orders.length
          }))
        });

        // bypassRls hands back the service role, and every id below comes
        // from the request body: the location, items and existing lines must
        // belong to this company before anything is read or written by them
        // (supplyForecast upserts on (itemId, locationId, periodId) alone).
        const existingLineIds = existingLineUpdates.map(
          ({ order }) => order.existingLineId!
        );
        await requireCompanyRecord(client, "location", companyId, {
          id: locationId
        });
        const [ownedItems, ownedLines] = await Promise.all([
          client
            .from("item")
            .select("id")
            .in("id", Array.from(itemIds))
            .eq("companyId", companyId),
          existingLineIds.length > 0
            ? client
                .from("purchaseOrderLine")
                .select("id")
                .in("id", existingLineIds)
                .eq("companyId", companyId)
            : Promise.resolve({ data: [] as { id: string }[], error: null })
        ]);
        if (
          ownedItems.error ||
          ownedLines.error ||
          (ownedItems.data?.length ?? 0) !== itemIds.size ||
          (ownedLines.data?.length ?? 0) !== new Set(existingLineIds).size
        ) {
          logger.error("Planning order references records outside company", {
            companyId,
            userId,
            locationId,
            itemIds: Array.from(itemIds),
            existingLineIds,
            error: ownedItems.error ?? ownedLines.error
          });
          return data(
            {
              success: false,
              message: "Item or purchase order line not found"
            },
            { status: 404 }
          );
        }

        const [suppliers, supplierParts, company, currencies] =
          await Promise.all([
            client
              .from("supplier")
              .select("id, name, taxPercent, currencyCode")
              .in("id", Array.from(supplierIds))
              .eq("companyId", companyId),
            client
              .from("supplierPart")
              .select("*")
              .in("itemId", Array.from(itemIds))
              .eq("companyId", companyId),
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
            .eq("id", order.existingLineId!)
            .eq("companyId", companyId);
          if (updateLine.error) {
            logger.error("Failed to update existing PO line", {
              companyId,
              userId,
              locationId,
              purchaseOrderLineId: order.existingLineId,
              error: updateLine.error
            });
            errors.push(
              `Failed to update existing PO line ${order.existingLineId}: ${updateLine.error.message}`
            );
          }
        }

        // ── CREATE new PO lines, one PO per supplier ──
        // Track readable id too so the client can present a clickable toast.
        const poCache = new Map<string, { id: string; readableId: string }>();

        // Whether purchasing is blocked, for every item ordered, in one read
        const purchasingRows = await client
          .from("itemReplenishment")
          .select("itemId, purchasingBlocked")
          .in("itemId", Array.from(itemIds))
          .eq("companyId", companyId);
        const purchasingByItem = new Map(
          (purchasingRows.data ?? []).map((row) => [row.itemId, row])
        );

        for (const [supplierId, ordersInGroup] of ordersBySupplier) {
          const supplier = suppliersById.get(supplierId);
          if (!supplier) {
            logger.warn("Planning order supplier not found", {
              companyId,
              userId,
              locationId,
              supplierId
            });
            errors.push(`Supplier ${supplierId} not found`);
            continue;
          }

          // Reuse the supplier's open Planned/Draft PO for this location,
          // else create one. Looking up the header directly (rather than a
          // line whose requiredDate falls in a period) means a null or
          // overdue due date can no longer miss the match and spawn a
          // duplicate PO.
          let purchaseOrderId: string | undefined;
          let purchaseOrderReadableId: string | undefined;

          const existingPO = await client
            .from("purchaseOrder")
            .select(
              "id, purchaseOrderId, purchaseOrderDelivery!inner(locationId)"
            )
            .eq("companyId", companyId)
            .eq("supplierId", supplierId)
            .eq("purchaseOrderType", "Purchase")
            .in("status", ["Draft", "Planned"])
            .eq("purchaseOrderDelivery.locationId", locationId)
            .order("createdAt", { ascending: true })
            .limit(1)
            .maybeSingle();

          if (existingPO.error) {
            logger.error("Failed to look up existing PO for supplier", {
              companyId,
              userId,
              locationId,
              supplierId,
              error: existingPO.error
            });
            errors.push(
              `Failed to look up existing PO for supplier ${supplierId}: ${existingPO.error.message}`
            );
            continue;
          }

          if (existingPO.data) {
            purchaseOrderId = existingPO.data.id;
            purchaseOrderReadableId = existingPO.data.purchaseOrderId;
            logger.info("Reusing open PO for supplier", {
              companyId,
              userId,
              locationId,
              supplierId,
              purchaseOrderId,
              readableId: purchaseOrderReadableId,
              orderCount: ordersInGroup.length
            });
          } else {
            const createPO = await insertPurchaseOrder(client, {
              status: "Planned",
              supplierId,
              purchaseOrderType: "Purchase",
              currencyCode: supplier.currencyCode ?? baseCurrencyCode,
              locationId,
              companyId,
              companyGroupId,
              createdBy: userId
            });

            if (createPO.error || !createPO.data) {
              logger.error("Failed to create PO for supplier", {
                companyId,
                userId,
                locationId,
                supplierId,
                error: createPO.error
              });
              errors.push(
                `Failed to create PO for supplier ${supplierId}: ${createPO.error?.message ?? "no data returned"}`
              );
              continue;
            }

            purchaseOrderId = createPO.data.id;
            purchaseOrderReadableId = createPO.data.purchaseOrderId;
            logger.info("Created PO for supplier", {
              companyId,
              userId,
              locationId,
              supplierId,
              purchaseOrderId,
              readableId: purchaseOrderReadableId,
              orderCount: ordersInGroup.length
            });
          }

          poCache.set(supplierId, {
            id: purchaseOrderId,
            readableId: purchaseOrderReadableId ?? purchaseOrderId
          });

          // Create one line per order for this supplier
          for (const { itemId, order } of ordersInGroup) {
            const supplierPart = supplierParts?.data?.find(
              (sp) => sp.itemId === itemId && sp.supplierId === supplierId
            );

            const purchasing = {
              data: purchasingByItem.get(itemId),
              error:
                purchasingRows.error ??
                (purchasingByItem.has(itemId)
                  ? null
                  : { message: "No replenishment record" })
            };

            if (purchasing.error) {
              logger.error("Failed to retrieve item replenishment", {
                companyId,
                userId,
                locationId,
                supplierId,
                purchaseOrderId,
                itemId,
                error: purchasing.error
              });
              errors.push(
                `Failed to retrieve purchasing data for item ${itemId}: ${purchasing.error.message}`
              );
              continue;
            }

            if (purchasing.data?.purchasingBlocked) {
              logger.warn("Planning order skipped: purchasing blocked", {
                companyId,
                userId,
                locationId,
                supplierId,
                purchaseOrderId,
                itemId
              });
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

            // Check if this PO already has a line for the same item due on
            // the same date. Orders for different weeks stay on separate
            // lines so each keeps its own required date.
            let existingLineQuery = client
              .from("purchaseOrderLine")
              .select("id, purchaseQuantity")
              .eq("purchaseOrderId", purchaseOrderId)
              .eq("itemId", itemId)
              .eq("companyId", companyId);
            existingLineQuery = order.dueDate
              ? existingLineQuery.eq("requiredDate", order.dueDate)
              : existingLineQuery.is("requiredDate", null);
            const { data: existingLines } = await existingLineQuery.limit(1);

            if (existingLines?.[0]) {
              const existing = existingLines[0];
              const updateLine = await client
                .from("purchaseOrderLine")
                .update({
                  purchaseQuantity:
                    (existing.purchaseQuantity ?? 0) + adjustedQuantity,
                  updatedBy: userId
                })
                .eq("id", existing.id)
                .eq("companyId", companyId);

              if (updateLine.error) {
                logger.error("Failed to merge PO line", {
                  companyId,
                  userId,
                  locationId,
                  purchaseOrderId,
                  purchaseOrderLineId: existing.id,
                  itemId,
                  error: updateLine.error
                });
                errors.push(
                  `Failed to update PO line for item ${itemId}: ${updateLine.error.message}`
                );
                continue;
              }
              logger.info("Merged planned order into existing PO line", {
                companyId,
                userId,
                locationId,
                purchaseOrderId,
                purchaseOrderLineId: existing.id,
                itemId,
                requiredDate: order.dueDate ?? null,
                previousQuantity: existing.purchaseQuantity ?? 0,
                addedQuantity: adjustedQuantity
              });
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
                logger.error("Failed to create PO line", {
                  companyId,
                  userId,
                  locationId,
                  purchaseOrderId,
                  itemId,
                  error: createLine.error
                });
                errors.push(
                  `Failed to create PO line for item ${itemId}: ${createLine.error.message}`
                );
                continue;
              }
              logger.info("Created PO line from planned order", {
                companyId,
                userId,
                locationId,
                purchaseOrderId,
                itemId,
                requiredDate: order.dueDate ?? null,
                quantity: adjustedQuantity,
                minimumOrderQuantityApplied: adjustedQuantity !== order.quantity
              });
            }

            processedItems++;

            const conversionFactor = supplierPart?.conversionFactor ?? 1;
            allSupplyForecasts.push({
              itemId,
              locationId,
              sourceType: "Purchase Order" as const,
              forecastQuantity: order.quantity * conversionFactor,
              periodId: order.periodId,
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
          logger.error("Failed to process any planning orders", {
            companyId,
            userId,
            locationId,
            itemIds: Array.from(itemIds),
            supplierIds: Array.from(supplierIds),
            periodIds: Array.from(periodIds),
            errors
          });
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

        if (errors.length > 0) {
          logger.warn("Planning orders processed with errors", {
            companyId,
            userId,
            locationId,
            processedItems,
            totalItems: itemsToOrder.length,
            purchaseOrderIds: purchaseOrders.map((po) => po.readableId),
            errors
          });
        } else {
          logger.info("Planning orders processed", {
            companyId,
            userId,
            locationId,
            processedItems,
            totalItems: itemsToOrder.length,
            purchaseOrderIds: purchaseOrders.map((po) => po.readableId)
          });
        }

        return {
          success: processedItems > 0,
          message,
          processedItems,
          totalItems: itemsToOrder.length,
          purchaseOrders,
          errors: errors.length > 0 ? errors : undefined
        };
      } catch (error) {
        logger.error("Unexpected error processing purchase orders", {
          companyId,
          userId,
          locationId,
          error
        });
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
