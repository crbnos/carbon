import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect, useLoaderData, useParams } from "@remix-run/react";

import { getQuoteMaterial, QuoteMaterialForm } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { path } from "~/utils/path";
import { error } from "~/utils/result";
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
  });

  const { quoteId, lineId, materialId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");
  if (!materialId) throw new Error("Could not find materialId");

  const [material] = await Promise.all([getQuoteMaterial(client, materialId)]);

  if (material.error) {
    throw redirect(
      path.to.quoteLine(quoteId, lineId),
      await flash(
        request,
        error(material.error, "Failed to load quote material")
      )
    );
  }

  return json({
    material: {
      ...material.data,
      id: material.data.id ?? "",
      description: material.data.description ?? "",
      itemId: material.data.itemId ?? "",
      itemReadableId: material.data.itemReadableId ?? "",
      itemType: material.data.itemType as "Part",
      methodType: material.data.methodType ?? "Make",
      order: material.data.order ?? 1,
      quantity: material.data.quantity ?? 0,
      quoteMakeMethodId: material.data.quoteMakeMethodId ?? "",
      quoteMaterialMakeMethodId: material.data.quoteMaterialMakeMethodId,
      quoteOperationId: material.data.quoteOperationId ?? undefined,
      unitOfMeasureCode: material.data.unitOfMeasureCode ?? "",
    },
  });
}

export default function QuoteMaterialBuyPage() {
  const { material } = useLoaderData<typeof loader>();

  const { materialId } = useParams();
  if (!materialId) throw new Error("Could not find materialId");

  return (
    <VStack spacing={2} className="p-2">
      <QuoteMaterialForm
        key={materialId}
        initialValues={material}
        operations={[]}
      />
    </VStack>
  );
}
