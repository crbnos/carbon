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
  getItemReplenishment,
  itemPurchasingValidator,
  upsertItemPurchasing,
} from "~/modules/items";
import { ItemPurchasingForm, SupplierParts } from "~/modules/items/ui/Item";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [consumablePurchasing] = await Promise.all([
    getItemReplenishment(client, itemId, companyId),
  ]);

  if (consumablePurchasing.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(
          consumablePurchasing.error,
          "Failed to load consumable purchasing"
        )
      )
    );
  }

  return json({
    consumablePurchasing: consumablePurchasing.data,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  // validate with consumablesValidator
  const validation = await validator(itemPurchasingValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateConsumablePurchasing = await upsertItemPurchasing(client, {
    ...validation.data,
    itemId,
    updatedBy: userId,
  });
  if (updateConsumablePurchasing.error) {
    throw redirect(
      path.to.consumable(itemId),
      await flash(
        request,
        error(
          updateConsumablePurchasing.error,
          "Failed to update consumable purchasing"
        )
      )
    );
  }

  throw redirect(
    path.to.consumablePurchasing(itemId),
    await flash(request, success("Updated consumable purchasing"))
  );
}

export default function ConsumablePurchasingRoute() {
  const { consumablePurchasing } = useLoaderData<typeof loader>();

  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");
  const routeData = useRouteData<{ supplierParts: SupplierPart[] }>(
    path.to.consumable(itemId)
  );
  const supplierParts = routeData?.supplierParts ?? [];

  const initialValues = {
    ...consumablePurchasing,
    preferredSupplierId: consumablePurchasing?.preferredSupplierId ?? undefined,
    purchasingLeadTime: consumablePurchasing?.purchasingLeadTime ?? "",
    purchasingBlocked: consumablePurchasing?.purchasingBlocked ?? false,
    purchasingUnitOfMeasureCode:
      consumablePurchasing?.purchasingUnitOfMeasureCode ?? "",
    conversionFactor: consumablePurchasing?.conversionFactor ?? 1,
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
