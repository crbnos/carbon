import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
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
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [fixturePurchasing] = await Promise.all([
    getItemReplenishment(client, itemId, companyId),
  ]);

  if (fixturePurchasing.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(fixturePurchasing.error, "Failed to load fixture purchasing")
      )
    );
  }

  return json({
    fixturePurchasing: fixturePurchasing.data,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  // validate with fixturesValidator
  const validation = await validator(itemPurchasingValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateFixturePurchasing = await upsertItemPurchasing(client, {
    ...validation.data,
    itemId,
    updatedBy: userId,
  });
  if (updateFixturePurchasing.error) {
    throw redirect(
      path.to.fixture(itemId),
      await flash(
        request,
        error(
          updateFixturePurchasing.error,
          "Failed to update fixture purchasing"
        )
      )
    );
  }

  throw redirect(
    path.to.fixturePurchasing(itemId),
    await flash(request, success("Updated fixture purchasing"))
  );
}

export default function FixturePurchasingRoute() {
  const { fixturePurchasing } = useLoaderData<typeof loader>();

  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");
  const routeData = useRouteData<{ buyMethods: BuyMethod[] }>(
    path.to.fixture(itemId)
  );
  const buyMethods = routeData?.buyMethods ?? [];

  const initialValues = {
    ...fixturePurchasing,
    preferredSupplierId: fixturePurchasing?.preferredSupplierId ?? undefined,
    purchasingLeadTime: fixturePurchasing?.purchasingLeadTime ?? "",
    purchasingBlocked: fixturePurchasing?.purchasingBlocked ?? false,
    purchasingUnitOfMeasureCode:
      fixturePurchasing?.purchasingUnitOfMeasureCode ?? "",
    conversionFactor: fixturePurchasing?.conversionFactor ?? 1,
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
