// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { EACH_UNIT_OF_MEASURE_CODE } from "~/modules/items/items.models";
import { getSupplierPartPricing } from "~/modules/items/items.utils";
import {
  createProjectPurchaseOrderLineValidator,
  createPurchaseOrderLineFromMaterialValidator
} from "~/modules/projects/projects.models";
import { getSupplierPartTerms } from "~/modules/projects/projects.service";
import type { PurchaseLineItemTerms } from "~/modules/projects/ui/Element/purchase-line";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-create-po-line");

export type CreatePurchaseOrderLineResult = { error: { message: string } };

/**
 * The supplier a Create PO line modal starts with (the item's preferred
 * supplier, unless `?supplierId=` names another) and that supplier's Draft
 * purchase orders at the project's location, in one query. With no material
 * (the task's Add Purchase Order), also the assets a line can buy and the
 * currency a typed price is in.
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
  let purchaseOrders: {
    id: string;
    purchaseOrderId: string;
    currencyCode: string | null;
  }[] = [];
  if (supplierId) {
    let query = client
      .from("purchaseOrder")
      .select(
        "id, purchaseOrderId, currencyCode, purchaseOrderDelivery!inner(locationId)"
      )
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
      purchaseOrderId: po.purchaseOrderId,
      currencyCode: po.currencyCode
    }));
  }

  if (materialId) return { supplierId, purchaseOrders };

  const itemId = searchParams.get("itemId");
  const [assets, company, supplier, item] = await Promise.all([
    client
      .from("fixedAsset")
      .select("id, fixedAssetId, name")
      .eq("companyId", companyId)
      // Under Construction too: a CIP asset collects purchased cost.
      .in("status", ["Draft", "Under Construction"])
      .order("fixedAssetId"),
    client
      .from("company")
      .select("baseCurrencyCode")
      .eq("id", companyId)
      .single(),
    supplierId
      ? client
          .from("supplier")
          .select("currencyCode")
          .eq("id", supplierId)
          .eq("companyId", companyId)
          .maybeSingle()
      : null,
    itemId
      ? client
          .from("item")
          .select("type, unitOfMeasureCode, itemCost(unitCost)")
          .eq("id", itemId)
          .eq("companyId", companyId)
          .maybeSingle()
      : null
  ]);
  if (assets.error) {
    logger.error("Failed to load the fixed assets a line can buy", {
      companyId,
      projectId,
      error: assets.error
    });
  }

  const baseCurrencyCode = company.data?.baseCurrencyCode ?? "USD";
  const currencyCode = supplier?.data?.currencyCode ?? baseCurrencyCode;

  // The rate a new order would take. Null when it cannot be read, so the line
  // starts with no price rather than one in the wrong currency.
  const rate =
    currencyCode === baseCurrencyCode
      ? { data: 1, error: null }
      : await client.rpc("get_exchange_rate", {
          p_company_id: companyId,
          p_currency_code: currencyCode
        });
  if (rate.error) {
    logger.error("Failed to load the exchange rate", {
      companyId,
      currencyCode,
      error: rate.error
    });
  }

  let itemTerms: PurchaseLineItemTerms | null = null;
  if (itemId && item?.data) {
    const terms = await getSupplierPartTerms(client, {
      companyId,
      itemId,
      supplierId: supplierId ?? "",
      quantity: 1
    });
    const pricing = terms.part
      ? await getSupplierPartPricing(
          client,
          terms.part,
          baseCurrencyCode,
          currencyCode
        )
      : null;
    if (pricing?.error) {
      logger.error("Failed to load the supplier part's price", {
        companyId,
        itemId,
        supplierId,
        error: pricing.error
      });
    }
    // A service is always bought and "stocked" in EA, 1:1.
    const isService = item.data.type === "Service";
    const inventoryUnit = isService
      ? EACH_UNIT_OF_MEASURE_CODE
      : (item.data.unitOfMeasureCode ?? EACH_UNIT_OF_MEASURE_CODE);
    itemTerms = {
      conversionFactor: isService ? 1 : terms.conversionFactor,
      minimumOrderQuantity: isService
        ? 0
        : Number(terms.part?.minimumOrderQuantity ?? 0),
      inventoryUnit,
      purchaseUnit: isService
        ? EACH_UNIT_OF_MEASURE_CODE
        : (terms.purchaseUnit ?? inventoryUnit),
      unitCost: Number(item.data.itemCost?.[0]?.unitCost ?? 0),
      pricing: pricing?.data ?? null
    };
  }

  return {
    supplierId,
    // A line's price is in its order's currency, so only the orders in the
    // supplier's currency are offered.
    purchaseOrders: purchaseOrders.filter(
      (po) => (po.currencyCode ?? baseCurrencyCode) === currencyCode
    ),
    assets: assets.data ?? [],
    currencyCode,
    baseCurrencyCode,
    exchangeRate: rate.data ?? null,
    itemTerms
  };
}

/**
 * Create PO line: a purchase order line for a Purchase to Order plan-line
 * material, charged to its element, on a Draft purchase order of the
 * supplier or a new one (`projects.createPurchaseOrderLineFromMaterial`).
 * With no material, the task's Add Purchase Order
 * (`projects.createProjectPurchaseOrderLine`). The action redirects to the
 * purchase order.
 */
export async function action({
  request,
  params
}: ActionFunctionArgs): Promise<CreatePurchaseOrderLineResult> {
  assertIsPost(request);
  const { projectId, elementId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  if (!elementId) throw new Error("Could not find elementId");

  const formData = await request.formData();

  if (!formData.has("materialId")) {
    const line = await validator(
      createProjectPurchaseOrderLineValidator
    ).validate(formData);
    if (line.error) {
      return { error: { message: "Fill in the line's required fields" } };
    }
    const api = await carbon(request);
    const result = await api.projects.createProjectPurchaseOrderLine({
      ...line.data,
      projectId,
      projectElementId: elementId
    });
    if (result.error) return { error: { message: result.error.message } };

    const to = path.to.purchaseOrderDetails(result.data.purchaseOrderId);
    if (result.data.budgetWarning) {
      throw redirect(
        to,
        await flash(
          request,
          success(`Line saved. ${result.data.budgetWarning}`)
        )
      );
    }
    throw redirect(to);
  }

  const validation = await validator(
    createPurchaseOrderLineFromMaterialValidator
  ).validate(formData);
  if (validation.error) {
    return { error: { message: "Choose a supplier and enter a quantity" } };
  }

  const api = await carbon(request);
  const result = await api.projects.createPurchaseOrderLineFromMaterial({
    ...validation.data,
    projectId,
    projectElementId: elementId
  });
  if (result.error) return { error: { message: result.error.message } };

  throw redirect(path.to.purchaseOrderDetails(result.data.purchaseOrderId));
}
