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

  const [toolPurchasingResult, itemCostHistory] = await Promise.all([
    getItemReplenishment(client, itemId, companyId),
    getItemCostHistory(client, itemId, companyId),
  ]);

  if (toolPurchasingResult.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(toolPurchasingResult.error, "Failed to load tool purchasing")
      )
    );
  }

  return defer({
    toolPurchasing: toolPurchasingResult.data,
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

  // validate with toolsValidator
  const validation = await validator(itemPurchasingValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateToolPurchasing = await upsertItemPurchasing(client, {
    ...validation.data,
    itemId,
    updatedBy: userId,
  });
  if (updateToolPurchasing.error) {
    throw redirect(
      path.to.tool(itemId),
      await flash(
        request,
        error(updateToolPurchasing.error, "Failed to update tool purchasing")
      )
    );
  }

  throw redirect(
    path.to.toolPurchasing(itemId),
    await flash(request, success("Updated tool purchasing"))
  );
}

export default function ToolPurchasingRoute() {
  const { toolPurchasing, batchProperties, itemCostHistory } =
    useLoaderData<typeof loader>();

  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");
  const routeData = useRouteData<{ supplierParts: SupplierPart[] }>(
    path.to.tool(itemId)
  );
  const supplierParts = routeData?.supplierParts ?? [];

  const toolData = useRouteData<{
    toolSummary: { itemTrackingType?: string; readableIdWithRevision?: string };
  }>(path.to.tool(itemId));

  const initialValues = {
    ...toolPurchasing,
    preferredSupplierId: toolPurchasing?.preferredSupplierId ?? undefined,
    leadTime: toolPurchasing?.leadTime ?? "",
    purchasingBlocked: toolPurchasing?.purchasingBlocked ?? false,
    purchasingUnitOfMeasureCode:
      toolPurchasing?.purchasingUnitOfMeasureCode ?? "",
    conversionFactor: toolPurchasing?.conversionFactor ?? 1,
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
        toolData?.toolSummary?.itemTrackingType ?? ""
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
        readableId={toolData?.toolSummary?.readableIdWithRevision ?? ""}
        itemCostHistory={itemCostHistory}
      />
    </VStack>
  );
}
