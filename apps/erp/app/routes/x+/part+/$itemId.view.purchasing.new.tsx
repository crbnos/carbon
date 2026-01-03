import { assertIsPost, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { useRouteData } from "@carbon/remix";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useNavigate, useParams } from "react-router";
import type { PartSummary } from "~/modules/items";
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
    return {
      success: false,
      message: "Invalid form data"
    };
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const createPartSupplier = await upsertSupplierPart(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createPartSupplier.error) {
    return {
      success: false,
      message: "Failed to create part supplier"
    };
  }

  throw redirect(
    path.to.partPurchasing(itemId),
    await flash(request, success("Part supplier created"))
  );
}

export default function NewPartSupplierRoute() {
  const { itemId } = useParams();

  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ partSummary: PartSummary }>(
    path.to.part(itemId)
  );

  const initialValues = {
    itemId: itemId,
    supplierId: "",
    supplierPartId: "",
    unitPrice: 0,
    supplierUnitOfMeasureCode: "EA",
    minimumOrderQuantity: 1,
    conversionFactor: 1
  };

  const navigate = useNavigate();
  const onClose = () => navigate(path.to.partPurchasing(itemId));

  return (
    <SupplierPartForm
      type="Part"
      initialValues={initialValues}
      unitOfMeasureCode={routeData?.partSummary?.unitOfMeasureCode ?? ""}
      onClose={onClose}
    />
  );
}
