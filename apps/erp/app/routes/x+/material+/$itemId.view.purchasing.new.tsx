import { assertIsPost, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useRouteData } from "@carbon/remix";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useNavigate, useParams } from "react-router";
import type { MaterialSummary } from "~/modules/items";
import { supplierPartValidator, upsertSupplierPart } from "~/modules/items";
import { SupplierPartForm } from "~/modules/items/ui/Item";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(supplierPartValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const createMaterialSupplier = await upsertSupplierPart(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createMaterialSupplier.error) {
    return {
      success: false,
      message: "Failed to create material supplier"
    };
  }

  throw redirect(
    path.to.materialPurchasing(itemId),
    await flash(request, success("Material supplier created"))
  );
}

export default function NewMaterialSupplierRoute() {
  const { itemId } = useParams();

  if (!itemId) throw new Error("itemId not found");
  const routeData = useRouteData<{ materialSummary: MaterialSummary }>(
    path.to.material(itemId)
  );

  const initialValues = {
    itemId: itemId,
    supplierId: "",
    supplierMaterialId: "",
    unitPrice: 0,
    supplierUnitOfMeasureCode: "EA",
    minimumOrderQuantity: 1,
    conversionFactor: 1
  };

  const navigate = useNavigate();
  const onClose = () => navigate(path.to.materialPurchasing(itemId));

  return (
    <SupplierPartForm
      type="Material"
      initialValues={initialValues}
      unitOfMeasureCode={routeData?.materialSummary?.unitOfMeasureCode ?? ""}
      onClose={onClose}
    />
  );
}
