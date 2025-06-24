import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useRouteData } from "@carbon/remix";
import { useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import type { ToolSummary } from "~/modules/items";
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
    return json({
      success: false,
      message: "Invalid form data",
    });
  }

  const { id, ...data } = validation.data;

  const createToolSupplier = await upsertSupplierPart(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createToolSupplier.error) {
    return json({
      success: false,
      message: "Failed to create tool supplier",
    });
  }

  return json({
    success: true,
    message: "Tool supplier created",
  });
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
    conversionFactor: 1,
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
