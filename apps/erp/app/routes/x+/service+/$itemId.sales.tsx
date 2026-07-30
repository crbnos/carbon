import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  getItemUnitSalePrice,
  itemUnitSalePriceValidator,
  upsertItemUnitSalePrice
} from "~/modules/items";
import { ItemSalePriceForm } from "~/modules/items/ui/Item";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const serviceUnitSalePrice = await getItemUnitSalePrice(
    client,
    itemId,
    companyId
  );

  if (serviceUnitSalePrice.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(
          serviceUnitSalePrice.error,
          "Failed to load service unit sale price"
        )
      )
    );
  }

  return {
    serviceUnitSalePrice: serviceUnitSalePrice.data,
    itemId
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts"
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

  const updateServiceUnitSalePrice = await upsertItemUnitSalePrice(client, {
    ...validation.data,
    itemId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (updateServiceUnitSalePrice.error) {
    throw redirect(
      path.to.service(itemId),
      await flash(
        request,
        error(
          updateServiceUnitSalePrice.error,
          "Failed to update service sale price"
        )
      )
    );
  }

  throw redirect(
    path.to.serviceSales(itemId),
    await flash(request, success("Updated service sale price"))
  );
}

export default function ServiceSalesRoute() {
  const { serviceUnitSalePrice, itemId } = useLoaderData<typeof loader>();

  const initialValues = {
    ...serviceUnitSalePrice,
    salesUnitOfMeasureCode: serviceUnitSalePrice?.salesUnitOfMeasureCode ?? "",
    ...getCustomFields(serviceUnitSalePrice.customFields),
    itemId: itemId
  };

  return (
    <VStack spacing={2} className="p-2">
      <ItemSalePriceForm
        key={initialValues.itemId}
        initialValues={initialValues}
      />
    </VStack>
  );
}
