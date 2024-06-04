import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  PartSalePriceForm,
  getItemUnitSalePrice,
  itemUnitSalePriceValidator,
  upsertItemUnitSalePrice,
} from "~/modules/parts";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [partUnitSalePrice] = await Promise.all([
    getItemUnitSalePrice(client, itemId, companyId),
  ]);

  if (partUnitSalePrice.error) {
    throw redirect(
      path.to.parts,
      await flash(
        request,
        error(partUnitSalePrice.error, "Failed to load part unit sale price")
      )
    );
  }

  return json({
    partUnitSalePrice: partUnitSalePrice.data,
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
    path.to.partSalePrice(itemId),
    await flash(request, success("Updated part sale price"))
  );
}

export default function PartSalePriceRoute() {
  const { partUnitSalePrice } = useLoaderData<typeof loader>();

  const initialValues = {
    ...partUnitSalePrice,
    salesUnitOfMeasureCode: partUnitSalePrice?.salesUnitOfMeasureCode ?? "",
    ...getCustomFields(partUnitSalePrice.customFields),
  };

  return (
    <PartSalePriceForm
      key={initialValues.itemId}
      initialValues={initialValues}
    />
  );
}
