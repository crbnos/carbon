import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useParams } from "@remix-run/react";
import {
  BuyMethodForm,
  buyMethodValidator,
  upsertBuyMethod,
} from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(buyMethodValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const createMaterialSupplier = await upsertBuyMethod(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createMaterialSupplier.error) {
    throw redirect(
      path.to.materialSuppliers(itemId),
      await flash(
        request,
        error(
          createMaterialSupplier.error,
          "Failed to create material supplier"
        )
      )
    );
  }

  throw redirect(path.to.materialSuppliers(itemId));
}

export default function NewMaterialSupplierRoute() {
  const { itemId } = useParams();

  if (!itemId) throw new Error("itemId not found");

  const initialValues = {
    itemId: itemId,
    supplierId: "",
    supplierMaterialId: "",
    unitPrice: 0,
    supplierUnitOfMeasureCode: "EA",
    minimumOrderQuantity: 1,
    conversionFactor: 1,
  };

  return <BuyMethodForm type="Material" initialValues={initialValues} />;
}
