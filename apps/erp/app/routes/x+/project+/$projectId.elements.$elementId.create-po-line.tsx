// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import {
  applyRate,
  datetime,
  redirect,
  round,
  SCALE,
  taxableBase
} from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getSupplierPartPricing } from "~/modules/items/items.utils";
import {
  createPurchaseOrderLineFromMaterialValidator,
  NEW_PURCHASE_ORDER
} from "~/modules/projects/projects.models";
import { chargeNumberError } from "~/modules/projects/projects.server";
import {
  insertPurchaseOrder,
  upsertPurchaseOrderLine
} from "~/modules/purchasing/purchasing.service";
import { resolveSupplierPrice } from "~/modules/shared/shared.utils";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-create-po-line");

export type CreatePurchaseOrderLineResult = { error: { message: string } };

/**
 * The supplier a Create PO line modal starts with (the item's preferred
 * supplier, unless `?supplierId=` names another) and that supplier's Draft
 * purchase orders at the project's location, in one query.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: ["projects", "purchasing"]
  });

  const { projectId, elementId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  if (!elementId) throw new Error("Could not find elementId");

  const searchParams = new URL(request.url).searchParams;
  const materialId = searchParams.get("materialId") ?? "";

  const [material, project] = await Promise.all([
    client
      .from("projectElementMaterial")
      .select("itemId")
      .eq("id", materialId)
      .eq("projectElementId", elementId)
      .eq("companyId", companyId)
      .maybeSingle(),
    client
      .from("project")
      .select("locationId")
      .eq("id", projectId)
      .eq("companyId", companyId)
      .maybeSingle()
  ]);

  let supplierId = searchParams.get("supplierId");
  if (!supplierId && material.data) {
    const replenishment = await client
      .from("itemReplenishment")
      .select("preferredSupplierId")
      .eq("itemId", material.data.itemId)
      .eq("companyId", companyId)
      .maybeSingle();
    supplierId = replenishment.data?.preferredSupplierId ?? null;
  }

  const locationId = project.data?.locationId ?? null;
  let purchaseOrders: { id: string; purchaseOrderId: string }[] = [];
  if (supplierId) {
    let query = client
      .from("purchaseOrder")
      .select("id, purchaseOrderId, purchaseOrderDelivery!inner(locationId)")
      .eq("companyId", companyId)
      .eq("supplierId", supplierId)
      .eq("purchaseOrderType", "Purchase")
      .eq("status", "Draft")
      .order("createdAt", { ascending: false });
    if (locationId) {
      query = query.eq("purchaseOrderDelivery.locationId", locationId);
    }
    const drafts = await query;
    if (drafts.error) {
      logger.error("Failed to load the supplier's Draft purchase orders", {
        companyId,
        projectId,
        supplierId,
        error: drafts.error
      });
    }
    purchaseOrders = (drafts.data ?? []).map((po) => ({
      id: po.id,
      purchaseOrderId: po.purchaseOrderId
    }));
  }

  return { supplierId, purchaseOrders };
}

/**
 * Create PO line: a purchase order line for a Purchase to Order plan-line
 * material, charged to its element, on a Draft purchase order of the
 * supplier or a new one. The quantity is in the plan line's unit and becomes
 * purchase units through the supplier part's conversion factor, raised to
 * its minimum order quantity. The material remembers the line, and the
 * action redirects to the purchase order.
 */
export async function action({
  request,
  params
}: ActionFunctionArgs): Promise<CreatePurchaseOrderLineResult> {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "purchasing",
      view: "projects"
    });

  const { projectId, elementId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  if (!elementId) throw new Error("Could not find elementId");

  const validation = await validator(
    createPurchaseOrderLineFromMaterialValidator
  ).validate(await request.formData());
  if (validation.error) {
    return { error: { message: "Choose a supplier and enter a quantity" } };
  }
  const { materialId, supplierId, quantity, requiredDate, purchaseOrderId } =
    validation.data;

  const [material, project, supplier] = await Promise.all([
    client
      .from("projectElementMaterial")
      .select(
        "id, itemId, methodType, unitOfMeasureCode, purchaseOrderLineId, item:item!projectElementMaterial_itemId_fkey(name, unitOfMeasureCode)"
      )
      .eq("id", materialId)
      .eq("projectId", projectId)
      .eq("projectElementId", elementId)
      .eq("companyId", companyId)
      .maybeSingle(),
    client
      .from("project")
      .select("locationId")
      .eq("id", projectId)
      .eq("companyId", companyId)
      .maybeSingle(),
    client
      .from("supplier")
      .select("id, taxPercent, currencyCode")
      .eq("id", supplierId)
      .eq("companyId", companyId)
      .maybeSingle()
  ]);
  if (material.error || !material.data) {
    logger.error("Failed to load the plan-line material", {
      companyId,
      projectId,
      materialId,
      error: material.error
    });
    return { error: { message: "The material is not on this element" } };
  }
  if (material.data.methodType !== "Purchase to Order") {
    return {
      error: { message: "Only a Purchase to Order material makes a PO line" }
    };
  }
  if (material.data.purchaseOrderLineId) {
    return { error: { message: "This material already has a PO line" } };
  }
  if (supplier.error || !supplier.data) {
    return { error: { message: "The supplier does not exist" } };
  }
  const chargeError = await chargeNumberError(client, companyId, {
    projectId,
    projectElementId: elementId
  });
  if (chargeError) return { error: { message: chargeError.message } };

  const itemId = material.data.itemId;
  const [supplierPart, replenishment] = await Promise.all([
    client
      .from("supplierPart")
      .select(
        "id, companyId, currencyCode, supplierUnitPrice, supplierUnitOfMeasureCode, conversionFactor, minimumOrderQuantity"
      )
      .eq("itemId", itemId)
      .eq("supplierId", supplierId)
      .eq("companyId", companyId)
      .order("createdAt", { ascending: true })
      .limit(1),
    client
      .from("itemReplenishment")
      .select("purchasingBlocked")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .maybeSingle()
  ]);
  if (replenishment.data?.purchasingBlocked) {
    return { error: { message: "Purchasing is blocked for this item" } };
  }
  if (supplierPart.error) {
    logger.error("Failed to load the supplier part", {
      companyId,
      itemId,
      supplierId,
      error: supplierPart.error
    });
  }
  const part = supplierPart.data?.[0];
  const conversionFactor = Number(part?.conversionFactor ?? 1) || 1;
  const minimumOrderQuantity = Number(part?.minimumOrderQuantity ?? 0);
  const purchaseQuantity = Math.max(
    round(quantity / conversionFactor),
    minimumOrderQuantity
  );
  const inventoryUnit =
    material.data.unitOfMeasureCode ??
    material.data.item?.unitOfMeasureCode ??
    "EA";

  const [company, currencies] = await Promise.all([
    client
      .from("company")
      .select("baseCurrencyCode")
      .eq("id", companyId)
      .single(),
    client
      .from("currencies")
      .select("code, decimalPlaces")
      .eq("companyGroupId", companyGroupId)
  ]);
  const baseCurrencyCode = company.data?.baseCurrencyCode ?? "USD";
  const currencyCode = supplier.data.currencyCode ?? baseCurrencyCode;
  const locationId = project.data?.locationId ?? undefined;

  let orderId = purchaseOrderId;
  // The order's currency and rate (foreign per base): the line's price is in it.
  let order = { currencyCode, exchangeRate: 1 };
  if (purchaseOrderId === NEW_PURCHASE_ORDER) {
    const created = await insertPurchaseOrder(client, {
      status: "Draft",
      supplierId,
      purchaseOrderType: "Purchase",
      currencyCode,
      locationId,
      companyId,
      companyGroupId,
      createdBy: userId
    });
    if (created.error || !created.data) {
      logger.error("Failed to create a purchase order for a plan line", {
        companyId,
        projectId,
        supplierId,
        error: created.error
      });
      return { error: { message: "Failed to create the purchase order" } };
    }
    orderId = created.data.id;
    order = { currencyCode, exchangeRate: created.data.exchangeRate };
  } else {
    const draft = await client
      .from("purchaseOrder")
      .select("id, currencyCode, exchangeRate")
      .eq("id", purchaseOrderId)
      .eq("supplierId", supplierId)
      .eq("status", "Draft")
      .eq("companyId", companyId)
      .maybeSingle();
    if (draft.error || !draft.data) {
      return {
        error: { message: "The purchase order is not a Draft of this supplier" }
      };
    }
    order = {
      currencyCode: draft.data.currencyCode ?? baseCurrencyCode,
      exchangeRate: Number(draft.data.exchangeRate ?? 1)
    };
  }
  const decimals =
    (currencies.data ?? []).find((c) => c.code === order.currencyCode)
      ?.decimalPlaces ?? SCALE;

  // The supplier part's price is in its own currency; convert it into the
  // order's, as every purchase document does (resolveSupplierPrice).
  const pricing = part
    ? await getSupplierPartPricing(
        client,
        part,
        baseCurrencyCode,
        order.currencyCode
      )
    : null;
  if (pricing?.error) {
    return { error: { message: pricing.error.message } };
  }
  const supplierUnitPrice = resolveSupplierPrice(
    pricing?.data ?? null,
    purchaseQuantity,
    order,
    0
  );
  const taxPercent = Number(supplier.data.taxPercent ?? 0);
  const line = await upsertPurchaseOrderLine(client, {
    purchaseOrderId: orderId,
    itemId,
    description: material.data.item?.name ?? undefined,
    purchaseOrderLineType: "Part",
    purchaseQuantity,
    purchaseUnitOfMeasureCode: part?.supplierUnitOfMeasureCode ?? inventoryUnit,
    inventoryUnitOfMeasureCode: inventoryUnit,
    conversionFactor,
    supplierUnitPrice,
    exchangeRate: order.exchangeRate,
    taxPercent,
    supplierTaxAmount: applyRate(
      taxableBase(supplierUnitPrice, purchaseQuantity, 0),
      taxPercent,
      decimals
    ),
    supplierShippingCost: 0,
    requiredDate: requiredDate || undefined,
    locationId,
    projectId,
    projectElementId: elementId,
    companyId,
    createdBy: userId
  });
  if (line.error || !line.data) {
    logger.error("Failed to create a PO line from a plan-line material", {
      companyId,
      projectId,
      materialId,
      purchaseOrderId: orderId,
      error: line.error
    });
    return { error: { message: "Failed to create the purchase order line" } };
  }

  // The service role: creating a PO line needs no right to edit the plan.
  const stamp = await getCarbonServiceRole()
    .from("projectElementMaterial")
    .update({
      purchaseOrderLineId: line.data.id,
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", materialId)
    .eq("companyId", companyId);
  if (stamp.error) {
    // The line exists; only the plan line's pointer to it failed.
    logger.error("Failed to link the PO line to its plan-line material", {
      companyId,
      projectId,
      materialId,
      purchaseOrderLineId: line.data.id,
      error: stamp.error
    });
  }

  throw redirect(path.to.purchaseOrderDetails(orderId));
}
