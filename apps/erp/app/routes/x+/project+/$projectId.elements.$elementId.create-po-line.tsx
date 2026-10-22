// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { createPurchaseOrderLineFromMaterialValidator } from "~/modules/projects/projects.models";
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
 * supplier or a new one (`projects.createPurchaseOrderLineFromMaterial`).
 * The action redirects to the purchase order.
 */
export async function action({
  request,
  params
}: ActionFunctionArgs): Promise<CreatePurchaseOrderLineResult> {
  assertIsPost(request);
  const { projectId, elementId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  if (!elementId) throw new Error("Could not find elementId");

  const validation = await validator(
    createPurchaseOrderLineFromMaterialValidator
  ).validate(await request.formData());
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
