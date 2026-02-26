import { assertIsPost, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useRouteData } from "@carbon/remix";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import type { MaterialSummary } from "~/modules/items";
import { supplierPartValidator, upsertSupplierPart } from "~/modules/items";
import { SupplierPartForm } from "~/modules/items/ui/Item";
import { getDatabaseClient } from "~/services/database.server";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });

  const { supplierPartId } = params;
  if (!supplierPartId) throw new Error("Could not find supplierPartId");

  const [supplierPartResult, priceBreaksResult] = await Promise.all([
    client
      .from("supplierPart")
      .select("*")
      .eq("id", supplierPartId)
      .eq("companyId", companyId)
      .single(),
    client
      .from("supplierPartPrice")
      .select("quantity, unitPrice, sourceType, sourceDocumentId, createdAt")
      .eq("supplierPartId", supplierPartId)
      .order("quantity", { ascending: true })
  ]);

  if (!supplierPartResult?.data)
    throw new Error("Could not find supplier part");

  const supplierPart = supplierPartResult.data;

  const purchasingHistory = await client
    .from("purchaseOrderLine")
    .select(
      "id, purchaseQuantity, unitPrice, purchaseOrderId, purchaseOrder!inner(purchaseOrderId, supplierId, orderDate)"
    )
    .eq("itemId", supplierPart.itemId)
    .eq("purchaseOrder.supplierId", supplierPart.supplierId)
    .order("createdAt", { ascending: false })
    .limit(10);

  return {
    supplierPart,
    priceBreaks: priceBreaksResult.data ?? [],
    purchasingHistory: purchasingHistory.data ?? []
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "parts"
  });

  const { itemId, supplierPartId } = params;
  if (!itemId) throw new Error("Could not find itemId");
  if (!supplierPartId) throw new Error("Could not find supplierPartId");

  const formData = await request.formData();

  const validation = await validator(supplierPartValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const updatedSupplierPart = await upsertSupplierPart(client, {
    id: supplierPartId,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updatedSupplierPart.error) {
    return { success: false, message: "Failed to update supplier part" };
  }

  const priceBreaksRaw = formData.get("priceBreaks");
  if (priceBreaksRaw) {
    const priceBreaks = JSON.parse(priceBreaksRaw as string) as {
      quantity: number;
      unitPrice: number;
      leadTime: number;
    }[];
    const db = getDatabaseClient();
    await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom("supplierPartPrice")
        .where("supplierPartId", "=", supplierPartId)
        .execute();
      if (priceBreaks.length > 0) {
        await trx
          .insertInto("supplierPartPrice")
          .values(
            priceBreaks.map((pb) => ({
              supplierPartId,
              quantity: pb.quantity,
              unitPrice: pb.unitPrice,
              leadTime: pb.leadTime ?? 0,
              sourceType: "Manual Entry" as const,
              companyId,
              createdBy: userId,
              updatedBy: userId
            }))
          )
          .execute();
      }
    });
  }

  throw redirect(
    path.to.materialPurchasing(itemId),
    await flash(request, success("Supplier part updated"))
  );
}

export default function EditMaterialSupplierRoute() {
  const { itemId } = useParams();
  const { supplierPart, priceBreaks, purchasingHistory } =
    useLoaderData<typeof loader>();

  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ materialSummary: MaterialSummary }>(
    path.to.material(itemId)
  );

  const navigate = useNavigate();
  const onClose = () => navigate(path.to.materialPurchasing(itemId));

  const initialValues = {
    id: supplierPart.id,
    itemId: supplierPart.itemId,
    supplierId: supplierPart.supplierId,
    supplierPartId: supplierPart.supplierPartId ?? "",
    unitPrice: supplierPart.unitPrice ?? 0,
    supplierUnitOfMeasureCode: supplierPart.supplierUnitOfMeasureCode ?? "EA",
    minimumOrderQuantity: supplierPart.minimumOrderQuantity ?? 1,
    conversionFactor: supplierPart.conversionFactor ?? 1
  };

  return (
    <SupplierPartForm
      type="Material"
      initialValues={initialValues}
      unitOfMeasureCode={routeData?.materialSummary?.unitOfMeasureCode ?? ""}
      priceBreaks={priceBreaks}
      purchasingHistory={purchasingHistory}
      onClose={onClose}
    />
  );
}
