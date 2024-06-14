import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
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

  const materialPurchasing = await getItemReplenishment(
    client,
    itemId,
    companyId
  );

  if (materialPurchasing.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(materialPurchasing.error, "Failed to load material purchasing")
      )
    );
  }

  return json({
    materialPurchasing: materialPurchasing.data,
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
  const { materialPurchasing } = useLoaderData<typeof loader>();

  const initialValues = {
    ...materialPurchasing,
    preferredSupplierId: materialPurchasing?.preferredSupplierId ?? undefined,
    purchasingLeadTime: materialPurchasing?.purchasingLeadTime ?? "",
    purchasingBlocked: materialPurchasing?.purchasingBlocked ?? false,
    purchasingUnitOfMeasureCode:
      materialPurchasing?.purchasingUnitOfMeasureCode ?? "",
    conversionFactor: materialPurchasing?.conversionFactor ?? 1,
  };

  return (
    <ItemPurchasingForm
      key={initialValues.itemId}
      initialValues={initialValues}
    />
  );
}
