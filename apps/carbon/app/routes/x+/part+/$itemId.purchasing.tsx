import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import { useLoaderData, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
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

  const [partPurchasing] = await Promise.all([
    getItemReplenishment(client, itemId, companyId),
  ]);

  if (partPurchasing.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(partPurchasing.error, "Failed to load part purchasing")
      )
    );
  }

  return json({
    partPurchasing: partPurchasing.data,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  // validate with partsValidator
  const validation = await validator(itemPurchasingValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updatePartPurchasing = await upsertItemPurchasing(client, {
    ...validation.data,
    itemId,
    updatedBy: userId,
  });
  if (updatePartPurchasing.error) {
    throw redirect(
      path.to.part(itemId),
      await flash(
        request,
        error(updatePartPurchasing.error, "Failed to update part purchasing")
      )
    );
  }

  throw redirect(
    path.to.partPurchasing(itemId),
    await flash(request, success("Updated part purchasing"))
  );
}

export default function PartPurchasingRoute() {
  const { partPurchasing } = useLoaderData<typeof loader>();

  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");
  const routeData = useRouteData<{ buyMethods: BuyMethod[] }>(
    path.to.part(itemId)
  );
  const buyMethods = routeData?.buyMethods ?? [];

  const initialValues = {
    ...partPurchasing,
    preferredSupplierId: partPurchasing?.preferredSupplierId ?? undefined,
    purchasingLeadTime: partPurchasing?.purchasingLeadTime ?? "",
    purchasingBlocked: partPurchasing?.purchasingBlocked ?? false,
    purchasingUnitOfMeasureCode:
      partPurchasing?.purchasingUnitOfMeasureCode ?? "",
    conversionFactor: partPurchasing?.conversionFactor ?? 1,
  };

  return (
    <VStack spacing={2} className="p-2">
      <ItemPurchasingForm
        key={initialValues.itemId}
        initialValues={initialValues}
        allowedSuppliers={
          buyMethods.map((s) => s.supplier?.id).filter(Boolean) as string[]
        }
      />
      <BuyMethods buyMethods={buyMethods} />
    </VStack>
  );
}
