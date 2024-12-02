import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import {
  SupplierPartForm,
  supplierPartValidator,
  upsertSupplierPart,
} from "~/modules/items";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(supplierPartValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const createPartSupplier = await upsertSupplierPart(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createPartSupplier.error) {
    throw redirect(
      path.to.partPurchasing(itemId),
      await flash(
        request,
        error(createPartSupplier.error, "Failed to create part supplier")
      )
    );
  }

  throw redirect(path.to.partPurchasing(itemId));
}

export default function NewPartSupplierRoute() {
  const { itemId } = useParams();

  if (!itemId) throw new Error("itemId not found");

  const initialValues = {
    itemId: itemId,
    supplierId: "",
    supplierPartId: "",
    unitPrice: 0,
    supplierUnitOfMeasureCode: "EA",
    minimumOrderQuantity: 1,
    conversionFactor: 1,
  };

  return <SupplierPartForm type="Part" initialValues={initialValues} />;
}
