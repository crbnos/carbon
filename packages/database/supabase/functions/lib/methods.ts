import { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types.ts";

export type JobMethod = NonNullable<
  Awaited<ReturnType<typeof getJobMethodTreeArray>>["data"]
>[number];

export type JobMethodTreeItem = {
  id: string;
  data: JobMethod;
  children: JobMethodTreeItem[];
};

export async function getJobMethodTree(
  client: SupabaseClient<Database>,
  methodId: string,
  parentMaterialId: string | null = null
) {
  const items = await getJobMethodTreeArray(client, methodId);
  if (items.error) return items;

  const tree = getJobMethodTreeArrayToTree(items.data, parentMaterialId);

  return {
    data: tree,
    error: null,
  };
}

export function getJobMethodTreeArray(
  client: SupabaseClient<Database>,
  methodId: string
) {
  return client.rpc("get_job_methods_by_method_id", {
    mid: methodId,
  });
}

function getJobMethodTreeArrayToTree(
  items: JobMethod[],
  parentMaterialId: string | null = null
): JobMethodTreeItem[] {
  // function traverseAndRenameIds(node: JobMethodTreeItem) {
  //   const clone = structuredClone(node);
  //   clone.id = `node-${Math.random().toString(16).slice(2)}`;
  //   clone.children = clone.children.map((n) => traverseAndRenameIds(n));
  //   return clone;
  // }

  const rootItems: JobMethodTreeItem[] = [];
  const lookup: { [id: string]: JobMethodTreeItem } = {};

  for (const item of items) {
    const itemId = item.methodMaterialId;
    const parentId = item.parentMaterialId;

    if (!Object.prototype.hasOwnProperty.call(lookup, itemId)) {
      // @ts-ignore - we don't add data here
      lookup[itemId] = { id: itemId, children: [] };
    }

    lookup[itemId]["data"] = item;

    const treeItem = lookup[itemId];

    if (parentId === parentMaterialId || parentId === undefined) {
      rootItems.push(treeItem);
    } else {
      if (!Object.prototype.hasOwnProperty.call(lookup, parentId)) {
        // @ts-ignore - we don't add data here
        lookup[parentId] = { id: parentId, children: [] };
      }

      lookup[parentId]["children"].push(treeItem);
    }
  }
  return rootItems;
}

export function traverseJobMethod(
  node: JobMethodTreeItem,
  callback: (node: JobMethodTreeItem) => void
) {
  callback(node);

  if (node.children) {
    for (const child of node.children) {
      traverseJobMethod(child, callback);
    }
  }
}

export type QuoteMethod = NonNullable<
  Awaited<ReturnType<typeof getQuoteMethodTreeArray>>["data"]
>[number];
export type QuoteMethodTreeItem = {
  id: string;
  data: QuoteMethod;
  children: QuoteMethodTreeItem[];
};

export async function getQuoteMethodTree(
  client: SupabaseClient<Database>,
  methodId: string,
  parentMaterialId: string | null = null
) {
  const items = await getQuoteMethodTreeArray(client, methodId);
  if (items.error) return items;

  const tree = getQuoteMethodTreeArrayToTree(items.data, parentMaterialId);

  return {
    data: tree,
    error: null,
  };
}

export function getQuoteMethodTreeArray(
  client: SupabaseClient<Database>,
  methodId: string
) {
  return client.rpc("get_quote_methods_by_method_id", {
    mid: methodId,
  });
}

function getQuoteMethodTreeArrayToTree(
  items: QuoteMethod[],
  parentMaterialId: string | null = null
): QuoteMethodTreeItem[] {
  const rootItems: QuoteMethodTreeItem[] = [];
  const lookup: { [id: string]: QuoteMethodTreeItem } = {};

  for (const item of items) {
    const itemId = item.methodMaterialId;
    const parentId = item.parentMaterialId;

    if (!Object.prototype.hasOwnProperty.call(lookup, itemId)) {
      lookup[itemId] = { id: itemId, children: [], data: item };
    } else {
      lookup[itemId].data = item;
    }

    const treeItem = lookup[itemId];

    if (parentId === parentMaterialId || parentId === undefined) {
      rootItems.push(treeItem);
    } else {
      if (!Object.prototype.hasOwnProperty.call(lookup, parentId)) {
        lookup[parentId] = {
          id: parentId,
          children: [],
          data: {} as QuoteMethod,
        };
      }

      lookup[parentId].children.push(treeItem);
    }
  }
  return rootItems;
}

export async function traverseQuoteMethod(
  node: QuoteMethodTreeItem,
  callback: (node: QuoteMethodTreeItem) => void | Promise<void>
) {
  await callback(node);

  if (node.children) {
    for await (const child of node.children) {
      await traverseQuoteMethod(child, callback);
    }
  }
}

export const getRatesFromWorkCenters =
  (workCenters: Database["public"]["Views"]["workCenters"]["Row"][] | null) =>
  (
    processId: string,
    workCenterId: string | null
  ): { overheadRate: number; laborRate: number; machineRate: number } => {
    if (!workCenters) {
      return {
        laborRate: 0,
        machineRate: 0,
        overheadRate: 0,
      };
    }

    if (workCenterId) {
      const workCenter = workCenters?.find(
        (wc) => wc.id === workCenterId && wc.active
      );

      if (workCenter) {
        return {
          laborRate: workCenter.laborRate ?? 0,
          machineRate: workCenter.machineRate ?? 0,
          overheadRate: workCenter.overheadRate ?? 0,
        };
      }
    }

    const relatedWorkCenters = workCenters.filter((wc) => {
      const processes = wc.processes ?? [];
      return wc.active && processes.some((p) => p === processId);
    });

    if (relatedWorkCenters.length > 0) {
      const laborRate =
        relatedWorkCenters.reduce((acc, workCenter) => {
          return (acc += workCenter.laborRate ?? 0);
        }, 0) / relatedWorkCenters.length;

      const machineRate =
        relatedWorkCenters.reduce((acc, workCenter) => {
          return (acc += workCenter.machineRate ?? 0);
        }, 0) / relatedWorkCenters.length;

      const overheadRate =
        relatedWorkCenters.reduce((acc, workCenter) => {
          return (acc += workCenter.overheadRate ?? 0);
        }, 0) / relatedWorkCenters.length;

      return {
        laborRate,
        machineRate,
        overheadRate,
      };
    }

    return {
      laborRate: 0,
      machineRate: 0,
      overheadRate: 0,
    };
  };

export const getRatesFromSupplierProcesses =
  (
    processes: Database["public"]["Tables"]["supplierProcess"]["Row"][] | null
  ) =>
  (
    processId: string,
    supplierProcessId: string | null
  ): {
    operationMinimumCost: number;
    operationLeadTime: number;
  } => {
    if (!processes) {
      return {
        operationMinimumCost: 0,
        operationLeadTime: 0,
      };
    }

    if (supplierProcessId) {
      const supplierProcess = processes?.find(
        (sp) => sp.id === supplierProcessId
      );

      if (supplierProcess) {
        return {
          operationMinimumCost: supplierProcess.minimumCost,
          operationLeadTime: supplierProcess.leadTime,
        };
      }
    }

    const relatedProcesses = processes.filter((p) => p.processId === processId);

    if (relatedProcesses.length > 0) {
      const operationMinimumCost =
        relatedProcesses.reduce((acc, process) => {
          return (acc += process.minimumCost ?? 0);
        }, 0) / relatedProcesses.length;
      const operationLeadTime =
        relatedProcesses.reduce((acc, process) => {
          return (acc += process.leadTime ?? 0);
        }, 0) / relatedProcesses.length;

      return {
        operationMinimumCost,
        operationLeadTime,
      };
    }

    return {
      operationMinimumCost: 0,
      operationLeadTime: 0,
    };
  };

type SupplierPriceMap = Record<
  string,
  {
    priceBreaks: { quantity: number; unitPrice: number }[];
    fallbackUnitPrice: number | null;
  }
>;

type CostCategoryKey =
  | "materialCost"
  | "partCost"
  | "toolCost"
  | "consumableCost"
  | "serviceCost"
  | "laborCost"
  | "machineCost"
  | "overheadCost"
  | "outsideCost";

const costCategoryKeys: CostCategoryKey[] = [
  "materialCost",
  "partCost",
  "toolCost",
  "consumableCost",
  "serviceCost",
  "laborCost",
  "machineCost",
  "overheadCost",
  "outsideCost",
];

type CostEffects = Record<CostCategoryKey, ((qty: number) => number)[]>;

async function getSupplierPriceBreaksForItems(
  client: SupabaseClient<Database>,
  itemIds: string[]
): Promise<SupplierPriceMap> {
  if (!itemIds.length) return {};

  const supplierParts = await client
    .from("supplierPart")
    .select("id, itemId, unitPrice")
    .in("itemId", itemIds);

  if (!supplierParts.data?.length) return {};

  const supplierPartIds = supplierParts.data.map((sp) => sp.id);

  const prices = await client
    .from("supplierPartPrice")
    .select("supplierPartId, quantity, unitPrice")
    .in("supplierPartId", supplierPartIds)
    .order("quantity", { ascending: true });

  const spToItem = new Map<string, string>();
  for (const sp of supplierParts.data) {
    spToItem.set(sp.id, sp.itemId);
  }

  const result: SupplierPriceMap = {};

  for (const sp of supplierParts.data) {
    if (!result[sp.itemId]) {
      result[sp.itemId] = { priceBreaks: [], fallbackUnitPrice: null };
    }
    const current = result[sp.itemId].fallbackUnitPrice;
    if (sp.unitPrice != null && (current === null || sp.unitPrice < current)) {
      result[sp.itemId].fallbackUnitPrice = sp.unitPrice;
    }
  }

  for (const price of prices.data ?? []) {
    const itemId = spToItem.get(price.supplierPartId);
    if (itemId && result[itemId]) {
      result[itemId].priceBreaks.push({
        quantity: price.quantity,
        unitPrice: price.unitPrice,
      });
    }
  }

  return result;
}

function lookupPriceFromBreaks(
  priceBreaks: { quantity: number; unitPrice: number }[],
  requestedQty: number,
  fallbackPrice: number
): number {
  const eligible = priceBreaks.filter((pb) => pb.quantity <= requestedQty);
  if (eligible.length) {
    return eligible.reduce((best, pb) =>
      pb.quantity > best.quantity ? pb : best
    ).unitPrice;
  }
  return fallbackPrice;
}

function lookupBuyPriceFromMap(
  itemId: string,
  requestedQty: number,
  priceMap: SupplierPriceMap,
  fallbackCost: number
): number {
  const entry = priceMap[itemId];
  if (!entry) return fallbackCost;
  return lookupPriceFromBreaks(
    entry.priceBreaks,
    requestedQty,
    entry.fallbackUnitPrice ?? fallbackCost
  );
}

function normalizeTimeToHours(
  time: number,
  unit: string
): { fixedHours: number; hoursPerUnit: number } {
  let fixedHours = 0;
  let hoursPerUnit = 0;
  switch (unit) {
    case "Total Hours":
      fixedHours = time;
      break;
    case "Total Minutes":
      fixedHours = time / 60;
      break;
    case "Hours/Piece":
      hoursPerUnit = time;
      break;
    case "Hours/100 Pieces":
      hoursPerUnit = time / 100;
      break;
    case "Hours/1000 Pieces":
      hoursPerUnit = time / 1000;
      break;
    case "Minutes/Piece":
      hoursPerUnit = time / 60;
      break;
    case "Minutes/100 Pieces":
      hoursPerUnit = time / 100 / 60;
      break;
    case "Minutes/1000 Pieces":
      hoursPerUnit = time / 1000 / 60;
      break;
    case "Pieces/Hour":
      hoursPerUnit = 1 / time;
      break;
    case "Pieces/Minute":
      hoursPerUnit = 1 / (time / 60);
      break;
    case "Seconds/Piece":
      hoursPerUnit = time / 3600;
      break;
  }
  return { fixedHours, hoursPerUnit };
}

export async function calculateQuoteLinePrices(
  client: SupabaseClient<Database>,
  quoteId: string,
  quoteLineId: string,
  companyId: string,
  userId: string
) {
  // 1. Fetch data in parallel
  const [quoteLineResult, settingsResult, quoteResult, operationsResult] =
    await Promise.all([
      client
        .from("quoteLine")
        .select("quantity, methodType, unitPricePrecision")
        .eq("id", quoteLineId)
        .single(),
      client
        .from("companySettings")
        .select("quoteLineCategoryMarkups")
        .eq("id", companyId)
        .single(),
      client.from("quote").select("exchangeRate").eq("id", quoteId).single(),
      client
        .from("quoteOperation")
        .select("*")
        .eq("quoteLineId", quoteLineId),
    ]);

  if (quoteLineResult.error) throw new Error("Failed to get quote line");
  if (settingsResult.error) throw new Error("Failed to get company settings");
  if (quoteResult.error) throw new Error("Failed to get quote");

  const quoteLine = quoteLineResult.data;
  const quantities = quoteLine.quantity ?? [1];
  const exchangeRate = quoteResult.data.exchangeRate ?? 1;
  const precision = quoteLine.unitPricePrecision ?? 2;
  const operations = operationsResult.data ?? [];

  // Parse default markups from settings (stored as decimals, convert to whole numbers)
  const rawMarkups =
    (settingsResult.data.quoteLineCategoryMarkups as Record<string, number>) ??
    {};
  const defaultMarkups: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawMarkups)) {
    defaultMarkups[key] = value * 100;
  }

  // Defaults are "enabled" only when at least one category markup is positive;
  // an all-zero/empty default means the feature is off. Mirrors
  // getEffectiveDefaultMarkups in apps/erp/app/modules/sales/sales.utils.ts —
  // keep both in sync (the edge runtime cannot import app code).
  const defaultsEnabled = Object.values(defaultMarkups).some((v) => v > 0);
  const effectiveDefaults = defaultsEnabled ? defaultMarkups : {};

  // Rows whose price was stated by a person or an external system
  // (priceSource = 'manual') are never recomputed. Mirrors decideRecalcPricing
  // in sales.utils.ts.
  const existingPricesResult = await client
    .from("quoteLinePrice")
    .select("quantity, priceSource")
    .eq("quoteLineId", quoteLineId)
    .eq("companyId", companyId);
  // A failed read must abort: treating it as "no manual rows" would let the
  // delete/replace below wipe manually priced rows.
  if (existingPricesResult.error)
    throw new Error("Failed to get existing quote line prices");
  const manualQuantities = new Set(
    (existingPricesResult.data ?? [])
      .filter(
        (row) =>
          row.priceSource === "manual" &&
          quantities.some((qty) => Number(qty) === Number(row.quantity))
      )
      .map((row) => Number(row.quantity))
  );

  // 2. Fix Buy material costs with supplier price breaks
  const buyMaterials = await client
    .from("quoteMaterial")
    .select("id, itemId, unitCost")
    .eq("quoteLineId", quoteLineId)
    .eq("methodType", "Purchase to Order");

  const buyItemIds = [
    ...new Set((buyMaterials.data ?? []).map((m) => m.itemId)),
  ];
  const priceMap = await getSupplierPriceBreaksForItems(client, buyItemIds);

  for (const mat of buyMaterials.data ?? []) {
    const price = lookupBuyPriceFromMap(mat.itemId, 1, priceMap, mat.unitCost);
    if (price !== mat.unitCost) {
      await client
        .from("quoteMaterial")
        .update({ unitCost: price })
        .eq("id", mat.id);
    }
  }

  // 3. Build the quote method tree
  const rootMethod = await client
    .from("quoteMakeMethod")
    .select("id")
    .eq("quoteLineId", quoteLineId)
    .is("parentMaterialId", null)
    .single();

  if (rootMethod.error) throw new Error("Failed to get root make method");

  const tree = await getQuoteMethodTree(client, rootMethod.data.id);
  if (tree.error) throw new Error("Failed to get quote method tree");

  // 4. Enhance tree: multiply quantities through parent chain, attach operations
  type EnhancedNode = {
    itemId: string;
    itemType: string;
    methodType: string;
    quantity: number;
    unitCost: number;
    quoteMaterialMakeMethodId: string;
    operations: typeof operations;
    children: EnhancedNode[];
  };

  function buildEnhancedTree(
    node: QuoteMethodTreeItem,
    parentQuantity: number
  ): EnhancedNode {
    const qty = node.data.quantity * parentQuantity;
    const nodeOps = operations.filter(
      (o) => o.quoteMakeMethodId === node.data.quoteMaterialMakeMethodId
    );
    return {
      itemId: node.data.itemId,
      itemType: node.data.itemType,
      methodType: node.data.methodType,
      quantity: qty,
      unitCost: node.data.unitCost,
      quoteMaterialMakeMethodId: node.data.quoteMaterialMakeMethodId,
      operations: nodeOps,
      children: node.children.map((c) => buildEnhancedTree(c, qty)),
    };
  }

  // 5. Build cost effects
  const effects: CostEffects = {
    materialCost: [],
    partCost: [],
    toolCost: [],
    consumableCost: [],
    serviceCost: [],
    laborCost: [],
    machineCost: [],
    overheadCost: [],
    outsideCost: [],
  };

  function pushBuyCostEffect(
    itemId: string,
    itemType: string,
    quantity: number,
    unitCost: number
  ) {
    const costFn = (outerQty: number) => {
      const requestedQty = quantity * outerQty;
      const resolved = lookupBuyPriceFromMap(
        itemId,
        requestedQty,
        priceMap,
        unitCost
      );
      return resolved * requestedQty;
    };
    switch (itemType) {
      case "Material":
        effects.materialCost.push(costFn);
        break;
      case "Part":
        effects.partCost.push(costFn);
        break;
      case "Tool":
        effects.toolCost.push(costFn);
        break;
      case "Consumable":
        effects.consumableCost.push(costFn);
        break;
      case "Service":
        effects.serviceCost.push(costFn);
        break;
    }
  }

  function walkTree(node: EnhancedNode) {
    if (node.methodType === "Purchase to Order") {
      pushBuyCostEffect(node.itemId, node.itemType, node.quantity, node.unitCost);
    } else if (node.methodType === "Pull from Inventory") {
      const costFn = (quantity: number) =>
        node.unitCost * node.quantity * quantity;
      switch (node.itemType) {
        case "Material":
          effects.materialCost.push(costFn);
          break;
        case "Part":
          effects.partCost.push(costFn);
          break;
        case "Tool":
          effects.toolCost.push(costFn);
          break;
        case "Consumable":
          effects.consumableCost.push(costFn);
          break;
        case "Service":
          effects.serviceCost.push(costFn);
          break;
      }
    }

    for (const operation of node.operations) {
      if (operation.operationType === "Inside") {
        if (operation.setupTime) {
          const { fixedHours, hoursPerUnit } = normalizeTimeToHours(
            operation.setupTime,
            operation.setupUnit
          );
          effects.laborCost.push((quantity) => {
            return (
              hoursPerUnit * quantity * node.quantity * (operation.laborRate ?? 0) +
              fixedHours * (operation.laborRate ?? 0)
            );
          });
          effects.overheadCost.push((quantity) => {
            return (
              hoursPerUnit *
                quantity *
                node.quantity *
                (operation.overheadRate ?? 0) +
              fixedHours * (operation.overheadRate ?? 0)
            );
          });
        }

        let laborFixedHours = 0;
        let laborHoursPerUnit = 0;
        let machineFixedHours = 0;
        let machineHoursPerUnit = 0;

        if (operation.laborTime) {
          const normalized = normalizeTimeToHours(
            operation.laborTime,
            operation.laborUnit
          );
          laborFixedHours = normalized.fixedHours;
          laborHoursPerUnit = normalized.hoursPerUnit;

          effects.laborCost.push((quantity) => {
            return (
              laborHoursPerUnit *
                quantity *
                node.quantity *
                (operation.laborRate ?? 0) +
              laborFixedHours * (operation.laborRate ?? 0)
            );
          });
        }

        if (operation.machineTime) {
          const normalized = normalizeTimeToHours(
            operation.machineTime,
            operation.machineUnit
          );
          machineFixedHours = normalized.fixedHours;
          machineHoursPerUnit = normalized.hoursPerUnit;

          effects.machineCost.push((quantity) => {
            return (
              machineHoursPerUnit *
                quantity *
                node.quantity *
                (operation.machineRate ?? 0) +
              machineFixedHours * (operation.machineRate ?? 0)
            );
          });
        }

        const hoursPerUnit = Math.max(laborHoursPerUnit, machineHoursPerUnit);
        const fixedHours = Math.max(laborFixedHours, machineFixedHours);

        effects.overheadCost.push((quantity) => {
          if (hoursPerUnit * quantity * node.quantity > fixedHours) {
            return (
              hoursPerUnit *
              quantity *
              node.quantity *
              (operation.overheadRate ?? 0)
            );
          } else {
            return fixedHours * (operation.overheadRate ?? 0);
          }
        });
      } else if (operation.operationType === "Outside") {
        effects.outsideCost.push((quantity) => {
          const unitCost =
            operation.operationUnitCost * node.quantity * quantity;
          return Math.max(operation.operationMinimumCost, unitCost);
        });
      }
    }

    for (const child of node.children) {
      walkTree(child);
    }
  }

  // Build enhanced trees and walk them
  for (const root of tree.data) {
    const enhanced = buildEnhancedTree(root, 1);
    walkTree(enhanced);
  }

  // 6. Compute prices for each quantity
  const priceRows = quantities
    .filter((qty) => !manualQuantities.has(Number(qty)))
    .map((qty) => {
      const categoryCosts: Record<CostCategoryKey, number> = {
        materialCost: 0,
        partCost: 0,
        toolCost: 0,
        consumableCost: 0,
        serviceCost: 0,
        laborCost: 0,
        machineCost: 0,
        overheadCost: 0,
        outsideCost: 0,
      };

      for (const key of costCategoryKeys) {
        categoryCosts[key] = effects[key].reduce(
          (acc, effect) => acc + effect(qty),
          0
        );
        // Convert to per-unit cost
        if (qty > 0) {
          categoryCosts[key] = categoryCosts[key] / qty;
        }
      }

      // Apply markups
      const unitPrice = costCategoryKeys.reduce((sum, key) => {
        const cost = categoryCosts[key] ?? 0;
        const markup = effectiveDefaults[key] ?? 0;
        return sum + cost * (1 + markup / 100);
      }, 0);

      const roundedUnitPrice = Number(unitPrice.toFixed(precision));

      return {
        quoteId,
        quoteLineId,
        companyId,
        quantity: qty,
        unitPrice: roundedUnitPrice,
        categoryMarkups: effectiveDefaults,
        priceSource: "system",
        exchangeRate,
        createdBy: userId,
        leadTime: 0,
        discountPercent: 0,
      };
    });

  // 7. Replace system-priced rows; manual rows for current quantities are
  // preserved untouched. Manual rows for removed quantity breaks are deleted
  // along with the system rows.
  let deleteQuery = client
    .from("quoteLinePrice")
    .delete()
    .eq("quoteLineId", quoteLineId)
    .eq("companyId", companyId);
  if (manualQuantities.size > 0) {
    deleteQuery = deleteQuery.not(
      "quantity",
      "in",
      `(${[...manualQuantities].join(",")})`
    );
  }
  const deleteResult = await deleteQuery;
  if (deleteResult.error) throw new Error("Failed to delete quote line prices");

  if (priceRows.length > 0) {
    const insertResult = await client.from("quoteLinePrice").insert(priceRows);
    if (insertResult.error)
      throw new Error("Failed to insert quote line prices");
  }
}
