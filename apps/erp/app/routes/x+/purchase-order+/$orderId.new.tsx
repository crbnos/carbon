// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { redirect, round } from "@carbon/utils";
import { type ActionFunctionArgs, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { LineTaxDecision } from "~/modules/accounting/accounting.utils";
import { getUnreleasedChangeOrderIssue } from "~/modules/items/items.service";
import {
  chargeNumberError,
  checkProjectBudget
} from "~/modules/projects/projects.service";
import {
  isPurchaseOrderLocked,
  purchaseOrderLineValidator
} from "~/modules/purchasing/purchasing.models";
import {
  getPurchaseOrder,
  resolveCreatedPurchaseLineTax,
  upsertPurchaseOrderLine
} from "~/modules/purchasing/purchasing.service";
import type { PurchaseOrder } from "~/modules/purchasing/types";
import { PurchaseOrderLineForm } from "~/modules/purchasing/ui/PurchaseOrder";
import type { MethodItemType } from "~/modules/shared/types";
import { getDatabaseClient } from "~/services/database.server";
import { setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  // First check with view permission to verify PO status
  const { client: viewClient } = await requirePermissions(request, {
    view: "purchasing"
  });

  const purchaseOrder = await getPurchaseOrder(viewClient, orderId);
  if (purchaseOrder.error) {
    throw redirect(
      path.to.purchaseOrderDetails(orderId),
      await flash(
        request,
        error(purchaseOrder.error, "Failed to load purchase order")
      )
    );
  }

  await requireUnlocked({
    request,
    isLocked: isPurchaseOrderLocked(purchaseOrder.data?.status),
    redirectTo: path.to.purchaseOrderDetails(orderId),
    message: "Cannot modify a confirmed purchase order."
  });

  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "purchasing"
    });

  const formData = await request.formData();
  const validation = await validator(purchaseOrderLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  // An item a change notice is still holding is not purchasable — it is a draft
  // revision the supplier has never been shown. Checked here rather than only in
  // the picker because this action is also reached by the API and the MCP tools.
  if (d.itemId) {
    const unreleasedIssue = await getUnreleasedChangeOrderIssue(
      getCarbonServiceRole(),
      { itemId: d.itemId, companyId }
    );
    if (unreleasedIssue) {
      throw redirect(
        path.to.purchaseOrderDetails(orderId),
        await flash(
          request,
          error(null, `${unreleasedIssue} It cannot be purchased.`)
        )
      );
    }
  }

  const chargeError = await chargeNumberError(client, companyId, d);
  if (chargeError) {
    throw redirect(
      path.to.purchaseOrderDetails(orderId),
      await flash(request, error(null, chargeError.message))
    );
  }

  // Budget control (Government Contracting 5c, C4): Block refuses the line,
  // Warn saves it and flashes the overrun.
  const budget = d.projectId
    ? await checkProjectBudget(getDatabaseClient(), client, {
        companyId,
        source: "purchase",
        charges: [
          {
            projectId: d.projectId,
            projectElementId: d.projectElementId ?? null,
            amount:
              (d.purchaseQuantity ?? 0) *
              ((d.supplierUnitPrice ?? 0) / (d.exchangeRate || 1))
          }
        ]
      })
    : null;
  if (budget?.status === "block") {
    // The add-line modal closes when it submits, so a field error would have
    // no form to land on: every refusal after validation is a flash.
    throw redirect(
      path.to.purchaseOrderDetails(orderId),
      await flash(request, error(null, budget.message))
    );
  }

  const tax = await resolveCreatedPurchaseLineTax(client, {
    companyId,
    companyGroupId,
    supplierId: purchaseOrder.data?.supplierId,
    documentDate: purchaseOrder.data?.orderDate,
    currencyCode: purchaseOrder.data?.currencyCode,
    itemId: d.itemId,
    unitPrice: d.supplierUnitPrice ?? 0,
    quantity: d.purchaseQuantity ?? 0,
    shippingCost: d.supplierShippingCost ?? 0,
    // The form posts the field: an empty one is a cleared code. A request
    // that does not takes the supplier's code.
    taxCodeId: formData.has("taxCodeId") ? (d.taxCodeId ?? "") : undefined,
    taxPercent: d.taxPercent,
    supplierTaxAmount: d.supplierTaxAmount ?? 0
  });
  Object.assign(d, tax);

  const createPurchaseOrderLine = await upsertPurchaseOrderLine(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createPurchaseOrderLine.error) {
    throw redirect(
      path.to.purchaseOrderDetails(orderId),
      await flash(
        request,
        error(
          createPurchaseOrderLine.error,
          "Failed to create purchase order line."
        )
      )
    );
  }

  if (budget?.status === "warn") {
    throw redirect(
      path.to.purchaseOrderDetails(orderId),
      await flash(request, success(`Line saved. ${budget.message}`))
    );
  }

  throw redirect(path.to.purchaseOrderDetails(orderId));
}

export default function NewPurchaseOrderLineRoute() {
  const { orderId } = useParams();

  if (!orderId) throw new Error("Could not find purchase order id");
  const routeData = useRouteData<{
    purchaseOrder: PurchaseOrder;
    resolvedTax: LineTaxDecision | null;
  }>(path.to.purchaseOrder(orderId));

  const initialValues = {
    conversionFactor: 1,
    exchangeRate: 1,
    inventoryUnitOfMeasureCode: "",
    itemId: "",
    purchaseOrderId: orderId,
    // See PurchaseOrderExplorer — "Item" is the picker's generic mode and is
    // not a valid line type.
    purchaseOrderLineType: "Part" as MethodItemType,
    purchaseQuantity: 1,
    purchaseUnitOfMeasureCode: "",
    requiredDate: routeData?.purchaseOrder?.receiptRequestedDate ?? undefined,
    promisedDate: routeData?.purchaseOrder?.receiptPromisedDate ?? undefined,
    setupPrice: 0,
    storageUnitId: "",
    supplierShippingCost: 0,
    supplierTaxAmount: 0,
    supplierUnitPrice: 0,
    // The supplier's tax code, else its bare percent.
    taxCodeId: routeData?.resolvedTax?.taxCodeId ?? undefined,
    taxPercent: round(routeData?.resolvedTax?.taxPercent ?? 0)
  };

  return <PurchaseOrderLineForm initialValues={initialValues} />;
}
