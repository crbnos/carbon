import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import { useRouteData } from "@carbon/remix";
import { useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import type { ConsumableSummary } from "~/modules/items";
import { supplierPartValidator, upsertSupplierPart } from "~/modules/items";
import { SupplierPartForm } from "~/modules/items/ui/Item";
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

  const createConsumableSupplier = await upsertSupplierPart(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createConsumableSupplier.error) {
    return json({
      success: false,
      message: "Failed to create consumable supplier",
    });
  }

  return json({
    success: true,
    message: "Consumable supplier created successfully",
  });
}

export default function NewConsumableSupplierRoute() {
  const { itemId } = useParams();

  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ consumableSummary: ConsumableSummary }>(
    path.to.consumable(itemId)
  );

  const navigate = useNavigate();
  const onClose = () => navigate(path.to.consumablePurchasing(itemId));

  const initialValues = {
    itemId: itemId,
    supplierId: "",
    supplierConsumableId: "",
    unitPrice: 0,
    supplierUnitOfMeasureCode: "EA",
    minimumOrderQuantity: 1,
    conversionFactor: 1,
  };

  return (
    <SupplierPartForm
      type="Consumable"
      initialValues={initialValues}
      unitOfMeasureCode={routeData?.consumableSummary?.unitOfMeasureCode ?? ""}
      onClose={onClose}
    />
  );
}
