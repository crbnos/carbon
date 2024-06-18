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
  const routeData = useRouteData<{ buyMethods: BuyMethod[] }>(
    path.to.tool(itemId)
  );
  const buyMethods = routeData?.buyMethods ?? [];

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
