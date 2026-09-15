import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";
import { computePlanningOrders } from "@carbon/utils";
import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import { Trans } from "@lingui/react/macro";
import { z } from "zod";
import type {
  ProductionOrder,
  ProductionPlanningItem
} from "~/modules/production";
import type {
  PlannedOrder,
  PurchasingPlanningItem
} from "~/modules/purchasing";
import type { Item } from "~/stores";
import type { ItemReorderingPolicy } from "../../types";

export function ItemReorderPolicy({
  reorderingPolicy,
  className
}: {
  reorderingPolicy: Database["public"]["Enums"]["itemReorderingPolicy"];
  className?: string;
}) {
  switch (reorderingPolicy) {
    case "Manual Reorder":
      return (
        <Status color="gray" className={className}>
          <Trans>Manual</Trans>
        </Status>
      );
    case "Demand-Based Reorder":
      return (
        <Status color="blue" className={className}>
          <Trans>Demand-Based</Trans>
        </Status>
      );
    case "Fixed Reorder Quantity":
      return (
        <Status color="green" className={className}>
          <Trans>Fixed Reorder</Trans>
        </Status>
      );
    case "Maximum Quantity":
      return (
        <Status color="purple" className={className}>
          <Trans>Max Quantity</Trans>
        </Status>
      );
  }
}

export function getReorderPolicyDescription(itemPlanning: {
  reorderingPolicy: ItemReorderingPolicy;
  reorderPoint: number;
  reorderQuantity: number;
  maximumInventoryQuantity: number;
  demandAccumulationPeriod: number;
  demandAccumulationSafetyStock: number;
}) {
  const reorderPoint = itemPlanning.reorderPoint;
  switch (itemPlanning.reorderingPolicy) {
    case "Manual Reorder":
      return "Manually reorder the item";
    case "Demand-Based Reorder":
      const demandAccumulationPeriod = itemPlanning.demandAccumulationPeriod;
      return `Order enough to cover the next ${demandAccumulationPeriod} weeks`;
    case "Fixed Reorder Quantity":
      const reorderQuantity = itemPlanning.reorderQuantity;
      return `When stock is below ${reorderPoint}, order ${reorderQuantity} units`;
    case "Maximum Quantity":
      const maximumInventoryQuantity = itemPlanning.maximumInventoryQuantity;
      return `When stock is below ${reorderPoint}, order up to ${maximumInventoryQuantity} units`;
  }
}

type BaseOrderParams = {
  itemPlanning: ProductionPlanningItem | PurchasingPlanningItem;
  periods: { startDate: string; id: string }[];
};

// Cache for memoizing calculateOrders results
const ordersCache = new Map<
  string,
  {
    startDate: string;
    dueDate: string;
    quantity: number;
    periodId: string;
    isASAP: boolean;
  }[]
>();

// Generate cache key from itemPlanning and periods
function getCacheKey(
  itemPlanning: ProductionPlanningItem | PurchasingPlanningItem,
  periods: { startDate: string; id: string }[]
): string {
  // Include all relevant properties that affect order calculation
  const periodIds = periods.map((p) => p.id).join(",");
  const weekValues = Array.from({ length: 48 }, (_, i) => {
    const key = `week${i + 1}` as keyof typeof itemPlanning;
    return itemPlanning[key] ?? 0;
  }).join(",");

  return `${itemPlanning.id}_${itemPlanning.reorderingPolicy}_${itemPlanning.reorderPoint}_${itemPlanning.reorderQuantity}_${itemPlanning.maximumInventoryQuantity}_${itemPlanning.demandAccumulationPeriod}_${itemPlanning.demandAccumulationSafetyStock}_${itemPlanning.leadTime}_${itemPlanning.lotSize}_${itemPlanning.minimumOrderQuantity}_${itemPlanning.maximumOrderQuantity}_${itemPlanning.orderMultiple}_${itemPlanning.supersessionMode}_${itemPlanning.minimumReserveQuantity}_${itemPlanning.quantityOnHand}_${itemPlanning.quantityToOrder}_${periodIds}_${weekValues}`;
}

function calculateOrders({ itemPlanning, periods }: BaseOrderParams): {
  startDate: string;
  dueDate: string;
  quantity: number;
  periodId: string;
  isASAP: boolean;
  policyName?: string;
  triggerValues?: {
    projectedStock?: number;
    safetyStock?: number;
    reorderPoint?: number;
    reorderQuantity?: number;
    lotSize?: number;
    leadTime?: number;
  };
}[] {
  // Check cache first
  const cacheKey = getCacheKey(itemPlanning, periods);
  const cached = ordersCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Stock Only supersession overrides every reordering policy: replenish only to
  // the minimum service-stock floor, ignoring demand. The server already computes
  // this in get_*_planning (reserve − on-hand − incoming supply), so we reuse its
  // quantityToOrder rather than recomputing — keeping the drawer and the table in
  // exact agreement (and correctly accounting for what's already on order).
  if (itemPlanning.supersessionMode === "Stock Only") {
    const reserveOrders: {
      startDate: string;
      dueDate: string;
      quantity: number;
      periodId: string;
      isASAP: boolean;
      policyName?: string;
      triggerValues?: {
        projectedStock?: number;
        safetyStock?: number;
        reorderPoint?: number;
        reorderQuantity?: number;
        lotSize?: number;
        leadTime?: number;
      };
    }[] = [];
    const reserveShortfall = Math.max(0, itemPlanning.quantityToOrder ?? 0);
    if (reserveShortfall > 0 && periods.length > 0) {
      const dueDate = parseDate(periods[0].startDate);
      const startDate = dueDate.subtract({ days: itemPlanning.leadTime ?? 0 });
      reserveOrders.push({
        startDate: startDate.toString(),
        dueDate: dueDate.toString(),
        quantity: reserveShortfall,
        periodId: periods[0].id,
        isASAP: startDate.compare(today(getLocalTimeZone())) < 0,
        policyName: "Stock Only",
        triggerValues: {
          projectedStock: itemPlanning.quantityOnHand ?? 0,
          reorderPoint: itemPlanning.minimumReserveQuantity ?? 0,
          leadTime: itemPlanning.leadTime ?? 0
        }
      });
    }
    ordersCache.set(cacheKey, reserveOrders);
    return reserveOrders;
  }

  // The four-policy sizing math is shared with the MRP engine — the single
  // source of truth is computePlanningOrders in @carbon/utils (parity-tested
  // against the SQL calculate_quantity_to_order). This component only supplies
  // the projections (weekN columns) and the local "today".
  const projections = periods.map(
    (_, i) => (itemPlanning[`week${i + 1}` as "week1"] as number) || 0
  );

  const orders = computePlanningOrders({
    reorderingPolicy: itemPlanning.reorderingPolicy,
    periods,
    projections,
    todayDate: today(getLocalTimeZone()).toString(),
    params: {
      reorderPoint: itemPlanning.reorderPoint,
      reorderQuantity: itemPlanning.reorderQuantity,
      minimumOrderQuantity: itemPlanning.minimumOrderQuantity,
      maximumOrderQuantity: itemPlanning.maximumOrderQuantity,
      orderMultiple: itemPlanning.orderMultiple,
      lotSize: itemPlanning.lotSize,
      maximumInventoryQuantity: itemPlanning.maximumInventoryQuantity,
      demandAccumulationPeriod: itemPlanning.demandAccumulationPeriod,
      demandAccumulationSafetyStock: itemPlanning.demandAccumulationSafetyStock,
      leadTime: itemPlanning.leadTime
    }
  });

  ordersCache.set(cacheKey, orders);
  return orders;
}

// Export function to clear the cache if needed (e.g., after MRP runs)
export function clearOrdersCache() {
  ordersCache.clear();
}

export function getProductionOrdersFromPlanning(
  itemPlanning: ProductionPlanningItem,
  periods: { startDate: string; id: string }[]
): ProductionOrder[] {
  return calculateOrders({ itemPlanning, periods });
}

const supplierPartValidator = z.array(
  z.object({
    id: z.string(),
    supplierId: z.string(),
    supplierUnitOfMeasureCode: z.string(),
    conversionFactor: z.number(),
    unitPrice: z.number()
  })
);

export function getPurchaseOrdersFromPlanning(
  itemPlanning: PurchasingPlanningItem,
  periods: { startDate: string; id: string }[],
  items: Item[],
  supplierId?: string
): PlannedOrder[] {
  const suppliers = supplierPartValidator.safeParse(itemPlanning.suppliers);
  const supplier = suppliers.data?.find(
    (supplier) => supplier.supplierId === supplierId
  );

  const item = items.find((item) => item.id === itemPlanning.id);

  // Get the conversion factor from the selected supplier
  const conversionFactor = supplier?.conversionFactor ?? 1;

  return calculateOrders({ itemPlanning, periods }).map((order) => ({
    ...order,
    // Convert inventory quantity to purchase quantity by dividing by conversion factor
    quantity:
      conversionFactor > 0
        ? Math.ceil(order.quantity / conversionFactor)
        : order.quantity,
    supplierId: supplier?.supplierId ?? itemPlanning.preferredSupplierId,
    itemReadableId: item?.readableIdWithRevision,
    description: item?.name,
    unitOfMeasureCode: item?.unitOfMeasureCode
  }));
}
