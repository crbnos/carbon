import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { SupplierPart } from "~/modules/items";
import {
  getItemCostHistory,
  getItemReplenishment,
  itemPurchasingValidator,
  upsertItemPurchasing
} from "~/modules/items";
import { ItemPurchasingForm, SupplierParts } from "~/modules/items/ui/Item";
import { ItemCostHistoryChart } from "~/modules/items/ui/Item/ItemCostHistoryChart";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [servicePurchasingResult, itemCostHistory] = await Promise.all([
    getItemReplenishment(client, itemId, companyId),
    getItemCostHistory(client, itemId, companyId)
  ]);

  if (servicePurchasingResult.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(
          servicePurchasingResult.error,
          "Failed to load service purchasing"
        )
      )
    );
  }

  return {
    servicePurchasing: servicePurchasingResult.data,
    itemCostHistory: itemCostHistory.data ?? []
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const validation = await validator(itemPurchasingValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateServicePurchasing = await upsertItemPurchasing(client, {
    ...validation.data,
    itemId,
    updatedBy: userId
  });
  if (updateServicePurchasing.error) {
    throw redirect(
      path.to.service(itemId),
      await flash(
        request,
        error(
          updateServicePurchasing.error,
          "Failed to update service purchasing"
        )
      )
    );
  }

  throw redirect(
    path.to.servicePurchasing(itemId),
    await flash(request, success("Updated service purchasing"))
  );
}

export default function ServicePurchasingRoute() {
  const { servicePurchasing, itemCostHistory } = useLoaderData<typeof loader>();

  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");
  const routeData = useRouteData<{ supplierParts: SupplierPart[] }>(
    path.to.service(itemId)
  );
  const supplierParts = routeData?.supplierParts ?? [];

  const serviceData = useRouteData<{
    serviceSummary: { readableIdWithRevision?: string };
  }>(path.to.service(itemId));

  const initialValues = {
    ...servicePurchasing,
    preferredSupplierId: servicePurchasing?.preferredSupplierId ?? undefined,
    leadTime: servicePurchasing?.leadTime ?? "",
    purchasingBlocked: servicePurchasing?.purchasingBlocked ?? false,
    purchasingUnitOfMeasureCode:
      servicePurchasing?.purchasingUnitOfMeasureCode ?? "",
    conversionFactor: servicePurchasing?.conversionFactor ?? 1
  };

  return (
    <VStack spacing={2} className="p-2">
      <ItemPurchasingForm
        key={initialValues.itemId}
        initialValues={initialValues}
        allowedSuppliers={
          supplierParts.map((s) => s.supplierId).filter(Boolean) as string[]
        }
      />
      <SupplierParts supplierParts={supplierParts} />
      <ItemCostHistoryChart
        readableId={serviceData?.serviceSummary?.readableIdWithRevision ?? ""}
        itemCostHistory={itemCostHistory}
      />
    </VStack>
  );
}
