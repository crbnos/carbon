// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { hasPermission } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getUserClaims } from "@carbon/auth/users.server";
import type { Database } from "@carbon/database";
import {
  convertUnitPrice,
  supplierPartCurrency
} from "@carbon/database/supplier-part-price";
import { getLogger } from "@carbon/logger";
import { applyRate, datetime, SCALE, taxableBase } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import {
  assignPlanningActions,
  dismissPlanningActions,
  getPlanningActionsByIds,
  reopenDismissedPlanningActions,
  settleNewSupplyPlanningActions
} from "~/modules/production";
import {
  applyPurchasingPlanningActions,
  findPlanningPurchaseOrder,
  insertPurchaseOrder,
  isPurchaseOrderEditableFromPlanning,
  plannedOrderValidator,
  planningPurchaseOrderWeek,
  taxPairForQuantity,
  updatePurchaseOrderLineSchedule,
  upsertPurchaseOrderLine
} from "~/modules/purchasing";
import {
  isActiveCompanyEmployee,
  requireCompanyRecord
} from "~/modules/shared/shared.server";
import { getLocationTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "purchasing", "planning");

type PlanningActionRow = NonNullable<
  Awaited<ReturnType<typeof getPlanningActionsByIds>>["data"]
>[number];

/**
 * The date the supplier promised for a PO line: the line's own, else its
 * order's delivery date — the same COALESCE the `openPurchaseOrderLines` view
 * gives MRP. MRP dates the line by this ahead of the required date, so a
 * planning date change (which writes the required date) cannot move it.
 */
function promisedDateOf(line: {
  promisedDate: string | null;
  receiptPromisedDate: string | null | undefined;
}): string | null {
  return line.promisedDate ?? line.receiptPromisedDate ?? null;
}

/** A PO line an Apply targets, with its order's status and delivery promise. */
type PlanningLine = {
  id: string;
  purchaseOrderId: string;
  conversionFactor: number | null;
  promisedDate: string | null;
  purchaseOrderStatus:
    | Database["public"]["Enums"]["purchaseOrderStatus"]
    | null;
  receiptPromisedDate: string | null;
};

const itemsValidator = z
  .object({
    id: z.string(),
    orders: z.array(plannedOrderValidator)
  })
  .array();

export async function action({ request }: ActionFunctionArgs) {
  const { items, action, locationId, planningActionIds, assignee, line } =
    await request.json();

  // Creating planned orders is `create`; everything else here changes records
  // that already exist (apply, inline edits, dismiss, reopen, assign), which
  // the purchase order screens gate on `update`. The client is the service
  // role, so this check is the only one.
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      ...(action === "order"
        ? { create: "purchasing" }
        : { update: "purchasing" }),
      role: "employee",
      bypassRls: true
    });

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
      { status: 400 }
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
      { status: 400 }
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
          { status: 400 }
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
          { status: 400 }
        );
      }

      // `order` only creates PO lines. An existing line is changed through
      // `updateLine` or Apply, which carry the status, promised-date and
      // tax-pair guards; a stale client naming one here would get a duplicate.
      if (
        itemsToOrder.some((item) =>
          item.orders.some((o) => o.existingLineId || o.existingId)
        )
      ) {
        logger.warn("Planning order named an existing purchase order line", {
          companyId,
          userId,
          locationId
        });
        return data(
          {
            success: false,
            message: "Existing orders are changed from the Open Orders list"
          },
          { status: 400 }
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

        // Group new orders by supplier; below, each supplier's orders are
        // split again by week, so a supplier gets one PO per week. An
        // existing line is never edited here except to add a same-item,
        // same-date order to it: the drawer's inline edit and Apply go
        // through updatePurchaseOrderLineSchedule, which carries the status,
        // promised-date and tax-pair guards.
        type OrderEntry = {
          itemId: string;
          order: (typeof itemsToOrder)[0]["orders"][0];
        };
        const ordersBySupplier = new Map<string, OrderEntry[]>();
        const errors: string[] = [];
        // The (item, week) of every order that became a PO line, so the Order
        // suggestions it answers leave the worklist now, not at the next run.
        const ordered: { itemId: string; periodId: string }[] = [];

        for (const item of itemsToOrder) {
          itemIds.add(item.id);
          let itemHasUsableOrder = false;
          for (const order of item.orders) {
            if (order.supplierId) supplierIds.add(order.supplierId);
            if (order.periodId) periodIds.add(order.periodId);

            if (order.supplierId && order.periodId) {
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
          suppliers: Array.from(ordersBySupplier, ([supplierId, orders]) => ({
            supplierId,
            orderCount: orders.length
          }))
        });

        // bypassRls hands back the service role, and every id below comes
        // from the request body: the location and items must belong to this
        // company before anything is read or written by them
        // (supplyForecast upserts on (itemId, locationId, periodId) alone).
        await requireCompanyRecord(client, "location", companyId, {
          id: locationId
        });
        const ownedItems = await client
          .from("item")
          .select("id")
          .in("id", Array.from(itemIds))
          .eq("companyId", companyId);
        if (
          ownedItems.error ||
          (ownedItems.data?.length ?? 0) !== itemIds.size
        ) {
          logger.error("Planning order references records outside company", {
            companyId,
            userId,
            locationId,
            itemIds: Array.from(itemIds),
            error: ownedItems.error
          });
          return data(
            { success: false, message: "Item not found" },
            { status: 404 }
          );
        }

        const [suppliers, supplierParts, company, currencies, exchangeRates] =
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
              .eq("companyGroupId", companyGroupId),
            // Today's rate for each currency a supplier part is priced in.
            client.rpc("get_exchange_rates", { p_company_id: companyId })
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
        const exchangeRateByCurrency = new Map(
          (exchangeRates.data ?? []).map((rate) => [
            rate.currencyCode,
            rate.rate
          ])
        );

        // Settlement amounts round at the currency's own decimals, so the
        // planned order carries a real money value rather than a raw product.
        const currencyDecimals = new Map(
          currencies.data?.map((c) => [c.code, c.decimalPlaces]) ?? []
        );

        let processedItems = 0;

        // ── CREATE new PO lines, one PO per supplier per week ──
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

        // Weeks are counted from the location's today, as the planning
        // grid's are.
        const asOf = datetime.today(
          await getLocationTimeZone(client, locationId, companyId)
        );

        // Every open PO an order may join, with its lines, in one read: the
        // suppliers' Draft / Planned purchase orders at this location, oldest
        // first. The lines tell which weeks a PO already covers, and which
        // line a same-item, same-date order adds its quantity to.
        const openPurchaseOrders = await client
          .from("purchaseOrder")
          .select(
            "id, purchaseOrderId, supplierId, currencyCode, exchangeRate, createdFromPlanning, purchaseOrderDelivery!inner(locationId), purchaseOrderLine(id, itemId, requiredDate, purchaseQuantity, supplierUnitPrice, supplierShippingCost, taxPercent, supplierTaxAmount)"
          )
          .eq("companyId", companyId)
          .in("supplierId", Array.from(ordersBySupplier.keys()))
          .eq("purchaseOrderType", "Purchase")
          .in("status", ["Draft", "Planned"])
          .eq("purchaseOrderDelivery.locationId", locationId)
          .order("createdAt", { ascending: true });

        if (openPurchaseOrders.error) {
          logger.error("Failed to look up open POs for planning orders", {
            companyId,
            userId,
            locationId,
            supplierIds: Array.from(ordersBySupplier.keys()),
            error: openPurchaseOrders.error
          });
          return data(
            {
              success: false,
              message: "Failed to retrieve open purchase orders from database"
            },
            { status: 500 }
          );
        }

        const candidatePurchaseOrders = openPurchaseOrders.data.map((po) => ({
          id: po.id,
          purchaseOrderId: po.purchaseOrderId,
          supplierId: po.supplierId,
          currencyCode: po.currencyCode,
          exchangeRate: po.exchangeRate ?? 1,
          createdFromPlanning: po.createdFromPlanning,
          purchaseOrderLine: po.purchaseOrderLine ?? []
        }));

        // The POs this submit raised, and the planning POs it added to: their
        // approval bypass (`createdFromPlanning`) is restored once their lines
        // are written, since the shared line writer clears it on any change.
        // A Draft / Planned PO someone created by hand stays unflagged.
        const planningPurchaseOrderIds = new Set<string>();

        for (const [supplierId, ordersForSupplier] of ordersBySupplier) {
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

          const currencyCode = supplier.currencyCode ?? baseCurrencyCode;
          const decimals = currencyDecimals.get(currencyCode) ?? SCALE;

          // One PO per supplier per week, so each week's PO is finalized and
          // sent on its own and the later weeks stay Planned, where MRP can
          // still move, resize or cancel them.
          const ordersByWeek = new Map<string, OrderEntry[]>();
          for (const entry of ordersForSupplier) {
            const week = planningPurchaseOrderWeek(entry.order.dueDate, asOf);
            ordersByWeek.set(week, [...(ordersByWeek.get(week) ?? []), entry]);
          }

          for (const [week, ordersInGroup] of ordersByWeek) {
            // Reuse the supplier's open Draft / Planned PO whose lines are all
            // in this week, in the supplier's currency, else create one.
            let purchaseOrder = findPlanningPurchaseOrder(
              candidatePurchaseOrders,
              { supplierId, currencyCode, week },
              asOf
            );

            if (purchaseOrder) {
              if (purchaseOrder.createdFromPlanning) {
                planningPurchaseOrderIds.add(purchaseOrder.id);
              }
              logger.info("Reusing open PO for supplier week", {
                companyId,
                userId,
                locationId,
                supplierId,
                week,
                purchaseOrderId: purchaseOrder.id,
                readableId: purchaseOrder.purchaseOrderId,
                orderCount: ordersInGroup.length
              });
            } else {
              const createPO = await insertPurchaseOrder(client, {
                status: "Planned",
                supplierId,
                purchaseOrderType: "Purchase",
                currencyCode,
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
                  week,
                  error: createPO.error
                });
                errors.push(
                  `Failed to create PO for supplier ${supplierId}: ${createPO.error?.message ?? "no data returned"}`
                );
                continue;
              }

              purchaseOrder = {
                id: createPO.data.id,
                purchaseOrderId: createPO.data.purchaseOrderId,
                supplierId,
                currencyCode,
                exchangeRate: createPO.data.exchangeRate,
                createdFromPlanning: true,
                purchaseOrderLine: []
              };
              planningPurchaseOrderIds.add(createPO.data.id);
              candidatePurchaseOrders.push(purchaseOrder);
              logger.info("Created PO for supplier week", {
                companyId,
                userId,
                locationId,
                supplierId,
                week,
                purchaseOrderId: purchaseOrder.id,
                readableId: purchaseOrder.purchaseOrderId,
                orderCount: ordersInGroup.length
              });
            }

            const purchaseOrderId = purchaseOrder.id;
            poCache.set(`${supplierId}:${week}`, {
              id: purchaseOrderId,
              readableId: purchaseOrder.purchaseOrderId ?? purchaseOrderId
            });

            // Create one line per order for this supplier and week
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

              // An order for an item the PO already has on the same date adds
              // to that line. Orders for different dates stay on separate
              // lines so each keeps its own required date.
              const requiredDate = order.dueDate ?? null;
              const existing = purchaseOrder.purchaseOrderLine.find(
                (line) =>
                  line.itemId === itemId && line.requiredDate === requiredDate
              );

              if (existing) {
                const purchaseQuantity =
                  (existing.purchaseQuantity ?? 0) + adjustedQuantity;
                // The extended price follows the quantity on its own; the tax
                // amount is stored, so it is restated at the line's rate.
                const tax = taxPairForQuantity(
                  existing,
                  purchaseQuantity,
                  decimals
                );
                const updateLine = await client
                  .from("purchaseOrderLine")
                  .update({
                    purchaseQuantity,
                    taxPercent: tax.percent,
                    supplierTaxAmount: tax.amount,
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
                  requiredDate,
                  previousQuantity: existing.purchaseQuantity ?? 0,
                  addedQuantity: adjustedQuantity
                });
                existing.purchaseQuantity = purchaseQuantity;
                existing.taxPercent = tax.percent;
                existing.supplierTaxAmount = tax.amount;
              } else {
                // The supplier part's price is in its own currency; the line
                // holds the order's, converted at today's rate.
                const partCurrency = supplierPartCurrency(
                  supplierPart?.currencyCode,
                  baseCurrencyCode
                );
                // Base is always 1, whether or not the group lists it.
                const partRate =
                  partCurrency === baseCurrencyCode
                    ? 1
                    : exchangeRateByCurrency.get(partCurrency);
                if (
                  supplierPart?.supplierUnitPrice != null &&
                  partCurrency !== currencyCode &&
                  !partRate
                ) {
                  logger.error("No exchange rate for supplier part currency", {
                    companyId,
                    userId,
                    locationId,
                    purchaseOrderId,
                    itemId,
                    currencyCode: partCurrency
                  });
                  errors.push(
                    `No exchange rate for ${partCurrency}: set one in Accounting → Exchange Rates`
                  );
                  continue;
                }
                const supplierUnitPrice =
                  supplierPart?.supplierUnitPrice != null
                    ? convertUnitPrice(
                        supplierPart.supplierUnitPrice,
                        {
                          currencyCode: partCurrency,
                          exchangeRate: partRate ?? 1
                        },
                        {
                          currencyCode,
                          exchangeRate: purchaseOrder.exchangeRate
                        }
                      )
                    : 0;
                const taxPercent = supplier.taxPercent ?? 0;
                // supplier.taxPercent is a 0..1 fraction; the amount follows
                // the canonical denominator. Shipping is hardcoded 0 on this
                // path, so it is passed explicitly rather than omitted.
                const supplierTaxAmount = applyRate(
                  taxableBase(supplierUnitPrice, adjustedQuantity, 0),
                  taxPercent,
                  decimals
                );
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
                  supplierUnitPrice,
                  exchangeRate: purchaseOrder.exchangeRate,
                  taxPercent,
                  supplierTaxAmount,
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
                  requiredDate,
                  quantity: adjustedQuantity,
                  minimumOrderQuantityApplied:
                    adjustedQuantity !== order.quantity
                });
                purchaseOrder.purchaseOrderLine.push({
                  id: createLine.data.id,
                  itemId,
                  requiredDate,
                  purchaseQuantity: adjustedQuantity,
                  supplierUnitPrice,
                  supplierShippingCost: 0,
                  taxPercent,
                  supplierTaxAmount
                });
              }

              processedItems++;
              ordered.push({ itemId, periodId: order.periodId });

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

        if (planningPurchaseOrderIds.size > 0) {
          const flagged = await client
            .from("purchaseOrder")
            .update({ createdFromPlanning: true })
            .in("id", [...planningPurchaseOrderIds])
            .eq("companyId", companyId);
          if (flagged.error) {
            // The orders stand; they go through approval like any other PO.
            logger.error("Failed to mark planning purchase orders", {
              companyId,
              userId,
              purchaseOrderIds: [...planningPurchaseOrderIds],
              error: flagged.error
            });
          }
        }

        const settled = await settleNewSupplyPlanningActions(
          getDatabaseClient(),
          { companyId, locationId, userId, type: "Order", ordered }
        );
        if (settled.error) {
          // The PO lines stand; the suggestions clear on the next MRP run.
          logger.error("Failed to settle ordered planning actions", {
            companyId,
            userId,
            locationId,
            error: settled.error
          });
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

        // Dedupe by PO id. Each supplier week has its own PO, so this is
        // only a guard.
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

    // ── Save ONE field of ONE existing PO line: the planning drawer's Open
    // Orders table autosaves a quantity or due date cell here. The line is
    // re-read under companyId (the client is the service role and the id comes
    // from the body), and the same commitment gate as Apply holds: a PO that
    // has been sent is never edited from planning.
    case "updateLine": {
      const parsedLine = z
        .discriminatedUnion("field", [
          z.object({
            id: z.string().min(1),
            field: z.literal("quantity"),
            value: z.number().positive()
          }),
          z.object({
            id: z.string().min(1),
            field: z.literal("dueDate"),
            value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
          })
        ])
        .safeParse(line);
      if (!parsedLine.success) {
        return data(
          {
            success: false,
            message:
              "A purchase order line needs a quantity above zero or a valid date"
          },
          { status: 400 }
        );
      }

      const target = await client
        .from("purchaseOrderLine")
        .select(
          "id, locationId, promisedDate, purchaseOrder!inner(id, status, purchaseOrderDelivery(receiptPromisedDate))"
        )
        .eq("id", parsedLine.data.id)
        .eq("companyId", companyId)
        .maybeSingle();
      if (target.error || !target.data) {
        return data(
          { success: false, message: "Purchase order line not found" },
          { status: 404 }
        );
      }

      // The drawer lists one location's orders; a request for another
      // location's line did not come from it.
      if (target.data.locationId !== locationId) {
        return data(
          {
            success: false,
            message: "This purchase order line is for another location."
          },
          { status: 409 }
        );
      }

      const targetStatus = target.data.purchaseOrder?.status;
      if (!isPurchaseOrderEditableFromPlanning(targetStatus)) {
        return data(
          {
            success: false,
            message:
              "This purchase order is in approval or has been sent to the supplier. Change it on the order."
          },
          { status: 409 }
        );
      }

      if (
        parsedLine.data.field === "dueDate" &&
        promisedDateOf({
          promisedDate: target.data.promisedDate,
          receiptPromisedDate:
            target.data.purchaseOrder?.purchaseOrderDelivery
              ?.receiptPromisedDate
        }) !== null
      ) {
        return data(
          {
            success: false,
            message:
              "The supplier has promised a date for this line. Change it on the order."
          },
          { status: 409 }
        );
      }

      const saved = await updatePurchaseOrderLineSchedule(
        client,
        getDatabaseClient(),
        {
          lineId: target.data.id,
          companyId,
          companyGroupId,
          userId,
          ...(parsedLine.data.field === "quantity"
            ? { purchaseQuantity: parsedLine.data.value }
            : { requiredDate: parsedLine.data.value })
        }
      );
      if (saved.error) {
        logger.error("Failed to save PO line from planning", {
          companyId,
          userId,
          purchaseOrderLineId: target.data.id,
          field: parsedLine.data.field,
          error: saved.error
        });
        return data(
          { success: false, message: "Failed to update purchase order line" },
          { status: 500 }
        );
      }

      if (!saved.updated) {
        // Sent or put in approval after the status check above.
        return data(
          {
            success: false,
            message:
              "This purchase order is in approval or has been sent to the supplier. Change it on the order."
          },
          { status: 409 }
        );
      }

      return { success: true, message: "Updated purchase order line" };
    }

    // ── Apply a persisted planning action to its target PO line (spec §P1.5).
    // IDOR guard: the request carries ONLY planningActionIds — the type, target
    // and proposal values come from the persisted row, loaded by id+companyId
    // and required to be Open. The commitment gate re-reads the parent PO
    // status; a locked (sent) PO is never silently edited.
    // "apply" batches a mixed selection in ONE request (the client has a
    // single fetcher, so per-type requests would supersede each other) — each
    // row's own persisted type decides what happens to it.
    case "apply":
    case "expedite":
    case "defer":
    case "increase":
    case "decrease":
    case "cancel": {
      // The same id twice (a row selected in two places) is one action.
      const parsedIds = z
        .array(z.string().min(1))
        .min(1)
        .transform((ids) => [...new Set(ids)])
        .safeParse(planningActionIds);
      if (!parsedIds.success) {
        return data(
          { success: false, message: "planningActionIds is required" },
          { status: 400 }
        );
      }

      const wireToType: Record<string, string> = {
        expedite: "Expedite",
        defer: "Defer",
        increase: "Increase",
        decrease: "Decrease",
        cancel: "Cancel"
      };
      const changeActionTypes = new Set(Object.values(wireToType));

      const db = getDatabaseClient();
      const applied: string[] = [];
      const requiresManualAction: {
        id: string;
        purchaseOrderId: string | null;
      }[] = [];
      const errors: string[] = [];

      // Cancel DELETES the PO line, which the purchase order screen gates on
      // `delete`. Read once, only when a Cancel is in the batch.
      let canDeleteLines: boolean | undefined;
      const mayDeleteLines = async () => {
        canDeleteLines ??= hasPermission(
          (await getUserClaims(userId, companyId))?.permissions,
          "purchasing",
          "delete",
          companyId
        );
        return canDeleteLines;
      };

      // Two reads for the whole batch to decide what is eligible, then ONE
      // transaction that applies all of it (applyPurchasingPlanningActions).
      // The batch used to read the action and read its line one at a time —
      // three round trips per action before anything changed.
      const actionRows = await getPlanningActionsByIds(db, {
        ids: parsedIds.data,
        companyId
      });
      if (actionRows.error) {
        logger.error("Failed to read planning actions", {
          companyId,
          error: actionRows.error
        });
        return data(
          { success: false, message: "Failed to read planning actions" },
          { status: 500 }
        );
      }
      const rowById = new Map(actionRows.data.map((row) => [row.id, row]));

      const eligible: { planningActionId: string; row: PlanningActionRow }[] =
        [];
      for (const planningActionId of parsedIds.data) {
        const row = rowById.get(planningActionId);
        if (!row) {
          errors.push(`Planning action ${planningActionId} not found`);
          continue;
        }
        if (row.status !== "Open") {
          errors.push(`Planning action ${planningActionId} is not open`);
          continue;
        }
        if (
          action === "apply"
            ? !changeActionTypes.has(row.type)
            : wireToType[action] !== row.type
        ) {
          errors.push(
            action === "apply"
              ? `Planning action ${planningActionId} is a ${row.type}, which Apply cannot batch`
              : `Planning action ${planningActionId} is a ${row.type}, not ${wireToType[action]}`
          );
          continue;
        }
        if (!row.purchaseOrderLineId) {
          errors.push(
            `Planning action ${planningActionId} does not target a purchase order line`
          );
          continue;
        }
        eligible.push({ planningActionId, row });
      }

      // One statement, like the reads above: the id list goes to Postgres as a
      // parameter, never into a PostgREST URL. The order's status and delivery
      // promise come with the line, as the embed gave them.
      const lineIds = [
        ...new Set(eligible.map(({ row }) => row.purchaseOrderLineId!))
      ];
      let lineById: Map<string, PlanningLine>;
      try {
        const lines =
          lineIds.length > 0
            ? await db
                .selectFrom("purchaseOrderLine as pol")
                .innerJoin("purchaseOrder as po", (join) =>
                  join
                    .onRef("po.id", "=", "pol.purchaseOrderId")
                    .on("po.companyId", "=", companyId)
                )
                .leftJoin("purchaseOrderDelivery as pod", "pod.id", "po.id")
                .select([
                  "pol.id",
                  "pol.purchaseOrderId",
                  "pol.conversionFactor",
                  "pol.promisedDate",
                  "po.status as purchaseOrderStatus",
                  "pod.receiptPromisedDate"
                ])
                .where("pol.id", "in", lineIds)
                .where("pol.companyId", "=", companyId)
                .execute()
            : [];
        lineById = new Map(lines.map((line) => [line.id, line]));
      } catch (err) {
        logger.error(
          "Failed to read purchase order lines for planning actions",
          {
            companyId,
            error: err
          }
        );
        return data(
          {
            success: false,
            message: "Failed to read the planning actions' purchase order lines"
          },
          { status: 500 }
        );
      }

      const toClaim: {
        planningActionId: string;
        row: PlanningActionRow;
        line: PlanningLine;
      }[] = [];
      for (const { planningActionId, row } of eligible) {
        const line = lineById.get(row.purchaseOrderLineId!);
        if (!line) {
          errors.push(
            `Purchase order line for planning action ${planningActionId} not found`
          );
          continue;
        }

        const datePromised =
          (row.type === "Expedite" || row.type === "Defer") &&
          promisedDateOf(line) !== null;
        if (
          !isPurchaseOrderEditableFromPlanning(line.purchaseOrderStatus) ||
          datePromised
        ) {
          // In approval or sent, or a date the supplier promised (which Apply's
          // required date cannot move) — surface "Review on PO" instead.
          requiresManualAction.push({
            id: planningActionId,
            purchaseOrderId: line.purchaseOrderId
          });
          continue;
        }

        if (row.type === "Cancel" && !(await mayDeleteLines())) {
          errors.push(
            `Planning action ${planningActionId} deletes a purchase order line, which needs delete permission`
          );
          continue;
        }
        toClaim.push({ planningActionId, row, line });
      }

      // One transaction for the whole batch, set-based: the claim, the dates,
      // the quantities and the cancels are one statement each, and a refused
      // write un-claims its action inside the same transaction. A failure
      // rolls everything back; the previous loop applied one action at a time
      // and could run into the request's time limit with the rest unapplied.
      let outcome: Awaited<ReturnType<typeof applyPurchasingPlanningActions>>;
      try {
        outcome = await applyPurchasingPlanningActions(db, {
          companyId,
          companyGroupId,
          userId,
          actions: toClaim.map(({ planningActionId, row, line }) => ({
            planningActionId,
            type: row.type as
              | "Expedite"
              | "Defer"
              | "Increase"
              | "Decrease"
              | "Cancel",
            lineId: line.id,
            purchaseOrderId: line.purchaseOrderId,
            suggestedDate: row.suggestedDate ?? null,
            suggestedQuantity:
              row.suggestedQuantity === null ||
              row.suggestedQuantity === undefined
                ? null
                : Number(row.suggestedQuantity)
          }))
        });
      } catch (err) {
        logger.error("Failed to apply planning actions", {
          companyId,
          userId,
          planningActionIds: toClaim.map((t) => t.planningActionId),
          error: err
        });
        return data(
          {
            success: false,
            message: `Failed to apply planning actions: ${
              err instanceof Error ? err.message : "unknown error"
            }`
          },
          { status: 500 }
        );
      }
      applied.push(...outcome.applied);
      requiresManualAction.push(...outcome.refused);
      for (const id of outcome.alreadyApplied) {
        errors.push(`Planning action ${id} was already applied`);
      }
      for (const failure of outcome.failed) {
        errors.push(`Planning action ${failure.id}: ${failure.message}`);
      }

      // Committed targets are not failures, but "Applied 0" with a success
      // toast is a lie — surface the manual-review count, and only report
      // success when something was actually applied (or nothing needed review).
      const manualCount = requiresManualAction.length;
      const messageParts = [
        `Applied ${applied.length} planning action${applied.length === 1 ? "" : "s"}`
      ];
      if (manualCount > 0) {
        messageParts.push(
          `${manualCount} target${manualCount === 1 ? " is" : "s are"} committed — review on the order`
        );
      }
      if (errors.length > 0) {
        messageParts.push(`${errors.length} failed`);
      }
      return {
        success:
          errors.length === 0 && !(applied.length === 0 && manualCount > 0),
        message: messageParts.join("; "),
        applied,
        requiresManualAction,
        errors: errors.length > 0 ? errors : undefined
      };
    }

    // ── Worklist mutations: dismiss suppresses a persisting need until it
    // changes materially; assign sets assigneeOverridden so the next MRP
    // diff-write never re-resolves the owner from the ladder.
    case "dismiss": {
      // The same id twice (a row selected in two places) is one action.
      const parsedIds = z
        .array(z.string().min(1))
        .min(1)
        .transform((ids) => [...new Set(ids)])
        .safeParse(planningActionIds);
      if (!parsedIds.success) {
        return data(
          { success: false, message: "planningActionIds is required" },
          { status: 400 }
        );
      }
      const result = await dismissPlanningActions(getDatabaseClient(), {
        ids: parsedIds.data,
        companyId,
        userId,
        kind: "Buy"
      });
      if (result.error) {
        logger.error("Failed to dismiss planning actions", {
          companyId,
          userId,
          planningActionIds: parsedIds.data,
          error: result.error
        });
        return data(
          { success: false, message: "Failed to dismiss planning actions" },
          { status: 500 }
        );
      }
      // The rows actually changed: an action applied or changed since the
      // page loaded is skipped, and the count says so.
      const changed = result.data?.length ?? 0;
      if (changed === 0) {
        return {
          success: false,
          message:
            "Nothing to dismiss — these actions changed since the page loaded"
        };
      }
      return {
        success: true,
        message: `Dismissed ${changed} planning action${changed === 1 ? "" : "s"}${
          changed < parsedIds.data.length
            ? `; ${parsedIds.data.length - changed} changed since the page loaded`
            : ""
        }`
      };
    }
    case "reopen": {
      // The same id twice (a row selected in two places) is one action.
      const parsedIds = z
        .array(z.string().min(1))
        .min(1)
        .transform((ids) => [...new Set(ids)])
        .safeParse(planningActionIds);
      if (!parsedIds.success) {
        return data(
          { success: false, message: "planningActionIds is required" },
          { status: 400 }
        );
      }
      const result = await reopenDismissedPlanningActions(getDatabaseClient(), {
        ids: parsedIds.data,
        companyId,
        userId,
        kind: "Buy"
      });
      if (result.error) {
        logger.error("Failed to reopen planning actions", {
          companyId,
          userId,
          planningActionIds: parsedIds.data,
          error: result.error
        });
        return data(
          { success: false, message: "Failed to reopen planning actions" },
          { status: 500 }
        );
      }
      // The rows actually changed: an action applied or changed since the
      // page loaded is skipped, and the count says so.
      const changed = result.data?.length ?? 0;
      if (changed === 0) {
        return {
          success: false,
          message:
            "Nothing to reopen — these actions changed since the page loaded"
        };
      }
      return {
        success: true,
        message: `Reopened ${changed} planning action${changed === 1 ? "" : "s"}${
          changed < parsedIds.data.length
            ? `; ${parsedIds.data.length - changed} changed since the page loaded`
            : ""
        }`
      };
    }
    case "assign": {
      // The same id twice (a row selected in two places) is one action.
      const parsedIds = z
        .array(z.string().min(1))
        .min(1)
        .transform((ids) => [...new Set(ids)])
        .safeParse(planningActionIds);
      if (!parsedIds.success) {
        return data(
          { success: false, message: "planningActionIds is required" },
          { status: 400 }
        );
      }
      const parsedAssignee = z
        .string()
        .optional()
        .safeParse(assignee ?? undefined);
      if (!parsedAssignee.success) {
        return data(
          { success: false, message: "Invalid assignee" },
          { status: 400 }
        );
      }
      if (
        parsedAssignee.data &&
        !(await isActiveCompanyEmployee(client, companyId, parsedAssignee.data))
      ) {
        return data(
          { success: false, message: "Choose an employee of this company" },
          { status: 400 }
        );
      }
      const result = await assignPlanningActions(getDatabaseClient(), {
        ids: parsedIds.data,
        companyId,
        assignee: parsedAssignee.data || null,
        userId,
        kind: "Buy"
      });
      if (result.error) {
        logger.error("Failed to assign planning actions", {
          companyId,
          userId,
          planningActionIds: parsedIds.data,
          error: result.error
        });
        return data(
          { success: false, message: "Failed to assign planning actions" },
          { status: 500 }
        );
      }
      // The rows actually changed: an action applied or changed since the
      // page loaded is skipped, and the count says so.
      const changed = result.data?.length ?? 0;
      if (changed === 0) {
        return {
          success: false,
          message:
            "Nothing to assign — these actions changed since the page loaded"
        };
      }
      return {
        success: true,
        message: `Assigned ${changed} planning action${changed === 1 ? "" : "s"}${
          changed < parsedIds.data.length
            ? `; ${parsedIds.data.length - changed} changed since the page loaded`
            : ""
        }`
      };
    }

    default:
      return data(
        {
          success: false,
          message: `Unknown action '${action}'. Expected one of: 'order', 'updateLine', 'apply', 'expedite', 'defer', 'increase', 'decrease', 'cancel', 'dismiss', 'reopen', 'assign'`
        },
        { status: 400 }
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
