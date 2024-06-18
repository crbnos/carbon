import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useParams } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import type { BuyMethod } from "~/modules/items";
import {
  BuyMethods,
  ItemPurchasingForm,
  getItemReplenishment,
  itemPurchasingValidator,
  upsertItemPurchasing,
} from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

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
  const routeData = useRouteData<{ buyMethods: BuyMethod[] }>(
    path.to.consumable(itemId)
  );
  const buyMethods = routeData?.buyMethods ?? [];

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
    <>
      <ItemPurchasingForm
        key={initialValues.itemId}
        initialValues={initialValues}
        allowedSuppliers={
          buyMethods.map((s) => s.supplier?.id).filter(Boolean) as string[]
        }
      />
      <BuyMethods buyMethods={buyMethods} />
    </>
  );
}
