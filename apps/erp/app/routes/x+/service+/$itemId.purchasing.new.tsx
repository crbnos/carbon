import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useRouteData } from "@carbon/react";
import type { ActionFunctionArgs } from "react-router";
import { useNavigate, useParams } from "react-router";
import type { ServiceSummary } from "~/modules/items";
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

  const createServiceSupplier = await upsertSupplierPart(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createServiceSupplier.error) {
    return {
      success: false,
      message: "Failed to create service supplier"
    };
  }

  const newSupplierPartId = createServiceSupplier.data?.id;
  const priceBreaksRaw = formData.get("priceBreaks");
  if (newSupplierPartId && priceBreaksRaw) {
    const priceBreaks = JSON.parse(priceBreaksRaw as string) as {
      quantity: number;
      unitPrice: number;
      leadTime: number;
    }[];
    if (priceBreaks.length > 0) {
      await client.from("supplierPartPrice").insert(
        priceBreaks.map((pb) => ({
          supplierPartId: newSupplierPartId,
          quantity: pb.quantity,
          unitPrice: pb.unitPrice,
          leadTime: pb.leadTime ?? 0,
          sourceType: "Manual Entry" as const,
          companyId,
          createdBy: userId,
          updatedBy: userId
        }))
      );
    }
  }

  return { success: true, message: "Service supplier created" };
}

export default function NewServiceSupplierRoute() {
  const { itemId } = useParams();

  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ serviceSummary: ServiceSummary }>(
    path.to.service(itemId)
  );

  const navigate = useNavigate();
  const onClose = () => navigate(path.to.servicePurchasing(itemId));

  const initialValues = {
    itemId: itemId,
    supplierId: "",
    supplierPartId: "",
    unitPrice: 0,
    supplierUnitOfMeasureCode: "EA",
    minimumOrderQuantity: 1,
    orderMultiple: 1,
    conversionFactor: 1
  };

  return (
    <SupplierPartForm
      type="Service"
      initialValues={initialValues}
      unitOfMeasureCode={routeData?.serviceSummary?.unitOfMeasureCode ?? ""}
      onClose={onClose}
    />
  );
}
