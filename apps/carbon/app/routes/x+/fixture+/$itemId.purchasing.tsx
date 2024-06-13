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

  const fixturePurchasing = await getItemReplenishment(
    client,
    itemId,
    companyId
  );

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
    <ItemPurchasingForm
      key={initialValues.itemId}
      initialValues={initialValues}
    />
  );
}
