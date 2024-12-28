import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import { useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  getItemCustomerParts,
  getItemUnitSalePrice,
  itemUnitSalePriceValidator,
  upsertItemUnitSalePrice,
} from "~/modules/items";
import CustomerParts from "~/modules/items/ui/Item/CustomerParts";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [partUnitSalePrice, customerParts] = await Promise.all([
    getItemUnitSalePrice(client, itemId, companyId),
    getItemCustomerParts(client, itemId, companyId),
  ]);

  if (partUnitSalePrice.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(partUnitSalePrice.error, "Failed to load part unit sale price")
      )
    );
  }

  return json({
    partUnitSalePrice: partUnitSalePrice.data,
    customerParts: customerParts.data,
    itemId,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(itemUnitSalePriceValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updatePartUnitSalePrice = await upsertItemUnitSalePrice(client, {
    ...validation.data,
    itemId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updatePartUnitSalePrice.error) {
    throw redirect(
      path.to.part(itemId),
      await flash(
        request,
        error(updatePartUnitSalePrice.error, "Failed to update part sale price")
      )
    );
  }

  throw redirect(
    path.to.partSales(itemId),
    await flash(request, success("Updated part sale price"))
  );
}

export default function PartSalesRoute() {
  const { customerParts, itemId } = useLoaderData<typeof loader>();

  // const initialValues = {
  //   ...partUnitSalePrice,
  //   salesUnitOfMeasureCode: partUnitSalePrice?.salesUnitOfMeasureCode ?? "",
  //   ...getCustomFields(partUnitSalePrice.customFields),
  //   itemId: itemId,
  // };

  return (
    <VStack spacing={2} className="p-2">
      {/* <ItemSalePriceForm
        key={initialValues.itemId}
        initialValues={initialValues}
      /> */}
      {customerParts ? (
        <CustomerParts customerParts={customerParts} itemId={itemId} />
      ) : null}
    </VStack>
  );
}
