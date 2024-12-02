import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import { useLoaderData, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useRouteData } from "~/hooks";
import type { SupplierPart } from "~/modules/items";
import {
  ItemPurchasingForm,
  SupplierParts,
  getItemReplenishment,
  itemPurchasingValidator,
  upsertItemPurchasing,
} from "~/modules/items";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [toolPurchasing] = await Promise.all([
    getItemReplenishment(client, itemId, companyId),
  ]);

  if (toolPurchasing.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(toolPurchasing.error, "Failed to load tool purchasing")
      )
    );
  }

  return json({
    toolPurchasing: toolPurchasing.data,
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
  const { toolPurchasing } = useLoaderData<typeof loader>();

  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");
  const routeData = useRouteData<{ supplierParts: SupplierPart[] }>(
    path.to.tool(itemId)
  );
  const supplierParts = routeData?.supplierParts ?? [];

  const initialValues = {
    ...toolPurchasing,
    preferredSupplierId: toolPurchasing?.preferredSupplierId ?? undefined,
    purchasingLeadTime: toolPurchasing?.purchasingLeadTime ?? "",
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
    </VStack>
  );
}
