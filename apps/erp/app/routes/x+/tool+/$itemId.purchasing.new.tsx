import { assertIsPost, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { useRouteData } from "@carbon/remix";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useNavigate, useParams } from "react-router";
import type { ToolSummary } from "~/modules/items";
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

  const createToolSupplier = await upsertSupplierPart(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createToolSupplier.error) {
    return {
      success: false,
      message: "Failed to create tool supplier"
    };
  }

  throw redirect(
    path.to.toolPurchasing(itemId),
    await flash(request, success("Tool supplier created"))
  );
}

export default function NewToolSupplierRoute() {
  const { itemId } = useParams();

  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ toolSummary: ToolSummary }>(
    path.to.tool(itemId)
  );

  const navigate = useNavigate();
  const onClose = () => navigate(path.to.toolPurchasing(itemId));

  const initialValues = {
    itemId: itemId,
    supplierId: "",
    supplierToolId: "",
    unitPrice: 0,
    supplierUnitOfMeasureCode: "EA",
    minimumOrderQuantity: 1,
    conversionFactor: 1
  };

  return (
    <SupplierPartForm
      type="Tool"
      initialValues={initialValues}
      unitOfMeasureCode={routeData?.toolSummary?.unitOfMeasureCode ?? ""}
      onClose={onClose}
    />
  );
}
