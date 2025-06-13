import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import { Await, useLoaderData, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { Suspense } from "react";
import { useRouteData } from "~/hooks";
import { getBatchProperties } from "~/modules/inventory";
import BatchPropertiesConfig from "~/modules/inventory/ui/Batches/BatchPropertiesConfig";
import type { SupplierPart } from "~/modules/items";
import {
  getItemCostHistory,
  getItemReplenishment,
  itemPurchasingValidator,
  upsertItemPurchasing,
} from "~/modules/items";
import { ItemPurchasingForm, SupplierParts } from "~/modules/items/ui/Item";
import { ItemCostHistoryChart } from "~/modules/items/ui/Item/ItemCostHistoryChart";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [materialPurchasingResult, itemCostHistory] = await Promise.all([
    getItemReplenishment(client, itemId, companyId),
    getItemCostHistory(client, itemId, companyId),
  ]);

  if (materialPurchasingResult.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(
          materialPurchasingResult.error,
          "Failed to load material purchasing"
        )
      )
    );
  }

  return defer({
    materialPurchasing: materialPurchasingResult.data,
    batchProperties: getBatchProperties(client, [itemId], companyId),
    itemCostHistory: itemCostHistory.data ?? [],
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  // validate with materialsValidator
  const validation = await validator(itemPurchasingValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateMaterialPurchasing = await upsertItemPurchasing(client, {
    ...validation.data,
    itemId,
    updatedBy: userId,
  });
  if (updateMaterialPurchasing.error) {
    throw redirect(
      path.to.material(itemId),
      await flash(
        request,
        error(
          updateMaterialPurchasing.error,
          "Failed to update material purchasing"
        )
      )
    );
  }

  throw redirect(
    path.to.materialPurchasing(itemId),
    await flash(request, success("Updated material purchasing"))
  );
}

export default function MaterialPurchasingRoute() {
  const { materialPurchasing, batchProperties, itemCostHistory } =
    useLoaderData<typeof loader>();

  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");
  const routeData = useRouteData<{ supplierParts: SupplierPart[] }>(
    path.to.material(itemId)
  );
  const supplierParts = routeData?.supplierParts ?? [];

  const materialData = useRouteData<{
    materialSummary: {
      itemTrackingType?: string;
      readableIdWithRevision?: string;
    };
  }>(path.to.material(itemId));

  const initialValues = {
    ...materialPurchasing,
    preferredSupplierId: materialPurchasing?.preferredSupplierId ?? undefined,
    leadTime: materialPurchasing?.leadTime ?? "",
    purchasingBlocked: materialPurchasing?.purchasingBlocked ?? false,
    purchasingUnitOfMeasureCode:
      materialPurchasing?.purchasingUnitOfMeasureCode ?? "",
    conversionFactor: materialPurchasing?.conversionFactor ?? 1,
  };

  return (
    <VStack spacing={2} className="p-2">
      <ItemPurchasingForm
        key={initialValues.itemId}
        initialValues={initialValues}
        allowedSuppliers={
          supplierParts.map((s) => s.supplier?.id).filter(Boolean) as string[]
        }
      />
      <SupplierParts supplierParts={supplierParts} />
      {["Batch", "Serial"].includes(
        materialData?.materialSummary?.itemTrackingType ?? ""
      ) && (
        <Suspense fallback={null}>
          <Await resolve={batchProperties}>
            {(resolvedProperties) => (
              <BatchPropertiesConfig
                itemId={itemId}
                key={`batch-properties:${itemId}`}
                properties={resolvedProperties.data ?? []}
              />
            )}
          </Await>
        </Suspense>
      )}
      <ItemCostHistoryChart
        readableId={materialData?.materialSummary?.readableIdWithRevision ?? ""}
        itemCostHistory={itemCostHistory}
      />
    </VStack>
  );
}
